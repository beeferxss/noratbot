const LEVELS = {
    0: { name: 'Public', color: '#55aaff' },
    1: { name: 'Trusted', color: '#ffaa00' },
    2: { name: 'Admin', color: '#ff6b6b' }
};

const CATEGORIES = {
    Games: ['chess', 'rps', 'snake', 'spleef', 'trivia', 'roll', 'poll', 'hangman', 'rtp'],
    Fun: ['bruhify', 'rainbowify', 'echo', 'superecho', 'music', 'campfire', 'parkour'],
    Utils: ['uuid', 'ip', 'cb', 'supercb', 'refill', 'remind', 'seen', 'whereami', 'uptime', 'wikipedia', 'translate', 'chattranslate', 'netmsg', 'serverchat', 'mail', 'players', 'alts'],
    Core: ['corecmd', 'spawnproof', 'cb'],
    Admin: ['filter', 'whitelist', 'cloop', 'discord', 'eval', 'shell', 'restart', 'stop', 'authenticate', 'validate', 'servers', 'servercrash', 'info'],
    Other: []
};

const PREFIX = 'nr:';

function categoryOf(cmd) {
    const name = String(cmd.name).toLowerCase();
    for (const [cat, names] of Object.entries(CATEGORIES)) {
        if (names.includes(name)) return cat;
    }
    return 'Other';
}

function usageOf(cmd) {
    return PREFIX + (cmd.usage || cmd.name);
}

function sendMenu(ctx) {
    const userLevel = Number(ctx.level ?? 0);
    const out = [];

    out.push({ text: 'Dynamic Help', color: 'white', bold: true });
    out.push({ text: '\n\nBy Rank:\n', color: 'gray' });

    for (const lvl of Object.keys(LEVELS).map(Number)) {
        const accessible = userLevel >= lvl;
        out.push({
            text: LEVELS[lvl].name,
            color: accessible ? LEVELS[lvl].color : 'dark_gray',
            bold: true,
            click_event: accessible ? { action: 'run_command', command: `${PREFIX}dhelp rank ${LEVELS[lvl].name.toLowerCase()}` } : undefined,
            hover_event: { action: 'show_text', value: { text: accessible ? `View ${LEVELS[lvl].name} commands` : 'Requires higher rank', color: accessible ? 'green' : 'red' } }
        });
        out.push({ text: '  ', color: 'gray' });
    }

    out.push({ text: '\n\nBy Category:\n', color: 'gray' });
    for (const cat of Object.keys(CATEGORIES)) {
        out.push({
            text: cat,
            color: '#55aaff',
            bold: true,
            click_event: { action: 'run_command', command: `${PREFIX}dhelp cat ${cat.toLowerCase()}` },
            hover_event: { action: 'show_text', value: { text: `View ${cat} commands`, color: 'green' } }
        });
        out.push({ text: '  ', color: 'gray' });
    }

    out.push({ text: '\n\nOr type ', color: 'gray' });
    out.push({ text: `${PREFIX}dhelp <command>`, color: '#55aaff' });
    out.push({ text: ' for details.', color: 'gray' });

    ctx.tellraw('@a', { text: '', extra: out });
}

function sendRank(ctx, level) {
    const all = [...new Map([...ctx.commands.values()].map(c => [c.name, c])).values()]
        .filter(c => Number(c.level) === level)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const out = [];
    out.push({ text: `${LEVELS[level].name} Commands`, color: LEVELS[level].color, bold: true });
    out.push({ text: ` (${all.length})\n`, color: 'dark_gray' });

    all.forEach((cmd, i) => {
        out.push({
            text: cmd.name,
            color: LEVELS[level].color,
            click_event: { action: 'run_command', command: `${PREFIX}help ${cmd.name}` },
            hover_event: { action: 'show_text', value: { text: usageOf(cmd), color: 'white' } }
        });
        if (i < all.length - 1) out.push({ text: ' · ', color: 'dark_gray' });
    });

    out.push({ text: '\n\n', color: 'gray' });
    out.push({
        text: '← Back',
        color: '#55aaff',
        click_event: { action: 'run_command', command: `${PREFIX}dhelp` },
        hover_event: { action: 'show_text', value: { text: 'Return to categories', color: 'green' } }
    });

    ctx.tellraw('@a', { text: '', extra: out });
}

function sendCategory(ctx, catName) {
    const target = Object.keys(CATEGORIES).find(c => c.toLowerCase() === catName.toLowerCase()) || catName;
    const all = [...new Map([...ctx.commands.values()].map(c => [c.name, c])).values()]
        .filter(c => categoryOf(c) === target)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const out = [];
    out.push({ text: `${target} Commands`, color: '#55aaff', bold: true });
    out.push({ text: ` (${all.length})\n`, color: 'dark_gray' });

    all.forEach((cmd, i) => {
        out.push({
            text: cmd.name,
            color: '#55aaff',
            click_event: { action: 'run_command', command: `${PREFIX}help ${cmd.name}` },
            hover_event: { action: 'show_text', value: { text: usageOf(cmd), color: 'white' } }
        });
        if (i < all.length - 1) out.push({ text: ' · ', color: 'dark_gray' });
    });

    out.push({ text: '\n\n', color: 'gray' });
    out.push({
        text: '← Back',
        color: '#55aaff',
        click_event: { action: 'run_command', command: `${PREFIX}dhelp` },
        hover_event: { action: 'show_text', value: { text: 'Return to categories', color: 'green' } }
    });

    ctx.tellraw('@a', { text: '', extra: out });
}

module.exports = {
    name: 'dhelp',
    description: 'Dynamic help with clickable ranks and categories',
    usage: 'dhelp [rank public|trusted|admin | cat <name> | command]',
    level: 0,
    aliases: ['dh'],
    async execute(ctx) {
        const args = ctx.args || [];

        if (args.length === 0) {
            sendMenu(ctx);
            return;
        }

        const first = args[0].toLowerCase();

        if (first === 'rank') {
            const levelName = (args[1] || '').toLowerCase();
            const level = Object.keys(LEVELS).find(n => LEVELS[n].name.toLowerCase() === levelName);
            if (level === undefined) {
                ctx.tellrawCommand('Unknown rank.');
                return;
            }
            const userLevel = Number(ctx.level ?? 0);
            if (userLevel < Number(level)) {
                ctx.tellrawCommand('You do not have access to that rank.');
                return;
            }
            sendRank(ctx, Number(level));
            return;
        }

        if (first === 'cat' || first === 'category') {
            const catName = (args[1] || '').toLowerCase();
            const target = Object.keys(CATEGORIES).find(c => c.toLowerCase() === catName);
            if (!target) {
                ctx.tellrawCommand('Unknown category.');
                return;
            }
            sendCategory(ctx, target);
            return;
        }

        // direct rank name
        const level = Object.keys(LEVELS).find(n => LEVELS[n].name.toLowerCase() === first);
        if (level !== undefined) {
            const userLevel = Number(ctx.level ?? 0);
            if (userLevel < Number(level)) {
                ctx.tellrawCommand('You do not have access to that rank.');
                return;
            }
            sendRank(ctx, Number(level));
            return;
        }

        // direct category name
        const cat = Object.keys(CATEGORIES).find(c => c.toLowerCase() === first);
        if (cat) {
            sendCategory(ctx, cat);
            return;
        }

        const cmd = ctx.commands.get(first);
        if (cmd) {
            ctx.tellrawCommand(`Use ${PREFIX}help ${cmd.name} for details.`);
            return;
        }

        ctx.tellrawCommand(`Unknown "${first}".`);
    }
};
