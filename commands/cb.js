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

            const info = `Core origin: ${core.origin.x}, ${core.origin.y}, ${core.origin.z} | bounds: ${core.bounds.x}, ${core.bounds.y}, ${core.bounds.z} | ready: ${core.ready}`;
            const tokenCmd = (ctx.bot.clickTokens && typeof ctx.bot.clickTokens.register === 'function')
                ? ctx.bot.clickTokens.register('cb', async (clickerName) => {
                    if (!core.ready) return;
                    core.run(`tp ${clickerName} ${core.origin.x} ${core.origin.y} ${core.origin.z}`);
                })
                : null;
            const button = tokenCmd
                ? {
                    text: '[TP to core]',
                    color: '#55aaff',
                    click_event: { action: 'run_command', command: tokenCmd },
                    hover_event: { action: 'show_text', value: { text: 'Teleport to the core', color: 'green' } }
                }
                : { text: '' };
            return ctx.tellraw('@a', { text: '', extra: [{ text: info + ' ' }, button] });
        }
        ctx.core.run(cmd);
    }
};