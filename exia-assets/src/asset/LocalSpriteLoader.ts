import { _decorator, Component, Sprite, SpriteFrame, SpriteAtlas } from 'cc';
import { localRes } from './LocalResManager';

const { ccclass, property, menu,requireComponent } = _decorator;

// ============================================================================
//  LocalSpriteLoader（本地 resources 图片切换组件）
//
//  挂在 Sprite 节点上，管理从 resources/ 加载的 SpriteFrame 切换与释放
//
//  与 RemoteSpriteLoader 的核心区别：
//  ┌─────────────────────┬──────────────────────┬────────────────────────┐
//  │                     │  RemoteSpriteLoader  │  LocalSpriteLoader     │
//  ├─────────────────────┼──────────────────────┼────────────────────────┤
//  │  资源来源            │  CDN URL             │  resources/ 路径        │
//  │  SpriteFrame 来源   │  手动 new            │  引擎打包好的           │
//  │  Texture2D 来源     │  手动 new            │  引擎内建依赖           │
//  │  释放方式            │  由外到内逐层 destroy │  只需 decRef 顶层      │
//  │  Texture2D 管理     │  需要纹理池共享       │  引擎自动管理           │
//  │  网络重试            │  需要                │  不需要（本地文件）      │
//  └─────────────────────┴──────────────────────┴────────────────────────┘
// ============================================================================

/** 当前持有的资源追踪信息 */
interface LocalSpriteHandle {
    /** 资源路径或图集标识 */
    id: string;
    /** 引用的 SpriteFrame */
    spriteFrame: SpriteFrame;
    /** 释放回调 */
    release: () => void;
}

@ccclass('LocalSpriteLoader')
@requireComponent(Sprite)
@menu("exia/LocalSpriteLoader")
export class LocalSpriteLoader extends Component {

    // ---- 编辑器属性 ----

    @property({ displayName:"resources/ 下的图片路径", tooltip: 'resources/ 下的图片路径（不含扩展名和 /spriteFrame）' })
    initialPath: string = '';

    @property({ displayName:"是否在 onLoad 时自动加载", tooltip: '是否在 onLoad 时自动加载' })
    autoLoad: boolean = true;

    // ---- 内部状态 ----

    private _sprite: Sprite | null = null;
    private _currentHandle: LocalSpriteHandle | null = null;
    private _currentId: string = '';
    private _seq = 0;
    private _loading = false;

    // ======================== 生命周期 ========================

    onLoad() {
        this._sprite = this.getComponent(Sprite);
        if (this.autoLoad && this.initialPath) {
            this.loadPath(this.initialPath);
        }
    }

    onDestroy() {
        this._releaseCurrent();
    }

    // ======================== 公开 API ========================

    get currentId(): string { return this._currentId; }
    get isLoading(): boolean { return this._loading; }

    /**
     * 加载 resources/ 下的图片并切换 SpriteFrame
     *
     * @param path 相对于 resources/ 的路径，不含扩展名
     *             例: "textures/hero"  "ui/icons/coin"
     *             自动补全 /spriteFrame 后缀
     */
    async loadPath(path: string): Promise<boolean> {
        if (!path) { this.clear(); return false; }

        if (path === this._currentId && this._currentHandle) return true;

        const seq = ++this._seq;
        this._loading = true;

        let spriteFrame: SpriteFrame;
        try {
            spriteFrame = await localRes.loadSpriteFrame(path);
        } catch (err) {
            if (seq === this._seq) {
                this._loading = false;
                console.error(`[LocalSpriteLoader] 加载失败: ${path}`, err);
            }
            return false;
        }

        // 竞态校验
        if (seq !== this._seq) {
            localRes.releaseSpriteFrame(path);
            return false;
        }

        this._releaseCurrent();

        this._currentHandle = {
            id: path,
            spriteFrame,
            release: () => localRes.releaseSpriteFrame(path),
        };
        this._currentId = path;
        this._loading = false;

        if (this._sprite?.isValid) {
            this._sprite.spriteFrame = spriteFrame;
        }

        return true;
    }

    /**
     * 从 SpriteAtlas 图集中加载指定帧
     *
     * @param atlasPath 图集路径，例: "ui/common-atlas"
     * @param frameName 帧名称，例: "btn_close"
     */
    async loadFromAtlas(atlasPath: string, frameName: string): Promise<boolean> {
        const id = `${atlasPath}#${frameName}`;

        if (id === this._currentId && this._currentHandle) return true;

        const seq = ++this._seq;
        this._loading = true;

        let spriteFrame: SpriteFrame;
        try {
            spriteFrame = await localRes.loadFromAtlas(atlasPath, frameName);
        } catch (err) {
            if (seq === this._seq) {
                this._loading = false;
                console.error(`[LocalSpriteLoader] 图集帧加载失败: ${id}`, err);
            }
            return false;
        }

        if (seq !== this._seq) {
            localRes.releaseAtlasFrame(atlasPath, frameName);
            return false;
        }

        this._releaseCurrent();

        this._currentHandle = {
            id,
            spriteFrame,
            release: () => localRes.releaseAtlasFrame(atlasPath, frameName),
        };
        this._currentId = id;
        this._loading = false;

        if (this._sprite?.isValid) {
            this._sprite.spriteFrame = spriteFrame;
        }

        return true;
    }

    /**
     * 清空并释放
     */
    clear(): void {
        this._seq++;
        this._releaseCurrent();
        this._currentId = '';
        this._loading = false;

        if (this._sprite?.isValid) {
            this._sprite.spriteFrame = null;
        }
    }

    // ======================== 内部 ========================

    private _releaseCurrent(): void {
        if (this._currentHandle) {
            if (this._sprite?.isValid) {
                this._sprite.spriteFrame = null;
            }
            this._currentHandle.release();
            this._currentHandle = null;
        }
    }
}
