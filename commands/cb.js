module.exports = {
    name: 'cb',
    description: 'Run command through command block',
    level: 0,

    async execute(ctx) {
        const cmd = ctx.args.join(' ');
        if (!cmd) {
            const core = ctx.bot?.core;
            if (!core) return ctx.tellrawCommand('Core is not loaded.');
            if (!core.ready) return ctx.tellrawCommand('Core is not ready.');

            const info = `core ${core.origin.x},${core.origin.y},${core.origin.z} to ${core.bounds.x},${core.bounds.y},${core.bounds.z} ready:${core.ready}`;
            let button = { text: '' };
            if (ctx.bot.clickTokens?.register) {
                const token = ctx.bot.clickTokens.register('cb', async (clicker) => {
                    if (!core.ready) return;
                    core.run(`tp ${clicker} ${core.origin.x} ${core.origin.y} ${core.origin.z}`);
                });
                button = {
                    text: '[tp to core]',
                    color: '#55aaff',
                    click_event: { action: 'run_command', command: token },
                    hover_event: { action: 'show_text',                        value: { text: 'tp to core', color: 'green' } }
                };
            }
            return ctx.tellraw('@a', { text: '', extra: [{ text: info + ' ' }, button] });
        }
        ctx.core.run(cmd);
    }
};