import { assetManager, Asset, ImageAsset, JsonAsset } from 'cc';
import { RefCountCache, RefCountEntry } from '../core/RefCountCache';

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

interface CacheEntry extends RefCountEntry {
    asset: Asset;
    url: string;
    loadedAt: number;
    size: number;
}

// ============================================================================

class RemoteAssetManager {

    private static _inst: RemoteAssetManager | null = null;
    static get instance(): RemoteAssetManager {
        return this._inst ??= new RemoteAssetManager();
    }

    private _rc = new RefCountCache<CacheEntry>((key, entry) => {
        if (entry.asset.isValid) {
            entry.asset.decRef();
            assetManager.releaseAsset(entry.asset);
        }
    });

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

    async load<T extends Asset>(url: string, options?: LoadOptions): Promise<T> {
        const key = this._key(url, options);

        // ① 命中缓存
        const cached = this._rc.get(key, e => e.asset.isValid);
        if (cached) return cached.asset as T;

        // ② 去重
        const pending = this._rc.getPending(key);
        if (pending) {
            const entry = await pending;
            const resolved = this._rc.get(key, e => e.asset.isValid);
            return (resolved?.asset ?? entry.asset) as T;
        }

        // ③ 发起新请求
        const promise = this._loadWithRetry<T>(url, key, options);
        this._rc.setPending(key, promise as Promise<CacheEntry>);

        try {
            const entry = await promise;
            return entry.asset as T;
        } finally {
            this._rc.deletePending(key);
        }
    }

    // ======================== 引用管理 ========================

    addRef(url: string, options?: LoadOptions): boolean {
        const entry = this._rc.get(this._key(url, options), e => e.asset.isValid);
        return !!entry;
    }

    release(url: string, options?: LoadOptions): void {
        this._rc.release(this._key(url, options));
    }

    forceRelease(url: string, options?: LoadOptions): void {
        this._rc.forceRelease(this._key(url, options));
    }

    releaseAll(): void {
        this._rc.releaseAll();
    }

    releaseIdle(maxIdleMs: number): void {
        this._rc.releaseIdle(maxIdleMs);
    }

    // ======================== 批量加载 ========================

    /**
     * 批量加载远程资源（并行，单个失败不影响其他）
     */
    async loadBatch<T extends Asset>(
        tasks: Array<{ url: string; options?: LoadOptions }>,
        onProgress?: (done: number, total: number) => void,
    ): Promise<Map<string, T>> {
        const results = new Map<string, T>();
        let done = 0;
        const total = tasks.length;

        await Promise.all(tasks.map(async (task) => {
            try {
                const asset = await this.load<T>(task.url, task.options);
                results.set(task.url, asset);
            } catch (e) {
                console.error(`[RemoteAssetMgr] 批量加载失败: ${task.url}`, e);
            } finally {
                done++;
                onProgress?.(done, total);
            }
        }));

        return results;
    }

    /** 批量释放 */
    releaseBatch(tasks: Array<{ url: string; options?: LoadOptions }>): void {
        for (const { url, options } of tasks) {
            this.release(url, options);
        }
    }

    // ======================== 查询 ========================

    has(url: string, opts?: LoadOptions): boolean {
        const entry = this._rc.getEntry(this._key(url, opts));
        return !!entry && entry.asset.isValid;
    }

    isLoading(url: string, opts?: LoadOptions): boolean {
        return !!this._rc.getPending(this._key(url, opts));
    }

    getRefCount(url: string, opts?: LoadOptions): number {
        return this._rc.getRefCount(this._key(url, opts));
    }

    get cacheCount() { return this._rc.size; }

    dump() {
        const now = Date.now();
        const rows: any[] = [];
        this._rc.forEach(e => rows.push({
            url: e.url, ref: e.refCount,
            sizeKB: +(e.size / 1024).toFixed(1),
            idleSec: +((now - e.lastAccessAt) / 1000).toFixed(1),
        }));
        return rows;
    }

    // ======================== 内部实现 ========================

    _key(url: string, opts?: LoadOptions): string {
        return `${url}|${opts?.type?.name ?? ''}|${opts?.ext ?? ''}`;
    }

    private async _loadWithRetry<T extends Asset>(
        url: string, cacheKey: string, opts?: LoadOptions,
    ): Promise<CacheEntry> {
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
                const entry: CacheEntry = {
                    asset, url,
                    refCount: 1,
                    loadedAt: Date.now(),
                    lastAccessAt: Date.now(),
                    size: this._estimateSize(asset),
                };
                this._rc.set(cacheKey, entry);
                if (this._maxCacheSize > 0) this._evictLRU();
                return entry;
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
        this._rc.forEach(e => total += e.size);
        if (total <= this._maxCacheSize) return;

        const list: { key: string; entry: CacheEntry }[] = [];
        this._rc.forEach((e, k) => { if (e.refCount <= 0) list.push({ key: k, entry: e }); });
        list.sort((a, b) => a.entry.lastAccessAt - b.entry.lastAccessAt);

        for (const { key } of list) {
            if (total <= this._maxCacheSize) break;
            const entry = this._rc.getEntry(key);
            if (entry) {
                total -= entry.size;
                this._rc.forceRelease(key);
            }
        }
    }
}

export const remoteAssets = RemoteAssetManager.instance;
export { RemoteAssetManager };
