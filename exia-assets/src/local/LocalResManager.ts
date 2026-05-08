import { resources, assetManager, Asset, SpriteFrame, Texture2D, SpriteAtlas, AssetManager } from 'cc';
import { sp } from 'cc';
import { RefCountCache, RefCountEntry } from '../core/RefCountCache';
import { bundleManager } from '../core/BundleManager';

// ============================================================================
//  LocalResManager（本地 resources 资源管理器）
//
//  ★ 与远程资源的关键区别 ★
//
//  远程资源（RemoteAssetManager）:
//    loadRemote 返回 ImageAsset → 你手动 new Texture2D / SpriteFrame
//    引擎不知道你创建的对象 → 必须自己手动 destroy 每一层
//
//  本地 resources 资源:
//    resources.load 返回的 SpriteFrame 是引擎打包好的完整资产
//    SpriteFrame / Texture2D / ImageAsset 之间有引擎内建的依赖链
//    只需 decRef 顶层资源 → 引擎自动沿依赖链释放底层
//    ❌ 千万不要手动 destroy Texture2D！引擎会 double-free 或影响其他引用
//
//  本管理器职责：
//  · 加载去重（同一路径不发重复请求）
//  · 引用计数（多个 Sprite 共享同一个 SpriteFrame 时安全释放）
//  · 加载完成自动 addRef，释放时 decRef
//  · SpriteAtlas 支持（图集中取子帧）
//  · 预加载 / 批量加载 / 目录加载
//  · Bundle 支持（本地/远程 Bundle，默认 resources）
//  · 引擎层 releaseAsset 交给 decRef 归零后自动触发
// ============================================================================

/** 缓存条目 */
interface CacheEntry extends RefCountEntry {
    asset: Asset;
    path: string;
    loadedAt: number;
}

// ============================================================================

class LocalResManager {

    private static _inst: LocalResManager | null = null;
    static get instance(): LocalResManager {
        return this._inst ??= new LocalResManager();
    }

    private _rc = new RefCountCache<CacheEntry>((key, entry) => {
        if (entry.asset.isValid) {
            entry.asset.decRef();
        }
        console.debug(`[LocalResManager] 释放: ${entry.path}`);
    });

    private constructor() {}

    // ================================================================
    //  Bundle 辅助
    // ================================================================

    /**
     * 获取 Bundle 实例
     * - 不传或传 'resources' → 返回内置 resources
     * - 其他名称 → 从 BundleManager 获取（需先 loadBundle）
     */
    private _getBundle(bundleName?: string): AssetManager.Bundle {
        if (!bundleName || bundleName === 'resources') return resources;
        const b = bundleManager.getBundle(bundleName);
        if (!b) throw new Error(`[LocalResManager] Bundle "${bundleName}" 未加载，请先调用 bundleManager.loadBundle()`);
        return b;
    }

    // ================================================================
    //  核心加载
    // ================================================================

    /**
     * 加载资源
     *
     * @param path        相对于 Bundle 的路径，不含扩展名
     * @param type        资源类型，例: SpriteFrame, Texture2D, SpriteAtlas
     * @param bundleName  Bundle 名称，默认 'resources'
     *
     * 流程：
     *  缓存命中  → refCount++ 直接返回
     *  请求去重  → 复用进行中的 Promise
     *  新请求    → bundle.load + addRef + 写缓存
     */
    async load<T extends Asset>(path: string, type: typeof Asset, bundleName?: string): Promise<T> {
        const key = this._key(path, type, bundleName);

        // ① 缓存命中
        const cached = this._rc.get(key, e => e.asset.isValid);
        if (cached) return cached.asset as T;

        // ② 去重
        const pending = this._rc.getPending(key);
        if (pending) {
            const entry = await pending;
            const resolved = this._rc.get(key, e => e.asset.isValid);
            return (resolved?.asset ?? entry.asset) as T;
        }

        // ③ 新请求
        const promise = this._doLoad<T>(path, type, key, bundleName);
        this._rc.setPending(key, promise as Promise<CacheEntry>);

        try {
            const entry = await promise;
            return entry.asset as T;
        } finally {
            this._rc.deletePending(key);
        }
    }

    // ================================================================
    //  SpriteFrame 便捷方法
    // ================================================================

    async loadSpriteFrame(path: string, bundleName?: string): Promise<SpriteFrame> {
        const fullPath = path.endsWith('/spriteFrame') ? path : `${path}/spriteFrame`;
        return this.load<SpriteFrame>(fullPath, SpriteFrame as any, bundleName);
    }

    async loadFromAtlas(atlasPath: string, frameName: string, bundleName?: string): Promise<SpriteFrame> {
        const key = this._key(atlasPath, SpriteAtlas, bundleName) + `#${frameName}`;

        // 子帧缓存命中
        const cached = this._rc.get(key, e => e.asset.isValid);
        if (cached) return cached.asset as SpriteFrame;

        // 先加载图集
        const atlas = await this.load<SpriteAtlas>(atlasPath, SpriteAtlas as any, bundleName);

        const frame = atlas.getSpriteFrame(frameName);
        if (!frame) {
            throw new Error(`[LocalResManager] 图集 "${atlasPath}" 中未找到帧 "${frameName}"`);
        }

        frame.addRef();
        this._rc.set(key, {
            asset: frame,
            path: key,
            refCount: 1,
            loadedAt: Date.now(),
            lastAccessAt: Date.now(),
        });

        return frame;
    }

    // ================================================================
    //  批量 / 预加载 / 目录加载
    // ================================================================

    async loadSpriteFrames(
        paths: string[],
        onProgress?: (loaded: number, total: number) => void,
        bundleName?: string,
    ): Promise<SpriteFrame[]> {
        let done = 0;
        const tasks = paths.map(p =>
            this.loadSpriteFrame(p, bundleName).then(sf => {
                done++;
                onProgress?.(done, paths.length);
                return sf;
            }),
        );
        return Promise.all(tasks);
    }

    loadDir(dir: string, bundleName?: string): Promise<SpriteFrame[]> {
        const bundle = this._getBundle(bundleName);
        return new Promise((resolve, reject) => {
            bundle.loadDir<SpriteFrame>(dir, SpriteFrame, (err, assets) => {
                if (err || !assets) {
                    reject(err ?? new Error(`目录加载失败: ${dir}`));
                    return;
                }
                for (const sf of assets) {
                    const key = this._key(sf.name, SpriteFrame, bundleName);
                    sf.addRef();
                    const existing = this._rc.getEntry(key);
                    if (existing) {
                        existing.refCount++;
                        existing.lastAccessAt = Date.now();
                    } else {
                        this._rc.set(key, {
                            asset: sf,
                            path: sf.name,
                            refCount: 1,
                            loadedAt: Date.now(),
                            lastAccessAt: Date.now(),
                        });
                    }
                }
                resolve(assets);
            });
        });
    }

    async preloadSpriteFrame(path: string, bundleName?: string): Promise<void> {
        const sf = await this.loadSpriteFrame(path, bundleName);
        this.releaseSpriteFrame(path, bundleName);
    }

    // ================================================================
    //  Spine (sp.SkeletonData) 便捷方法
    // ================================================================

    async loadSpineData(path: string, bundleName?: string): Promise<sp.SkeletonData> {
        return this.load<sp.SkeletonData>(path, sp.SkeletonData as any, bundleName);
    }

    releaseSpineData(path: string, bundleName?: string): void {
        this.release(path, sp.SkeletonData as any, bundleName);
    }

    async preloadSpineData(path: string, bundleName?: string): Promise<void> {
        await this.loadSpineData(path, bundleName);
        this.releaseSpineData(path, bundleName);
    }

    async loadSpineDataBatch(
        paths: string[],
        onProgress?: (loaded: number, total: number) => void,
        bundleName?: string,
    ): Promise<sp.SkeletonData[]> {
        let done = 0;
        const tasks = paths.map(p =>
            this.loadSpineData(p, bundleName).then(sd => {
                done++;
                onProgress?.(done, paths.length);
                return sd;
            }),
        );
        return Promise.all(tasks);
    }

    // ================================================================
    //  泛型批量加载 / 释放
    // ================================================================

    /**
     * 泛型批量加载
     *
     * @param paths       资源路径数组
     * @param type        资源类型
     * @param opts        可选项：bundleName、onProgress
     */
    async loadBatch<T extends Asset>(
        paths: string[],
        type: typeof Asset,
        opts?: { bundleName?: string; onProgress?: (done: number, total: number) => void },
    ): Promise<T[]> {
        let done = 0;
        const tasks = paths.map(p =>
            this.load<T>(p, type, opts?.bundleName).then(asset => {
                done++;
                opts?.onProgress?.(done, paths.length);
                return asset;
            }),
        );
        return Promise.all(tasks);
    }

    /** 批量释放 */
    releaseBatch(paths: string[], type: typeof Asset, bundleName?: string): void {
        for (const p of paths) {
            this.release(p, type, bundleName);
        }
    }

    // ================================================================
    //  释放
    // ================================================================

    release(path: string, type: typeof Asset, bundleName?: string): void {
        this._rc.release(this._key(path, type, bundleName));
    }

    releaseSpriteFrame(path: string, bundleName?: string): void {
        const fullPath = path.endsWith('/spriteFrame') ? path : `${path}/spriteFrame`;
        this.release(fullPath, SpriteFrame as any, bundleName);
    }

    releaseAtlasFrame(atlasPath: string, frameName: string, bundleName?: string): void {
        const key = this._key(atlasPath, SpriteAtlas, bundleName) + `#${frameName}`;
        this._rc.release(key);
    }

    releaseAtlas(atlasPath: string, bundleName?: string): void {
        this.release(atlasPath, SpriteAtlas as any, bundleName);
    }

    forceRelease(path: string, type: typeof Asset, bundleName?: string): void {
        this._rc.forceRelease(this._key(path, type, bundleName));
    }

    releaseAll(): void {
        this._rc.releaseAll();
    }

    releaseIdle(maxIdleMs: number): void {
        this._rc.releaseIdle(maxIdleMs);
    }

    // ================================================================
    //  查询
    // ================================================================

    has(path: string, type: typeof Asset, bundleName?: string): boolean {
        const entry = this._rc.getEntry(this._key(path, type, bundleName));
        return !!entry && entry.asset.isValid;
    }

    getRefCount(path: string, type: typeof Asset, bundleName?: string): number {
        return this._rc.getRefCount(this._key(path, type, bundleName));
    }

    get cacheCount(): number { return this._rc.size; }

    dump() {
        const now = Date.now();
        const rows: any[] = [];
        this._rc.forEach(e => rows.push({
            path: e.path,
            ref: e.refCount,
            valid: e.asset.isValid,
            idleSec: +((now - e.lastAccessAt) / 1000).toFixed(1),
        }));
        return rows;
    }

    // ================================================================
    //  内部
    // ================================================================

    private _key(path: string, type: typeof Asset, bundleName?: string): string {
        return `${bundleName ?? 'resources'}:${path}|${type.name}`;
    }

    private _doLoad<T extends Asset>(
        path: string, type: typeof Asset, cacheKey: string, bundleName?: string,
    ): Promise<CacheEntry> {
        const bundle = this._getBundle(bundleName);
        return new Promise((resolve, reject) => {
            bundle.load<T>(path, type as any, (err, asset) => {
                if (err || !asset) {
                    reject(err ?? new Error(`加载失败: ${path}`));
                    return;
                }
                asset.addRef();

                const entry: CacheEntry = {
                    asset,
                    path,
                    refCount: 1,
                    loadedAt: Date.now(),
                    lastAccessAt: Date.now(),
                };
                this._rc.set(cacheKey, entry);
                resolve(entry);
            });
        });
    }
}

export const localRes = LocalResManager.instance;
export { LocalResManager };
