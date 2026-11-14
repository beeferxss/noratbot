module.exports = {
    name: 'prs',
    description: 'Disconnect and reconnect a bot through a fresh proxy (rotate proxy)',
    roleRequired: 'Trusted',
    aliases: ['proxyrotate', 'proxyrestart', 'rotproxy'],

    async execute(msg, args, client, bot) {
        const pool = [...global.channelMap.values()];
        if (!pool.length) return 'No bots online.';

        const gcfg = (bot || pool[0])?.globalConfig?.discord;
        if (!gcfg) return 'Discord config not loaded.';

        const member = msg.member;
        if (!member) return 'Not in a server.';
        const hasTrusted = gcfg.trustedId && member.roles.cache.has(gcfg.trustedId);
        const hasAdmin = gcfg.adminId && member.roles.cache.has(gcfg.adminId);
        if (!hasTrusted && !hasAdmin) return 'Trusted or Admin role required.';

        const targetArg = args[0]?.toLowerCase();
        let targets = [];

        if (!targetArg) {
            if (bot) targets = [bot];
            else targets = pool;
        } else if (targetArg === 'all') {
            targets = pool;
        } else {
            const found = pool.find(b => b.id === targetArg);
            if (!found) return `Server "${targetArg}" not found. Available: ${pool.map(b => b.id).join(', ')}`;
            targets = [found];
        }

        const results = [];
        for (const b of targets) {
            try {
                await b.rotateProxy();
                results.push(`[${b.id}] disconnecting and reconnecting through a fresh proxy.`);
            } catch (e) {
                results.push(`[${b.id}] failed: ${e.message}`);
            }
        }
        return results.join('\n') || 'Done.';
    }
};
