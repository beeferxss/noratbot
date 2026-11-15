const gradient = require('../utils/gradient');

const PREFIX = 'wb:';

const LEVELS = {
    0: { name: 'girlies', color: '#ff77cc' },
    1: { name: 'besties', color: '#ffaa00' },
    2: { name: 'queen', color: '#ff4fa3' }
};

function grad(text, start, end) {
    return gradient.gradient(text, start, end);
}

function toSNBT(obj) {
    if (typeof obj === 'string') {
        let safeStr = obj.replace(/\n/g, '\\n').replace(/'/g, "\\'");
        return `'${safeStr}'`;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return obj.toString();
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(item => toSNBT(item)).join(',')}]`;
    }
    if (typeof obj === 'object' && obj !== null) {
        const pairs = [];
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                pairs.push(`${key}:${toSNBT(obj[key])}`);
            }
        }
        return `{${pairs.join(',')}}`;
    }
    return "''";
}

function levelOf(cmd) {
    return LEVELS[Number(cmd.level)] || { name: `lvl ${cmd.level}??`, color: '#ffffff' };
}

function usageOf(cmd) {
    return PREFIX + (cmd.usage || cmd.name);
}

function sendInfo(ctx, cmd) {
    const level = levelOf(cmd);
    const out = [];

    out.push(...grad(`☆ wOmEn bOt ~ stylo ~ cmd tea: ${cmd.name} ☆`, '#ffb3ec', '#ff4fa3'));
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'so like it does: ', color: '#ff77cc' });
    out.push({ text: cmd.description || 'idk figure it out babe', color: '#ffffff' });
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'type it like: ', color: '#ff77cc' });
    out.push({ text: usageOf(cmd), color: '#ffffff' });
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'vibes/access: ', color: '#ff77cc' });
    out.push({ text: `${cmd.level} (${level.name})`, color: level.color });
    out.push({ text: '\n', color: 'gray' });

    if (cmd.aliases && cmd.aliases.length) {
        out.push({ text: 'aka also: ', color: '#ff77cc' });
        out.push({ text: cmd.aliases.join(' ~ '), color: '#ffffff' });
        out.push({ text: '\n', color: 'gray' });
    }

    const suggest = `${PREFIX}${cmd.name} `;
    out.push({ text: '\n♡ ', color: 'light_purple' });
    out.push({
        text: 'tap here 2 type it (no man can explain)',
        color: '#ff99dd',
        click_event: { action: 'suggest_command', command: suggest },
        hover_event: { action: 'show_text', value: { text: `ok fine: ${suggest}`, color: 'light_purple' } }
    });

    ctx.run(`tellraw @a ${toSNBT({ text: '', extra: out })}`);
}

function sendList(ctx, onlyLevel) {
    const all = [...new Map([...ctx.commands.values()].map(c => [c.name, c])).values()]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const out = [];
    out.push(...grad('wOmEn bOt ☆stylo☆ hElP?? (good luck bestie)', '#ffb3ec', '#ff4fa3'));
    out.push({ text: '\n', color: 'gray' });

    for (const lvl of Object.keys(LEVELS).map(Number)) {
        if (onlyLevel !== undefined && lvl !== onlyLevel) continue;

        const cmds = all.filter(c => Number(c.level) === lvl);
        if (!cmds.length) continue;

        out.push({ text: `\n~ ${LEVELS[lvl].name} zone ~ `, color: LEVELS[lvl].color, bold: true });
        out.push({ text: `(${cmds.length}??)\n`, color: 'dark_gray' });

        cmds.forEach((cmd, i) => {
            out.push({
                text: cmd.name,
                color: LEVELS[lvl].color,
                click_event: { action: 'suggest_command', command: `${PREFIX}help ${cmd.name}` },
                hover_event: {
                    action: 'show_text',
                    value: {
                        text: '',
                        extra: [
                            { text: usageOf(cmd), color: '#ffffff' },
                            { text: `\n${cmd.description || 'mystery vibes'}`, color: 'gray' }
                        ]
                    }
                }
            });
            if (i < cmds.length - 1) out.push({ text: ' ✿ ', color: 'light_purple' });
        });

        out.push({ text: '\n', color: 'gray' });
    }

    out.push({ text: `\nhover 4 secrets. ${PREFIX}help <cmd> if u dare`, color: '#ff99dd' });

    ctx.tellraw('@a', { text: '', extra: out });
}

module.exports = {
    name: 'help',
    description: 'List all commands (women bot stylo chaos)',
    usage: 'help [command|girlies|besties|queen]',
    level: 0,

    async execute(ctx) {
        const args = ctx.args || [];

        if (args.length === 0) {
            sendList(ctx);
            return;
        }

        const search = args[0].toLowerCase();

        const cmd = ctx.commands.get(search);
        if (cmd) {
            sendInfo(ctx, cmd);
            return;
        }

        const level = Object.keys(LEVELS).find(n => LEVELS[n].name.toLowerCase() === search);
        if (level !== undefined) {
            sendList(ctx, Number(level));
            return;
        }

        ctx.tellrawCommand(`huh?? "${search}" not found bestie (women bot confused)`);
    }
};
