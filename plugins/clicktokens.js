const RANGE_MAX = 3420556;

module.exports = function clickTokensPlugin(bot) {
    const tokens = new Map(); // token command string -> { source, action }
    const bySource = new Map(); // source command -> Set(token command string)

    function makeToken() {
        let token;
        let cmd;
        do {
            token = Math.floor(Math.random() * (RANGE_MAX + 1));
            cmd = `/random value ${token}..${token}`;
        } while (tokens.has(cmd));
        return cmd;
    }

    function register(source, action) {
        const src = String(source || 'unknown').toLowerCase();
        const cmd = makeToken();
        tokens.set(cmd, { source: src, action });
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
        if (player) player = player.replace(/^\.+/, '').trim();

        return { player, tokenCmd };
    }

    async function handleChat(msg) {
        if (typeof msg !== 'string') return;
        const parsed = extractPlayerAndCommand(msg);
        if (!parsed) return;

        const entry = resolve(parsed.tokenCmd);
        if (!entry) return;

        const clickerName = parsed.player;
        if (!clickerName || clickerName.toLowerCase() === (bot.config?.username || bot.username || '').toLowerCase()) return;

        const player = {
            username: clickerName,
            uuid: bot.commands?.getPlayerUUID ? bot.commands.getPlayerUUID(clickerName) : null,
            usedPrefix: (bot.globalConfig?.bot?.prefix?.[0]) || 'nr:'
        };

        try {
            await entry.action(clickerName, player);
        } catch (e) {
            console.error(`[${bot.id}] [ClickTokens] Action failed:`, e);
        }
    }

    bot.on('chat_plain', handleChat);

    bot.clickTokens = {
        register,
        invalidate,
        resolve,
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

    bot.on('bot:destroy', () => {
        tokens.clear();
        bySource.clear();
        bot.removeListener('chat_plain', handleChat);
    });
};
