import { _decorator } from 'cc';
import { sp } from 'cc';
import { BaseAssetLoader } from '../core/BaseAssetLoader';
import { remoteSpineManager, SpineLoadConfig, SpineHandle } from './RemoteSpineManager';

const { ccclass, property, menu, requireComponent } = _decorator;

@ccclass('RemoteSpineLoader')
@requireComponent(sp.Skeleton)
@menu("exia/RemoteSpineLoader")
export class RemoteSpineLoader extends BaseAssetLoader<SpineHandle> {

    @property({ displayName: "初始骨骼 JSON/SKEL 的远程 URL", tooltip: '初始骨骼 JSON/SKEL 的远程 URL（留空则不自动加载）' })
    initialSkelUrl: string = '';

    @property({ displayName: "初始 Atlas URL", tooltip: '初始 Atlas URL（留空则自动推导）' })
    initialAtlasUrl: string = '';

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
        if (this.autoLoad && this.initialSkelUrl) {
            const config: SpineLoadConfig = { skelUrl: this.initialSkelUrl };
            if (this.initialAtlasUrl) config.atlasUrl = this.initialAtlasUrl;
            this.loadSpine(config);
        }
    }

    protected applyHandle(h: SpineHandle) {
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

    get currentKey(): string { return this._currentKey; }
    get skeleton(): sp.Skeleton | null { return this._skeleton; }

    async loadSpine(config: SpineLoadConfig): Promise<boolean> {
        return this._loadTemplate(
            config.skelUrl,
            () => remoteSpineManager.acquire(config),
            (h) => h.release(),
        );
    }

    async loadUrl(skelUrl: string, atlasUrl?: string): Promise<boolean> {
        return this.loadSpine({ skelUrl, atlasUrl });
    }

    // ---- 动画 / 皮肤便捷方法 ----

    setAnimation(name: string, loop: boolean = true, trackIndex: number = 0): void {
        if (this._skeleton?.isValid && this._currentHandle) {
            this._skeleton.setAnimation(trackIndex, name, loop);
        }
    }

    addAnimation(name: string, loop: boolean = false, delay: number = 0, trackIndex: number = 0): void {
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
            const skeletonData = (this._skeleton as any)._skeleton?.data;
            if (skeletonData?.animations) {
                return skeletonData.animations.map((a: any): string => a.name);
            }
        } catch { /* ignore */ }
        return [];
    }

    async reload(): Promise<boolean> {
        const key = this._currentKey;
        if (!key) return false;
        this.clear();
        return this.loadUrl(key);
    }
}
