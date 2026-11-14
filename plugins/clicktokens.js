const RANGE_MAX = 3420556;
const TOKEN_TTL_MS = 3 * 60 * 1000;

module.exports = function clickTokensPlugin(bot) {
    const tokens = new Map(); // token command string -> { source, action }
    const bySource = new Map(); // source command -> Set(token command string)

    function makeToken() {
        let token;
        let cmd;
        do {
            token = Math.floor(Math.random() * (RANGE_MAX + 1));
            cmd = `/random value ${token}..${token + 1}`;
        } while (tokens.has(cmd));
        return cmd;
    }

    function register(source, action) {
        const src = String(source || 'unknown').toLowerCase();
        // prune expired tokens first
        const now = Date.now();
        for (const [cmd, entry] of tokens) {
            if (now - (entry.createdAt || 0) > TOKEN_TTL_MS) {
                tokens.delete(cmd);
                const set = bySource.get(entry.source);
                if (set) set.delete(cmd);
            }
        }
        const cmd = makeToken();
        tokens.set(cmd, { source: src, action, createdAt: now });
        if (!bySource.has(src)) bySource.set(src, new Set());
        bySource.get(src).add(cmd);
        return cmd;
    }

    function invalidate(source) {
        const src = String(source || '').toLowerCase();
        const set = bySource.get(src);
        if (!set) return 0;
        let count = 0;
        for (const cmd of set) {
            tokens.delete(cmd);
            count++;
        }
        bySource.delete(src);
        return count;
    }

    function resolve(cmdString) {
        const key = String(cmdString || '').trim();
        const entry = tokens.get(key);
        if (!entry) return null;
        if (Date.now() - (entry.createdAt || 0) > TOKEN_TTL_MS) {
            tokens.delete(key);
            const set = bySource.get(entry.source);
            if (set) set.delete(key);
            return null;
        }
        tokens.delete(key);
        const set = bySource.get(entry.source);
        if (set) set.delete(key);
        return entry;
    }

    function extractPlayerAndCommand(msg) {
        const clean = String(msg || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!clean) return null;
        const m = clean.match(/\/random\s+value\s+(\d+)\.\.(\d+)/i);
        if (!m) return null;
        const tokenCmd = `/random value ${m[1]}..${m[2]}`;

        let player = null;
        // common cspy/chat formats
        let pm = clean.match(/issued server command:\s*\/random/i);
        if (pm) {
            const nameMatch = clean.match(/^([A-Za-z0-9_]+)\s+issued server command:/i);
            if (nameMatch) player = nameMatch[1];
        }
        if (!player) {
            pm = clean.match(/^\[([^\]]+)\]\s*\/random/i);
            if (pm) player = pm[1].trim();
        }
        if (!player) {
            pm = clean.match(/^([^:]+):\s*\/random/i);
            if (pm) player = pm[1].trim();
        }
        if (!player) {
            // fallback: any username-like token immediately before /random
            pm = clean.match(/([A-Za-z0-9_]{2,16})[^\n]*\/random\s+value/i);
            if (pm) player = pm[1];
        }
        if (player) player = player.replace(/^\.+/, '').trim();

        console.log(`[${bot.id}] [ClickTokens] parsed chat="${clean}" player="${player}" token="${tokenCmd}"`);
        return { player, tokenCmd };
    }

    async function handleChat(msg) {
        if (typeof msg !== 'string') return;
        const parsed = extractPlayerAndCommand(msg);
        if (!parsed) return;

        const entry = resolve(parsed.tokenCmd);
        if (!entry) {
            console.log(`[${bot.id}] [ClickTokens] no entry for ${parsed.tokenCmd}`);
            return;
        }

        const clickerName = parsed.player;
        if (!clickerName || clickerName.toLowerCase() === (bot.config?.username || bot.username || '').toLowerCase()) return;

        const uuid = (bot.commands?.getPlayerUUID ? bot.commands.getPlayerUUID(clickerName) : null)
            || (bot.playersAPI?.getUUID ? bot.playersAPI.getUUID(clickerName) : null)
            || (bot.playersAPI?.get ? bot.playersAPI.get(clickerName)?.uuid : null);
        const player = {
            username: clickerName,
            uuid,
            usedPrefix: (bot.globalConfig?.bot?.prefix?.[0]) || 'nr:'
        };

        try {
            await entry.action(clickerName, player);
        } catch (e) {
            console.error(`[${bot.id}] [ClickTokens] Action failed:`, e);
        }
    }

    bot.on('chat_plain', handleChat);

    function transform(components, source) {
        if (!bot.clickTokens || typeof bot.clickTokens.register !== 'function') return components;
        if (Array.isArray(components)) return components.map(c => transform(c, source));
        if (!components || typeof components !== 'object') return components;
        const out = { ...components };
        if (out.click_event && out.click_event.action === 'suggest_command' && typeof out.click_event.command === 'string') {
            const commandString = out.click_event.command.trim();
            const prefixes = (bot.globalConfig?.bot?.prefix || bot.globalConfig?.bot?.prefixes || ['nr:']);
            const usedPrefix = prefixes.find(p => commandString.toLowerCase().startsWith(String(p).toLowerCase())) || '';
            const raw = usedPrefix ? commandString.slice(usedPrefix.length).trim() : commandString;
            const parts = raw.split(/\s+/).filter(Boolean);
            const cmdName = (parts.shift() || '').toLowerCase();
            const args = parts;
            if (cmdName) {
                const tokenCmd = register(source || cmdName, async (clickerName, clickerPlayer) => {
                    await bot.commands.execute(cmdName, args, commandString, null, clickerPlayer);
                });
                out.click_event = { action: 'run_command', command: tokenCmd };
            }
        }
        for (const key of Object.keys(out)) {
            if (out[key] && typeof out[key] === 'object') {
                out[key] = transform(out[key], source);
            }
        }
        return out;
    }

    bot.clickTokens = {
        register,
        invalidate,
        resolve,
        transform,
        makeToken,

        component(text, tokenCmd, color, hoverText) {
            return {
                text: String(text),
                color: color || '#55aaff',
                click_event: { action: 'run_command', command: tokenCmd },
                hover_event: hoverText ? { action: 'show_text', value: { text: hoverText, color: 'green' } } : undefined
            };
        }
    };

    const cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [cmd, entry] of tokens) {
            if (now - (entry.createdAt || 0) > TOKEN_TTL_MS) {
                tokens.delete(cmd);
                const set = bySource.get(entry.source);
                if (set) set.delete(cmd);
            }
        }
    }, 60 * 1000);

    bot.on('bot:destroy', () => {
        clearInterval(cleanupTimer);
        tokens.clear();
        bySource.clear();
        bot.removeListener('chat_plain', handleChat);
    });
};
