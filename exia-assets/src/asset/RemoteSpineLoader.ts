import { _decorator, Component } from 'cc';
import { sp } from 'cc';
import { remoteSpineManager, SpineLoadConfig, SpineHandle } from './RemoteSpineManager';

const { ccclass, property, requireComponent } = _decorator;

// ============================================================================
//  第三层：RemoteSpineLoader（节点组件）
//  职责：挂在 sp.Skeleton 节点上，管理远程 Spine 资源切换 + 自动释放
//
//  完整协作链路：
//  ┌──────────────────────────────────────────────────────────────────────┐
//  │  RemoteSpineLoader（每个 Skeleton 节点一个）                          │
//  │  · 持有 SpineHandle                                                 │
//  │  · 切换时释放旧 handle → 申请新 handle                               │
//  │  · onDestroy 自动清理                                                │
//  │  · 序列号防竞态                                                      │
//  ├──────────────────────────────────────────────────────────────────────┤
//  │  RemoteSpineManager（单例 · Spine 资源池）                            │
//  │  · 并行加载 skeleton + atlas + textures                              │
//  │  · 解析 atlas 自动发现纹理文件名                                      │
//  │  · 组装 sp.SkeletonData                                             │
//  │  · 引用计数共享（多个节点复用同一套骨骼数据）                           │
//  │  · 归零时释放 SkeletonData + Texture2D                               │
//  ├──────────────────────────────────────────────────────────────────────┤
//  │  RemoteAssetManager（单例 · 网络/缓存层）                             │
//  │  · 纹理图片的请求去重 / 重试 / 超时 / LRU 缓存                        │
//  │  · ImageAsset 引用计数管理                                           │
//  └──────────────────────────────────────────────────────────────────────┘
// ============================================================================

@ccclass('RemoteSpineLoader')
@requireComponent(sp.Skeleton)
export class RemoteSpineLoader extends Component {

    // ---- 编辑器属性 ----

    @property({ displayName:"初始骨骼 JSON/SKEL 的远程 URL", tooltip: '初始骨骼 JSON/SKEL 的远程 URL（留空则不自动加载）' })
    initialSkelUrl: string = '';

    @property({ displayName:"初始 Atlas URL", tooltip: '初始 Atlas URL（留空则自动推导）' })
    initialAtlasUrl: string = '';

    @property({ displayName:"加载完成后自动播放的动画名", tooltip: '加载完成后自动播放的动画名' })
    autoPlayAnimation: string = '';

    @property({ displayName:"自动播放是否循环", tooltip: '自动播放是否循环' })
    autoPlayLoop: boolean = true;

    @property({ displayName:"是否在 onLoad 时自动加载", tooltip: '是否在 onLoad 时自动加载' })
    autoLoad: boolean = true;

    // ---- 内部状态 ----

    private _skeleton: sp.Skeleton | null = null;
    private _currentHandle: SpineHandle | null = null;
    private _currentKey: string = '';
    private _seq = 0;
    private _loading = false;

    // ======================== 生命周期 ========================

    onLoad() {
        this._skeleton = this.getComponent(sp.Skeleton);

        if (this.autoLoad && this.initialSkelUrl) {
            const config: SpineLoadConfig = {
                skelUrl: this.initialSkelUrl,
            };
            if (this.initialAtlasUrl) {
                config.atlasUrl = this.initialAtlasUrl;
            }
            this.loadSpine(config);
        }
    }

    onDestroy() {
        this._releaseCurrentHandle();
    }

    // ======================== 公开 API ========================

    /** 当前加载的骨骼 key */
    get currentKey(): string { return this._currentKey; }

    /** 是否正在加载 */
    get isLoading(): boolean { return this._loading; }

    /** 获取底层 sp.Skeleton 组件 */
    get skeleton(): sp.Skeleton | null { return this._skeleton; }

    /**
     * 加载并切换远程 Spine 资源
     *
     * 流程：
     *  1. 序列号 +1（旧的进行中请求自动失效）
     *  2. RemoteSpineManager.acquire → 并行加载三件套
     *  3. 序列号校验
     *  4. 释放旧 handle（触发三层释放链）
     *  5. 赋值 SkeletonData → 自动播放动画
     *
     * @returns 是否成功
     */
    async loadSpine(config: SpineLoadConfig): Promise<boolean> {
        if (!config.skelUrl) {
            this.clear();
            return false;
        }

        // 与当前相同 → 跳过
        const newKey = config.skelUrl;
        if (newKey === this._currentKey && this._currentHandle) {
            return true;
        }

        const seq = ++this._seq;
        this._loading = true;

        let handle: SpineHandle;
        try {
            handle = await remoteSpineManager.acquire(config);
        } catch (err) {
            if (seq === this._seq) {
                this._loading = false;
                console.error(`[RemoteSpineLoader] 加载失败: ${config.skelUrl}`, err);
            }
            return false;
        }

        // 竞态校验
        if (seq !== this._seq) {
            handle.release();
            return false;
        }

        // 释放旧资源
        this._releaseCurrentHandle();

        // 应用新资源
        this._currentHandle = handle;
        this._currentKey = newKey;
        this._loading = false;

        this._applyToSkeleton(handle);

        return true;
    }

    /**
     * 便捷方法：只传 URL
     */
    async loadUrl(skelUrl: string, atlasUrl?: string): Promise<boolean> {
        return this.loadSpine({ skelUrl, atlasUrl });
    }

    /**
     * 清空显示并释放资源
     */
    clear(): void {
        this._seq++;
        this._releaseCurrentHandle();
        this._currentKey = '';
        this._loading = false;

        if (this._skeleton?.isValid) {
            this._skeleton.skeletonData = null as any;
        }
    }

    /**
     * 设置当前动画
     */
    setAnimation(name: string, loop: boolean = true, trackIndex: number = 0): void {
        if (this._skeleton?.isValid && this._currentHandle) {
            this._skeleton.setAnimation(trackIndex, name, loop);
        }
    }

    /**
     * 添加后续动画
     */
    addAnimation(name: string, loop: boolean = false, delay: number = 0, trackIndex: number = 0): void {
        if (this._skeleton?.isValid && this._currentHandle) {
            this._skeleton.addAnimation(trackIndex, name, loop, delay);
        }
    }

    /**
     * 设置皮肤
     */
    setSkin(skinName: string): void {
        if (this._skeleton?.isValid && this._currentHandle) {
            this._skeleton.setSkin(skinName);
        }
    }

    /**
     * 获取所有动画名
     */
    getAnimationNames(): string[] {
        if (!this._skeleton?.isValid || !this._currentHandle) return [];
        const data = this._skeleton.skeletonData;
        if (!data) return [];
        // 通过 Spine runtime 获取
        try {
            const skeletonData = (this._skeleton as any)._skeleton?.data;
            if (skeletonData?.animations) {
                return skeletonData.animations.map((a: any) => a.name);
            }
        } catch { /* ignore */ }
        return [];
    }

    /**
     * 强制刷新
     */
    async reload(): Promise<boolean> {
        const key = this._currentKey;
        if (!key) return false;
        this.clear();
        return this.loadUrl(key);
    }

    // ======================== 内部方法 ========================

    private _releaseCurrentHandle(): void {
        if (this._currentHandle) {
            // 先断开 Skeleton 对 SkeletonData 的引用
            if (this._skeleton?.isValid) {
                this._skeleton.skeletonData = null as any;
            }
            this._currentHandle.release();
            this._currentHandle = null;
        }
    }

    private _applyToSkeleton(handle: SpineHandle): void {
        if (!this._skeleton?.isValid) return;

        this._skeleton.skeletonData = handle.skeletonData;

        // 自动播放
        if (this.autoPlayAnimation) {
            this._skeleton.setAnimation(0, this.autoPlayAnimation, this.autoPlayLoop);
        }
    }
}
