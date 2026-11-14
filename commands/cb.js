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
            return ctx.tellrawCommand(`Core origin: ${core.origin.x}, ${core.origin.y}, ${core.origin.z} | bounds: ${core.bounds.x}, ${core.bounds.y}, ${core.bounds.z} | ready: ${core.ready}`);
        }
        ctx.core.run(cmd);
    }
};