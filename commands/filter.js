const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'filter',
    description: 'Manage filter (players, UUIDs, regex)',
    usage: 'filter <on|off|list|add|remove|add-uuid|remove-uuid|add-ip [--all]|remove-ip|mute|unmute|clear|clear-uuid|clear-ip|clear-mute|regex> ...',
    aliases: ["f"],
    level: 1,

    async execute(ctx) {
        const args = ctx.args;
        if (!args.length) {
            ctx.tellrawCommand('Usage: filter <on|off|list|add|remove|add-uuid|remove-uuid|add-ip [--all]|remove-ip|mute|unmute|list|clear|clear-uuid|clear-ip|clear-mute|regex> ...');
            return;
        }

        const f = ctx.bot.filter;
        if (!f || typeof f.addPlayer !== 'function') {
            ctx.tellrawCommand('Filter plugin not loaded.');
            return;
        }

        const sub = args[0].toLowerCase();
        const rest = args.slice(1);
        const say = ctx.tellrawCommand.bind(ctx);

        const isUuid = s =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
            /^[0-9a-f]{32}$/i.test(s);

        if (sub === 'on') {
            const ok = f.on ? f.on() : false;
            say(ok ? 'Filter enabled.' : 'Failed to enable filter.');
            return;
        }

        if (sub === 'off') {
            const ok = f.off ? f.off() : false;
            say(ok ? 'Filter disabled.' : 'Failed to disable filter.');
            return;
        }

        if (sub === 'list') {
            const players = f.listPlayers() || [];
            const uuids = f.listUUIDs() || [];
            const regex = f.getRegex();
            const ips = f.listIPs ? (f.listIPs() || []) : [];
            const mutes = f.listMutes ? (f.listMutes() || []) : [];
            say(`Filter: ${f.isEnabled ? (f.isEnabled() ? 'ON' : 'OFF') : 'ON'}\nPlayers: ${players.length ? players.join(', ') : '(empty)'}\nUUIDs: ${uuids.length ? uuids.join(', ') : '(empty)'}\nIPs: ${ips.length ? ips.join(', ') : '(empty)'}\nMutes: ${mutes.length ? mutes.join(', ') : '(empty)'}\nRegex: ${regex || '(none)'}`);
            return;
        }

        if (sub === 'add') {
            if (!rest.length) return say('Usage: filter add <name or UUID>');
            const val = rest.join(' ');
            const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(val);
            let ok;
            if (isUuid(val)) {
                ok = f.addUUID(val);
                say(ok ? `Added UUID "${val}" to filter list` : `Failed to add UUID to filter list (maybe exists)`);
            } else if (isIp) {
                ok = f.addIP(val);
                say(ok ? `Added IP "${val}" to filter list` : `Failed to add IP to filter list (maybe exists)`);
            } else {
                ok = f.addPlayer(val);
                say(ok ? `Added player "${val}" to filter list` : `Failed to add player to filter list (maybe exists)`);
            }
            return;
        }

        if (sub === 'remove') {
            if (!rest.length) return say('Usage: filter remove <name or UUID>');
            const val = rest.join(' ');
            const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(val);
            let ok = false;
            if (isUuid(val)) {
                ok = f.removeUUID(val);
            } else if (isIp) {
                ok = f.removeIP(val);
            } else {
                ok = f.removePlayer(val);
                if (!ok) ok = f.removeUUID(val);
                if (!ok) ok = f.removeIP(val);
            }
            say(ok ? `Removed "${val}" from filter list` : `Failed to remove "${val}" from filter list (not found)`);
            return;
        }

        if (sub === 'add-uuid') {
            if (!rest.length) return say('Usage: filter add-uuid <uuid>');
            const val = rest.join(' ');
            const ok = f.addUUID(val);
            say(ok ? `Added UUID "${val}" to filter list` : `Failed to add UUID to filter list (maybe exists)`);
            return;
        }

        if (sub === 'remove-uuid') {
            if (!rest.length) return say('Usage: filter remove-uuid <uuid>');
            const val = rest.join(' ');
            const ok = f.removeUUID(val);
            say(ok ? `Removed UUID "${val}" to filter list` : `Failed to remove UUID from filter list (not found)`);
            return;
        }

        if (sub === 'clear') {
            const ok = f.clearPlayers();
            say(ok ? 'Cleared all player names from filter list' : 'Failed to clear players from filter list');
            return;
        }

        if (sub === 'clear-uuid') {
            const ok = f.clearUUIDs();
            say(ok ? 'Cleared all UUIDs from filter list' : 'Failed to clear UUIDs from filter list');
            return;
        }

        if (sub === 'add-ip') {
            if (!rest.length) return say('Usage: filter add-ip <ip|player --all>');
            const args2 = [...rest];
            const allFlags = ['--all', '--allservers', '-allservers', '-allserver'];
            const useAll = args2.length && allFlags.includes(String(args2[args2.length - 1]).toLowerCase());
            if (useAll) args2.pop();
            const val = args2.join(' ').trim();
            if (!val) return say('Usage: filter add-ip <ip|player --all>');
            if (useAll) {
                if (!ctx.bot.playersDatabase || typeof ctx.bot.playersDatabase.getPlayerIPs !== 'function') {
                    return say('Players database not available.');
                }
                const entries = ctx.bot.playersDatabase.getPlayerIPs(val, false) || [];
                const ips = [...new Set(entries.map(e => e && e.ip ? String(e.ip).trim() : '').filter(Boolean))];
                if (!ips.length) return say(`No known IPs found for "${val}".`);
                let added = 0;
                for (const ip of ips) if (f.addIP(ip)) added++;
                say(added ? `Added ${added} IP(s) for "${val}" to filter list.` : `No new IPs added for "${val}" (maybe already in list).`);
                return;
            }
            const ok = f.addIP(val);
            say(ok ? `Added IP "${val}" to filter list` : `Failed to add IP to filter list (maybe exists)`);
            return;
        }

        if (sub === 'remove-ip') {
            if (!rest.length) return say('Usage: filter remove-ip <ip>');
            const val = rest.join(' ').trim();
            const ok = f.removeIP(val);
            say(ok ? `Removed IP "${val}" from filter list` : `Failed to remove IP from filter list (not found)`);
            return;
        }

        if (sub === 'clear-ip') {
            const ok = f.clearIPs();
            say(ok ? 'Cleared all IPs from filter list' : 'Failed to clear IPs from filter list');
            return;
        }

        if (sub === 'mute') {
            if (!rest.length) return say('Usage: filter mute <target>');
            const val = rest.join(' ').trim();
            const ok = f.addMute ? f.addMute(val) : false;
            say(ok ? `Added mute target "${val}" (runs on start, join, and self-unmute).` : `Failed to add mute target "${val}" (maybe exists or unsupported).`);
            return;
        }

        if (sub === 'unmute' || sub === 'remove-mute') {
            if (!rest.length) return say('Usage: filter unmute <target>');
            const val = rest.join(' ').trim();
            const ok = f.removeMute ? f.removeMute(val) : false;
            say(ok ? `Removed mute target "${val}".` : `Failed to remove mute target "${val}" (not found).`);
            return;
        }

        if (sub === 'clear-mute' || sub === 'clear-mutes') {
            const ok = f.clearMutes ? f.clearMutes() : false;
            say(ok ? 'Cleared all mute targets.' : 'Failed to clear mute targets.');
            return;
        }

        if (sub === 'regex') {
            if (!rest.length) return say('Usage: filter regex <set|get|remove> [pattern]');
            const rsub = rest[0].toLowerCase();
            const rval = rest.slice(1).join(' ');
            if (rsub === 'set') {
                if (!rval) return say('Usage: filter regex set <pattern>');
                const ok = f.setRegex(rval);
                say(ok ? `Set regex: ${rval} to filter list` : `Failed to set regex (invalid pattern) in filter list`);
            } else if (rsub === 'get' || rsub === 'list') {
                say(`Current regex: ${f.getRegex() || '(none)'} in filter list`);
            } else if (rsub === 'remove' || rsub === 'clear') {
                const ok = f.removeRegex();
                say(ok ? 'Removed regex in filter list' : 'Failed to remove regex from filter list');
            } else {
                say('Usage: filter regex <set|get|remove> [pattern]');
            }
            return;
        }

        say(`Unknown subcommand: ${sub}. Available: on, off, list, add, remove, add-uuid, remove-uuid, add-ip, remove-ip, mute, unmute, clear, clear-uuid, clear-ip, clear-mute, regex`);
    }
};