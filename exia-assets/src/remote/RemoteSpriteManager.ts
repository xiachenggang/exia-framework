import { ImageAsset, SpriteFrame, Texture2D } from 'cc';
import { remoteAssets, LoadOptions } from './RemoteAssetManager';
import { RefCountCache, RefCountEntry } from '../core/RefCountCache';

// ============================================================================
//  第二层：RemoteSpriteManager（纹理池）
//  职责：在 RemoteAssetManager 之上管理 Texture2D 的共享与生命周期
//
//  资源链路：
//    RemoteAssetManager  →  管理 ImageAsset（网络/缓存/重试/去重）
//    RemoteSpriteManager →  管理 Texture2D （GPU 显存共享池）
//    RemoteSpriteLoader  →  管理 SpriteFrame（每个节点独立持有）
// ============================================================================

/** 纹理池条目 */
interface TextureEntry extends RefCountEntry {
    texture: Texture2D;
    url: string;
    createAt: number;
}

/** acquire 返回给上层的句柄 */
export interface SpriteHandle {
    url: string;
    spriteFrame: SpriteFrame;
    release: () => void;
}

// ============================================================================

class RemoteSpriteManager {

    private static _inst: RemoteSpriteManager | null = null;
    static get instance(): RemoteSpriteManager {
        return this._inst ??= new RemoteSpriteManager();
    }

    private _rc = new RefCountCache<TextureEntry>((key, entry) => {
        if (entry.texture.isValid) {
            entry.texture.destroy();
        }
    });

    private constructor() {}

    // ======================== 核心 API ========================

    async acquire(url: string, retry?: LoadOptions['retry']): Promise<SpriteHandle> {
        const ext = RemoteSpriteManager._guessExt(url);
        const loadOpts: LoadOptions = { type: ImageAsset as any, ext, retry };

        // ① 通过 RemoteAssetManager 加载 ImageAsset
        const imageAsset = await remoteAssets.load<ImageAsset>(url, loadOpts);

        // ② 获取或创建共享 Texture2D
        let texEntry = this._rc.getEntry(url);
        if (!texEntry || !texEntry.texture.isValid) {
            if (texEntry) this._rc.delete(url);
            const texture = new Texture2D();
            texture.image = imageAsset;
            texEntry = {
                texture, url,
                refCount: 0,
                createAt: Date.now(),
                lastAccessAt: Date.now(),
            };
            this._rc.set(url, texEntry);
        }
        texEntry.refCount++;
        texEntry.lastAccessAt = Date.now();

        // ③ 每个调用者拥有独立的 SpriteFrame
        const spriteFrame = new SpriteFrame();
        spriteFrame.texture = texEntry.texture;

        // ④ 构建句柄
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

    async preload(url: string): Promise<void> {
        const handle = await this.acquire(url);
        handle.release();
    }

    // ======================== 查询 ========================

    getTextureRefCount(url: string): number {
        return this._rc.getRefCount(url);
    }

    get poolSize(): number { return this._rc.size; }

    dump() {
        const rows: any[] = [];
        this._rc.forEach(e => rows.push({
            url: e.url,
            texRef: e.refCount,
            assetRef: remoteAssets.getRefCount(e.url, { ext: RemoteSpriteManager._guessExt(e.url) }),
        }));
        return rows;
    }

    purgeAll(): void {
        this._rc.releaseAll();
        remoteAssets.releaseAll();
    }

    // ======================== 内部 ========================

    /**
     * 释放链路（由外到内）：
     *  1. SpriteFrame.destroy()       — 调用者独有
     *  2. 纹理池 refCount--
     *     → 归零则 Texture2D.destroy() — 释放 GPU 显存
     *  3. RemoteAssetManager.release() — ImageAsset refCount--
     */
    private _releaseOne(url: string, spriteFrame: SpriteFrame, loadOpts: LoadOptions): void {
        if (spriteFrame.isValid) {
            spriteFrame.destroy();
        }

        this._rc.release(url);
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
