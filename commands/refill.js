module.exports = {
    name: 'refill',
    description: 'Rebuilds the core block and refills the area',
    level: 0,

    async execute(ctx) {
        const core = ctx.bot?.core;
        if (!core || typeof core.refill !== 'function') {
            ctx.tellrawCommand('Core is not available.');
            return;
        }

        const ok = await core.refill('manual', true);
        ctx.tellrawCommand(ok ? 'Core block replaced and area refilled.' : 'Refill failed; retrying.');
    }
};
