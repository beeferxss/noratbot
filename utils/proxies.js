const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(process.cwd(), 'proxies.json');

const DEFAULT_SOURCES = [
    'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=ipport&format=text&timeout=5000',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt'
];

function parseProxy(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let value = raw.trim();
    if (!value || value.startsWith('#') || value.startsWith('//')) return null;

    let userId;
    let password;
    const at = value.lastIndexOf('@');
    if (at !== -1) {
        const auth = value.slice(0, at);
        value = value.slice(at + 1);
        const colon = auth.indexOf(':');
        if (colon === -1) return null;
        userId = auth.slice(0, colon);
        password = auth.slice(colon + 1);
    }

    const parts = value.split(':');
    if (parts.length !== 2) return null;
    const host = parts[0].trim();
    const port = Number(parts[1].trim());
    if (!host || !/^[a-z0-9.\-:[\]_]+$/i.test(host)) return null;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

    const proxy = { host, port };
    if (userId) {
        proxy.userId = userId;
        proxy.password = password || '';
    }
    return proxy;
}

function keyOf(proxy) {
    return `${proxy.host}:${proxy.port}`;
}

class ProxyPool {
    constructor(config = {}) {
        this.config = config || {};
        this.sources = Array.isArray(this.config.sources) && this.config.sources.length
            ? this.config.sources.filter(u => typeof u === 'string' && u.startsWith('http'))
            : DEFAULT_SOURCES;
        this.refreshMs = Math.max(1, Number(this.config.refreshMinutes) || 20) * 60 * 1000;
        this.failureMs = Math.max(1, Number(this.config.failureCooldownMinutes) || 15) * 60 * 1000;
        this.timeoutMs = Math.max(1000, Number(this.config.connectTimeout) || 8000);
        this.maxListSize = Math.max(50, Number(this.config.maxListSize) || 4000);

        this.list = [];
        this.failed = new Map();
        this.good = new Set();
        this.loadedAt = 0;
        this.refreshing = null;
        this.refreshTimer = null;
        this.bootstrapped = false;
    }

    get enabled() {
        return this.config.enabled !== false;
    }

    loadCache() {
        try {
            if (!fs.existsSync(CACHE_PATH)) return;
            const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
            if (Array.isArray(raw.proxies) && raw.proxies.length) {
                this.list = raw.proxies.map(parseProxy).filter(Boolean).slice(0, this.maxListSize);
                this.loadedAt = Number(raw.fetchedAt) || 0;
            }
        } catch (e) {
            console.error('[Proxy] Cache load failed:', e.message);
        }
    }

    saveCache() {
        try {
            fs.writeFileSync(CACHE_PATH, JSON.stringify({
                fetchedAt: this.loadedAt,
                proxies: this.list.map(keyOf)
            }), 'utf8');
        } catch (e) {
            console.error('[Proxy] Cache save failed:', e.message);
        }
    }

    async fetchSource(url) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs * 2) });
            if (!res.ok) return [];
            const text = await res.text();
            const out = [];
            for (const line of text.split(/\r?\n/)) {
                const proxy = parseProxy(line);
                if (proxy) out.push(proxy);
            }
            return out;
        } catch (e) {
            console.error(`[Proxy] Source failed (${new URL(url).host}):`, e.message);
            return [];
        }
    }

    async refresh() {
        if (this.refreshing) return this.refreshing;
        this.refreshing = (async () => {
            const results = await Promise.all(this.sources.map(url => this.fetchSource(url)));
            const seen = new Set();
            const merged = [];
            for (const proxy of results.flat()) {
                const key = keyOf(proxy);
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(proxy);
            }
            if (merged.length) {
                for (let i = merged.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [merged[i], merged[j]] = [merged[j], merged[i]];
                }
                this.list = merged.slice(0, this.maxListSize);
                this.loadedAt = Date.now();
                this.saveCache();
                console.log(`[Proxy] Loaded ${this.list.length} socks5 proxies`);
            } else if (!this.list.length) {
                console.error('[Proxy] No proxies available, connections will go direct');
            }
            return this.list;
        })().finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }

    start() {
        if (this.bootstrapped) return;
        this.bootstrapped = true;
        this.loadCache();
        const stale = Date.now() - this.loadedAt > this.refreshMs;
        if (stale || !this.list.length) this.refresh();
        this.refreshTimer = setInterval(() => this.refresh(), this.refreshMs);
        if (this.refreshTimer.unref) this.refreshTimer.unref();
    }

    pick() {
        if (!this.enabled) return null;
        const now = Date.now();
        for (const [key, until] of this.failed) {
            if (now >= until) this.failed.delete(key);
        }
        const usable = this.list.filter(p => !this.failed.has(keyOf(p)));
        if (!usable.length) return null;
        const knownGood = usable.filter(p => this.good.has(keyOf(p)));
        const pool = knownGood.length && Math.random() < 0.7 ? knownGood : usable;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    markFailed(proxy) {
        if (!proxy) return;
        this.failed.set(keyOf(proxy), Date.now() + this.failureMs);
    }

    clearFailure(proxy) {
        if (proxy) this.failed.delete(keyOf(proxy));
    }

    markGood(proxy) {
        if (proxy) this.good.add(keyOf(proxy));
    }
}

const pools = new WeakMap();

function forConfig(globalConfig) {
    const config = globalConfig?.proxy || {};
    if (!config || typeof config !== 'object') return null;
    if (config.enabled === false) return null;
    const cached = pools.get(config);
    if (cached) return cached;
    const pool = new ProxyPool(config);
    pools.set(config, pool);
    pool.start();
    return pool;
}

module.exports = {
    ProxyPool,
    forConfig,
    parseProxy
};
