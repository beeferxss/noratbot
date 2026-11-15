'use strict';

module.exports = function spawnproofPlugin(bot) {
    const cfg = bot.globalConfig?.spawnproof || bot.config?.spawnproof || {};
    if (cfg.enabled === false) return;

    const region = cfg.region || {};
    const size = Number.isFinite(Number(region.size)) ? Number(region.size) : 0;
    const ox = Number(region.x);
    const oy = Number(region.y);
    const oz = Number(region.z);
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz) || size <= 0) return;

    const bounds = { x: ox + size - 1, y: oy + size - 1, z: oz + size - 1 };
    const offset = Number.isFinite(Number(cfg.backupOffset)) ? Number(cfg.backupOffset) : 1000;
    const bx = ox + offset;
    const by = oy;
    const bz = oz + offset;
    const bBounds = { x: bx + size - 1, y: by + size - 1, z: bz + size - 1 };

    let restoring = false;
    let cooldown = false;
    let damagePending = false;
    let initialized = false;
    let backupReady = false;

    function inside(x, y, z) {
        return x >= ox && x <= bounds.x && y >= oy && y <= bounds.y && z >= oz && z <= bounds.z;
    }

    // Prefer the core, which writes the command into a command block without a
    // chat line; fall back to chat only with the leading slash attached.
    function runCommand(cmd) {
        const command = String(cmd === undefined || cmd === null ? '' : cmd).replace(/^\//, '').trim();
        if (!command) return false;
        if (bot.core && typeof bot.core.run === 'function' && bot.core.ready) {
            const result = bot.core.run(command);
            if (result !== false) return true;
        }
        if (typeof bot.chat !== 'function') return false;
        try {
            bot.chat('/' + command);
            return true;
        } catch (e) {
            return false;
        }
    }

    function scheduleRestore() {
        if (restoring) return;
        if (cooldown) { damagePending = true; return; }
        restoring = true;
        cooldown = true;
        const cmd = `clone ${bx} ${by} ${bz} ${bBounds.x} ${bBounds.y} ${bBounds.z} ${ox} ${oy} ${oz} replace`;
        runCommand(cmd);
        setTimeout(() => {
            restoring = false;
            cooldown = false;
            if (damagePending) {
                damagePending = false;
                scheduleRestore();
            }
        }, Number(cfg.cooldownMs) || 1000);
    }

    function onBlockChange(packet) {
        if (restoring) { damagePending = true; return; }
        if (!packet?.location) return;
        const x = packet.location.x, y = packet.location.y, z = packet.location.z;
        if (!inside(x, y, z)) return;
        // Treat any change in the region as potential damage.
        scheduleRestore();
    }

    function init() {
        if (initialized) return;
        initialized = true;
        // Create backup copy.
        const cmd = `clone ${ox} ${oy} ${oz} ${bounds.x} ${bounds.y} ${bounds.z} ${bx} ${by} ${bz} replace`;
        backupReady = runCommand(cmd);
    }

    bot.on('block_change', onBlockChange);
    // Delay init until bot is positioned.
    const timer = setTimeout(() => { init(); }, Number(cfg.initDelayMs) || 5000);
    bot.on('end', () => { clearTimeout(timer); bot.removeListener('block_change', onBlockChange); });

    bot.spawnproof = {
        region: { ox, oy, oz, size, bounds },
        backup: { bx, by, bz, bounds: bBounds },
        restore: () => scheduleRestore(),
        backupNow: () => {
            const cmd = `clone ${ox} ${oy} ${oz} ${bounds.x} ${bounds.y} ${bounds.z} ${bx} ${by} ${bz} replace`;
            backupReady = runCommand(cmd);
            return backupReady;
        }
    };
};
