const minecraftData = require('minecraft-data');

module.exports = function core(bot) {
    const cfg = bot.globalConfig?.core || bot.config?.core || {};
    const area = cfg.area || {};
    const refillConfig = cfg.refill || {};

    const ENABLED = cfg.enabled !== false;
    const VERSION = bot.config?.version || '1.21.11';
    const SIZE = Number.isFinite(Number(area.size)) ? Number(area.size) : 16;
    const Y = Number.isFinite(Number(area.y)) ? Number(area.y) : 30;
    const HIDE = cfg.hide === true;
    const WORLD_BORDER = Number.isFinite(Number(cfg.worldBorder)) ? Math.max(SIZE, Number(cfg.worldBorder)) : 29999984;
    const BLOCK = typeof refillConfig.block === 'string' && refillConfig.block.trim()
        ? refillConfig.block.trim().replace(/^minecraft:/, '')
        : 'repeating_command_block'; // {CustomName:{"text":"https://norat.pw","color":"blue","click_event":{"action":"open_url","url":"https://norat.pw"}}}
    const MODE = typeof refillConfig.mode === 'string' && refillConfig.mode.trim()
        ? refillConfig.mode.trim()
        : 'destroy';

    const INITIAL_DELAY = Number.isFinite(Number(cfg.initialDelay)) ? Number(cfg.initialDelay) : 2000;
    const CHUNK_DELAY = Number.isFinite(Number(cfg.chunkChangeDelay)) ? Number(cfg.chunkChangeDelay) : 200;
    const DAMAGE_DELAY = Number.isFinite(Number(cfg.damageDelay)) ? Number(cfg.damageDelay) : 50;
    const REFILL_FINISH = Number.isFinite(Number(cfg.refillFinishDelay)) ? Number(cfg.refillFinishDelay) : 100;
    const REFILL_COOLDOWN = Number.isFinite(Number(cfg.refillCooldown)) ? Number(cfg.refillCooldown) : 1;
    const OWN_CHANGE_TIME = Number.isFinite(Number(cfg.ownChangeDuration)) ? Number(cfg.ownChangeDuration) : 2500;
    const SURVIVOR_MAX_AGE = Number.isFinite(Number(cfg.survivorMaxAge)) ? Number(cfg.survivorMaxAge) : 60000;

    if (!ENABLED) {
        bot.core = {
            ready: false,
            origin: { x: null, y: Y, z: null },
            bounds: { x: null, y: Y + SIZE - 1, z: null },
            cursor: { x: null, y: Y, z: null },
            reset() { return false; },
            refill() { return false; },
            run() { return false; },
            runTracked() { return Promise.resolve(null); },
            destroy() { this.ready = false; }
        };
        return;
    }

    let mcData = null;
    const repeatingStateIds = new Set();
    try {
        mcData = minecraftData(VERSION);
        const block = mcData?.blocksByName?.[BLOCK];
        if (block) {
            if (Number.isInteger(block.minStateId) && Number.isInteger(block.maxStateId)) {
                for (let id = block.minStateId; id <= block.maxStateId; id++) {
                    repeatingStateIds.add(id);
                }
            } else if (Number.isInteger(block.defaultState)) {
                repeatingStateIds.add(block.defaultState);
            }
        }
    } catch (error) {
        console.error(`[${bot.id}] [Core] minecraft-data init failed:`, error);
    }

    let PrismarineChunk = null;
    try {
        PrismarineChunk = require('prismarine-chunk')(VERSION);
    } catch (e) {
    }

    let position = null;
    let initialized = false;
    let chunkX = null;
    let chunkZ = null;
    let refilling = false;
    let cooldown = false;
    let initialTimer = null;
    let chunkTimer = null;
    let damageTimer = null;
    let finishTimer = null;

    const coreBlocks = new Map();
    const ownChanges = new Map();
    const MAX_OWN_CHANGES = Math.max(300, SIZE * SIZE * SIZE);

    function log(message) {
        console.log(`[${bot.id}] [Core] ${message}`);
    }

    function key(x, y, z) { return `${x}:${y}:${z}`; }

    function inside(x, y, z) {
        return bot.core.origin.x !== null &&
            x >= bot.core.origin.x && x <= bot.core.bounds.x &&
            y >= bot.core.origin.y && y <= bot.core.bounds.y &&
            z >= bot.core.origin.z && z <= bot.core.bounds.z;
    }

    function markOwn(x, y, z) {
        if (ownChanges.size >= MAX_OWN_CHANGES) {
            const keys = [...ownChanges.keys()];
            const toRemove = keys.slice(0, Math.floor(keys.length / 2));
            for (const key of toRemove) {
                ownChanges.delete(key);
            }
        }
        ownChanges.set(key(x, y, z), Date.now() + OWN_CHANGE_TIME);
    }

    function isOwn(x, y, z) {
        const id = key(x, y, z);
        const expires = ownChanges.get(id);
        if (!expires) return false;
        if (Date.now() >= expires) {
            ownChanges.delete(id);
            return false;
        }
        return true;
    }

    function cleanupOwn() {
        const now = Date.now();
        for (const [id, expires] of ownChanges) {
            if (now >= expires) ownChanges.delete(id);
        }
    }

    function createCoreMap(initialAlive = false) {
        coreBlocks.clear();
        if (bot.core.origin.x === null) return;
        const now = initialAlive ? Date.now() : 0;
        for (let x = bot.core.origin.x; x <= bot.core.bounds.x; x++) {
            for (let y = bot.core.origin.y; y <= bot.core.bounds.y; y++) {
                for (let z = bot.core.origin.z; z <= bot.core.bounds.z; z++) {
                    coreBlocks.set(key(x, y, z), {
                        alive: initialAlive,
                        verifiedAt: now
                    });
                }
            }
        }
    }

    function markBlock(x, y, z, alive, verified = true) {
        const entry = coreBlocks.get(key(x, y, z));
        if (!entry) return;
        entry.alive = Boolean(alive);
        if (verified) entry.verifiedAt = Date.now();
    }

    function getRecentlyVerifiedSurvivor() {
        const now = Date.now();
        for (const [id, entry] of coreBlocks) {
            if (!entry.alive || !entry.verifiedAt) continue;
            if (now - entry.verifiedAt > SURVIVOR_MAX_AGE) continue;
            
            const [x, y, z] = id.split(':').map(Number);
            return { x, y, z };
        }
        return null;
    }

    function isRepeatingState(state) {
        if (state === null || state === undefined) return null;
        if (typeof state === 'number') return repeatingStateIds.has(state);
        if (typeof state === 'bigint') return repeatingStateIds.has(Number(state));
        if (typeof state === 'string') {
            return state.replace(/^minecraft:/, '').toLowerCase() === BLOCK.toLowerCase();
        }
        if (typeof state === 'object') {
            if (Number.isInteger(state.stateId)) return repeatingStateIds.has(state.stateId);
            if (Number.isInteger(state.id)) return repeatingStateIds.has(state.id);
            if (typeof state.name === 'string') return isRepeatingState(state.name);
        }
        return null;
    }

    function extractState(packet) {
        if (!packet) return null;
        if (packet.blockState !== undefined) return packet.blockState;
        if (packet.state !== undefined) return packet.state;
        if (packet.type !== undefined) return packet.type;
        return null;
    }

    function scheduleDamage(reason) {
        if (!bot.core.ready || refilling || cooldown) return;
        if (damageTimer) clearTimeout(damageTimer);
        damageTimer = setTimeout(() => {
            damageTimer = null;
            if (!position || refilling || cooldown) return;
            bot.core.refill(reason);
        }, DAMAGE_DELAY);
    }

    async function refill(reason = 'damage') {
        if (!position) return false;
        if (refilling) return false;
        if (cooldown) return false;
        if (bot.core.origin.x === null && !bot.core.reset()) return false;

        refilling = true;
        bot.core.ready = false;
        cleanupOwn();

        const command = `fill ${bot.core.origin.x} ${bot.core.origin.y} ${bot.core.origin.z} ${bot.core.bounds.x} ${bot.core.bounds.y} ${bot.core.bounds.z} ${BLOCK} ${MODE}`;
        let success = false;

        const survivor = getRecentlyVerifiedSurvivor();
        if (survivor) {
            try {
                markOwn(survivor.x, survivor.y, survivor.z);
                if (typeof bot.write !== 'function') throw new Error('bot.write unavailable');
                
                bot.write('update_command_block', {
                    location: survivor,
                    command,
                    mode: 1,
                    flags: 0b101
                });

                await new Promise(resolve => setTimeout(resolve, 35));
                const k1 = key(bot.core.origin.x, bot.core.origin.y, bot.core.origin.z);
                const k2 = key(bot.core.bounds.x, bot.core.bounds.y, bot.core.bounds.z);
                const k3 = key(survivor.x, survivor.y, survivor.z);

                const status1 = coreBlocks.get(k1);
                const status2 = coreBlocks.get(k2);
                const status3 = coreBlocks.get(k3);

                if (status1?.alive && status2?.alive && status3?.alive) {
                    success = true;
                } else {
                    if (status3) status3.alive = false;
                }
            } catch (error) {
                success = false;
                const k = key(survivor.x, survivor.y, survivor.z);
                if (coreBlocks.has(k)) coreBlocks.get(k).alive = false;
                console.error(`[${bot.id}] [Core] Survivor refill error:`, error);
            }
        }

        if (!success) {
            try {
                if (typeof bot.chat !== 'function') throw new Error('bot.chat unavailable');
                success = bot.chat('/' + command) !== false;
            } catch (error) {
                console.error(`[${bot.id}] [Core] Chat refill error:`, error);
            }
        }

        if (!success) {
            refilling = false;
            return false;
        }

        for (const entry of coreBlocks.values()) {
            entry.alive = true;
            entry.verifiedAt = Date.now();
        }

        bot.core.cursor = { x: bot.core.origin.x, y: bot.core.origin.y, z: bot.core.origin.z };
        bot.core._cursor = { x: bot.core.origin.x, y: bot.core.origin.y, z: bot.core.origin.z };

        if (finishTimer) clearTimeout(finishTimer);
        finishTimer = setTimeout(() => {
            finishTimer = null;
            refilling = false;
            bot.core.ready = true;
            cooldown = true;
            setTimeout(() => { cooldown = false; }, REFILL_COOLDOWN);
        }, REFILL_FINISH);

        return true;
    }

    const handlers = {
        onBlockChange(packet) {
            if (!packet?.location || !bot.core.ready || refilling || cooldown) return;
            const x = packet.location.x;
            const y = packet.location.y;
            const z = packet.location.z;
            if (!inside(x, y, z)) return;
            if (isOwn(x, y, z)) return;
            const state = isRepeatingState(extractState(packet));
            if (state === true) {
                markBlock(x, y, z, true, true);
                return;
            }
            markBlock(x, y, z, false, true);
            scheduleDamage(`block-change ${x} ${y} ${z}`);
        },

        onMapChunk(packet) {
            if (!packet || !bot.core.ready || refilling || cooldown) return;
            const cx = packet.x;
            const cz = packet.z;
            if (cx !== chunkX || cz !== chunkZ) return;
            if (!packet.chunkData) return;
            if (!PrismarineChunk) return;

            try {
                const chunk = new PrismarineChunk();
                chunk.load(packet.chunkData, packet.bitMap || 0);

                let damaged = false;
                const originX = bot.core.origin.x;
                const originY = bot.core.origin.y;
                const originZ = bot.core.origin.z;
                const boundsX = bot.core.bounds.x;
                const boundsY = bot.core.bounds.y;
                const boundsZ = bot.core.bounds.z;

                for (let x = originX; x <= boundsX; x++) {
                    for (let y = originY; y <= boundsY; y++) {
                        for (let z = originZ; z <= boundsZ; z++) {
                            const block = chunk.getBlock({ x: x & 15, y, z: z & 15 });
                            const isRepeating = block && block.name && block.name.includes('repeating_command_block');
                            const keyStr = key(x, y, z);
                            const entry = coreBlocks.get(keyStr);
                            if (entry) {
                                if (!isRepeating) {
                                    entry.alive = false;
                                    entry.verifiedAt = Date.now();
                                    damaged = true;
                                } else {
                                    entry.alive = true;
                                    entry.verifiedAt = Date.now();
                                }
                            }
                        }
                    }
                }

                if (damaged) {
                    clearTimeout(damageTimer);
                    damageTimer = setTimeout(() => {
                        if (!position || refilling || cooldown) return;
                        bot.core.refill('map_chunk_damage');
                    }, DAMAGE_DELAY);
                }
            } catch (e) {
                // ignore
            }
        },

        onMultiBlockChange(packet) {
            if (!packet || !bot.core.ready || refilling || cooldown) return;
            if (!Array.isArray(packet.records)) return;
            const coordinates = packet.chunkCoordinates;
            if (!coordinates || typeof coordinates.x !== 'number' || typeof coordinates.y !== 'number' || typeof coordinates.z !== 'number') return;
            if (coordinates.x !== chunkX || coordinates.z !== chunkZ) return;
            let damaged = false;
            for (const record of packet.records) {
                if (typeof record !== 'number') continue;
                const stateId = record >>> 12;
                const localX = (record >>> 8) & 0xF;
                const localZ = (record >>> 4) & 0xF;
                const localY = record & 0xF;
                const x = coordinates.x * 16 + localX;
                const y = coordinates.y * 16 + localY;
                const z = coordinates.z * 16 + localZ;
                if (!inside(x, y, z)) continue;
                if (isOwn(x, y, z)) continue;
                const correct = isRepeatingState(stateId);
                if (correct === true) {
                    markBlock(x, y, z, true, true);
                } else {
                    markBlock(x, y, z, false, true);
                    damaged = true;
                }
            }
            if (damaged) {
                scheduleDamage('multi-block-change');
            }
        },

        onPosition(packet) {
            if (typeof packet?.x !== 'number' || typeof packet?.y !== 'number' || typeof packet?.z !== 'number') return;
            position = { x: packet.x, y: packet.y, z: packet.z };
            if (!initialized) {
                initialized = true;
                bot.core.reset();
                if (HIDE && bot.core.pendingTeleport) {
                    const tp = bot.core.pendingTeleport;
                    bot.core.pendingTeleport = null;
                    setTimeout(() => {
                        if (bot && typeof bot.chat === 'function') {
                            try { bot.chat(`/tp @s ${tp.x} ${tp.y} ${tp.z}`); } catch (e) {}
                        }
                    }, 3000);
                }
                initialTimer = setTimeout(() => {
                    initialTimer = null;
                    if (position) bot.core.refill('initial');
                }, HIDE ? Math.max(INITIAL_DELAY, 8000) : INITIAL_DELAY);
                return;
            }
            if (HIDE) return;
            const cx = Math.floor(position.x / SIZE);
            const cz = Math.floor(position.z / SIZE);
            if (cx === chunkX && cz === chunkZ) return;
            bot.core.reset();
            if (chunkTimer) clearTimeout(chunkTimer);
            chunkTimer = setTimeout(() => {
                chunkTimer = null;
                if (position) bot.core.refill('chunk-change');
            }, CHUNK_DELAY);
        },

        onEnd() {
            bot.core.destroy();
        }
    };

    bot.on('block_change', handlers.onBlockChange);
    bot.on('map_chunk', handlers.onMapChunk);
    bot.on('multi_block_change', handlers.onMultiBlockChange);
    bot.on('position', handlers.onPosition);
    bot.on('end', handlers.onEnd);

    // query command block LastOutput through nbt
    const nbtQueries = new Map();
    let nbtTransactionId = 1;

    function findKey(node, wanted) {
        if (!node || typeof node !== 'object') return undefined;
        if (Object.prototype.hasOwnProperty.call(node, wanted)) return node[wanted];
        for (const value of Object.values(node)) {
            const found = findKey(value, wanted);
            if (found !== undefined) return found;
        }
        return undefined;
    }

    // convert typed nbt to plain js; 1.21.5+ stores LastOutput as a text component
    function simplifyNbt(node) {
        if (node === null || typeof node !== 'object') return node;
        if (Array.isArray(node)) return node.map(simplifyNbt);
        if (typeof node.type === 'string' && 'value' in node) {
            const v = node.value;
            if (node.type === 'compound') {
                const out = {};
                for (const k of Object.keys(v || {})) out[k] = simplifyNbt(v[k]);
                return out;
            }
            if (node.type === 'list') {
                const items = v && Array.isArray(v.value) ? v.value : [];
                const t = v && v.type;
                return items.map(item => {
                    if (t === 'compound' && item && typeof item === 'object') {
                        return simplifyNbt({ type: 'compound', value: item });
                    }
                    return simplifyNbt(item);
                });
            }
            return v;
        }
        return node;
    }

    function flattenComponent(c) {
        if (c === null || c === undefined) return '';
        if (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') return String(c);
        if (Array.isArray(c)) return c.map(flattenComponent).join('');
        let out = '';
        if (c.text !== undefined) out += flattenComponent(c.text);
        else if (c.translate !== undefined) {
            out += String(c.translate);
            const args = c.with || c.args;
            if (Array.isArray(args)) out += ' ' + args.map(flattenComponent).join(' ');
        }
        // text components wrap bare strings as { "": "text" }
        if (c[''] !== undefined) out += flattenComponent(c['']);
        if (c.extra) out += flattenComponent(c.extra);
        return out;
    }

    function parseLastOutput(nbt) {
        const found = findKey(nbt, 'LastOutput');
        if (found === undefined) return null;
        let raw = simplifyNbt(found);
        if (typeof raw === 'string') {
            if (!raw) return null;
            try {
                raw = JSON.parse(raw);
            } catch {
                return raw;
            }
        }
        let text = flattenComponent(raw);
        if (bot.core) bot.core._lastRaw = JSON.stringify(raw);

        // fallback: grab the first ip-looking value from the raw nbt
        if (/IP Address:/.test(text) && !/IP Address:\s*\/?\S/.test(text)) {
            const ip = JSON.stringify(raw).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
            if (ip) text = text.replace(/IP Address:\s*$/, `IP Address: /${ip[0]}`);
        }
        return text || null;
    }

    function onNbtQueryResponse(packet) {
        if (!packet) return;
        const pending = nbtQueries.get(packet.transactionId);
        if (!pending) return;
        nbtQueries.delete(packet.transactionId);
        clearTimeout(pending.timer);
        bot.core._lastNbt = packet.nbt;
        pending.resolve(parseLastOutput(packet.nbt));
    }

    // resolve packet names for this protocol version
    function detectPacketNames() {
        const result = { server: null, client: null, matchesServer: [], matchesClient: [] };
        try {
            const play = mcData?.protocol?.play;
            const list = dir => Object.keys(play?.[dir]?.types || {})
                .filter(n => n.startsWith('packet_'))
                .map(n => n.slice('packet_'.length));
            const server = list('toServer');
            const client = list('toClient');
            const wanted = /nbt|query|tag/;
            result.matchesServer = server.filter(n => wanted.test(n));
            result.matchesClient = client.filter(n => wanted.test(n));

            const pick = (all, preferred, pattern) =>
                preferred.find(n => all.includes(n)) || all.find(n => pattern.test(n)) || null;

            result.server = pick(server,
                ['query_block_nbt', 'query_block_entity_tag', 'block_entity_tag_query'],
                /query.*(block|nbt)|block.*query/);
            result.client = pick(client,
                ['nbt_query_response', 'tag_query', 'query_response'],
                /nbt_query|tag_query|query.*(response|result)/);
        } catch (error) {
            console.error(`[${bot.id}] [Core] packet name detection failed:`, error);
        }
        return result;
    }

    const nbtPackets = detectPacketNames();
    const QUERY_S = nbtPackets.server || 'query_block_nbt';
    const QUERY_C = nbtPackets.client || 'nbt_query_response';

    bot.on(QUERY_C, onNbtQueryResponse);

    // also catch query replies on the raw client by transactionId
    function onAnyPacket(data, meta) {
        const name = meta && meta.name;
        if (!name || !/nbt|query/i.test(name) || !data || data.transactionId === undefined) return;
        if (bot.core) bot.core._lastQueryPacketName = name;
        onNbtQueryResponse(data);
    }
    if (bot.client && typeof bot.client.on === 'function') bot.client.on('packet', onAnyPacket);

    bot.core = {
        ready: false,
        origin: { x: null, y: Y, z: null },
        bounds: { x: null, y: Y + SIZE - 1, z: null },
        cursor: { x: null, y: Y, z: null },
        _cursor: { x: null, y: Y, z: null },
        pendingTeleport: null,

        reset() {
            if (HIDE) {
                if (this.origin.x !== null) return true;
                const maxSteps = Math.max(1, Math.floor((WORLD_BORDER - SIZE) / SIZE));
                const rx = (Math.floor(Math.random() * (2 * maxSteps + 1)) - maxSteps) * SIZE + Math.floor(Math.random() * SIZE);
                const rz = (Math.floor(Math.random() * (2 * maxSteps + 1)) - maxSteps) * SIZE + Math.floor(Math.random() * SIZE);
                this.origin = { x: rx, y: Y, z: rz };
                this.bounds = { x: rx + SIZE - 1, y: Y + SIZE - 1, z: rz + SIZE - 1 };
                this.cursor = { ...this.origin };
                this._cursor = { ...this.origin };
                chunkX = Math.floor(rx / SIZE);
                chunkZ = Math.floor(rz / SIZE);
                this.ready = false;
                ownChanges.clear();
                createCoreMap(false);
                this.pendingTeleport = { x: rx, y: Y, z: rz };
                console.log(`[${bot.id}] [Core] Hidden at ${rx} ${Y} ${rz}`);
                return true;
            }
            if (!position) return false;
            const cx = Math.floor(position.x / SIZE);
            const cz = Math.floor(position.z / SIZE);
            const x = cx * SIZE;
            const z = cz * SIZE;
            this.origin = { x, y: Y, z };
            this.bounds = { x: x + SIZE - 1, y: Y + SIZE - 1, z: z + SIZE - 1 };
            this.cursor = { ...this.origin };
            this._cursor = { ...this.origin };
            chunkX = cx;
            chunkZ = cz;
            this.ready = false;
            ownChanges.clear();
            createCoreMap(false);
            return true;
        },

        _getNextBlock() {
            const ox = this.origin.x, oy = this.origin.y, oz = this.origin.z;
            const wx = this.bounds.x - ox + 1;
            const wy = this.bounds.y - oy + 1;
            const wz = this.bounds.z - oz + 1;
            const volume = wx * wy * wz;
            if (volume <= 0) return null;

            let start = 0;
            const c = this._cursor;
            if (c && c.x !== null && c.y !== null && c.z !== null) {
                start = (c.x - ox) + (c.y - oy) * wx + (c.z - oz) * wx * wy;
                if (!Number.isFinite(start) || start < 0 || start >= volume) start = 0;
            }

            for (let i = 0; i < volume; i++) {
                const idx = (start + i) % volume;
                const x = ox + (idx % wx);
                const y = oy + (Math.floor(idx / wx) % wy);
                const z = oz + Math.floor(idx / (wx * wy));
                const keyStr = key(x, y, z);
                const entry = coreBlocks.get(keyStr);
                if (entry && entry.alive) {
                    this._cursor = { x, y, z };
                    return { x, y, z };
                }
            }
            return null;
        },

        _advanceCursor() {
            const c = this._cursor;
            if (!c || c.x === null || c.y === null || c.z === null) return;
            const ox = this.origin.x, oy = this.origin.y, oz = this.origin.z;
            const wx = this.bounds.x - ox + 1;
            const wy = this.bounds.y - oy + 1;
            const wz = this.bounds.z - oz + 1;
            const volume = wx * wy * wz;
            if (volume <= 0) return;
            let idx = (c.x - ox) + (c.y - oy) * wx + (c.z - oz) * wx * wy;
            idx = (idx + 1) % volume;
            const x = ox + (idx % wx);
            const y = oy + (Math.floor(idx / wx) % wy);
            const z = oz + Math.floor(idx / (wx * wy));
            this._cursor = { x, y, z };
        },

        refill,

        run(command) {
            if (!this.ready || command === undefined || command === null) return false;

            cleanupOwn();

            const location = this._getNextBlock();
            if (!location) {
                if (!refilling && !cooldown) {
                    this.refill('run-fallback');
                }
                return false;
            }

            try {
                markOwn(location.x, location.y, location.z);
                const commandString = String(command).replace(/^\//, '').slice(0, 32767);
                if (typeof bot.write !== 'function') return false;
                const result = bot.write('update_command_block', {
                    location,
                    command: commandString,
                    mode: 1,
                    flags: 0b101
                });
                this._advanceCursor();
                this._lastLocation = result !== false ? location : null;
                return result !== false;
            } catch (error) {
                console.error(`[${bot.id}] [Core] Run error:`, error);
                return false;
            }
        },

        _nbtPackets: nbtPackets,

        // run command block and return its output, or null
        runTracked(command, { delay = 150, timeout = 3000 } = {}) {
            this._lastLocation = null;
            const ok = this.run(command);
            const location = this._lastLocation;
            this._lastRunOk = !!(ok && location);
            if (!ok || !location) return Promise.resolve(null);

            return new Promise(resolve => {
                const transactionId = nbtTransactionId++;
                const timer = setTimeout(() => {
                    nbtQueries.delete(transactionId);
                    resolve(null);
                }, timeout);
                nbtQueries.set(transactionId, { resolve, timer });

                setTimeout(() => {
                    try {
                        const sent = bot.write(QUERY_S, { transactionId, location });
                        if (sent === false) console.error(`[${bot.id}] [Core] write('${QUERY_S}') returned false`);
                    } catch (error) {
                        console.error(`[${bot.id}] [Core] write('${QUERY_S}') failed:`, error);
                        if (nbtQueries.delete(transactionId)) {
                            clearTimeout(timer);
                            resolve(null);
                        }
                    }
                }, delay);
            });
        },

        destroy() {
            if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
            if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
            if (damageTimer) { clearTimeout(damageTimer); damageTimer = null; }
            if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }

            bot.removeListener('block_change', handlers.onBlockChange);
            bot.removeListener('map_chunk', handlers.onMapChunk);
            bot.removeListener('multi_block_change', handlers.onMultiBlockChange);
            bot.removeListener('position', handlers.onPosition);
            bot.removeListener('end', handlers.onEnd);
            bot.removeListener(QUERY_C, onNbtQueryResponse);
            if (bot.client && typeof bot.client.removeListener === 'function') bot.client.removeListener('packet', onAnyPacket);
            for (const q of nbtQueries.values()) { clearTimeout(q.timer); q.resolve(null); }
            nbtQueries.clear();

            position = null;
            initialized = false;
            chunkX = null; chunkZ = null;
            refilling = false; cooldown = false;
            ownChanges.clear();
            coreBlocks.clear();
            this.ready = false;
            this.pendingTeleport = null;
            this.origin = { x: null, y: Y, z: null };
            this.bounds = { x: null, y: Y + SIZE - 1, z: null };
            this.cursor = { x: null, y: Y, z: null };
            this._cursor = { x: null, y: Y, z: null };
        }
    };
};