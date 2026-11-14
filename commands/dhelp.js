const LEVELS = {
    0: { name: 'Public', color: '#55aaff' },
    1: { name: 'Trusted', color: '#ffaa00' },
    2: { name: 'Admin', color: '#ff6b6b' }
};

const PREFIX = 'nr:';

function usageOf(cmd) {
    return PREFIX + (cmd.usage || cmd.name);
}

function sendMenu(ctx) {
    const userLevel = Number(ctx.level ?? 0);
    const out = [];

    out.push({ text: 'Dynamic Help', color: 'white', bold: true });
    out.push({ text: '\nSelect a category:\n', color: 'gray' });

    for (const lvl of Object.keys(LEVELS).map(Number)) {
        const accessible = userLevel >= lvl;
        out.push({
            text: `${LEVELS[lvl].name}`,
            color: accessible ? LEVELS[lvl].color : 'dark_gray',
            bold: true,
            click_event: accessible ? { action: 'suggest_command', command: `${PREFIX}dhelp ${LEVELS[lvl].name.toLowerCase()}` } : undefined,
            hover_event: { action: 'show_text', value: { text: accessible ? `View ${LEVELS[lvl].name} commands` : 'Requires higher rank', color: accessible ? 'green' : 'red' } }
        });
        out.push({ text: '  ', color: 'gray' });
    }

    out.push({ text: '\n\nOr type ', color: 'gray' });
    out.push({ text: `${PREFIX}dhelp <command>`, color: '#55aaff' });
    out.push({ text: ' for details.', color: 'gray' });

    ctx.tellraw('@a', { text: '', extra: out });
}

function sendCategory(ctx, level) {
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
            click_event: { action: 'suggest_command', command: `${PREFIX}help ${cmd.name}` },
            hover_event: { action: 'show_text', value: { text: usageOf(cmd), color: 'white' } }
        });
        if (i < all.length - 1) out.push({ text: ' · ', color: 'dark_gray' });
    });

    out.push({ text: '\n\n', color: 'gray' });
    out.push({
        text: '← Back',
        color: '#55aaff',
        click_event: { action: 'suggest_command', command: `${PREFIX}dhelp` },
        hover_event: { action: 'show_text', value: { text: 'Return to categories', color: 'green' } }
    });

    ctx.tellraw('@a', { text: '', extra: out });
}

module.exports = {
    name: 'dhelp',
    description: 'Dynamic help with clickable categories',
    usage: 'dhelp [public|trusted|admin|command]',
    level: 0,
    aliases: ['dh'],
    async execute(ctx) {
        const args = ctx.args || [];

        if (args.length === 0) {
            sendMenu(ctx);
            return;
        }

        const search = args[0].toLowerCase();

        const cmd = ctx.commands.get(search);
        if (cmd) {
            // delegate to help info if available
            ctx.tellrawCommand(`Use ${PREFIX}help ${cmd.name} for details.`);
            return;
        }

        const level = Object.keys(LEVELS).find(n => LEVELS[n].name.toLowerCase() === search);
        if (level !== undefined) {
            const userLevel = Number(ctx.level ?? 0);
            if (userLevel < Number(level)) {
                ctx.tellrawCommand('You do not have access to that category.');
                return;
            }
            sendCategory(ctx, Number(level));
            return;
        }

        ctx.tellrawCommand(`Unknown category "${search}".`);
    }
};
