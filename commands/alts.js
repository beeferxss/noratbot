const gradient = require('../utils/gradient');

const LIMIT = 200;
const ALL_SERVER_FLAGS = ['-allserver', '-allservers', '--all', '--allservers'];

const COLORS = {
    primary: '#55aaff',
    secondary: '#62d66b',
    label: '#aaaaaa',
    username: '#d9ffd2',
    number: '#ffaa00'
};

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6 = /^[0-9a-f:]+$/i;

function looksLikeIP(s) {
    return IPV4.test(s) || (s.includes(':') && s.length >= 2 && IPV6.test(s));
}

function timeAgo(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const units = [['y', 31536000000], ['mo', 2592000000], ['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];
    const parts = [];
    let rest = diff;
    for (const [label, size] of units) {
        const n = Math.floor(rest / size);
        if (n > 0) {
            parts.push(`${n}${label}`);
            rest -= n * size;
        }
        if (parts.length === 2) break;
    }
    return parts.length ? `${parts.join(' ')} ago` : 'just now';
}

function formatDate(ms) {
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function stripFormatting(s) {
    return String(s ?? '').replace(/§[0-9a-fk-or]/gi, '').trim();
}

function normalizeIPs(raw) {
    const out = [];

    const pushEntry = (ip, value) => {
        if (ip === null || ip === undefined) return;
        const address = String(ip).trim();
        if (!address) return;
        let time = 0;
        let server = null;
        if (typeof value === 'number') time = value;
        else if (value && typeof value === 'object') {
            time = Number(value.lastSeen ?? value.time ?? value.lastUsed ?? value.lastJoin ?? value.joined ?? value.left ?? 0) || 0;
            server = value.server ?? value.right ?? null;
        }
        out.push({ ip: address, time, server });
    };

    if (!raw) return [];

    if (raw instanceof Map) {
        for (const [k, v] of raw) pushEntry(k, v);
    } else if (Array.isArray(raw)) {
        for (const item of raw) {
            if (typeof item === 'string') pushEntry(item, 0);
            else if (item && typeof item === 'object') {
                const address = item.ip ?? item.address ?? item.value ?? item.ipAddress ?? item.IP;
                if (address !== undefined) pushEntry(address, item);
                else if (!(item.username || item.name)) {
                    const keys = Object.keys(item);
                    if (keys.length && keys[0]) pushEntry(keys[0], item[keys[0]]);
                }
            }
        }
    } else if (typeof raw === 'object') {
        if (Array.isArray(raw.ips)) return normalizeIPs(raw.ips);
        if (Array.isArray(raw.items)) return normalizeIPs(raw.items);
        if (Array.isArray(raw.results)) return normalizeIPs(raw.results);
        if (Array.isArray(raw.data)) return normalizeIPs(raw.data);

        for (const [k, v] of Object.entries(raw)) {
            if (k === 'ips' && v && typeof v === 'object' && !Array.isArray(v)) {
                for (const [ip, t] of Object.entries(v)) pushEntry(ip, t);
            } else {
                pushEntry(k, v);
            }
        }
    }

    const byIp = new Map();
    for (const entry of out) {
        const prev = byIp.get(entry.ip);
        if (!prev || entry.time > prev.time) byIp.set(entry.ip, entry);
    }

    return [...byIp.values()].sort((a, b) => b.time - a.time);
}

async function fetchIPs(db, username, allServers) {
    if (!db || typeof db !== 'object') return null;

    const methods = [
        'getPlayerIPs',
        'findPlayerIPs',
        'getIPs',
        'getPlayerIPHistory',
        'findPlayerIPHistory',
        'getIPHistory',
        'ipsOfPlayer',
        'ipsForPlayer'
    ];

    for (const method of methods) {
        if (typeof db[method] === 'function') {
            try {
                const raw = await db[method](username, allServers, LIMIT);
                return normalizeIPs(raw);
            } catch (e) {
                console.error('[alts/ip] fetch failed:', e);
                return [];
            }
        }
    }

    const auto = Object.keys(db).find(k =>
        typeof db[k] === 'function' &&
        /ip/i.test(k) &&
        !/set/i.test(k) &&
        k.toLowerCase() !== 'getplayerip'
    );
    if (auto) {
        try {
            const raw = await db[auto](username, allServers, LIMIT);
            return normalizeIPs(raw);
        } catch (e) {
            console.error('[alts/ip] fetch failed:', e);
            return [];
        }
    }

    if (typeof db.getPlayerIP === 'function') {
        try {
            const ip = await db.getPlayerIP(username);
            return ip ? [{ ip: String(ip).trim(), time: 0, server: null }] : [];
        } catch (e) {
            console.error('[alts/ip] getPlayerIP failed:', e);
            return [];
        }
    }

    return null;
}

function normalizeAlts(raw) {
    if (!raw) return [];
    const out = [];

    const pushEntry = (username, value) => {
        let time = 0;
        let server = null;
        if (typeof value === 'number') time = value;
        else if (value && typeof value === 'object') {
            time = Number(value.lastSeen ?? value.time ?? value.left ?? 0) || 0;
            server = value.server ?? value.right ?? null;
        }
        out.push({ username: String(username), time, server });
    };

    if (raw instanceof Map) {
        for (const [k, v] of raw) pushEntry(k, v);
    } else if (Array.isArray(raw)) {
        for (const item of raw) {
            if (typeof item === 'string') pushEntry(item, 0);
            else if (item) pushEntry(item.username ?? item.name, item);
        }
    } else if (typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) pushEntry(k, v);
    }

    return out;
}

function send(ctx, components) {
    const payload = { text: '', extra: components };
    if (typeof ctx.tellraw === 'function') {
        return ctx.tellraw('@a', payload);
    }
    if (typeof ctx.run === 'function') {
        return ctx.run(`tellraw @a ${JSON.stringify(payload)}`);
    }
    if (typeof ctx.tellrawCommand === 'function') {
        const text = components.map(c => c.text || '').join('');
        return ctx.tellrawCommand(text);
    }
    return false;
}

async function showIPs(ctx, db, player, allServers, page) {
    const bot = ctx.bot;
    const prefix = ctx.prefix || (bot.globalConfig?.bot?.prefix?.[0]) || 'ba:';

    const ips = await fetchIPs(db, player, allServers);
    if (ips === null) {
        return ctx.tellrawCommand('The player database is disabled or not loaded.');
    }

    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(ips.length / pageSize));
    page = Math.min(Math.max(1, page || 1), totalPages);

    const header = allServers
        ? `bananabot - IPs of player ${player} (all servers) (${ips.length}) - page ${page}/${totalPages}`
        : `bananabot - IPs of player ${player} (${ips.length}) - page ${page}/${totalPages}`;
    const headerComps = gradient.gradient(header, '#f4fcff', '#238bff');

    if (!ips.length) {
        headerComps.push({ text: '\n', color: COLORS.label });
        headerComps.push({ text: 'No IPs found.', color: COLORS.label });
        return send(ctx, headerComps);
    }

    const start = (page - 1) * pageSize;
    const pageIps = ips.slice(start, start + pageSize);

    const source = (ctx.commandName || 'alts').toLowerCase();
    const nameComps = pageIps.map((ip, i) => {
        const seen = ip.time
            ? `Last used ${timeAgo(ip.time)} (${formatDate(ip.time)})`
            : 'Last used: unknown';
        const where = ip.server ? `\nServer: ${ip.server}` : '';
        const label = ip.server ? `${ip.ip} [${ip.server}]` : ip.ip;
        const hoverText = `Click to show alts of ${ip.ip}\n${seen}${where}`;

        let clickEvent = { action: 'suggest_command', command: `${prefix}alts ${ip.ip}` };
        if (bot.clickTokens && typeof bot.clickTokens.register === 'function') {
            const tokenCmd = bot.clickTokens.register(source, async (clickerName, clickerPlayer) => {
                await bot.commands.execute('alts', [ip.ip], `${prefix}alts ${ip.ip}`, ctx.message, clickerPlayer);
            });
            clickEvent = { action: 'run_command', command: tokenCmd };
        }

        return {
            text: label + ' ',
            color: (start + i) % 2 === 0 ? COLORS.primary : COLORS.secondary,
            click_event: clickEvent,
            hover_event: {
                action: 'show_text',
                value: { text: hoverText, color: 'green' }
            }
        };
    });

    headerComps.push({ text: '\n', color: COLORS.label });
    send(ctx, [...headerComps, ...nameComps]);
}

async function showAltsOfIP(ctx, db, targetIP, displayInput, allServers) {
    const bot = ctx.bot;
    if (typeof db.findPlayerAlts !== 'function') {
        return ctx.tellrawCommand('The player database does not support alt lookups.');
    }

    const raw = await db.findPlayerAlts(targetIP, allServers, LIMIT);
    const alts = normalizeAlts(raw).sort((a, b) => b.time - a.time);

    const header = `bananabot - Alts of IP ${displayInput} (${alts.length})`;
    const headerComps = gradient.gradient(header, '#f4fcff', '#238bff');

    if (!alts.length) {
        headerComps.push({ text: '\n', color: COLORS.label });
        headerComps.push({ text: 'No alts found.', color: COLORS.label });
        return ctx.tellraw('@a', { text: '', extra: headerComps });
    }

    const onlineNow = new Set(
        (bot.playersAPI?.getOnline?.() || []).map(p => stripFormatting(p.username).toLowerCase())
    );

    const nameComps = alts.flatMap((alt, i) => {
        const name = stripFormatting(alt.username);
        const isOnline = onlineNow.has(name.toLowerCase());
        const seen = isOnline
            ? 'Online now'
            : alt.time
                ? `Last seen ${timeAgo(alt.time)} (${formatDate(alt.time)})`
                : 'Last seen: unknown';
        const where = alt.server ? `\nServer: ${alt.server}` : '';
        return [{
            text: name,
            color: i % 2 === 0 ? COLORS.primary : COLORS.secondary,
            click_event: { action: 'copy_to_clipboard', value: name },
            hover_event: {
                action: 'show_text',
                value: { text: `Click to copy ${name}\n${seen}${where}`, color: 'green' }
            }
        }, { text: ' ', color: COLORS.label }];
    });

    const PER_MESSAGE = 40 * 2; // two components (name + space) per alt
    headerComps.push({ text: '\n', color: COLORS.label });
    ctx.tellraw('@a', { text: '', extra: [...headerComps, ...nameComps.slice(0, PER_MESSAGE)] });
    for (let i = PER_MESSAGE; i < nameComps.length; i += PER_MESSAGE) {
        ctx.tellraw('@a', { text: '', extra: nameComps.slice(i, i + PER_MESSAGE) });
    }
}

module.exports = {
    name: 'alts',
    description: 'List player IPs (click an IP to show alts), or show alts for an IP',
    aliases: ['a', 'alt', 'ip', 'ips', 'playerips', 'findalts', 'sameip'],
    level: 0,
    usage: 'alts [-allservers|--all] <player|ip> [page]',

    async execute(ctx) {
        const bot = ctx.bot;
        const args = ctx.args || [];

        const db = bot?.playersDatabase ?? ctx.playersDatabase ?? null;
        if (!db) {
            return ctx.tellrawCommand('The player database is disabled or not loaded.');
        }

        const allServers = args.some(a => ALL_SERVER_FLAGS.includes(String(a).toLowerCase()));
        const rest = args.filter(a => !ALL_SERVER_FLAGS.includes(String(a).toLowerCase()));

        // optional trailing page number
        let page = 1;
        let targetArgs = rest;
        if (rest.length && /^\d+$/.test(String(rest[rest.length - 1]))) {
            page = parseInt(rest[rest.length - 1], 10) || 1;
            targetArgs = rest.slice(0, -1);
        }
        const target = targetArgs.join(' ').trim();

        if (!target) {
            return ctx.tellrawCommand('Usage: alts [-allservers|--all] <player|ip> [page]');
        }

        try {
            // If input is an IP, show alts of that IP (normal alts behavior).
            // This is also what clicking an IP does.
            if (looksLikeIP(target)) {
                return await showAltsOfIP(ctx, db, target, target, allServers);
            }

            // Otherwise, default to IP-list behavior for the player (like ip command).
            return await showIPs(ctx, db, target, allServers, page);
        } catch (err) {
            console.error(`[${bot?.id}] [alts] Failed:`, err);
            ctx.tellrawCommand('Failed to look up player/IP info.');
        }
    }
};
