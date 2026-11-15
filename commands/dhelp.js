const LEVELS = {
    0: { name: 'spirits', color: '#00ccff' },
    1: { name: 'wraiths', color: '#00ff88' },
    2: { name: 'phantom', color: '#8844ff' }
};

const CATEGORIES = {
    Games: ['chess', 'rps', 'snake', 'spleef', 'trivia', 'roll', 'poll', 'hangman', 'rtp'],
    Fun: ['bruhify', 'rainbowify', 'music', 'campfire', 'parkour'],
    Utils: ['uuid', 'ip', 'cb', 'supercb', 'refill', 'remind', 'seen', 'whereami', 'uptime', 'wikipedia', 'translate', 'chattranslate', 'netmsg', 'serverchat', 'mail', 'players', 'alts'],
    Core: ['corecmd', 'spawnproof', 'cb'],
    Admin: ['filter', 'whitelist', 'cloop', 'discord', 'eval', 'shell', 'restart', 'stop', 'authenticate', 'validate', 'servers', 'servercrash', 'info'],
    Other: []
};

const PREFIX = 'ph:';

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

    out.push({ text: 'PhantomBot ✦ dYnaMiC hElP ✦ (the void remembers)', color: '#00ccff', bold: true });
    out.push({ text: '\n\nby vibes/rank??\n', color: 'light_purple' });

    for (const lvl of Object.keys(LEVELS).map(Number)) {
        const accessible = userLevel >= lvl;
        out.push({
            text: LEVELS[lvl].name,
            color: accessible ? LEVELS[lvl].color : 'dark_gray',
            bold: true,
            click_event: accessible ? { action: 'suggest_command', command: `${PREFIX}dhelp rank ${LEVELS[lvl].name.toLowerCase()}` } : undefined,
            hover_event: { action: 'show_text', value: { text: accessible ? `peek ${LEVELS[lvl].name} realm` : 'no access spirit', color: accessible ? 'light_purple' : 'red' } }
        });
        out.push({ text: '  ✿  ', color: 'gray' });
    }

    out.push({ text: '\n\nby category (kinda)\n', color: 'light_purple' });
    for (const cat of Object.keys(CATEGORIES)) {
        out.push({
            text: cat,
            color: '#ff99dd',
            bold: true,
            click_event: { action: 'suggest_command', command: `${PREFIX}dhelp cat ${cat.toLowerCase()}` },
            hover_event: { action: 'show_text', value: { text: `open ${cat} realm`, color: 'light_purple' } }
        });
        out.push({ text: '  ~  ', color: 'gray' });
    }

    out.push({ text: '\n\nor just type ', color: 'gray' });
    out.push({ text: `${PREFIX}dhelp <thing>`, color: '#ff77cc' });
    out.push({ text: ' if you can read this lol', color: 'gray' });

    ctx.tellraw('@a', { text: '', extra: out });
}

function sendRank(ctx, level) {
    const all = [...new Map([...ctx.commands.values()].map(c => [c.name, c])).values()]
        .filter(c => Number(c.level) === level)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const out = [];
    out.push({ text: `${LEVELS[level].name} stuff`, color: LEVELS[level].color, bold: true });
    out.push({ text: ` (${all.length})\n`, color: 'dark_gray' });

    all.forEach((cmd, i) => {
        out.push({
            text: cmd.name,
            color: LEVELS[level].color,
            click_event: { action: 'suggest_command', command: `${PREFIX}help ${cmd.name}` },
            hover_event: { action: 'show_text', value: { text: usageOf(cmd), color: 'white' } }
        });
        if (i < all.length - 1) out.push({ text: ' · ', color: 'dark_gray' });
    });

    out.push({ text: '\n\n', color: 'gray' });
    out.push({
        text: '← go back (somehow)',
        color: '#ff99dd',
        click_event: { action: 'suggest_command', command: `${PREFIX}dhelp` },
        hover_event: { action: 'show_text', value: { text: 'back to chaos menu', color: 'light_purple' } }
    });

    ctx.tellraw('@a', { text: '', extra: out });
}

function sendCategory(ctx, catName) {
    const target = Object.keys(CATEGORIES).find(c => c.toLowerCase() === catName.toLowerCase()) || catName;
    const all = [...new Map([...ctx.commands.values()].map(c => [c.name, c])).values()]
        .filter(c => categoryOf(c) === target)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const out = [];
    out.push({ text: `${target} pile`, color: '#ff77cc', bold: true });
    out.push({ text: ` (${all.length})\n`, color: 'dark_gray' });

    all.forEach((cmd, i) => {
        out.push({
            text: cmd.name,
            color: '#ff99dd',
            click_event: { action: 'suggest_command', command: `${PREFIX}help ${cmd.name}` },
            hover_event: { action: 'show_text', value: { text: usageOf(cmd), color: 'white' } }
        });
        if (i < all.length - 1) out.push({ text: ' · ', color: 'dark_gray' });
    });

    out.push({ text: '\n\n', color: 'gray' });
    out.push({
        text: '← back??',
        color: '#ff99dd',
        click_event: { action: 'suggest_command', command: `${PREFIX}dhelp` },
        hover_event: { action: 'show_text', value: { text: 'return to chaos', color: 'light_purple' } }
    });

    ctx.tellraw('@a', { text: '', extra: out });
}

module.exports = {
    name: 'dhelp',
    description: 'Dynamic help (PhantomBot ghost edition)',
    usage: 'dhelp [rank girlies|besties|queen | cat <name> | command]',
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
                ctx.tellrawCommand('idk that rank babe');
                return;
            }
            const userLevel = Number(ctx.level ?? 0);
            if (userLevel < Number(level)) {
                ctx.tellrawCommand('nope not ur vibe level');
                return;
            }
            sendRank(ctx, Number(level));
            return;
        }

        if (first === 'cat' || first === 'category') {
            const catName = (args[1] || '').toLowerCase();
            const target = Object.keys(CATEGORIES).find(c => c.toLowerCase() === catName);
            if (!target) {
                ctx.tellrawCommand('what category even is that??');
                return;
            }
            sendCategory(ctx, target);
            return;
        }

        const level = Object.keys(LEVELS).find(n => LEVELS[n].name.toLowerCase() === first);
        if (level !== undefined) {
            const userLevel = Number(ctx.level ?? 0);
            if (userLevel < Number(level)) {
                ctx.tellrawCommand('nope not ur vibe level');
                return;
            }
            sendRank(ctx, Number(level));
            return;
        }

        const cat = Object.keys(CATEGORIES).find(c => c.toLowerCase() === first);
        if (cat) {
            sendCategory(ctx, cat);
            return;
        }

        const cmd = ctx.commands.get(first);
        if (cmd) {
            ctx.tellrawCommand(`try ${PREFIX}help ${cmd.name} bestie`);
            return;
        }

        ctx.tellrawCommand(`"${first}"?? never heard of her`);
    }
};
