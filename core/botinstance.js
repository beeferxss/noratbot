const EventEmitter = require('events');
const mc = require('minecraft-protocol');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { SocksClient } = require('socks');
const proxies = require('../utils/proxies');

function formatDisconnectReason(reason) {
    if (!reason) return 'Unknown reason';
    if (typeof reason === 'string') return reason;
    if (typeof reason === 'object') {
        if (reason.type === 'compound' && reason.value) {
            const textField = reason.value.text;
            if (textField) {
                if (typeof textField === 'string') return textField;
                if (textField.type === 'string' && textField.value) return textField.value;
                if (textField.type === 'compound' && textField.value) {
                    return formatDisconnectReason(textField);
                }
            }
            const translateField = reason.value.translate;
            if (translateField) {
                let msg = `[${translateField.value}]`;
                const withField = reason.value.with;
                if (withField && withField.type === 'list' && Array.isArray(withField.value)) {
                    const args = withField.value.map(arg => formatDisconnectReason(arg)).join(', ');
                    msg += ` ${args}`;
                }
                return msg;
            }
            const keyField = reason.value.key;
            if (keyField) {
                return `[${keyField.value}]`;
            }
            const extraField = reason.value.extra;
            if (extraField) {
                return formatDisconnectReason(extraField);
            }
            if (reason.value.color && reason.value.text) {
                return formatDisconnectReason(reason.value.text);
            }
            for (const key in reason.value) {
                const val = reason.value[key];
                const result = formatDisconnectReason(val);
                if (result && result !== '[object Object]') return result;
            }
            return 'Unknown disconnect reason';
        }
        if (Array.isArray(reason)) {
            return reason.map(r => formatDisconnectReason(r)).join(' ');
        }
        if (reason.text) return formatDisconnectReason(reason.text);
        if (reason.translate) {
            let msg = `[${reason.translate}]`;
            if (reason.with) {
                const args = reason.with.map(arg => formatDisconnectReason(arg)).join(', ');
                msg += ` ${args}`;
            }
            return msg;
        }
        if (reason.key) return `[${reason.key}]`;
        if (reason.extra) return formatDisconnectReason(reason.extra);
        if (reason.description) return reason.description;
        if (reason.message) return reason.message;
    }
    return String(reason);
}

class BotInstance extends EventEmitter {
    constructor(globalConfig, serverConfig) {
        super();
        this.globalConfig = globalConfig || {};
        this.config = serverConfig || {};
        this.gconf = this.globalConfig;
        this.conf = this.config;
        this.id = String(this.config.id || '');
        this.bot = null;
        this.started = false;
        this.ready = false;
        this.destroyed = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = this.globalConfig?.minecraft?.connection?.maxAttempts || 5;
        this.pendingReconnect = false;
        this.pluginsLoaded = false;
        this.client = null;
        this.playerUUIDs = new Map();
        this.players = {};
        this.core = null;
        this.commands = null;
        this._disconnectReason = null;
        this._errorReason = null;
        this._connecting = false;
        this.proxyPool = proxies.forConfig(this.globalConfig);
        this.proxy = null;
        this._proxyBootstrapTried = false;
        this._pendingTunnelSocket = null;
        this.probeTimeout = Math.min(15000, Math.max(500, Number(this.globalConfig?.proxy?.probeTimeout) || 3000));
        this.probeCandidates = Math.min(25, Math.max(1, Number(this.globalConfig?.proxy?.probeCandidates) || 6));
        this.fallbackDirect = this.globalConfig?.proxy?.fallbackDirect !== false;
    }

    log(message) {
        console.log(`[${this.id}] ${message}`);
    }

    start() {
        if (this.destroyed) return false;
        if (this.started) return false;
        this.started = true;
        this.emit('bot:connecting', this.config.host, this.config.port);
        this.connect();
        return true;
    }

    async connect() {
        if (this.destroyed) return;
        if (this._connecting) return;
        this._connecting = true;

        if (this.proxyPool && !this.proxyPool.list.length && !this._proxyBootstrapTried) {
            this._proxyBootstrapTried = true;
            await this.proxyPool.refresh();
            if (this.destroyed) { this._connecting = false; return; }
        }

        const config = this.config;
        if (!config.host || !config.port) {
            this.emit('bot:error', new Error('Minecraft host/port is missing'));
            this._connecting = false;
            this.scheduleReconnect();
            return;
        }

        if (this.client) {
            await this.stop();
        }

        let tunnel = null;
        try {
            tunnel = await this.acquireProxyTunnel();
        } catch (error) {
            console.error(`[${this.id}] ${error.message}`);
            this.emit('bot:error', error);
            this._connecting = false;
            this.scheduleReconnect();
            return;
        }

        if (this.destroyed) {
            if (tunnel) tunnel.socket.destroy();
            this._connecting = false;
            return;
        }

        const options = {
            host: config.host,
            port: Number(config.port),
            username: config.username,
            version: config.version,
            auth: config.auth || 'offline'
        };

        if (tunnel) {
            const { proxy, socket } = tunnel;
            this._pendingTunnelSocket = socket;
            options.connect = client => {
                this._pendingTunnelSocket = null;
                if (this.client && this.client !== client) {
                    socket.destroy();
                    return;
                }
                this.log(`Connected through ${proxy.host}:${proxy.port}`);
                client.setSocket(socket);
                client.emit('connect');
            };
        }

        let client;
        try {
            client = mc.createClient(options);
        } catch (error) {
            if (tunnel) tunnel.socket.destroy();
            this._pendingTunnelSocket = null;
            this.emit('bot:error', error);
            this._connecting = false;
            this.scheduleReconnect();
            return;
        }

        this.client = client;
        this.bot = client;
        if (!this.pluginsLoaded) {
            this.loadPlugins();
            this.pluginsLoaded = true;
        }
        this.attachClientEvents();
    }

    fixedProxyFromConfig() {
        const setting = this.config.proxy;
        if (!setting || setting === false) return null;

        if (typeof setting === 'string') {
            const parsed = proxies.parseProxy(setting);
            if (!parsed) console.error(`[${this.id}] Invalid proxy config: ${setting}`);
            return parsed;
        }

        if (typeof setting === 'object' && setting.host) {
            const parsed = proxies.parseProxy(`${setting.host}:${setting.port}`);
            if (!parsed) {
                console.error(`[${this.id}] Invalid proxy config`);
                return null;
            }
            if (setting.userId) parsed.userId = String(setting.userId);
            if (setting.password) parsed.password = String(setting.password);
            return parsed;
        }

        return null;
    }

    async probeSocket(proxy, destination, timeout) {
        try {
            const { socket } = await SocksClient.createConnection({
                proxy: {
                    host: proxy.host,
                    port: proxy.port,
                    type: 5,
                    userId: proxy.userId,
                    password: proxy.password
                },
                command: 'connect',
                destination,
                timeout
            });
            return { socket };
        } catch (error) {
            return { error: error.code || error.message || 'connect failed' };
        }
    }

    // Only hand a proxy to a client once it has actually opened a tunnel to the
    // server. Dead or blackholing pool entries are dropped instead of costing a
    // full connect cycle every reconnect.
    async acquireProxyTunnel() {
        if (this.config.proxy === false) return null;

        const destination = await this.proxyDestination();

        const fixed = this.fixedProxyFromConfig();
        if (fixed) {
            const { socket } = await this.probeSocket(fixed, destination, this.probeTimeout);
            if (socket) return { proxy: fixed, socket };
            console.error(`[${this.id}] Fixed proxy ${fixed.host}:${fixed.port} failed pre-check`);
            if (!this.fallbackDirect) throw new Error(`proxy ${fixed.host}:${fixed.port} is not reachable`);
            return null;
        }

        if (!this.proxyPool) return null;

        const tried = new Set();
        let lastError = 'no candidate in pool';
        for (let i = 0; i < this.probeCandidates; i++) {
            const candidate = this.proxyPool.pick();
            if (!candidate) break;
            const key = `${candidate.host}:${candidate.port}`;
            if (tried.has(key)) {
                this.proxyPool.markFailed(candidate);
                continue;
            }
            tried.add(key);
            const { socket, error } = await this.probeSocket(candidate, destination, this.probeTimeout);
            if (socket) {
                this.proxy = candidate;
                this.proxyPool.markGood(candidate);
                this.log(`Proxy ${key} tunnelled to ${destination.host}:${destination.port} after ${tried.size} attempt(s)`);
                return { proxy: candidate, socket };
            }
            lastError = error;
            this.proxyPool.markFailed(candidate);
        }

        this.proxy = null;
        console.error(`[${this.id}] No working proxy (${tried.size} tried, last ${lastError}); ${this.fallbackDirect ? 'connecting directly' : 'retrying later'}`);
        if (!this.fallbackDirect) throw new Error('no working proxy available');
        return null;
    }

    async proxyDestination() {
        const destination = await this.resolveDestination(this.config.host, Number(this.config.port));
        if (/^[0-9a-f:.]+$/i.test(destination.host)) return destination;
        try {
            const addresses = await dns.promises.lookup(destination.host);
            if (addresses && addresses.address) {
                return { host: addresses.address, port: destination.port };
            }
        } catch (e) {
            // Leave the hostname in place; some proxies resolve names remotely.
        }
        return destination;
    }

    resolveDestination(host, port) {
        if (port !== 25565 || /^[0-9.]+$/.test(host) || host === 'localhost') {
            return Promise.resolve({ host, port });
        }
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve({ host, port }), 3000);
            dns.resolveSrv(`_minecraft._tcp.${host}`, (error, records) => {
                clearTimeout(timer);
                if (!error && records && records.length) {
                    resolve({ host: records[0].name, port: records[0].port });
                } else {
                    resolve({ host, port });
                }
            });
        });
    }

    attachClientEvents() {
        const client = this.client;
        let disconnectSent = false; 

        client.on('login', () => {
            this.connectedAt = Date.now();
            this.reconnectAttempts = 0;
            this.pendingReconnect = false;
            this._connecting = false;
            disconnectSent = false;
            this._errorReason = null;
            if (this.proxy && this.proxyPool) this.proxyPool.markGood(this.proxy);
            this.emit('login');
            this.emit('bot:login');
            this.log(`Connected to server`);
            this.ready = true;
            this.emit('bot:ready');
            this.emit('bot:connected');
        });

        client.on('disconnect', packet => {
            const reason = packet.reason || packet;
            const reasonStr = formatDisconnectReason(reason);
            this._disconnectReason = reasonStr;
            disconnectSent = true;
            this.emit('bot:disconnect', reasonStr);
        });

        client.on('error', error => {
            this._errorReason = error.message || 'ECONNRESET';
            if (!this.ready && this.proxy && this.proxyPool) {
                this.proxyPool.markFailed(this.proxy);
                this.proxy = null;
            }
            this.emit('bot:error', error);
            console.error(`[${this.id}] Minecraft error:`, error);
        });

        client.on('end', reason => {
            if (this.client !== client) return;
            let finalReason;
            if (this._errorReason) {
                finalReason = this._errorReason;
                this._errorReason = null;
            } else if (this._disconnectReason) {
                finalReason = this._disconnectReason;
            } else {
                finalReason = reason || 'socketClosed';
            }
            this._disconnectReason = null;
            if (!disconnectSent) {
                this.emit('bot:disconnect', finalReason);
            }
            this.ready = false;
            this.connectedAt = null;
            this.started = false;
            this._connecting = false;
            client.removeAllListeners();
            this.client = null;
            this.bot = null;
            this.log('Bot disconnected');
            if (this.globalConfig?.minecraft?.connection?.autoReconnect !== false && !this.destroyed) {
                this.scheduleReconnect();
            }
        });

        const proxyEvents = [
            'player_chat', 'profileless_chat', 'system_chat', 'disguised_chat', 'chat',
            'entity_status', 'game_state_change', 'respawn',
            'spawn_entity', 'named_entity_spawn', 'player_info', 'player_remove',
            'position',
            'block_change', 'multi_block_change', 'map_chunk', 'map_chunk_bulk'
        ];
        for (const event of proxyEvents) {
            client.on(event, packet => {
                this.emit(event, packet);
            });
        }
    }

    chat(message) {
        if (!this.client || typeof this.client.chat !== 'function') return false;
        try {
            this.client.chat(String(message));
            return true;
        } catch (error) {
            this.emit('bot:error', error);
            return false;
        }
    }

    write(packetName, data) {
        if (!this.client) return false;
        try {
            this.client.write(packetName, data);
            return true;
        } catch (error) {
            this.emit('bot:error', error);
            return false;
        }
    }

    scheduleReconnect() {
        if (this.destroyed || this.reconnectTimer) return;
        if (global.botInitializing) {
            this.pendingReconnect = true;
            this.log('Deferred reconnect until initialization complete');
            return;
        }
        this.startReconnect();
    }

    startReconnect() {
        if (this.destroyed || this.reconnectTimer) return;
        const connection = this.globalConfig?.minecraft?.connection || {};
        const baseDelay = Number(connection.reconnectDelay || 3000);
        const maxDelay = Number(connection.maxReconnectDelay || 30000);
        const delay = Math.min(baseDelay * Math.max(1, Math.pow(2, this.reconnectAttempts)), maxDelay);
        this.reconnectAttempts++;
        this.emit('bot:reconnect');
        this.log(`Reconnect in ${delay}ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.destroyed) return;
            this.started = true;
            this._connecting = false;
            this.connect();
        }, delay);
    }

    loadPlugins() {
        const pluginsDir = path.join(process.cwd(), 'plugins');
        if (!fs.existsSync(pluginsDir)) {
            fs.mkdirSync(pluginsDir, { recursive: true });
            return;
        }
        const files = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
        for (const file of files) {
            const pluginPath = path.join(pluginsDir, file);
            try {
                if (file !== 'discord.js') {
                    delete require.cache[require.resolve(pluginPath)];
                }
                const plugin = require(pluginPath);
                if (typeof plugin !== 'function') {
                    console.log(`[${this.id}] [Plugin] Skipped: ${file}`);
                    continue;
                }
                plugin(this);
                this.emit('plugin:loaded', file);
            } catch (error) {
                console.error(`[${this.id}] [Plugin] Failed to load ${file}:`, error);
                this.emit('plugin:error', file, error);
            }
        }
    }

    async rotateProxy() {
        if (this.proxy && this.proxyPool) this.proxyPool.markFailed(this.proxy);
        this.proxy = null;
        this._proxyBootstrapTried = false;
        await this.stop();
        if (this.destroyed) return false;
        this.started = false;
        this._connecting = false;
        this.start();
        return true;
    }

    async stop() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.started = false;
        this.ready = false;
        this._connecting = false;
        this.pendingReconnect = false;
        if (this.client && typeof this.client.end === 'function') {
            try {
                this.client.end('Bot stopped');
            } catch (error) {
                this.emit('bot:error', error);
            }
        }
        if (this._pendingTunnelSocket) {
            this._pendingTunnelSocket.destroy();
            this._pendingTunnelSocket = null;
        }
        this.client = null;
        this.bot = null;
    }

    async destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        await this.stop();
        this.playerUUIDs.clear();
        this.players = {};
        this.emit('bot:destroy');
        this.removeAllListeners();
    }
}

module.exports = BotInstance;
