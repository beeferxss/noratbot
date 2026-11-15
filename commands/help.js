const gradient = require('../utils/gradient');

const PREFIX = 'ph:';

const LEVELS = {
    0: { name: 'spirits', color: '#00ccff' },
    1: { name: 'wraiths', color: '#00ff88' },
    2: { name: 'phantom', color: '#8844ff' }
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

    out.push(...grad(`✦ PhantomBot ~ ghost ~ cmd: ${cmd.name} ✦`, '#00ccff', '#8844ff'));
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'what it does: ', color: '#00ccff' });
    out.push({ text: cmd.description || 'unknown spirit', color: '#ffffff' });
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'invoke like: ', color: '#00ccff' });
    out.push({ text: usageOf(cmd), color: '#ffffff' });
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'rank: ', color: '#00ccff' });
    out.push({ text: `${cmd.level} (${level.name})`, color: level.color });
    out.push({ text: '\n', color: 'gray' });

    if (cmd.aliases && cmd.aliases.length) {
        out.push({ text: 'also known as: ', color: '#00ccff' });
        out.push({ text: cmd.aliases.join(' ~ '), color: '#ffffff' });
        out.push({ text: '\n', color: 'gray' });
    }

    const suggest = `${PREFIX}${cmd.name} `;
    out.push({ text: '\n✦ ', color: '#00ff88' });
    out.push({
        text: 'click to summon (phantom approved)',
        color: '#00ccff',
        click_event: { action: 'suggest_command', command: suggest },
        hover_event: { action: 'show_text', value: { text: `summon: ${suggest}`, color: '#00ff88' } }
    });

    ctx.run(`tellraw @a ${toSNBT({ text: '', extra: out })}`);
}

function sendList(ctx, onlyLevel) {
    const all = [...new Map([...ctx.commands.values()].map(c => [c.name, c])).values()]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const out = [];
    out.push(...grad('PhantomBot ✦ ghost help ✦ (the void remembers)', '#00ccff', '#8844ff'));
    out.push({ text: '\n', color: 'gray' });

    for (const lvl of Object.keys(LEVELS).map(Number)) {
        if (onlyLevel !== undefined && lvl !== onlyLevel) continue;

        const cmds = all.filter(c => Number(c.level) === lvl);
        if (!cmds.length) continue;

        out.push({ text: `\n~ ${LEVELS[lvl].name} realm ~ `, color: LEVELS[lvl].color, bold: true });
        out.push({ text: `(${cmds.length})\n`, color: 'dark_gray' });

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
                            { text: `\n${cmd.description || 'unknown spirit'}`, color: 'gray' }
                        ]
                    }
                }
            });
            if (i < cmds.length - 1) out.push({ text: ' ✦ ', color: '#00ff88' });
        });

        out.push({ text: '\n', color: 'gray' });
    }

    out.push({ text: `\nhover for secrets. ${PREFIX}help <cmd> to invoke`, color: '#00ccff' });

    ctx.tellraw('@a', { text: '', extra: out });
}

module.exports = {
    name: 'help',
    description: 'List all commands (PhantomBot ghost edition)',
    usage: 'help [command|spirits|wraiths|phantom]',
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

        ctx.tellrawCommand(`"${search}" not found in the void (PhantomBot confused)`);
    }
};
