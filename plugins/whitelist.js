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

        const punishKey = player.uuid || cleanName(name);
        if (punishTimers.has(punishKey)) return true;

        let stopped = false;
        const chineseChars = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几相九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江是眼铁另解更';

        function randomChinese(len) {
            let out = '';
            for (let i = 0; i < len; i++) out += chineseChars[Math.floor(Math.random() * chineseChars.length)];
            return out;
        }

        const spamTellraw = () => {
            if (stopped) return;
            const cur = bot.playersAPI?.get ? bot.playersAPI.get(name) : player;
            if (!cur || cur.online === false || !shouldFilter(cur)) { stop(); return; }
            if (bot.core && typeof bot.core.run === 'function') {
                const msg = randomChinese(300);
                const payload = JSON.stringify({ text: msg });
                bot.core.run(`tellraw ${name} ${payload}`);
            }
        };

        const stop = () => {
            if (stopped) return;
            stopped = true;
            const t = punishTimers.get(punishKey);
            if (t && t.timer) clearTimeout(t.timer);
            if (t && t.tellrawTimer) clearInterval(t.tellrawTimer);
            punishTimers.delete(punishKey);
        };

        const ensureEndJailWarp = () => {
            if (bot._endJailWarpReady) return bot._endJailWarpReady;
            bot._endJailWarpReady = (async () => {
                try {
                    const chat = (cmd) => { try { bot.chat('/' + String(cmd).replace(/^\//, '')); } catch (e) {} };
                    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                    // Determine return position (core area) so we can come back without placing core in the end.
                    let rx = 0, ry = 100, rz = 0;
                    const o = bot.core && bot.core.origin;
                    const b = bot.core && bot.core.bounds;
                    if (o && b && o.x !== null && o.z !== null) {
                        rx = Math.floor((o.x + b.x) / 2);
                        ry = (Number.isFinite(o.y) ? o.y : 100);
                        rz = Math.floor((o.z + b.z) / 2);
                    } else if (bot.entity && bot.entity.position) {
                        rx = Math.floor(bot.entity.position.x);
                        ry = Math.floor(bot.entity.position.y);
                        rz = Math.floor(bot.entity.position.z);
                    }
                    // Teleport to end, set warp, then return to core. No core placement in the end.
                    chat('tppos 100 64 100 world_the_end');
                    await sleep(1500);
                    chat('setwarp end_jail_trap');
                    await sleep(800);
                    chat(`tppos ${rx} ${ry} ${rz}`);
                    await sleep(500);
                    return true;
                } catch (e) {
                    return false;
                }
            })();
            return bot._endJailWarpReady;
        };

        const cycle = () => {
            if (stopped) return;
            const current = bot.playersAPI?.get ? bot.playersAPI.get(name) : player;
            if (!current || current.online === false || !shouldFilter(current)) {
                stop();
                return;
            }
            const exec = (cmd) => {
                if (bot.core && typeof bot.core.run === 'function') bot.core.run(cmd);
            };
            // Extremely aggressive punish cycle (Kaboom/vanilla-compatible commands), then repeat.
            const cmds = [
                `warp end_jail_trap ${name}`,
                `minecraft:tp ${name} 300000 1000 300000`,
                `tp ${name} 300000 1000 300000`,
                `deop ${name}`,
                `minecraft:deop ${name}`,
                `gamemode spectator ${name}`,
                `minecraft:gamemode spectator ${name}`,
                `core clear ${name}`,
                `workbench ${name}`,
                `cspy ${name} off`,
            ];
            // Burst commands multiple times per cycle for maximum enforcement.
            for (let r = 0; r < 5; r++) {
                for (const c of cmds) exec(c);
            }
            // Spam warp-to-jail and elder guardian jumpscare without delay (separate loops).
            for (let i = 0; i < 120; i++) exec(`warp end_jail_trap ${name}`);
            for (let i = 0; i < 120; i++) exec(`jumpscare ${name}`);
            const next = setTimeout(cycle, 0);
            const entry = punishTimers.get(punishKey);
            if (entry) entry.timer = next;
        };

        // Tellraw spam: 20x per second (every 50ms) with lots of Chinese characters.
        const tellrawTimer = setInterval(spamTellraw, 50);
        spamTellraw();
        punishTimers.set(punishKey, { timer: null, tellrawTimer, stop });
        ensureEndJailWarp();
        cycle();
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
        for (const v of punishTimers.values()) { try { if (v && v.timer) clearTimeout(v.timer); if (v && v.tellrawTimer) clearInterval(v.tellrawTimer); if (v && !v.timer && !v.tellrawTimer) clearInterval(v); } catch(e){} }
        punishTimers.clear();
    });
    bot.on('bot:destroy', () => {
        for (const v of punishTimers.values()) { try { if (v && v.timer) clearTimeout(v.timer); if (v && v.tellrawTimer) clearInterval(v.tellrawTimer); if (v && !v.timer && !v.tellrawTimer) clearInterval(v); } catch(e){} }
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
