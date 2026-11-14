module.exports = {
    name: 'spawnproof',
    description: 'Spawnproof region: backup + auto-restore. Aliases: sp, sproof, spawnp',
    level: 1,
    aliases: ['sp', 'sproof', 'spawnp'],
    async execute(ctx) {
        const bot = ctx.bot;
        const sp = bot.spawnproof;
        if (!sp) return ctx.tellrawCommand('Spawnproof not configured.');
        const sub = (ctx.args && ctx.args[0]) || '';
        if (sub === 'restore') {
            sp.restore();
            return ctx.tellrawCommand('Spawnproof restore triggered.');
        }
        if (sub === 'backup') {
            const ok = sp.backupNow();
            return ctx.tellrawCommand(ok ? 'Spawnproof backup created.' : 'Spawnproof backup failed.');
        }
        return ctx.tellrawCommand(`Spawnproof region: ${sp.region.ox} ${sp.region.oy} ${sp.region.oz} size ${sp.region.size} | backup: ${sp.backup.bx} ${sp.backup.by} ${sp.backup.bz}`);
    }
};
