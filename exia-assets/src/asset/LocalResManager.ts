import { resources, Asset, SpriteFrame, Texture2D, SpriteAtlas, ImageAsset, assetManager } from 'cc';
import { sp } from 'cc';

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
//  · 引擎层 releaseAsset 交给 decRef 归零后自动触发
// ============================================================================

/** 缓存条目 */
interface CacheEntry<T extends Asset = Asset> {
    asset: T;
    path: string;
    refCount: number;
    loadedAt: number;
    lastAccessAt: number;
}

/** 进行中的请求（去重） */
interface PendingRequest<T extends Asset = Asset> {
    promise: Promise<T>;
    callerCount: number;
}

// ============================================================================

class LocalResManager {

    private static _inst: LocalResManager | null = null;
    static get instance(): LocalResManager {
        return this._inst ??= new LocalResManager();
    }

    /** path|type → 缓存条目 */
    private _cache = new Map<string, CacheEntry>();
    /** path|type → 进行中请求 */
    private _pending = new Map<string, PendingRequest>();

    private constructor() {}

    // ================================================================
    //  核心加载
    // ================================================================

    /**
     * 加载 resources 下的资源
     *
     * @param path  相对于 resources/ 的路径，不含扩展名
     *              例: "textures/hero"  "ui/icons/coin"
     * @param type  资源类型，例: SpriteFrame, Texture2D, SpriteAtlas
     *
     * 流程：
     *  缓存命中  → refCount++ 直接返回
     *  请求去重  → 复用进行中的 Promise
     *  新请求    → resources.load + addRef + 写缓存
     */
    async load<T extends Asset>(path: string, type: typeof Asset): Promise<T> {
        const key = this._key(path, type);

        // ① 缓存命中
        const cached = this._cache.get(key);
        if (cached && cached.asset.isValid) {
            cached.refCount++;
            cached.lastAccessAt = Date.now();
            return cached.asset as T;
        }
        if (cached) this._cache.delete(key);

        // ② 去重
        const pending = this._pending.get(key);
        if (pending) {
            pending.callerCount++;
            const asset = await pending.promise;
            // 等待完成后补 refCount
            const entry = this._cache.get(key);
            if (entry) {
                entry.refCount++;
                entry.lastAccessAt = Date.now();
            }
            return asset as T;
        }

        // ③ 新请求
        const promise = this._doLoad<T>(path, type, key);
        this._pending.set(key, { promise: promise as Promise<Asset>, callerCount: 1 });

        try {
            return await promise;
        } finally {
            this._pending.delete(key);
        }
    }

    // ================================================================
    //  SpriteFrame 便捷方法
    // ================================================================

    /**
     * 加载 SpriteFrame
     *
     * ★ resources 下图片资源的路径规则 ★
     *
     * 文件结构:
     *   assets/resources/textures/hero.png
     *
     * 编辑器导入后引擎自动生成:
     *   hero (ImageAsset)
     *     └─ hero/texture (Texture2D)      ← 子资产
     *         └─ hero/spriteFrame (SpriteFrame) ← 子资产
     *
     * 所以加载 SpriteFrame 的路径是:
     *   "textures/hero/spriteFrame"   ← ✅ 正确
     *   "textures/hero"               ← ❌ 加载的是 ImageAsset
     *
     * 本方法自动补全 "/spriteFrame" 后缀
     */
    async loadSpriteFrame(path: string): Promise<SpriteFrame> {
        // 如果用户已经写了 /spriteFrame 就不再追加
        const fullPath = path.endsWith('/spriteFrame') ? path : `${path}/spriteFrame`;
        return this.load<SpriteFrame>(fullPath, SpriteFrame as any);
    }

    /**
     * 从 SpriteAtlas 中获取指定帧
     *
     * @param atlasPath 图集路径，例: "ui/common-atlas"
     * @param frameName 帧名称，例: "btn_close"
     */
    async loadFromAtlas(atlasPath: string, frameName: string): Promise<SpriteFrame> {
        const key = this._key(atlasPath, SpriteAtlas) + `#${frameName}`;

        // 子帧缓存命中
        const cached = this._cache.get(key);
        if (cached && cached.asset.isValid) {
            cached.refCount++;
            cached.lastAccessAt = Date.now();
            return cached.asset as SpriteFrame;
        }

        // 先加载图集（图集自身也走缓存/去重）
        const atlas = await this.load<SpriteAtlas>(atlasPath, SpriteAtlas as any);

        const frame = atlas.getSpriteFrame(frameName);
        if (!frame) {
            throw new Error(`[LocalResManager] 图集 "${atlasPath}" 中未找到帧 "${frameName}"`);
        }

        // 子帧 addRef（图集本身已经被 addRef，子帧也需要独立管理）
        frame.addRef();
        this._cache.set(key, {
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

    /**
     * 批量加载 SpriteFrame
     */
    async loadSpriteFrames(
        paths: string[],
        onProgress?: (loaded: number, total: number) => void,
    ): Promise<SpriteFrame[]> {
        let done = 0;
        const tasks = paths.map(p =>
            this.loadSpriteFrame(p).then(sf => {
                done++;
                onProgress?.(done, paths.length);
                return sf;
            }),
        );
        return Promise.all(tasks);
    }

    /**
     * 加载 resources 下某个目录的全部 SpriteFrame
     *
     * @param dir 目录路径，例: "textures/items"
     */
    loadDir(dir: string): Promise<SpriteFrame[]> {
        return new Promise((resolve, reject) => {
            resources.loadDir<SpriteFrame>(dir, SpriteFrame, (err, assets) => {
                if (err || !assets) {
                    reject(err ?? new Error(`目录加载失败: ${dir}`));
                    return;
                }
                // 每个资产写入缓存
                for (const sf of assets) {
                    const key = this._key(sf.name, SpriteFrame);
                    sf.addRef();
                    const existing = this._cache.get(key);
                    if (existing) {
                        existing.refCount++;
                        existing.lastAccessAt = Date.now();
                    } else {
                        this._cache.set(key, {
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

    /**
     * 预加载（不占引用计数）
     */
    async preloadSpriteFrame(path: string): Promise<void> {
        const sf = await this.loadSpriteFrame(path);
        this.releaseSpriteFrame(path);
    }

    // ================================================================
    //  Spine (sp.SkeletonData) 便捷方法
    // ================================================================

    /**
     * 加载 resources 下的 Spine 骨骼数据
     *
     * ★ 本地 Spine 与远程 Spine 的核心区别 ★
     *
     * 远程 Spine（RemoteSpineManager）:
     *   需要自己用 XHR 加载 .json + .atlas + .png
     *   手动 new Texture2D、手动组装 sp.SkeletonData
     *   释放时必须手动 destroy SkeletonData → Texture2D × N → ImageAsset × N
     *
     * 本地 Spine:
     *   编辑器导入 .json + .atlas + .png 后，引擎自动打包成 sp.SkeletonData
     *   内部的 Texture2D / atlas 都是引擎管理的子资产，依赖关系已注册
     *   只需 decRef(sp.SkeletonData) → 引擎自动释放全链
     *   ❌ 绝不要手动 destroy 其内部纹理！
     *
     * 路径规则：
     *   文件: assets/resources/spine/hero/hero.json
     *                                    hero.atlas
     *                                    hero.png
     *   加载路径: "spine/hero/hero"  ← 指向 .json 主文件（不含扩展名）
     *
     * @param path 相对于 resources/ 的路径，不含扩展名
     */
    async loadSpineData(path: string): Promise<sp.SkeletonData> {
        return this.load<sp.SkeletonData>(path, sp.SkeletonData as any);
    }

    /** 释放 Spine 骨骼数据 */
    releaseSpineData(path: string): void {
        this.release(path, sp.SkeletonData as any);
    }

    /** 预加载 Spine（不占引用计数） */
    async preloadSpineData(path: string): Promise<void> {
        await this.loadSpineData(path);
        this.releaseSpineData(path);
    }

    /** 批量加载 Spine */
    async loadSpineDataBatch(
        paths: string[],
        onProgress?: (loaded: number, total: number) => void,
    ): Promise<sp.SkeletonData[]> {
        let done = 0;
        const tasks = paths.map(p =>
            this.loadSpineData(p).then(sd => {
                done++;
                onProgress?.(done, paths.length);
                return sd;
            }),
        );
        return Promise.all(tasks);
    }

    // ================================================================
    //  释放
    // ================================================================

    /**
     * ★ resources 资源的正确释放方式 ★
     *
     * 与远程资源完全不同！
     *
     * 远程资源释放（三步手动）:
     *   spriteFrame.destroy()        ← 你 new 的
     *   texture.destroy()            ← 你 new 的
     *   imageAsset.decRef()          ← 引擎的
     *   assetManager.releaseAsset()  ← 引擎的
     *
     * 本地资源释放（只需 decRef）:
     *   spriteFrame.decRef()
     *   → 引擎自动处理：
     *     · 追踪到 Texture2D 依赖 → 减其引用
     *     · 追踪到 ImageAsset 依赖 → 减其引用
     *     · 所有引用归零 → 自动释放全链
     *
     * ❌ 绝对不要这样做：
     *   texture.destroy()   // 会破坏引擎依赖追踪！
     *   spriteFrame.destroy() // 同上！
     *
     * ✅ 只需要：
     *   spriteFrame.decRef()  // 让引擎自己管理
     */
    release(path: string, type: typeof Asset): void {
        const key = this._key(path, type);
        this._releaseByKey(key);
    }

    /** 释放 SpriteFrame（自动补全路径） */
    releaseSpriteFrame(path: string): void {
        const fullPath = path.endsWith('/spriteFrame') ? path : `${path}/spriteFrame`;
        this.release(fullPath, SpriteFrame as any);
    }

    /** 释放图集子帧 */
    releaseAtlasFrame(atlasPath: string, frameName: string): void {
        const key = this._key(atlasPath, SpriteAtlas) + `#${frameName}`;
        this._releaseByKey(key);
    }

    /** 释放图集本身 */
    releaseAtlas(atlasPath: string): void {
        this.release(atlasPath, SpriteAtlas as any);
    }

    /** 强制释放（忽略引用计数） */
    forceRelease(path: string, type: typeof Asset): void {
        const key = this._key(path, type);
        const entry = this._cache.get(key);
        if (entry) this._destroy(key, entry);
    }

    /** 释放所有缓存 */
    releaseAll(): void {
        this._cache.forEach((e, k) => this._destroy(k, e));
    }

    /** 释放空闲资源 */
    releaseIdle(maxIdleMs: number): void {
        const now = Date.now();
        const keys: string[] = [];
        this._cache.forEach((e, k) => {
            if (e.refCount <= 0 && now - e.lastAccessAt > maxIdleMs) keys.push(k);
        });
        keys.forEach(k => {
            const e = this._cache.get(k);
            if (e) this._destroy(k, e);
        });
    }

    // ================================================================
    //  查询
    // ================================================================

    has(path: string, type: typeof Asset): boolean {
        const e = this._cache.get(this._key(path, type));
        return !!e && e.asset.isValid;
    }

    getRefCount(path: string, type: typeof Asset): number {
        return this._cache.get(this._key(path, type))?.refCount ?? 0;
    }

    get cacheCount(): number { return this._cache.size; }

    dump() {
        const now = Date.now();
        const rows: any[] = [];
        this._cache.forEach(e => rows.push({
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

    private _key(path: string, type: typeof Asset): string {
        return `${path}|${type.name}`;
    }

    private _doLoad<T extends Asset>(
        path: string, type: typeof Asset, cacheKey: string,
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            resources.load<T>(path, type as any, (err, asset) => {
                if (err || !asset) {
                    reject(err ?? new Error(`加载失败: ${path}`));
                    return;
                }
                // addRef 防止被引擎自动 GC
                asset.addRef();

                this._cache.set(cacheKey, {
                    asset,
                    path,
                    refCount: 1,
                    loadedAt: Date.now(),
                    lastAccessAt: Date.now(),
                });
                resolve(asset);
            });
        });
    }

    private _releaseByKey(key: string): void {
        const entry = this._cache.get(key);
        if (!entry) return;

        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount <= 0) {
            this._destroy(key, entry);
        }
    }

    /**
     * ★ 本地资源销毁 —— 只 decRef，不 destroy ★
     */
    private _destroy(key: string, entry: CacheEntry): void {
        this._cache.delete(key);
        if (entry.asset.isValid) {
            // 只调 decRef —— 引擎的依赖追踪会自动沿链释放
            // 绝不调 destroy()！
            entry.asset.decRef();
        }
        console.debug(`[LocalResManager] 释放: ${entry.path}`);
    }
}

export const localRes = LocalResManager.instance;
export { LocalResManager };
