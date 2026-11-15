const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(process.cwd(), 'whitelist.json');

module.exports = function whitelistPlugin(bot) {
    const SCAN_INTERVAL = 100;
    const punishTimers = new Map();

    function log(msg) {
        console.log(`[${bot.id}] [Whitelist] ${msg}`);
    }

    function loadData() {
        try {
            if (!fs.existsSync(STORE_PATH)) {
                fs.writeFileSync(STORE_PATH, JSON.stringify({}), 'utf8');
                return {};
            }
            const raw = fs.readFileSync(STORE_PATH, 'utf8');
            if (!raw.trim()) return {};
            return JSON.parse(raw);
        } catch (e) {
            console.error(`[${bot.id}] [Whitelist] load error:`, e);
            return {};
        }
    }

    function saveData(data) {
        try {
            fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 4), 'utf8');
            return true;
        } catch (e) {
            console.error(`[${bot.id}] [Whitelist] save error:`, e);
            return false;
        }
    }

    function getServerData() {
        const all = loadData();
        if (!all[bot.id]) {
            all[bot.id] = { enabled: false, players: [], uuids: [], ips: [] };
            saveData(all);
        }
        if (typeof all[bot.id].enabled !== 'boolean') all[bot.id].enabled = false;
        if (!Array.isArray(all[bot.id].players)) all[bot.id].players = [];
        if (!Array.isArray(all[bot.id].uuids)) all[bot.id].uuids = [];
        if (!Array.isArray(all[bot.id].ips)) all[bot.id].ips = [];
        return all[bot.id];
    }

    function updateServerData(updateFn) {
        const all = loadData();
        if (!all[bot.id]) {
            all[bot.id] = { enabled: false, players: [], uuids: [], ips: [] };
        }
        if (typeof all[bot.id].enabled !== 'boolean') all[bot.id].enabled = false;
        if (!Array.isArray(all[bot.id].players)) all[bot.id].players = [];
        if (!Array.isArray(all[bot.id].uuids)) all[bot.id].uuids = [];
        if (!Array.isArray(all[bot.id].ips)) all[bot.id].ips = [];
        updateFn(all[bot.id]);
        saveData(all);
    }

    function cleanName(name) {
        return String(name || '').replace(/§[0-9a-fk-or]/g, '').trim().toLowerCase();
    }

    function isUuid(str) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str) ||
               /^[0-9a-f]{32}$/i.test(str);
    }

    function getPlayerIPsSet(player) {
        const set = new Set();
        if (player && (player.ip || player.IP)) set.add(String(player.ip || player.IP).trim());
        const name = player?.username || player?.name;
        if (name && bot.playersDatabase) {
            if (typeof bot.playersDatabase.getPlayerIP === 'function') {
                try { const ip = bot.playersDatabase.getPlayerIP(name); if (ip) set.add(String(ip).trim()); } catch (e) {}
            }
            if (typeof bot.playersDatabase.getPlayerIPs === 'function') {
                try {
                    const all = bot.playersDatabase.getPlayerIPs(name, false) || [];
                    for (const e of all) if (e && e.ip) set.add(String(e.ip).trim());
                } catch (e) {}
            }
        }
        return set;
    }

    function isWhitelisted(player) {
        const data = getServerData();
        const name = player.username || player.name;
        const uuid = player.uuid;
        const botName = bot.config?.username || bot.username || '';
        if (botName && cleanName(name) === cleanName(botName)) return true;

        if (data.players.some(p => cleanName(p) === cleanName(name))) return true;
        if (data.uuids.some(id => String(id) === String(uuid))) return true;

        const ipSet = getPlayerIPsSet(player);
        if (ipSet.size) {
            for (const x of data.ips) {
                if (ipSet.has(String(x).trim())) return true;
            }
        }

        return false;
    }

    function shouldFilter(player) {
        const data = getServerData();
        if (!data.enabled) return false;
        if (!player) return false;
        const name = player.username || player.name;
        if (!name) return false;
        const botName = bot.config?.username || bot.username || '';
        if (botName && cleanName(name) === cleanName(botName)) return false;
        return !isWhitelisted(player);
    }

    function doFilter(player) {
        if (!player) return false;
        const name = player.username || player.name;
        if (!name) return false;
        // Apply as soon as the player appears, even on fresh join (uuid/online may lag).
        if (player.online === false) return false;
        const botName = bot.config?.username || bot.username || '';
        if (botName && cleanName(name) === cleanName(botName)) return false;

        const cmds = [
            `sudo ${name} tppos 300000 1000 300000 world_the_end`,
            `deop ${name}`,
            `gamemode spectator ${name}`,
            `kill ${name}`
        ];
        const runOnce = () => {
            if (bot.core && typeof bot.core.run === 'function') {
                for (const cmd of cmds) bot.core.run(cmd);
                // Spam elder guardian jumpscare without delay.
                for (let i = 0; i < 25; i++) bot.core.run(`jumpscare ${name}`);
            }
        };
        runOnce();

        const timerKey = player.uuid || cleanName(name);
        if (!punishTimers.has(timerKey)) {
            const timer = setInterval(() => {
                const current = bot.playersAPI?.get ? bot.playersAPI.get(name) : player;
                if (!current || current.online === false || !shouldFilter(current)) {
                    clearInterval(timer);
                    punishTimers.delete(timerKey);
                    return;
                }
                // If uuid becomes available later, keep timer keyed by name (stable enough).
                runOnce();
            }, 0);
            punishTimers.set(timerKey, timer);
        }
        return true;
    }

    function sweep() {
        const data = getServerData();
        if (!data.enabled) return;
        if (!bot.playersAPI || typeof bot.playersAPI.getAll !== 'function') return;
        const players = bot.playersAPI.getAll();
        if (!players || !players.length) return;
        for (const p of players) {
            if (!p || p.online === false) continue;
            if (shouldFilter(p)) doFilter(p);
        }
    }

    function enforceJoin(p) {
        if (!p) return;
        // Try immediately and again shortly to catch just-joined players even if
        // uuid/online/player state is not fully populated on the first event.
        const attempt = () => { if (shouldFilter(p)) doFilter(p); };
        attempt();
        setTimeout(attempt, 0);
        setTimeout(attempt, 50);
        setTimeout(attempt, 150);
    }

    bot.on('player_added', p => {
        enforceJoin(p);
    });

    bot.on('player_updated', p => {
        if (!p) return;
        if (shouldFilter(p)) doFilter(p);
    });

    bot.on('bot:join', () => {
        sweep();
    });

    bot.on('bot:login', () => {
        sweep();
    });

    const scanTimer = setInterval(sweep, SCAN_INTERVAL);
    bot.on('bot:disconnect', () => {
        for (const timer of punishTimers.values()) clearInterval(timer);
        punishTimers.clear();
    });
    bot.on('bot:destroy', () => {
        for (const timer of punishTimers.values()) clearInterval(timer);
        punishTimers.clear();
        clearInterval(scanTimer);
    });



    bot.whitelist = {
        isEnabled() { return getServerData().enabled; },
        on() { updateServerData(d => { d.enabled = true; }); sweep(); return true; },
        off() { updateServerData(d => { d.enabled = false; }); return true; },


        addPlayer(name) {
            const n = cleanName(name);
            if (!n) return false;
            let ok = false;
            updateServerData(data => {
                if (!data.players.includes(n)) {
                    data.players.push(n);
                    ok = true;
                }
            });
            if (ok) sweep();
            return ok;
        },

        removePlayer(name) {
            const n = cleanName(name);
            let ok = false;
            updateServerData(data => {
                const idx = data.players.indexOf(n);
                if (idx !== -1) {
                    data.players.splice(idx, 1);
                    ok = true;
                }
            });
            return ok;
        },

        listPlayers() { return getServerData().players; },
        clearPlayers() { updateServerData(data => { data.players = []; }); return true; },

        addUUID(uuid) {
            uuid = String(uuid).trim();
            if (!uuid) return false;
            let ok = false;
            updateServerData(data => {
                if (!data.uuids.includes(uuid)) {
                    data.uuids.push(uuid);
                    ok = true;
                }
            });
            if (ok) sweep();
            return ok;
        },

        removeUUID(uuid) {
            uuid = String(uuid).trim();
            let ok = false;
            updateServerData(data => {
                const idx = data.uuids.indexOf(uuid);
                if (idx !== -1) {
                    data.uuids.splice(idx, 1);
                    ok = true;
                }
            });
            return ok;
        },

        listUUIDs() { return getServerData().uuids; },
        clearUUIDs() { updateServerData(data => { data.uuids = []; }); return true; },

        addIP(ip) {
            ip = String(ip || '').trim();
            if (!ip) return false;
            let ok = false;
            updateServerData(data => {
                if (!data.ips.includes(ip)) {
                    data.ips.push(ip);
                    ok = true;
                }
            });
            if (ok) sweep();
            return ok;
        },

        removeIP(ip) {
            ip = String(ip || '').trim();
            let ok = false;
            updateServerData(data => {
                const idx = data.ips.indexOf(ip);
                if (idx !== -1) {
                    data.ips.splice(idx, 1);
                    ok = true;
                }
            });
            return ok;
        },

        listIPs() { return getServerData().ips; },
        clearIPs() { updateServerData(data => { data.ips = []; }); return true; },

        rescan() { sweep(); return true; }
    };
};
