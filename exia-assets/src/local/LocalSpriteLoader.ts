import { _decorator, Sprite, SpriteFrame } from 'cc';
import { BaseAssetLoader, Releasable } from '../core/BaseAssetLoader';
import { localRes } from './LocalResManager';

const { ccclass, property, menu, requireComponent } = _decorator;

/** 本地 Sprite 句柄 */
interface LocalSpriteHandle extends Releasable {
    id: string;
    spriteFrame: SpriteFrame;
}

@ccclass('LocalSpriteLoader')
@requireComponent(Sprite)
@menu("exia/LocalSpriteLoader")
export class LocalSpriteLoader extends BaseAssetLoader<LocalSpriteHandle> {

    @property({ displayName: "resources/ 下的图片路径", tooltip: 'resources/ 下的图片路径（不含扩展名和 /spriteFrame）' })
    initialPath: string = '';

    @property({ displayName: "是否在 onLoad 时自动加载", tooltip: '是否在 onLoad 时自动加载' })
    autoLoad: boolean = true;

    private _sprite: Sprite | null = null;

    // ---- BaseAssetLoader 实现 ----

    protected onInit() {
        this._sprite = this.getComponent(Sprite);
    }

    protected doAutoLoad() {
        if (this.autoLoad && this.initialPath) {
            this.loadPath(this.initialPath);
        }
    }

    protected applyHandle(h: LocalSpriteHandle) {
        if (this._sprite?.isValid) {
            this._sprite.spriteFrame = h.spriteFrame;
        }
    }

    protected clearVisual() {
        if (this._sprite?.isValid) {
            this._sprite.spriteFrame = null;
        }
    }

    protected beforeRelease() {
        if (this._sprite?.isValid) {
            this._sprite.spriteFrame = null;
        }
    }

    // ---- 公开 API ----

    get currentId(): string { return this._currentKey; }

    async loadPath(path: string): Promise<boolean> {
        return this._loadTemplate(
            path,
            async () => {
                const sf = await localRes.loadSpriteFrame(path);
                return { id: path, spriteFrame: sf, release: () => localRes.releaseSpriteFrame(path) };
            },
            () => localRes.releaseSpriteFrame(path),
        );
    }

    async loadFromAtlas(atlasPath: string, frameName: string): Promise<boolean> {
        const id = `${atlasPath}#${frameName}`;
        return this._loadTemplate(
            id,
            async () => {
                const sf = await localRes.loadFromAtlas(atlasPath, frameName);
                return { id, spriteFrame: sf, release: () => localRes.releaseAtlasFrame(atlasPath, frameName) };
            },
            () => localRes.releaseAtlasFrame(atlasPath, frameName),
        );
    }
}
