// Credits: original noratbot by chipmunk — https://code.chipmunk.land/norat/noratbot/
// Launcher: a plain `node index.js` only supervises a child copy of this file.
// Exit code 42 (ba:restart force) starts it again, any other exit code ends it.
if (!process.env.NR_LAUNCHER) {
    const { spawn } = require('child_process');
    const run = () => {
        const child = spawn(process.execPath, [...process.execArgv, __filename, ...process.argv.slice(2)], {
            stdio: 'inherit',
            env: { ...process.env, NR_LAUNCHER: '1' }
        });
        child.on('exit', code => {
            if (code === 42) setTimeout(run, 1000);
            else process.exit(code ?? 0);
        });
    };
    run();
    return;
}

const fs = require('fs');
const path = require('path');
const BotManager = require('./core/botmanager');

const configPath = path.join(__dirname, 'config.json');

function loadConfig() {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config not found at ${configPath}`);
    }
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to parse config.json: ${error.message}`);
    }
    return config;
}

const config = loadConfig();
const manager = new BotManager(config);
global.botManager = manager;

manager.on('bot:created', bot => {});
manager.on('bot:connecting', bot => {
    console.log(`[${bot.id}] Connecting to ${bot.config.host}:${bot.config.port}`);
});
manager.on('bot:ready', () => {});
manager.on('bot:disconnect', (bot, reason) => {
    console.log(`[${bot.id}] Disconnected`, reason || '');
});
manager.on('bot:error', (bot, error) => {
    console.error(`[${bot.id}] Error:`, error);
});
manager.on('bot:reconnect', bot => {
    console.log(`[${bot.id}] Reconnecting...`);
});
manager.on('bot:failed', (bot, reason) => {
    console.log(`[${bot.id}] Failed permanently:`, reason);
});

const servers = Array.isArray(config?.minecraft?.servers)
    ? config.minecraft.servers
    : [];

global.botInitializing = true;

function isAntiFilterEnabled(server) {
    const g = config?.bot?.antiFilter;
    const s = server?.antiFilter;
    if (s === true || (s && typeof s === 'object' && s.enabled === true)) return true;
    if (s === false || (s && typeof s === 'object' && s.enabled === false)) return false;
    return g === true || (g && typeof g === 'object' && g.enabled === true);
}

function randomName(prefix = 'Bot') {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = prefix;
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

function buildAntiFilterPair(server) {
    const baseId = String(server.id || '').trim() || 'bot';
    // Controller: random name, vanished, does everything (commands/core/chat).
    const controller = JSON.parse(JSON.stringify(server));
    controller.id = `${baseId}-ctl`;
    controller.username = 'random';
    controller._antiFilterRole = 'controller';
    controller._antiFilterPair = baseId;
    // Decoy: visible bot, keeps configured name behavior (nick via selfcare) and can fill core.
    const decoy = JSON.parse(JSON.stringify(server));
    decoy.id = `${baseId}-decoy`;
    // Take name from config when explicitly set; else random-looking placeholder (nick will be applied).
    decoy.username = (typeof server.decoyUsername === 'string' && server.decoyUsername.trim()) ? server.decoyUsername.trim()
        : (typeof server.username === 'string' && server.username.trim() && server.username.trim().toLowerCase() !== 'random') ? server.username.trim()
        : randomName('Decoy');
    decoy._antiFilterRole = 'decoy';
    decoy._antiFilterPair = baseId;
    return { controller, decoy };
}

async function startBotsWithDelay() {
    const delayMs = 500;
    for (const server of servers) {
        if (!server || server.enabled !== true) continue;
        try {
            if (isAntiFilterEnabled(server)) {
                const { controller, decoy } = buildAntiFilterPair(server);
                manager.create(controller);
                console.log(`[Manager] Created ${controller.id} (anti-filter controller)`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                manager.create(decoy);
                console.log(`[Manager] Created ${decoy.id} (anti-filter decoy)`);
            } else {
                manager.create(server);
                console.log(`[Manager] Created ${server.id}`);
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        } catch (error) {
            console.error(`[Manager] Failed to create ${server.id}:`, error);
        }
    }
}

startBotsWithDelay()
    .then(() => {
        global.botInitializing = false;
        console.log('[Manager] All bots created. Starting deferred reconnects...');
        for (const bot of manager.list()) {
            if (!bot.ready && bot.pendingReconnect) {
                bot.startReconnect();
            }
        }
    })
    .catch(err => {
        console.error('[Manager] Error during startup:', err);
        global.botInitializing = false;
    });

process.on('uncaughtException', error => {
    console.error('[Process] Uncaught exception:', error);
});
process.on('unhandledRejection', error => {
    console.error('[Process] Unhandled rejection:', error);
});

module.exports = manager;