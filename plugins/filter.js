const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(process.cwd(), 'filter.json');

module.exports = function filterPlugin(bot) {
    const SCAN_INTERVAL = 100;
    const punishTimers = new Map();

    function log(msg) {
        console.log(`[${bot.id}] [Filter] ${msg}`);
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
            console.error(`[${bot.id}] [Filter] load error:`, e);
            return {};
        }
    }

    function saveData(data) {
        try {
            fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 4), 'utf8');
            return true;
        } catch (e) {
            console.error(`[${bot.id}] [Filter] save error:`, e);
            return false;
        }
    }

    function getServerData() {
        const all = loadData();
        if (!all[bot.id]) {
            all[bot.id] = { enabled: true, players: [], uuids: [], ips: [], regex: null, mutes: [] };
            saveData(all);
        }
        if (typeof all[bot.id].enabled !== 'boolean') all[bot.id].enabled = true;
        if (!Array.isArray(all[bot.id].ips)) all[bot.id].ips = [];
        if (!Array.isArray(all[bot.id].mutes)) all[bot.id].mutes = [];
        return all[bot.id];
    }

    function updateServerData(updateFn) {
        const all = loadData();
        if (!all[bot.id]) {
            all[bot.id] = { enabled: true, players: [], uuids: [], ips: [], regex: null, mutes: [] };
        }
        if (typeof all[bot.id].enabled !== 'boolean') all[bot.id].enabled = true;
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

    function shouldFilter(player) {
        const data = getServerData();
        if (data.enabled === false) return false;
        const name = player.username || player.name;
        const uuid = player.uuid;
        const botName = bot.config?.username || bot.username || '';
        if (botName && cleanName(name) === cleanName(botName)) return false;

        const matchPlayer = data.players.some(p => cleanName(p) === cleanName(name));
        if (matchPlayer) return true;

        const matchUuid = data.uuids.some(id => String(id) === String(uuid));
        if (matchUuid) return true;

        const ipSet = new Set();
        const directIp = (player && (player.ip || player.IP)) || (bot.playersDatabase && typeof bot.playersDatabase.getPlayerIP === 'function' ? bot.playersDatabase.getPlayerIP(name) : null);
        if (directIp) ipSet.add(String(directIp).trim());
        if (bot.playersDatabase && typeof bot.playersDatabase.getPlayerIPs === 'function') {
            try {
                const all = bot.playersDatabase.getPlayerIPs(name, false) || [];
                for (const e of all) if (e && e.ip) ipSet.add(String(e.ip).trim());
            } catch (e) {}
        }
        if (ipSet.size) {
            for (const ip of data.ips) {
                if (ipSet.has(String(ip).trim())) return true;
            }
        }

        if (data.regex) {
            try {
                return new RegExp(data.regex, 'i').test(name);
            } catch { return false; }
        }
        return false;
    }

    function doFilter(player) {
        if (!player) return false;
        const name = player.username || player.name;
        const uuid = player.uuid;
        if (!name || !uuid || !player.online) return false;
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
                // for (let i = 0; i < 25; i++) bot.core.run(`jumpscare ${name}`);
            }
        };
        runOnce();

        if (!punishTimers.has(uuid)) {
            const timer = setInterval(() => {
                const current = bot.playersAPI?.get ? bot.playersAPI.get(name) : player;
                if (!current || current.online !== true || !shouldFilter(current)) {
                    clearInterval(timer);
                    punishTimers.delete(uuid);
                    return;
                }
                runOnce();
            }, 0);
            punishTimers.set(uuid, timer);
        }
        return true;
    }

    function sweep() {
        if (!bot.ready) return;
        if (getServerData().enabled === false) return;
        if (!bot.playersAPI || typeof bot.playersAPI.getAll !== 'function') return;
        const players = bot.playersAPI.getAll();
        if (!players || !players.length) return;
        for (const p of players) {
            if (p.online !== true || !p.uuid) continue;
            if (shouldFilter(p)) doFilter(p);
        }
    }

    bot.on('player_added', p => {
        if (!bot.ready || !p.online || !p.uuid) return;
        if (shouldFilter(p)) doFilter(p);
        runMuteForPlayer(p, 'join');
    });

    bot.on('player_updated', p => {
        if (!bot.ready || !p.online || !p.uuid) return;
        if (shouldFilter(p)) doFilter(p);
    });

    bot.on('bot:login', () => {
        sweep();
        runMutes('start');
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


    function cleanTarget(name) {
        return String(name || '').replace(/§[0-9a-fk-or]/g, '').trim();
    }

    function getMuteTargets() {
        const data = getServerData();
        return Array.isArray(data.mutes) ? data.mutes.map(cleanTarget).filter(Boolean) : [];
    }

    function runMuteCommand(target) {
        if (!target) return false;
        const t = cleanTarget(target);
        if (!t) return false;
        if (bot.core && typeof bot.core.run === 'function') {
            bot.core.run(`mute ${t} filtered by pikabot`);
            return true;
        }
        return false;
    }

    function isMutedTarget(name) {
        const n = cleanName(name);
        if (!n) return false;
        return getMuteTargets().some(t => cleanName(t) === n);
    }

    function runMuteForPlayer(player, reason) {
        if (!player) return;
        const name = cleanTarget(player.username || player.name);
        if (!name) return;
        if (isMutedTarget(name)) runMuteCommand(name);
    }

    function runMutes(reason) {
        if (!bot.ready) return;
        const targets = getMuteTargets();
        if (!targets.length) return;
        for (const t of targets) runMuteCommand(t);
    }

    // Best-effort: re-mute on self-unmute messages.
    bot.on('chat_plain', msg => {
        if (typeof msg !== 'string') return;
        const lower = msg.toLowerCase();
        const unmuteHints = ['unmuted', 'can now talk', 'no longer muted', 'you may now speak'];
        if (!unmuteHints.some(h => lower.includes(h))) return;
        // Try to extract a player name from common formats: "Player has been unmuted" / "Player can now talk"
        const m = msg.match(/([A-Za-z0-9_]{2,16})\s+(?:has been unmuted|is no longer muted|can now talk)/i);
        if (m && m[1] && isMutedTarget(m[1])) {
            runMuteCommand(m[1]);
            return;
        }
        // Fallback: re-apply to any muted target currently online.
        if (bot.playersAPI && typeof bot.playersAPI.getAll === 'function') {
            for (const p of bot.playersAPI.getAll() || []) {
                if (p && p.online && isMutedTarget(p.username || p.name)) runMuteCommand(p.username || p.name);
            }
        }
    });

    bot.filter = {
        isEnabled() { return getServerData().enabled !== false; },
        on() { updateServerData(d => { d.enabled = true; }); sweep(); return true; },
        off() { updateServerData(d => { d.enabled = false; }); return true; },

        get() {
            const data = getServerData();
            return { players: [...data.players], uuids: [...data.uuids], ips: [...(data.ips||[])], regex: data.regex, mutes: [...(data.mutes||[])] };
        },


        addMute(target) {
            const t = cleanTarget(target);
            if (!t) return false;
            let ok = false;
            updateServerData(data => {
                if (!Array.isArray(data.mutes)) data.mutes = [];
                const n = cleanName(t);
                if (!data.mutes.some(x => cleanName(x) === n)) {
                    data.mutes.push(t);
                    ok = true;
                }
            });
            if (ok) runMuteCommand(t);
            return ok;
        },

        removeMute(target) {
            const n = cleanName(target);
            let ok = false;
            updateServerData(data => {
                if (!Array.isArray(data.mutes)) data.mutes = [];
                const idx = data.mutes.findIndex(x => cleanName(x) === n);
                if (idx !== -1) {
                    data.mutes.splice(idx, 1);
                    ok = true;
                }
            });
            return ok;
        },

        listMutes() {
            return getMuteTargets();
        },

        clearMutes() {
            updateServerData(data => { data.mutes = []; });
            return true;
        },

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

        listPlayers() {
            return getServerData().players;
        },

        clearPlayers() {
            updateServerData(data => { data.players = []; });
            return true;
        },

        addUUID(uuid) {
            uuid = String(uuid).trim();
            if (!uuid || !isUuid(uuid)) return false;
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

        listUUIDs() {
            return getServerData().uuids;
        },

        clearUUIDs() {
            updateServerData(data => { data.uuids = []; });
            return true;
        },

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

        listIPs() {
            return getServerData().ips;
        },

        clearIPs() {
            updateServerData(data => { data.ips = []; });
            return true;
        },

        setRegex(regex) {
            let ok = false;
            updateServerData(data => {
                if (typeof regex !== 'string' || !regex.trim()) {
                    data.regex = null;
                } else {
                    try { new RegExp(regex); } catch { ok = false; return; }
                    data.regex = regex.trim();
                }
                ok = true;
            });
            if (ok) sweep();
            return ok;
        },

        getRegex() {
            return getServerData().regex;
        },

        removeRegex() {
            updateServerData(data => { data.regex = null; });
            return true;
        },

        rescan() {
            sweep();
            return true;
        }
    };
};