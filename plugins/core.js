const minecraftData = require('minecraft-data');

module.exports = function core(bot) {
    const rawCore = bot.globalConfig?.core || bot.config?.core || {};
    const cfg = (rawCore && typeof rawCore === 'object' && bot.id && rawCore[bot.id] && typeof rawCore[bot.id] === 'object')
        ? rawCore[bot.id]
        : rawCore;
    const area = cfg.area || {};
    const refillConfig = cfg.refill || {};
    const REFILL_ENABLED = refillConfig.enabled !== false;

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
        : 'replace';

    const INITIAL_DELAY = Number.isFinite(Number(cfg.initialDelay)) ? Number(cfg.initialDelay) : 250;
    const CHUNK_DELAY = Number.isFinite(Number(cfg.chunkChangeDelay)) ? Number(cfg.chunkChangeDelay) : 50;
    const DAMAGE_DELAY = Number.isFinite(Number(cfg.damageDelay)) ? Number(cfg.damageDelay) : 50;
    const REFILL_FINISH = Number.isFinite(Number(cfg.refillFinishDelay)) ? Number(cfg.refillFinishDelay) : 100;
    const REFILL_COOLDOWN = Number.isFinite(Number(cfg.refillCooldown)) ? Number(cfg.refillCooldown) : 200;
    const GRACE_PERIOD = Number.isFinite(Number(cfg.gracePeriod)) ? Number(cfg.gracePeriod) : 750;
    const OWN_CHANGE_TIME = Number.isFinite(Number(cfg.ownChangeDuration)) ? Number(cfg.ownChangeDuration) : 2500;
    const SURVIVOR_MAX_AGE = Number.isFinite(Number(cfg.survivorMaxAge)) ? Number(cfg.survivorMaxAge) : 60000;

    if (!ENABLED) {
        bot.core = {
            ready: false,
            origin: { x: null, y: Y, z: null },
            bounds: { x: null, y: Y + SIZE - 1, z: null },
            cursor: { x: null, y: Y, z: null },
            reset() { return false; },
            refill(reason, force) { return false; },
            run() { return false; },
            runTracked() { return Promise.resolve(null); },
            destroy() { this.ready = false; }
        };
        return;
    }

    let mcData = null;
    try {
        mcData = minecraftData(VERSION);
    } catch (error) {
        console.error(`[${bot.id}] [Core] minecraft-data init failed:`, error);
    }

    // ViaVersion translates between the bot's client protocol and the server's
    // native version, so item ids have to come from the version the bot actually
    // speaks - a config that names the server version (or a snapshot) would
    // otherwise leave us without data tables.
    function dataVersion() {
        return bot.registry?.version?.minecraftVersion || bot.version || VERSION;
    }

    const dataCache = new Map();
    function dataFor(version) {
        if (dataCache.has(version)) return dataCache.get(version);
        let data = null;
        try {
            data = minecraftData(version);
        } catch (e) {
            data = null;
        }
        dataCache.set(version, data);
        return data;
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
    let damagePending = false;
    let damageDuringRefill = false;

    let coreEverReady = false;
    let graceUntil = 0;
    let refillRetryScheduled = false;
    let initialTimer = null;
    let chunkTimer = null;
    let damageTimer = null;
    let finishTimer = null;
    let refillRetryTimer = null;
    let refillRetryDelay = 2000;
    let coreAreaWarned = false;

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

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // This bot speaks minecraft-protocol directly - there is no mineflayer, so
    // no bot.creative / bot.blockAt / bot.heldItem. Everything below is packets.
    const HOTBAR_SLOT_START = 36;

    function hotbarIndex() {
        return Math.max(0, Math.min(8, Number(bot.quickBarSlot) || 0));
    }

    let ItemFactory = null;
    let ItemFactoryVersion = null;
    function itemFactory(version) {
        if (ItemFactory && ItemFactoryVersion === version) return ItemFactory;
        try {
            ItemFactory = require('prismarine-item')(version);
            ItemFactoryVersion = version;
            return ItemFactory;
        } catch (e) {
            return null;
        }
    }

    // The creative slot packet wants an *item* id. A block id is not one, so only
    // fall back to the block tables (minecraft-data included) when the bot's own
    // registry has no item entry for the core block.
    function coreBlockItemId() {
        const registryId = bot.registry?.itemsByName?.[BLOCK]?.id;
        if (Number.isInteger(registryId)) return registryId;

        const data = dataFor(dataVersion()) || mcData;

        const item = data?.itemsByName?.[BLOCK];
        if (item && Number.isInteger(item.id)) return item.id;

        const block = bot.registry?.blocksByName?.[BLOCK] || data?.blocksByName?.[BLOCK];
        if (block) {
            const viaItems = data?.items?.[block.id];
            if (viaItems && viaItems.name === BLOCK) return viaItems.id;
        }

        const scanned = Array.isArray(data?.itemsArray)
            ? data.itemsArray.find(entry => entry.name === BLOCK)
            : null;
        return scanned && Number.isInteger(scanned.id) ? scanned.id : null;
    }

    // Flying keeps the bot from dropping when the block under it is broken.
    function sendAbilities() {
        try {
            return bot.write('abilities', { flags: 0x02 }) !== false; // 0x02 = flying
        } catch (e) {
            return false;
        }
    }

    let nbtLib = null;
    try {
        nbtLib = require('prismarine-nbt');
    } catch (e) {
        nbtLib = null;
    }

    // A command block copies the block entity data of the item it was placed
    // from, so carrying Command + auto here means the block autoruns the fill
    // even if the follow-up update packet never lands (or is refused).
    function coreBlockEntityNbt(command) {
        if (!nbtLib) return null;
        try {
            return nbtLib.comp({
                id: nbtLib.string('command_block'),
                Command: nbtLib.string(String(command).replace(/^\//, '')),
                auto: nbtLib.byte(1),
                TrackOutput: nbtLib.byte(0),
                UpdateLastExecution: nbtLib.byte(0)
            });
        } catch (e) {
            return null;
        }
    }

    // Pre-1.20.5 items carry that compound as BlockEntityTag; from 1.20.5 it is
    // the minecraft:block_entity_data component instead.
    function legacyCoreBlockNbt(command) {
        const tag = coreBlockEntityNbt(command);
        if (!tag) return null;
        try {
            const body = nbtLib.comp({ ...tag.value });
            delete body.value.id;
            return nbtLib.comp({ BlockEntityTag: body });
        } catch (e) {
            return null;
        }
    }

    // The block entity type is a registry id in the 1.21.11+ component, and the
    // only place to learn it is the server's own configuration registries.
    let commandBlockEntityType = null;
    function onRegistryData(packet) {
        if (commandBlockEntityType !== null || !packet) return;
        const registry = String(packet.id || packet.name || '');
        if (!/block_entity_type/.test(registry)) return;
        const entries = Array.isArray(packet.entries) ? packet.entries : [];
        const index = entries.findIndex(entry => /(^|:)command_block$/.test(String(entry?.key || entry?.name || '')));
        if (index >= 0) {
            commandBlockEntityType = index;
            log(`Command block entity type id ${index} (${registry})`);
        }
    }
    bot.on('registry_data', onRegistryData);

    function varintBytes(value) {
        const bytes = [];
        let v = Number(value) >>> 0;
        do {
            let b = v & 0x7f;
            v >>>= 7;
            if (v) b |= 0x80;
            bytes.push(b);
        } while (v);
        return Buffer.from(bytes);
    }

    function encodeNbt(value) {
        if (!nbtLib?.proto) return null;
        try {
            const size = nbtLib.proto.sizeOf(value, 'anonymousNbt');
            const buffer = Buffer.alloc(size);
            nbtLib.proto.write(value, buffer, 0, 'anonymousNbt');
            return buffer;
        } catch (e) {
            return null;
        }
    }

    // How this version's slot writes the block_entity_data component: a bare
    // compound up to 1.21.10, then { type: registry id, data: compound }.
    let componentShape;
    function blockEntityShape(version) {
        if (componentShape !== undefined) return componentShape;
        const data = dataFor(version) || mcData;
        let found = null;
        const walk = node => {
            if (found || !node || typeof node !== 'object') return;
            if (node.fields && node.fields.block_entity_data !== undefined) {
                found = node.fields.block_entity_data;
                return;
            }
            for (const value of Object.values(node)) walk(value);
        };
        walk(data?.protocol?.types || {});
        componentShape = found;
        return componentShape;
    }

    function blockEntityComponent(command, version) {
        const tag = coreBlockEntityNbt(command);
        if (!tag) return null;

        const shape = blockEntityShape(version);
        if (!shape) return null;

        if (shape === 'anonymousNbt') {
            return { type: 'block_entity_data', data: tag };
        }

        // { type: <block entity registry id>, data: <compound> } as raw bytes
        if (commandBlockEntityType === null) return null;
        const bytes = encodeNbt(tag);
        if (!bytes) return null;
        return {
            type: 'block_entity_data',
            data: Buffer.concat([varintBytes(commandBlockEntityType), bytes])
        };
    }

    // Puts the core block into the selected hotbar slot with the creative slot
    // packet, so no /give with coordinates appears in the server log.
    function holdCoreBlock(command) {
        const id = coreBlockItemId();
        if (!Number.isInteger(id)) {
            log(`No item id for ${BLOCK} in this version's data`);
            return false;
        }

        const version = dataVersion();
        const Factory = itemFactory(version);
        const legacyNbt = command ? legacyCoreBlockNbt(command) : null;
        let item = { present: true, itemId: id, itemCount: 1 };
        let carriedNbt = false;

        try {
            const notch = Factory ? Factory.toNotch(new Factory(id, 1, legacyNbt)) : null;
            if (notch) item = notch;

            if (notch && notch.nbtData) {
                carriedNbt = true; // 1.20.4 and older carry BlockEntityTag
            } else if (command && notch && Array.isArray(notch.components)) {
                const component = blockEntityComponent(command, version);
                if (component) {
                    notch.components = [component];
                    notch.addedComponentCount = 1;
                    notch.removeComponents = [];
                    carriedNbt = true;
                } else {
                    log(`${BLOCK} has no block entity data in this version's slots; using the packet`);
                }
            }
        } catch (e) {
            item = { present: true, itemId: id, itemCount: 1 };
        }

        try {
            const hotbar = hotbarIndex();
            bot.write('set_creative_slot', { slot: HOTBAR_SLOT_START + hotbar, item });
            bot.write('held_item_slot', { slotId: hotbar });
            return { held: true, nbt: carriedNbt };
        } catch (e) {
            console.error(`[${bot.id}] [Core] Could not hold ${BLOCK}:`, e.message || e);
            return { held: false, nbt: false };
        }
    }

    // Breaks the block at (x,y,z) with the dig packets; harmless on water.
    async function digAt(x, y, z) {
        try {
            bot.write('block_dig', { status: 0, location: { x, y, z }, face: 1, sequence: 0 });
            await sleep(50);
            bot.write('block_dig', { status: 2, location: { x, y, z }, face: 1, sequence: 0 });
            return true;
        } catch (e) {
            return false;
        }
    }

    // The server answers a placement with a block update, which is the only
    // confirmation available without a world model.
    const blockChanges = new Map();
    function noteBlockChange(x, y, z) {
        blockChanges.set(key(x, y, z), Date.now());
        if (blockChanges.size > 4096) {
            const cutoff = Date.now() - 60000;
            for (const [id, ts] of blockChanges) {
                if (ts < cutoff) blockChanges.delete(id);
            }
        }
    }

    function trackBlockChange(packet) {
        const location = packet?.location;
        if (location) noteBlockChange(location.x, location.y, location.z);
    }

    function sendBlockPlace(location, direction) {
        const payload = {
            hand: 0,
            location,
            direction,
            cursorX: 0.5,
            cursorY: 1,
            cursorZ: 0.5,
            insideBlock: false,
            worldBorderHit: false,
            sequence: 0
        };
        for (const name of ['block_place', 'use_item_on']) {
            try {
                if (bot.write(name, payload) !== false) return true;
            } catch (e) {
                // packet name not in this version, try the next one
            }
        }
        return false;
    }

    function writeCoreCommand(x, y, z, command) {
        try {
            return bot.write('update_command_block', {
                location: { x, y, z },
                command: String(command).replace(/^\//, ''),
                mode: 1,
                flags: 0b101
            }) !== false;
        } catch (e) {
            return false;
        }
    }

    // Clears (x,y,z) and puts the core block there, then writes the command into
    // it. Returns the position it ended up at, or null.
    async function tryPlaceAt(x, y, z, command, carriedNbt) {
        markOwn(x, y, z);
        sendAbilities();

        // Break the cell and wait for its own block update first: that update is
        // the baseline the placement confirmation is compared against, otherwise
        // a dig reply arriving late would look like a successful placement.
        const id = key(x, y, z);
        const beforeDig = blockChanges.get(id) || 0;
        await digAt(x, y, z);
        const digStart = Date.now();
        while (Date.now() - digStart < 400 && (blockChanges.get(id) || 0) === beforeDig) {
            await sleep(25);
        }
        const mark = blockChanges.get(id) || 0;
        const changedAfter = candidate => (blockChanges.get(candidate) || 0) > mark;

        const confirm = async timeout => {
            const started = Date.now();
            while (Date.now() - started < timeout) {
                if ((blockChanges.get(id) || 0) > mark) return true;
                await sleep(40);
            }
            return false;
        };
        // The server places into the clicked cell when it is replaceable and on
        // the clicked face otherwise, so an unexpected neighbouring change means
        // the cell was not what we assumed - stop instead of scattering blocks.
        const stray = () => changedAfter(key(x, y - 1, z)) || changedAfter(key(x, y + 1, z));

        // 1) into the cell itself: air after the dig, replaced water/lava, and a
        //  still-solid cell (dig refused) lands above it instead - which the
        // stray check below catches before a second packet is sent.
        sendBlockPlace({ x, y, z }, 1);
        let placed = await confirm(500);
        if (!placed && stray()) {
            log(`The core spot ${x} ${y} ${z} is still solid`);
            return null;
        }
        // 2) on the top face of the block below
        if (!placed) {
            sendBlockPlace({ x, y: y - 1, z }, 1);
            placed = await confirm(500);
            if (!placed && stray()) {
                log(`The cell below ${x} ${y} ${z} was not solid`);
                return null;
            }
        }
        // 3) from the block above, looking down
        if (!placed) {
            sendBlockPlace({ x, y: y + 1, z }, 0);
            placed = await confirm(500);
        }
        if (!placed) return null;

        markOwn(x, y, z);
        // The item already carries Command + auto where the version supports it;
        // this covers the versions whose slot format drops item NBT.
        if (!writeCoreCommand(x, y, z, command)) {
            if (!carriedNbt) {
                log(`Could not write the command into the core block at ${x} ${y} ${z}`);
                return null;
            }
            log(`Command packet for ${x} ${y} ${z} failed; keeping the item NBT`);
        }
        return { x, y, z };
    }

    // The block under the bot's feet is the wanted spot, but a server can refuse
    // it (spawn protection, the bot's own hitbox in the hole), so the neighbours
    // are tried before giving up.
    async function placeCommandBlockAt(x, y, z, command) {
        const held = holdCoreBlock(command);
        if (!held.held) return null;
        await sleep(120); // let the server apply the creative slot

        const candidates = [
            { x, y, z },
            { x: x + 1, y, z },
            { x: x - 1, y, z },
            { x, y, z: z + 1 },
            { x, y, z: z - 1 }
        ];

        for (const candidate of candidates) {
            if (inside(candidate.x, candidate.y, candidate.z)) continue;
            const placed = await tryPlaceAt(candidate.x, candidate.y, candidate.z, command, held.nbt);
            if (placed) return placed;
            log(`No block at ${candidate.x} ${candidate.y} ${candidate.z}, trying the next spot`);
        }

        log(`Could not place the core block near ${x} ${y} ${z}`);
        return null;
    }

    // A failed refill used to retry exactly once and then give up forever, which
    // left core.ready false and made every command disappear without any message.
    function scheduleRefillRetry() {
        if (!REFILL_ENABLED || refillRetryTimer) return;

        const delay = Math.min(refillRetryDelay, 30000);
        refillRetryDelay = Math.min(refillRetryDelay * 2, 30000);

        console.warn(`[${bot.id}] [Core] Refill failed; retrying in ${delay}ms`);

        refillRetryTimer = setTimeout(() => {
            refillRetryTimer = null;

            if (refilling || cooldown || !position) {
                scheduleRefillRetry();
                return;
            }

            bot.core.refill('retry');
        }, delay);

        refillRetryTimer.unref?.();
    }

    // Command blocks only tick in loaded chunks. In hide mode the bot is
    // teleported into the core, so if it is far away the teleport was refused
    // and every write below would silently do nothing.
    function coreAreaLoaded() {
        if (!position) return false;
        const origin = bot.core?.origin;
        if (!origin || origin.x === null || origin.z === null) return false;

        const centerX = origin.x + (SIZE - 1) / 2;
        const centerZ = origin.z + (SIZE - 1) / 2;
        const radius = SIZE + 32;

        return Math.abs(position.x - centerX) <= radius && Math.abs(position.z - centerZ) <= radius;
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

    function scheduleDamage(reason) {
        if (!REFILL_ENABLED) return;
        if (!bot.core.ready || refilling) return;
        if (cooldown) { damagePending = true; return; }
        if (damageTimer) clearTimeout(damageTimer);
        damageTimer = setTimeout(() => {
            damageTimer = null;
            if (!position || refilling || cooldown) return;
            bot.core.refill(reason);
        }, DAMAGE_DELAY);
    }

    async function refill(reason = 'damage', force = false) {
        damagePending = false;
        damageDuringRefill = false;
        graceUntil = 0;
        if (force) { cooldown = false; refilling = false; }

        if (!REFILL_ENABLED) return false;
        if (!position) return false;
        if (refilling && !force) return false;
        if (cooldown && !force) return false;
        if (bot.core.origin.x === null && !bot.core.reset()) return false;

        refilling = true;
        // Only the very first fill gates readiness. A rebuild triggered by damage
        // must not make an already working core report "not ready" - that lied
        // to commands like cb/<core> while the area was still full of blocks.
        if (!coreEverReady) bot.core.ready = false;
        cleanupOwn();

        const command = `fill ${bot.core.origin.x} ${bot.core.origin.y} ${bot.core.origin.z} ${bot.core.bounds.x} ${bot.core.bounds.y} ${bot.core.bounds.z} ${BLOCK} ${MODE}`;
        let success = false;

        // Reuse remains: if a core block still exists, write the fill into it.
        const survivor = getRecentlyVerifiedSurvivor();
        if (survivor && !force) {
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
                success = true;
            } catch (error) {
                success = false;
                const k = key(survivor.x, survivor.y, survivor.z);
                if (coreBlocks.has(k)) coreBlocks.get(k).alive = false;
                console.error(`[${bot.id}] [Core] Survivor refill error:`, error);
            }
        }

        // Fallback: send the fill command via chat.
        if (!success) {
            try {
                if (typeof bot.chat !== 'function') throw new Error('bot.chat unavailable');
                success = bot.chat('/' + command) !== false;
            } catch (error) {
                console.error(`[${bot.id}] [Core] Chat refill error:`, error);
                success = false;
            }
        }

        if (!success) {
            refilling = false;
            scheduleRefillRetry();
            return false;
        }

        for (const entry of coreBlocks.values()) {
            entry.alive = true;
            entry.verifiedAt = Date.now();
        }

        refillRetryDelay = 2000;
        if (refillRetryTimer) {
            clearTimeout(refillRetryTimer);
            refillRetryTimer = null;
        }

        bot.core.cursor = { x: bot.core.origin.x, y: bot.core.origin.y, z: bot.core.origin.z };
        bot.core._cursor = { x: bot.core.origin.x, y: bot.core.origin.y, z: bot.core.origin.z };

        if (finishTimer) clearTimeout(finishTimer);
        finishTimer = setTimeout(() => {
            finishTimer = null;
            refilling = false;
            bot.core.ready = true;
            coreEverReady = true;
            if (damageDuringRefill) { damageDuringRefill = false; damagePending = true; }
            cooldown = true;
            graceUntil = Date.now() + GRACE_PERIOD;
            setTimeout(() => {
                cooldown = false;
                if (damagePending) {
                    damagePending = false;
                    scheduleDamage('cooldown-end');
                }
            }, REFILL_COOLDOWN);
        }, REFILL_FINISH);

        return true;
    }

    const handlers = {
        // The fill places repeating command blocks, so a block we wrote a command
        // into is a command block until something changes it. Block state ids are
        // deliberately not inspected: any change here that we did not make
        // ourselves means that block is no longer ours.
        onBlockChange(packet) {
            if (refilling) { damageDuringRefill = true; return; }
            if (Date.now() < graceUntil) return;
            if (!packet?.location || !bot.core.ready) return;
            const x = packet.location.x;
            const y = packet.location.y;
            const z = packet.location.z;
            // The core block sits outside the filled area, so it needs its own check.
            const seed = bot.core.seed;
            if (seed && x === seed.x && y === seed.y && z === seed.z) {
                if (isOwn(x, y, z)) return;
                scheduleDamage(`core block ${x} ${y} ${z}`);
                return;
            }
            if (!inside(x, y, z)) return;
            if (isOwn(x, y, z)) return;
            markBlock(x, y, z, false, true);
            scheduleDamage(`block-change ${x} ${y} ${z}`);
        },

        onMapChunk(packet) {
            if (refilling) { damageDuringRefill = true; return; }
            if (Date.now() < graceUntil) return;
            if (!packet || !bot.core.ready) return;
            const cx = packet.x;
            const cz = packet.z;
            if (cx !== chunkX || cz !== chunkZ) return;
            if (!packet.chunkData) return;
            if (!PrismarineChunk) return;

            try {
                const chunk = new PrismarineChunk();
                chunk.load(packet.chunkData, packet.bitMap || 0);

                let damaged = false;
                let damagedCount = 0;
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
                            const blockName = block && block.name ? String(block.name) : '';
                            const knownBlock = blockName !== '';
                            const isRepeating = blockName.includes('repeating_command_block') || blockName.includes('chain_command_block');
                            const keyStr = key(x, y, z);
                            const entry = coreBlocks.get(keyStr);
                            if (entry) {
                                if (!knownBlock) {
                                    // unknown block data in chunk - ignore, do not treat as damage
                                } else if (!isRepeating) {
                                    entry.alive = false;
                                    entry.verifiedAt = Date.now();
                                    damaged = true;
                                    damagedCount++;
                                } else {
                                    entry.alive = true;
                                    entry.verifiedAt = Date.now();
                                }
                            }
                        }
                    }
                }

                if (damaged && damagedCount >= 4) {
                    clearTimeout(damageTimer);
                    damageTimer = setTimeout(() => {
                        if (!position || refilling) return;
                        if (cooldown) { damagePending = true; return; }
                        bot.core.refill('map_chunk_damage');
                    }, DAMAGE_DELAY);
                }
            } catch (e) {
                // ignore
            }
        },

        onMultiBlockChange(packet) {
            if (refilling) { damageDuringRefill = true; return; }
            if (Date.now() < graceUntil) return;
            if (!packet || !bot.core.ready) return;
            if (!Array.isArray(packet.records)) return;
            const coordinates = packet.chunkCoordinates;
            if (!coordinates || typeof coordinates.x !== 'number' || typeof coordinates.y !== 'number' || typeof coordinates.z !== 'number') return;
            if (coordinates.x !== chunkX || coordinates.z !== chunkZ) return;
            let damaged = false;
            for (const record of packet.records) {
                if (typeof record !== 'number') continue;
                const localX = (record >>> 8) & 0xF;
                const localZ = (record >>> 4) & 0xF;
                const localY = record & 0xF;
                const x = coordinates.x * 16 + localX;
                const y = coordinates.y * 16 + localY;
                const z = coordinates.z * 16 + localZ;
                if (!inside(x, y, z)) continue;
                if (isOwn(x, y, z)) continue;
                markBlock(x, y, z, false, true);
                damaged = true;
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
            if (HIDE) {
                return;
            }
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

    bot.on('block_change', trackBlockChange);
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
        awaitingSurface: false,
        // Where the physical core block sits; the filled area is origin..bounds.
        seed: null,

        // /top lands the bot on the surface, and the core block goes in the block
        // it stands on, so the core follows the bot instead of area.y.
        setOriginFromSurface(pos) {
            const x = Math.floor(pos.x);
            const z = Math.floor(pos.z);
            // The filled area stays on the configured y level; /top only decides
            // where the bot - and the core block it places - is standing.
            this.origin = { x, y: Y, z };
            this.bounds = { x: x + SIZE - 1, y: Y + SIZE - 1, z: z + SIZE - 1 };
            this.cursor = { ...this.origin };
            this._cursor = { ...this.origin };
            this.seed = { x, y: Math.floor(pos.y) - 1, z };
            chunkX = Math.floor(x / 16);
            chunkZ = Math.floor(z / 16);
            this.ready = false;
            ownChanges.clear();
            damagePending = false;
            damageDuringRefill = false;
            graceUntil = 0;
            createCoreMap(false);
            log(`Core area at ${x} ${Y} ${z}; core block goes at ${x} ${this.seed.y} ${z}`);
        },

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
                damagePending = false;
                damageDuringRefill = false;

                graceUntil = 0;
                createCoreMap(false);
                this.seed = { x: rx, y: Y, z: rz };
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
            this.seed = { x, y: Y, z };
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

            // A rebuild is in flight: writing now would land in a block the fill is
            // about to replace. Refuse the write (callers fall back to chat) while
            // ready stays true, so status commands do not report a false negative.
            if (refilling) return false;

            if (!coreAreaLoaded()) {
                if (!coreAreaWarned) {
                    coreAreaWarned = true;
                    console.warn(`[${bot.id}] [Core] Core area not loaded around the bot (teleport refused?); core commands will fail over to chat until it is.`);
                }
                return false;
            }

            coreAreaWarned = false;
            cleanupOwn();

            const location = this._getNextBlock();
            if (!location) {
                if (REFILL_ENABLED && !refilling && !cooldown) {
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
            if (refillRetryTimer) { clearTimeout(refillRetryTimer); refillRetryTimer = null; }

            bot.removeListener('registry_data', onRegistryData);
            bot.removeListener('block_change', trackBlockChange);
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
            coreEverReady = false;
            ownChanges.clear();
            damagePending = false;
            damageDuringRefill = false;
            graceUntil = 0;
            coreBlocks.clear();
            this.ready = false;
            this.pendingTeleport = null;
            this.awaitingSurface = false;
            this.origin = { x: null, y: Y, z: null };
            this.bounds = { x: null, y: Y + SIZE - 1, z: null };
            this.cursor = { x: null, y: Y, z: null };
            this._cursor = { x: null, y: Y, z: null };
        }
    };
};