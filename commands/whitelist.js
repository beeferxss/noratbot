module.exports = {
    name: 'whitelist',
    description: 'Manage whitelist (on/off, add/remove players)',
    usage: 'whitelist <on|off|add|remove|list|clear> (add supports --all for all known IPs)',
    aliases: ['wl'],
    level: 1,

    async execute(ctx) {
        const args = ctx.args || [];
        const w = ctx.bot?.whitelist;
        if (!w || typeof w.addPlayer !== 'function') {
            ctx.tellrawCommand('Whitelist plugin not loaded.');
            return;
        }

        const sub = (args[0] || '').toLowerCase();
        const rest = args.slice(1);
        const say = ctx.tellrawCommand.bind(ctx);

        const isUuid = s =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
            /^[0-9a-f]{32}$/i.test(s);
        const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

        if (!sub) {
            say('Usage: whitelist <on|off|add|remove|list|clear> [player]');
            return;
        }

        if (sub === 'on') {
            const ok = w.on();
            say(ok ? 'Whitelist enabled.' : 'Failed to enable whitelist.');
            return;
        }

        if (sub === 'off') {
            const ok = w.off();
            say(ok ? 'Whitelist disabled.' : 'Failed to disable whitelist.');
            return;
        }

        if (sub === 'list') {
            const players = w.listPlayers() || [];
            const uuids = w.listUUIDs() || [];
            const ips = w.listIPs() || [];
            say(`Whitelist ${w.isEnabled() ? 'ON' : 'OFF'}\nPlayers: ${players.length ? players.join(', ') : '(empty)'}\nUUIDs: ${uuids.length ? uuids.join(', ') : '(empty)'}\nIPs: ${ips.length ? ips.join(', ') : '(empty)'}`);
            return;
        }

        if (sub === 'clear') {
            w.clearPlayers();
            w.clearUUIDs();
            w.clearIPs();
            say('Cleared whitelist.');
            return;
        }

        if (sub === 'add') {
            if (!rest.length) return say('Usage: whitelist add <player|uuid|ip> [--all]');
            const args2 = [...rest];
            const allFlags = ['--all', '--allservers', '-allservers', '-allserver'];
            const useAll = args2.length && allFlags.includes(String(args2[args2.length - 1]).toLowerCase());
            if (useAll) args2.pop();
            const val = args2.join(' ').trim();
            if (!val) return say('Usage: whitelist add <player|uuid|ip> [--all]');
            if (useAll) {
                if (!ctx.bot.playersDatabase || typeof ctx.bot.playersDatabase.getPlayerIPs !== 'function') {
                    return say('Players database not available.');
                }
                const entries = ctx.bot.playersDatabase.getPlayerIPs(val, false) || [];
                const ips = [...new Set(entries.map(e => e && e.ip ? String(e.ip).trim() : '').filter(Boolean))];
                if (!ips.length) return say(`No known IPs found for "${val}".`);
                let added = 0;
                for (const ip of ips) if (w.addIP(ip)) added++;
                say(added ? `Added ${added} IP(s) for "${val}" to whitelist.` : `No new IPs added for "${val}" (maybe already in list).`);
                return;
            }
            let ok;
            if (isUuid(val)) ok = w.addUUID(val);
            else if (isIp(val)) ok = w.addIP(val);
            else ok = w.addPlayer(val);
            say(ok ? `Added \"${val}\" to whitelist.` : `Failed to add \"${val}\" (maybe exists).`);
            return;
        }

        if (sub === 'remove') {
            if (!rest.length) return say('Usage: whitelist remove <player>');
            const val = rest.join(' ');
            let ok = false;
            if (isUuid(val)) ok = w.removeUUID(val);
            else if (isIp(val)) ok = w.removeIP(val);
            else {
                ok = w.removePlayer(val);
                if (!ok) ok = w.removeUUID(val);
                if (!ok) ok = w.removeIP(val);
            }
            say(ok ? `Removed \"${val}\" from whitelist.` : `Failed to remove \"${val}\" (not found).`);
            return;
        }

        say(`Unknown subcommand: ${sub}. Available: on, off, add, remove, list, clear`);
    }
};
