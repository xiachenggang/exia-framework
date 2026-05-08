import { assetManager, AssetManager, resources } from 'cc';
import { RefCountCache, RefCountEntry } from './RefCountCache';

// ============================================================================
//  BundleManager（Bundle 加载/缓存/释放管理器）
//
//  Cocos Creator 中 resources 本质上是默认 Bundle。
//  本地 Bundle 通过名称加载：assetManager.loadBundle('bundleName')
//  远程 Bundle 通过 URL 加载：assetManager.loadBundle('https://cdn.xxx/bundle')
//  加载完成后使用方式完全一致：bundle.load(path, type)
//
//  本管理器职责：
//  · 加载去重（同一 Bundle 不发重复请求）
//  · 引用计数（多处使用同一 Bundle 时安全卸载）
//  · 统一本地/远程 Bundle 生命周期
// ============================================================================

/** Bundle 缓存条目 */
interface BundleEntry extends RefCountEntry {
    bundle: AssetManager.Bundle;
    nameOrUrl: string;
    loadedAt: number;
}

// ============================================================================

class BundleManager {

    private static _inst: BundleManager | null = null;
    static get instance(): BundleManager {
        return this._inst ??= new BundleManager();
    }

    private _rc = new RefCountCache<BundleEntry>((key, entry) => {
        assetManager.removeBundle(entry.bundle);
        console.debug(`[BundleManager] 已卸载 Bundle: ${key}`);
    });

    private constructor() {}

    // ======================== 核心 API ========================

    /**
     * 加载 Bundle（本地名称或远程 URL）
     *
     * - resources 始终可用，调用此方法会直接返回
     * - 已加载的 Bundle refCount++
     * - 同一 Bundle 并发请求自动去重
     */
    async loadBundle(nameOrUrl: string): Promise<AssetManager.Bundle> {
        // resources 特殊处理：始终可用
        if (nameOrUrl === 'resources') {
            return resources;
        }

        // ① 缓存命中
        const cached = this._rc.get(nameOrUrl);
        if (cached) return cached.bundle;

        // ② 去重
        const pending = this._rc.getPending(nameOrUrl);
        if (pending) {
            const entry = await pending;
            const resolved = this._rc.get(nameOrUrl);
            return (resolved ?? entry).bundle;
        }

        // ③ 新请求
        const promise = this._doLoad(nameOrUrl);
        this._rc.setPending(nameOrUrl, promise);

        try {
            const entry = await promise;
            return entry.bundle;
        } finally {
            this._rc.deletePending(nameOrUrl);
        }
    }

    /**
     * 获取已加载的 Bundle（不增加引用计数）
     * resources 始终返回
     */
    getBundle(name: string): AssetManager.Bundle | null {
        if (name === 'resources') return resources;
        const entry = this._rc.getEntry(name);
        return entry?.bundle ?? assetManager.getBundle(name) ?? null;
    }

    // ======================== 释放 ========================

    /**
     * 释放 Bundle 引用（refCount-- → 归零调 removeBundle）
     * resources 不可释放
     */
    releaseBundle(name: string): void {
        if (name === 'resources') return;
        this._rc.release(name);
    }

    /** 强制释放 Bundle（忽略引用计数） */
    forceReleaseBundle(name: string): void {
        if (name === 'resources') return;
        this._rc.forceRelease(name);
    }

    /** 释放所有已加载的 Bundle（不含 resources） */
    releaseAll(): void {
        this._rc.releaseAll();
    }

    // ======================== 查询 ========================

    has(name: string): boolean {
        if (name === 'resources') return true;
        return this._rc.has(name);
    }

    getRefCount(name: string): number {
        if (name === 'resources') return -1; // resources 不计数
        return this._rc.getRefCount(name);
    }

    get bundleCount(): number {
        return this._rc.size + 1; // +1 for resources
    }

    dump() {
        const rows: any[] = [{ name: 'resources', ref: -1, note: '内置' }];
        this._rc.forEach((e, k) => rows.push({
            name: k,
            ref: e.refCount,
            url: e.nameOrUrl,
        }));
        return rows;
    }

    // ======================== 内部 ========================

    private _doLoad(nameOrUrl: string): Promise<BundleEntry> {
        return new Promise((resolve, reject) => {
            assetManager.loadBundle(nameOrUrl, (err, bundle) => {
                if (err || !bundle) {
                    reject(err ?? new Error(`[BundleManager] Bundle 加载失败: ${nameOrUrl}`));
                    return;
                }

                const key = bundle.name || nameOrUrl;
                const entry: BundleEntry = {
                    bundle,
                    nameOrUrl,
                    refCount: 1,
                    loadedAt: Date.now(),
                    lastAccessAt: Date.now(),
                };
                this._rc.set(key, entry);
                resolve(entry);
            });
        });
    }
}

export const bundleManager = BundleManager.instance;
export { BundleManager };
