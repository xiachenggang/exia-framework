import { _decorator } from 'cc';
import { sp } from 'cc';
import { BaseAssetLoader, Releasable } from '../core/BaseAssetLoader';
import { localRes } from './LocalResManager';

const { ccclass, property, menu, requireComponent } = _decorator;

/** 本地 Spine 句柄 */
interface LocalSpineHandle extends Releasable {
    path: string;
    skeletonData: sp.SkeletonData;
}

@ccclass('LocalSpineLoader')
@requireComponent(sp.Skeleton)
@menu("exia/LocalSpineLoader")
export class LocalSpineLoader extends BaseAssetLoader<LocalSpineHandle> {

    @property({ displayName: "resources/ 下的 Spine JSON 路径", tooltip: 'resources/ 下的 Spine JSON 路径（不含扩展名）\n例: spine/hero/hero' })
    initialPath: string = '';

    @property({ displayName: "加载完成后自动播放的动画名", tooltip: '加载完成后自动播放的动画名' })
    autoPlayAnimation: string = '';

    @property({ displayName: "自动播放是否循环", tooltip: '自动播放是否循环' })
    autoPlayLoop: boolean = true;

    @property({ displayName: "是否在 onLoad 时自动加载", tooltip: '是否在 onLoad 时自动加载' })
    autoLoad: boolean = true;

    private _skeleton: sp.Skeleton | null = null;

    // ---- BaseAssetLoader 实现 ----

    protected onInit() {
        this._skeleton = this.getComponent(sp.Skeleton);
    }

    protected doAutoLoad() {
        if (this.autoLoad && this.initialPath) {
            this.loadPath(this.initialPath);
        }
    }

    protected applyHandle(h: LocalSpineHandle) {
        if (!this._skeleton?.isValid) return;
        this._skeleton.skeletonData = h.skeletonData;
        if (this.autoPlayAnimation) {
            this._skeleton.setAnimation(0, this.autoPlayAnimation, this.autoPlayLoop);
        }
    }

    protected clearVisual() {
        if (this._skeleton?.isValid) {
            this._skeleton.skeletonData = null as any;
        }
    }

    protected beforeRelease() {
        if (this._skeleton?.isValid) {
            this._skeleton.skeletonData = null as any;
        }
    }

    // ---- 公开 API ----

    get currentPath(): string { return this._currentKey; }
    get skeleton(): sp.Skeleton | null { return this._skeleton; }

    async loadPath(path: string): Promise<boolean> {
        return this._loadTemplate(
            path,
            async () => {
                const sd = await localRes.loadSpineData(path);
                return { path, skeletonData: sd, release: () => localRes.releaseSpineData(path) };
            },
            () => localRes.releaseSpineData(path),
        );
    }

    // ---- 动画 / 皮肤便捷方法 ----

    setAnimation(name: string, loop = true, trackIndex = 0): void {
        if (this._skeleton?.isValid && this._currentHandle) {
            this._skeleton.setAnimation(trackIndex, name, loop);
        }
    }

    addAnimation(name: string, loop = false, delay = 0, trackIndex = 0): void {
        if (this._skeleton?.isValid && this._currentHandle) {
            this._skeleton.addAnimation(trackIndex, name, loop, delay);
        }
    }

    setSkin(skinName: string): void {
        if (this._skeleton?.isValid && this._currentHandle) {
            this._skeleton.setSkin(skinName);
        }
    }

    getAnimationNames(): string[] {
        if (!this._skeleton?.isValid || !this._currentHandle) return [];
        try {
            const sd = (this._skeleton as any)._skeleton?.data;
            if (sd?.animations) return sd.animations.map((a: any) => a.name);
        } catch { /* ignore */ }
        return [];
    }

    getSkinNames(): string[] {
        if (!this._skeleton?.isValid || !this._currentHandle) return [];
        try {
            const sd = (this._skeleton as any)._skeleton?.data;
            if (sd?.skins) return sd.skins.map((s: any) => s.name);
        } catch { /* ignore */ }
        return [];
    }

    async reload(): Promise<boolean> {
        const p = this._currentKey;
        if (!p) return false;
        this.clear();
        return this.loadPath(p);
    }
}
