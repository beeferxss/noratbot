const BotInstance = require('../core/botinstance');

module.exports = function dummyBotsPlugin(bot) {
    const dummies = new Map(); // id -> { id, name, instance, createdAt }
    let seq = 1;

    function log(msg) {
        console.log(`[${bot.id}] [DummyBots] ${msg}`);
    }

    function randName() {
        const n = Math.floor(Math.random() * 9000) + 1000;
        return `Dummy${n}`;
    }

    function normKey(v) {
        return String(v || '').trim().toLowerCase();
    }

    function makeGlobalConfig() {
        const g = JSON.parse(JSON.stringify(bot.globalConfig || bot.gconf || {}));
        g.minecraft = g.minecraft || {};
        g.minecraft.connection = g.minecraft.connection || {};
        // Keep reconnecting; always require proxy (no direct fallback) and rotate on failure.
        g.minecraft.connection.autoReconnect = true;
        g.minecraft.connection.maxAttempts = Number.MAX_SAFE_INTEGER;
        g.proxy = g.proxy || {};
        g.proxy.enabled = true;
        g.proxy.fallbackDirect = false;
        return g;
    }

    function makeServerConfig(name) {
        const base = bot.config || bot.conf || {};
        return {
            id: `dummy-${bot.id}-${seq++}`,
            host: base.host,
            port: base.port,
            version: base.version,
            username: name,
            auth: base.auth || 'offline',
            enabled: true,
            proxy: base.proxy
        };
    }

    function addDummy(requestedName) {
        let name = String(requestedName || '').trim();
        if (!name) name = randName();
        // avoid duplicate names/ids in our registry by suffix if needed
        let finalName = name;
        let suffix = 2;
        while ([...dummies.values()].some(d => normKey(d.name) === normKey(finalName))) {
            finalName = `${name}${suffix++}`;
        }
        const globalCfg = makeGlobalConfig();
        const srvCfg = makeServerConfig(finalName);
        const instance = new BotInstance(globalCfg, srvCfg);
        // Prevent loading all plugins into dummy clients.
        instance.pluginsLoaded = true;
        instance.isDummy = true;
        instance.dummyName = finalName;
        instance.dummyId = srvCfg.id;

        // Ensure proxy-only behavior; if somehow no proxy is acquired, keep retrying.
        instance.on('bot:error', err => {
            log(`Dummy ${finalName} error: ${err?.message || err}`);
        });
        instance.on('bot:disconnect', reason => {
            log(`Dummy ${finalName} disconnected: ${reason}`);
        });
        instance.on('bot:login', () => {
            log(`Dummy ${finalName} connected as ${finalName}`);
        });

        const entry = { id: srvCfg.id, name: finalName, instance, createdAt: Date.now() };
        dummies.set(srvCfg.id, entry);
        try {
            instance.start();
        } catch (e) {
            log(`Failed to start dummy ${finalName}: ${e?.message || e}`);
        }
        return entry;
    }

    function getEntry(idOrName) {
        if (!idOrName) return null;
        const key = String(idOrName).trim();
        if (dummies.has(key)) return dummies.get(key);
        const nk = normKey(key);
        return [...dummies.values()].find(d => normKey(d.name) === nk || normKey(d.id) === nk) || null;
    }

    async function removeEntry(idOrName) {
        const entry = getEntry(idOrName);
        if (!entry) return null;
        try { await entry.instance.destroy(); } catch (e) {}
        dummies.delete(entry.id);
        return entry;
    }

    async function clearAll() {
        const list = [...dummies.values()];
        for (const entry of list) {
            try { await entry.instance.destroy(); } catch (e) {}
            dummies.delete(entry.id);
        }
        return list.length;
    }

    function runCommandOn(entry, command) {
        if (!entry || !entry.instance) return false;
        const cmd = String(command || '').trim().replace(/^\/+/, '');
        if (!cmd) return false;
        const inst = entry.instance;
        // "run commands as them" - send as chat/command.
        if (inst.ready && typeof inst.chat === 'function') {
            return inst.chat('/' + cmd);
        }
        // If client exists but chat method differs, try direct client.chat
        if (inst.client && typeof inst.client.chat === 'function') {
            try { inst.client.chat('/' + cmd); return true; } catch (e) { return false; }
        }
        return false;
    }

    bot.dummyBots = {
        add(name, amount = 1) {
            const n = Math.max(1, Math.min(50, Number(amount) || 1));
            const created = [];
            for (let i = 0; i < n; i++) {
                // if multiple requested with a base name, suffix them
                const base = String(name || '').trim();
                const useName = (!base) ? '' : (n === 1 ? base : `${base}${i + 1}`);
                created.push(addDummy(useName));
            }
            return created;
        },
        list() {
            return [...dummies.values()].map(e => ({
                id: e.id,
                name: e.name,
                ready: !!e.instance?.ready,
                connecting: !!e.instance?._connecting,
                destroyed: !!e.instance?.destroyed,
                proxy: e.instance?.proxy ? `${e.instance.proxy.host}:${e.instance.proxy.port}` : null,
                createdAt: e.createdAt
            }));
        },
        get: getEntry,
        async remove(idOrName) { return await removeEntry(idOrName); },
        async clear() { return await clearAll(); },
        run(idOrNameOrAll, command) {
            const cmd = String(command || '').trim();
            if (!cmd) return { ok: false, count: 0 };
            const target = String(idOrNameOrAll || '').trim();
            let targets = [];
            if (target === '-all' || target === '--all' || target === '*') {
                targets = [...dummies.values()];
            } else {
                const e = getEntry(target);
                if (e) targets = [e];
            }
            let count = 0;
            for (const e of targets) {
                if (runCommandOn(e, cmd)) count++;
            }
            return { ok: count > 0, count, total: targets.length };
        }
    };

    bot.on('bot:destroy', async () => {
        await clearAll();
    });
};
