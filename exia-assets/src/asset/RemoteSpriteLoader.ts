import { _decorator, Component, Sprite, Color, UIOpacity } from 'cc';
import { remoteSpriteManager, SpriteHandle } from './RemoteSpriteManager';

const { ccclass, property, requireComponent } = _decorator;

// ============================================================================
//  第三层：RemoteSpriteLoader（节点组件）
//  职责：挂在 Sprite 节点上，管理 SpriteFrame 切换 + 自动释放
//
//  三层协作全景：
//  ┌───────────────────────────────────────────────────────────────┐
//  │  RemoteSpriteLoader（每个 Sprite 节点一个）                     │
//  │  · 持有 SpriteHandle                                          │
//  │  · 切换时释放旧 handle，申请新 handle                           │
//  │  · onDestroy 自动清理                                          │
//  │  · 防止快速切换竞态                                             │
//  ├───────────────────────────────────────────────────────────────┤
//  │  RemoteSpriteManager（单例 · 纹理池）                           │
//  │  · 管理 Texture2D 共享（多个 Sprite 用同一张图只占一份 GPU）      │
//  │  · acquire → SpriteHandle（含一次性 release 回调）              │
//  │  · 纹理引用归零 → Texture2D.destroy()                          │
//  ├───────────────────────────────────────────────────────────────┤
//  │  RemoteAssetManager（单例 · 网络/缓存层）                       │
//  │  · 请求去重（多个 acquire 同一 url → 只发一次网络请求）            │
//  │  · 失败指数退避重试                                             │
//  │  · 超时保护                                                    │
//  │  · ImageAsset 引用计数缓存                                      │
//  │  · LRU 淘汰 + 空闲回收                                         │
//  └───────────────────────────────────────────────────────────────┘
// ============================================================================

@ccclass('RemoteSpriteLoader')
@requireComponent(Sprite)
export class RemoteSpriteLoader extends Component {

    // ---- 编辑器属性 ----

    @property({ displayName:"初始远程图片 URL", tooltip: '初始远程图片 URL（留空则不自动加载）' })
    initialUrl: string = '';

    @property({ displayName:"加载中显示占位颜色", tooltip: '加载中显示占位颜色' })
    placeholderColor: Color = new Color(200, 200, 200, 128);

    @property({ displayName:"是否在 onLoad 时自动加载", tooltip: '是否在 onLoad 时自动加载 initialUrl' })
    autoLoad: boolean = true;

    @property({ displayName:"加载完成后淡入时长", tooltip: '加载完成后淡入时长(秒)，0=不淡入' })
    fadeInDuration: number = 0.15;

    // ---- 内部状态 ----

    private _sprite: Sprite | null = null;
    private _currentHandle: SpriteHandle | null = null;
    private _currentUrl: string = '';
    /** 加载序列号，防止快速切换竞态 */
    private _seq = 0;
    private _loading = false;

    // ======================== 生命周期 ========================

    onLoad() {
        this._sprite = this.getComponent(Sprite);

        if (this.autoLoad && this.initialUrl) {
            this.loadUrl(this.initialUrl);
        }
    }

    onDestroy() {
        this._releaseCurrentHandle();
    }

    // ======================== 公开 API ========================

    /** 当前显示的 url */
    get currentUrl(): string { return this._currentUrl; }

    /** 是否正在加载中 */
    get isLoading(): boolean { return this._loading; }

    /**
     * 加载并切换到新的远程图片
     *
     * 完整流程：
     *  1. 序列号 +1（使旧的进行中请求失效）
     *  2. 显示占位状态
     *  3. 通过 RemoteSpriteManager.acquire 获取 SpriteHandle
     *       └─ 内部调用 RemoteAssetManager.load（去重/重试/缓存）
     *       └─ 内部管理 Texture2D 共享池
     *  4. 序列号校验（若已过期则立即释放刚加载的 handle）
     *  5. 释放旧 handle（三层资源链逐层释放）
     *  6. 应用新 SpriteFrame + 可选淡入动画
     *
     * @returns 是否加载成功
     */
    async loadUrl(url: string): Promise<boolean> {
        if (!url) {
            this.clear();
            return false;
        }

        // 与当前完全相同 → 跳过
        if (url === this._currentUrl && this._currentHandle) {
            return true;
        }

        const seq = ++this._seq;
        this._loading = true;

        // 占位状态
        this._showPlaceholder();

        let handle: SpriteHandle;
        try {
            handle = await remoteSpriteManager.acquire(url);
        } catch (err) {
            // 确认是当前请求才报错，过期的静默忽略
            if (seq === this._seq) {
                this._loading = false;
                console.error(`[RemoteSpriteLoader] 加载失败: ${url}`, err);
            }
            return false;
        }

        // ★ 竞态校验：加载期间 loadUrl 又被调用了 → 丢弃这个结果
        if (seq !== this._seq) {
            handle.release();
            return false;
        }

        // 释放旧资源
        this._releaseCurrentHandle();

        // 应用新资源
        this._currentHandle = handle;
        this._currentUrl = url;
        this._loading = false;

        this._applyToSprite(handle);

        return true;
    }

    /**
     * 清空显示并释放资源
     */
    clear(): void {
        this._seq++; // 使进行中的请求失效
        this._releaseCurrentHandle();
        this._currentUrl = '';
        this._loading = false;

        if (this._sprite?.isValid) {
            this._sprite.spriteFrame = null;
        }
    }

    /**
     * 强制刷新（清缓存重新下载）
     */
    async reload(): Promise<boolean> {
        const url = this._currentUrl;
        if (!url) return false;
        this.clear();
        return this.loadUrl(url);
    }

    // ======================== 内部方法 ========================

    /**
     * 释放当前持有的 SpriteHandle
     * handle.release() 内部会完成三层释放：
     *   SpriteFrame.destroy → Texture2D 引用-1 → ImageAsset 引用-1
     */
    private _releaseCurrentHandle(): void {
        if (this._currentHandle) {
            this._currentHandle.release();
            this._currentHandle = null;
        }
    }

    /** 显示占位状态 */
    private _showPlaceholder(): void {
        if (!this._sprite?.isValid) return;
        this._sprite.color = this.placeholderColor;
    }

    /** 将 handle 的 spriteFrame 应用到 Sprite 上 */
    private _applyToSprite(handle: SpriteHandle): void {
        if (!this._sprite?.isValid) return;

        this._sprite.spriteFrame = handle.spriteFrame;
        this._sprite.color = Color.WHITE;

        // 淡入动画
        if (this.fadeInDuration > 0) {
            const opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
            opacity.opacity = 0;
            this._fadeIn(opacity, this.fadeInDuration);
        }
    }

    /** 简易淡入（避免引入 tween 依赖） */
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
