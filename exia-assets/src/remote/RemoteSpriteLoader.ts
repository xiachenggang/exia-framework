import { _decorator, Sprite, Color, UIOpacity } from 'cc';
import { BaseAssetLoader } from '../core/BaseAssetLoader';
import { remoteSpriteManager, SpriteHandle } from './RemoteSpriteManager';

const { ccclass, property, menu, requireComponent } = _decorator;

@ccclass('RemoteSpriteLoader')
@requireComponent(Sprite)
@menu("exia/RemoteSpriteLoader")
export class RemoteSpriteLoader extends BaseAssetLoader<SpriteHandle> {

    @property({ displayName: "初始远程图片 URL", tooltip: '初始远程图片 URL（留空则不自动加载）' })
    initialUrl: string = '';

    @property({ displayName: "加载中显示占位颜色", tooltip: '加载中显示占位颜色' })
    placeholderColor: Color = new Color(200, 200, 200, 128);

    @property({ displayName: "是否在 onLoad 时自动加载", tooltip: '是否在 onLoad 时自动加载 initialUrl' })
    autoLoad: boolean = true;

    @property({ displayName: "加载完成后淡入时长", tooltip: '加载完成后淡入时长(秒)，0=不淡入' })
    fadeInDuration: number = 0.15;

    private _sprite: Sprite | null = null;

    // ---- BaseAssetLoader 实现 ----

    protected onInit() {
        this._sprite = this.getComponent(Sprite);
    }

    protected doAutoLoad() {
        if (this.autoLoad && this.initialUrl) {
            this.loadUrl(this.initialUrl);
        }
    }

    protected applyHandle(h: SpriteHandle) {
        if (!this._sprite?.isValid) return;

        this._sprite.spriteFrame = h.spriteFrame;
        this._sprite.color = Color.WHITE;

        if (this.fadeInDuration > 0) {
            const opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
            opacity.opacity = 0;
            this._fadeIn(opacity, this.fadeInDuration);
        }
    }

    protected clearVisual() {
        if (this._sprite?.isValid) {
            this._sprite.spriteFrame = null;
        }
    }

    // ---- 公开 API ----

    get currentUrl(): string { return this._currentKey; }

    async loadUrl(url: string): Promise<boolean> {
        return this._loadTemplate(
            url,
            () => remoteSpriteManager.acquire(url),
            (h) => h.release(),
            () => this._showPlaceholder(),
        );
    }

    async reload(): Promise<boolean> {
        const url = this._currentKey;
        if (!url) return false;
        this.clear();
        return this.loadUrl(url);
    }

    // ---- 内部 ----

    private _showPlaceholder(): void {
        if (!this._sprite?.isValid) return;
        this._sprite.color = this.placeholderColor;
    }

    private _fadeIn(opacity: UIOpacity, duration: number): void {
        const startTime = Date.now();
        const tick = () => {
            if (!opacity.isValid) return;
            const elapsed = (Date.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            opacity.opacity = Math.round(255 * t);
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }
}
