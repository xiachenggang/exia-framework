import { assetManager, Asset, ImageAsset, JsonAsset } from 'cc';

// ============================================================================
//  第一层：RemoteAssetManager（网络 + 缓存层）
//  职责：请求去重 · 失败重试 · 超时控制 · 原始 Asset 级缓存与引用计数
//  不关心 Texture2D / SpriteFrame —— 那是上层的事
// ============================================================================

export interface RetryPolicy {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
}

export interface LoadOptions {
    type?: typeof Asset;
    retry?: Partial<RetryPolicy>;
    timeout?: number;
    ext?: string;
}

interface CacheEntry {
    asset: Asset;
    refCount: number;
    url: string;
    loadedAt: number;
    lastAccessAt: number;
    size: number;
}

interface PendingRequest {
    promise: Promise<Asset>;
    callerCount: number;
}

// ============================================================================

class RemoteAssetManager {

    private static _inst: RemoteAssetManager | null = null;
    static get instance(): RemoteAssetManager {
        return this._inst ??= new RemoteAssetManager();
    }

    private _cache = new Map<string, CacheEntry>();
    private _pending = new Map<string, PendingRequest>();

    private _defaultRetry: RetryPolicy = { maxRetries: 3, baseDelay: 1000, maxDelay: 10000 };
    private _defaultTimeout = 30_000;
    private _maxCacheSize = 0; // 0 = 不限

    private constructor() {}

    // ======================== 全局配置 ========================

    configure(opts: {
        retry?: Partial<RetryPolicy>;
        timeout?: number;
        maxCacheSize?: number;
    }): void {
        if (opts.retry) Object.assign(this._defaultRetry, opts.retry);
        if (opts.timeout !== undefined) this._defaultTimeout = opts.timeout;
        if (opts.maxCacheSize !== undefined) this._maxCacheSize = opts.maxCacheSize;
    }

    // ======================== 核心加载 ========================

    /**
     * 加载远程资源（唯一入口）
     *
     * 缓存命中  → refCount++ 直接返回
     * 请求去重  → 复用进行中的 Promise，不发新请求
     * 新请求    → 超时保护 + 指数退避重试
     */
    async load<T extends Asset>(url: string, options?: LoadOptions): Promise<T> {
        const key = this._key(url, options);

        // ① 命中缓存
        const cached = this._cache.get(key);
        if (cached && cached.asset.isValid) {
            cached.refCount++;
            cached.lastAccessAt = Date.now();
            return cached.asset as T;
        }
        if (cached) this._cache.delete(key);

        // ② 去重——复用进行中的请求
        const pending = this._pending.get(key);
        if (pending) {
            pending.callerCount++;
            const asset = await pending.promise;
            // 等待完成后还要给缓存条目补 refCount
            const entry = this._cache.get(key);
            if (entry) {
                entry.refCount++;
                entry.lastAccessAt = Date.now();
            }
            return asset as T;
        }

        // ③ 发起新请求
        const promise = this._loadWithRetry<T>(url, key, options);
        this._pending.set(key, { promise: promise as Promise<Asset>, callerCount: 1 });

        try {
            return await promise;
        } finally {
            this._pending.delete(key);
        }
    }

    // ======================== 引用管理 ========================

    /** 手动增加引用（不触发加载） */
    addRef(url: string, options?: LoadOptions): boolean {
        const e = this._cache.get(this._key(url, options));
        if (e && e.asset.isValid) { e.refCount++; e.lastAccessAt = Date.now(); return true; }
        return false;
    }

    /** 减少引用，归零时释放底层 Asset */
    release(url: string, options?: LoadOptions): void {
        const key = this._key(url, options);
        const e = this._cache.get(key);
        if (!e) return;
        e.refCount = Math.max(0, e.refCount - 1);
        if (e.refCount <= 0) this._destroy(key, e);
    }

    /** 强制释放（忽略引用计数） */
    forceRelease(url: string, options?: LoadOptions): void {
        const key = this._key(url, options);
        const e = this._cache.get(key);
        if (e) this._destroy(key, e);
    }

    /** 释放全部缓存 */
    releaseAll(): void {
        this._cache.forEach((e, k) => this._destroy(k, e));
    }

    /** 释放空闲超过指定时长且 refCount=0 的条目 */
    releaseIdle(maxIdleMs: number): void {
        const now = Date.now();
        const keys: string[] = [];
        this._cache.forEach((e, k) => {
            if (e.refCount <= 0 && now - e.lastAccessAt > maxIdleMs) keys.push(k);
        });
        keys.forEach(k => { const e = this._cache.get(k); if (e) this._destroy(k, e); });
    }

    // ======================== 查询 ========================

    has(url: string, opts?: LoadOptions): boolean {
        const e = this._cache.get(this._key(url, opts));
        return !!e && e.asset.isValid;
    }

    isLoading(url: string, opts?: LoadOptions): boolean {
        return this._pending.has(this._key(url, opts));
    }

    getRefCount(url: string, opts?: LoadOptions): number {
        return this._cache.get(this._key(url, opts))?.refCount ?? 0;
    }

    get cacheCount() { return this._cache.size; }
    get pendingCount() { return this._pending.size; }

    dump() {
        const now = Date.now();
        const rows: any[] = [];
        this._cache.forEach(e => rows.push({
            url: e.url, ref: e.refCount,
            sizeKB: +(e.size / 1024).toFixed(1),
            idleSec: +((now - e.lastAccessAt) / 1000).toFixed(1),
        }));
        return rows;
    }

    // ======================== 内部实现 ========================

    /** 缓存 key = url + type + ext */
    _key(url: string, opts?: LoadOptions): string {
        return `${url}|${opts?.type?.name ?? ''}|${opts?.ext ?? ''}`;
    }

    private async _loadWithRetry<T extends Asset>(
        url: string, cacheKey: string, opts?: LoadOptions,
    ): Promise<T> {
        const retry: RetryPolicy = { ...this._defaultRetry, ...opts?.retry };
        const timeout = opts?.timeout ?? this._defaultTimeout;
        let lastErr: Error | null = null;

        for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
            if (attempt > 0) {
                const base = retry.baseDelay * Math.pow(2, attempt - 1);
                const delay = Math.min(base + base * 0.3 * Math.random(), retry.maxDelay);
                await new Promise(r => setTimeout(r, delay));
                console.warn(`[RemoteAssetMgr] 重试 ${attempt}/${retry.maxRetries} → ${url}`);
            }
            try {
                const asset = await this._loadOnce<T>(url, opts, timeout);
                // 写入缓存，首次调用者 refCount = 1
                this._cache.set(cacheKey, {
                    asset, url,
                    refCount: 1,
                    loadedAt: Date.now(),
                    lastAccessAt: Date.now(),
                    size: this._estimateSize(asset),
                });
                if (this._maxCacheSize > 0) this._evictLRU();
                return asset;
            } catch (e: any) {
                lastErr = e instanceof Error ? e : new Error(String(e));
            }
        }
        throw new Error(`[RemoteAssetMgr] 加载失败(${retry.maxRetries + 1}次): ${url}\n${lastErr?.message}`);
    }

    private _loadOnce<T extends Asset>(url: string, opts?: LoadOptions, timeout = 30000): Promise<T> {
        return new Promise((resolve, reject) => {
            let done = false;
            const timer = timeout > 0
                ? setTimeout(() => { if (!done) { done = true; reject(new Error(`超时(${timeout}ms): ${url}`)); } }, timeout)
                : null;

            const cfg: Record<string, any> = {};
            if (opts?.ext) cfg.ext = opts.ext;

            assetManager.loadRemote<T>(url, cfg, (err, asset) => {
                if (done) return;
                done = true;
                if (timer) clearTimeout(timer);
                if (err || !asset) { reject(err ?? new Error(`空资源: ${url}`)); return; }
                asset.addRef();
                resolve(asset);
            });
        });
    }

    private _estimateSize(asset: Asset): number {
        if (asset instanceof ImageAsset) return (asset.width ?? 0) * (asset.height ?? 0) * 4;
        if (asset instanceof JsonAsset) return JSON.stringify(asset.json).length * 2;
        return 1024;
    }

    private _evictLRU(): void {
        if (this._maxCacheSize <= 0) return;
        let total = 0;
        this._cache.forEach(e => total += e.size);
        if (total <= this._maxCacheSize) return;

        const list: { key: string; entry: CacheEntry }[] = [];
        this._cache.forEach((e, k) => { if (e.refCount <= 0) list.push({ key: k, entry: e }); });
        list.sort((a, b) => a.entry.lastAccessAt - b.entry.lastAccessAt);

        for (const { key, entry } of list) {
            if (total <= this._maxCacheSize) break;
            total -= entry.size;
            this._destroy(key, entry);
        }
    }

    private _destroy(key: string, entry: CacheEntry): void {
        this._cache.delete(key);
        if (entry.asset.isValid) {
            entry.asset.decRef();
            assetManager.releaseAsset(entry.asset);
        }
    }
}

export const remoteAssets = RemoteAssetManager.instance;
export { RemoteAssetManager };
