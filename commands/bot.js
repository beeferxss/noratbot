module.exports = {
    name: 'bot',
    description: 'Manage dummy bots (add, list, clear, remove, run)',
    usage: 'bot <add|list|clear|remove|run> ...',
    aliases: ['bots', 'dummy', 'dummies'],
    level: 2,

    async execute(ctx) {
        const say = ctx.tellrawCommand.bind(ctx);
        const api = ctx.bot && ctx.bot.dummyBots;
        if (!api) return say('Dummy bots plugin not loaded.');

        const args = Array.isArray(ctx.args) ? [...ctx.args] : [];
        if (!args.length) {
            return say('Usage: bot <add|list|clear|remove|run> ... | add [name] [amount] | remove <id|name> | run <id|name|-all> <command>');
        }

        const sub = String(args.shift() || '').toLowerCase();

        if (sub === 'add') {
            // bot add [name] [amount]  (name optional -> random)
            let name = '';
            let amount = 1;
            if (args.length === 0) {
                name = ''; amount = 1;
            } else if (args.length === 1) {
                if (/^\d+$/.test(args[0])) {
                    amount = parseInt(args[0], 10);
                    name = '';
                } else {
                    name = args[0];
                    amount = 1;
                }
            } else {
                const last = args[args.length - 1];
                if (/^\d+$/.test(last)) {
                    amount = parseInt(last, 10);
                    name = args.slice(0, -1).join(' ').trim();
                } else {
                    name = args.join(' ').trim();
                    amount = 1;
                }
            }
            if (!Number.isFinite(amount) || amount < 1) amount = 1;
            if (amount > 50) amount = 50;
            const created = api.add(name, amount);
            const names = created.map(c => c.name);
            if (names.length === 1) {
                say(`Added dummy bot "${names[0]}" (connecting via proxy).`);
            } else {
                const preview = names.slice(0, 10).join(', ') + (names.length > 10 ? `, ... (+${names.length - 10})` : '');
                say(`Added ${names.length} dummy bots: ${preview} (connecting via proxy).`);
            }
            return;
        }

        if (sub === 'list') {
            const list = api.list();
            if (!list.length) return say('No dummy bots.');
            const lines = list.map((d, i) => {
                const status = d.ready ? 'ready' : (d.destroyed ? 'destroyed' : 'connecting');
                return `${i + 1}. ${d.name} [${d.id}] - ${status}${d.proxy ? ` (${d.proxy})` : ''}`;
            });
            const msg = `Dummy bots (${list.length}):\n` + lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n... (+${lines.length - 20} more)` : '');
            say(msg);
            return;
        }

        if (sub === 'clear') {
            const count = await api.clear();
            say(count ? `Cleared ${count} dummy bot(s).` : 'No dummy bots to clear.');
            return;
        }

        if (sub === 'remove' || sub === 'del' || sub === 'delete') {
            if (!args.length) return say('Usage: bot remove <id|name>');
            const target = args.join(' ').trim();
            const removed = await api.remove(target);
            if (!removed) return say(`Dummy bot not found: "${target}"`);
            say(`Removed dummy bot "${removed.name}" [${removed.id}].`);
            return;
        }

        if (sub === 'run' || sub === 'exec' || sub === 'cmd') {
            if (args.length < 2) return say('Usage: bot run <id|name|-all> <command>');
            const target = args.shift();
            const command = args.join(' ').trim();
            if (!command) return say('Usage: bot run <id|name|-all> <command>');
            const res = api.run(target, command);
            if (!res.total) return say(`Dummy bot not found: "${target}"`);
            if (!res.count) return say(`No ready dummy bots matched (target ${res.total}) to run: ${command}`);
            say(`Ran on ${res.count}/${res.total}: ${command}`);
            return;
        }

        say(`Unknown subcommand: ${sub}. Available: add, list, clear, remove, run`);
    }
};
