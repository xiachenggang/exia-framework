import { ImageAsset, SpriteFrame, Texture2D } from 'cc';
import { remoteAssets, LoadOptions } from './RemoteAssetManager';

// ============================================================================
//  第二层：RemoteSpriteManager（纹理池）
//  职责：在 RemoteAssetManager 之上管理 Texture2D 的共享与生命周期
//
//  资源链路：
//    RemoteAssetManager  →  管理 ImageAsset（网络/缓存/重试/去重）
//    RemoteSpriteManager →  管理 Texture2D （GPU 显存共享池）
//    RemoteSpriteLoader  →  管理 SpriteFrame（每个节点独立持有）
// ============================================================================

/** 纹理池条目：ImageAsset + Texture2D 共享，多个 Sprite 复用 */
interface TextureEntry {
    texture: Texture2D;
    url: string;
    /** 上层组件对此纹理的引用计数 */
    refCount: number;
    createAt: number;
}

/** acquire 返回给上层的句柄 */
export interface SpriteHandle {
    url: string;
    spriteFrame: SpriteFrame;
    /** 上层必须调用此方法释放 */
    release: () => void;
}

// ============================================================================

class RemoteSpriteManager {

    private static _inst: RemoteSpriteManager | null = null;
    static get instance(): RemoteSpriteManager {
        return this._inst ??= new RemoteSpriteManager();
    }

    /** url → 共享的 Texture2D 条目 */
    private _texPool = new Map<string, TextureEntry>();

    private constructor() {}

    // ======================== 核心 API ========================

    /**
     * 获取远程图片的 SpriteFrame
     *
     * 内部流程：
     *  1. 通过 RemoteAssetManager.load 获取 ImageAsset（享受去重/重试/缓存）
     *  2. 查纹理池：有则复用 Texture2D，无则新建
     *  3. 创建独立的 SpriteFrame 返回给调用者
     *  4. 返回 SpriteHandle，内含一次性 release() 回调
     *
     * @param url    CDN 图片地址
     * @param retry  可覆盖重试策略
     */
    async acquire(url: string, retry?: LoadOptions['retry']): Promise<SpriteHandle> {
        const ext = RemoteSpriteManager._guessExt(url);
        const loadOpts: LoadOptions = { type: ImageAsset as any, ext, retry };

        // ① 通过 RemoteAssetManager 加载 ImageAsset
        const imageAsset = await remoteAssets.load<ImageAsset>(url, loadOpts);

        // ② 获取或创建共享 Texture2D
        let texEntry = this._texPool.get(url);
        if (!texEntry || !texEntry.texture.isValid) {
            const texture = new Texture2D();
            texture.image = imageAsset;
            texEntry = {
                texture,
                url,
                refCount: 0,
                createAt: Date.now(),
            };
            this._texPool.set(url, texEntry);
        }
        texEntry.refCount++;

        // ③ 每个调用者拥有独立的 SpriteFrame（轻量对象，几乎不占内存）
        const spriteFrame = new SpriteFrame();
        spriteFrame.texture = texEntry.texture;

        // ④ 构建句柄，release 只能调一次
        let released = false;
        const handle: SpriteHandle = {
            url,
            spriteFrame,
            release: () => {
                if (released) return;
                released = true;
                this._releaseOne(url, spriteFrame, loadOpts);
            },
        };

        return handle;
    }

    /**
     * 批量获取
     */
    async acquireBatch(
        urls: string[],
        onProgress?: (loaded: number, total: number) => void,
    ): Promise<SpriteHandle[]> {
        let done = 0;
        const tasks = urls.map(url =>
            this.acquire(url).then(h => {
                done++;
                onProgress?.(done, urls.length);
                return h;
            }),
        );
        return Promise.all(tasks);
    }

    /**
     * 预热（加载到缓存但不占用纹理池引用）
     */
    async preload(url: string): Promise<void> {
        const handle = await this.acquire(url);
        handle.release();
    }

    // ======================== 查询 ========================

    /** 某 url 的 Texture2D 引用计数 */
    getTextureRefCount(url: string): number {
        return this._texPool.get(url)?.refCount ?? 0;
    }

    /** 纹理池大小 */
    get poolSize(): number { return this._texPool.size; }

    /** 打印池状态 */
    dump() {
        const rows: any[] = [];
        this._texPool.forEach(e => rows.push({
            url: e.url,
            texRef: e.refCount,
            assetRef: remoteAssets.getRefCount(e.url, { ext: RemoteSpriteManager._guessExt(e.url) }),
        }));
        return rows;
    }

    /** 强制清空纹理池 + 底层所有缓存 */
    purgeAll(): void {
        this._texPool.forEach((entry, url) => {
            if (entry.texture.isValid) entry.texture.destroy();
        });
        this._texPool.clear();
        remoteAssets.releaseAll();
    }

    // ======================== 内部 ========================

    /**
     * 释放单个 SpriteFrame + 对应引用链
     *
     * 释放顺序（由外到内）：
     *  1. SpriteFrame.destroy()       — 调用者独有
     *  2. 纹理池 refCount--
     *     → 归零则 Texture2D.destroy()  — 释放 GPU 显存
     *  3. RemoteAssetManager.release() — ImageAsset refCount--
     *     → 归零则 decRef + releaseAsset
     */
    private _releaseOne(url: string, spriteFrame: SpriteFrame, loadOpts: LoadOptions): void {
        // 1) 销毁调用者独有的 SpriteFrame
        if (spriteFrame.isValid) {
            spriteFrame.destroy();
        }

        // 2) 纹理池引用 -1
        const texEntry = this._texPool.get(url);
        if (texEntry) {
            texEntry.refCount = Math.max(0, texEntry.refCount - 1);

            if (texEntry.refCount <= 0) {
                // 没有任何 SpriteFrame 在用了 → 销毁 Texture2D
                if (texEntry.texture.isValid) {
                    texEntry.texture.destroy();
                }
                this._texPool.delete(url);
            }
        }

        // 3) 底层 ImageAsset 引用 -1
        remoteAssets.release(url, loadOpts);
    }

    static _guessExt(url: string): string {
        const u = url.split('?')[0].toLowerCase();
        if (u.endsWith('.png'))  return '.png';
        if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return '.jpg';
        if (u.endsWith('.webp')) return '.webp';
        return '.png';
    }
}

export const remoteSpriteManager = RemoteSpriteManager.instance;
export { RemoteSpriteManager };
