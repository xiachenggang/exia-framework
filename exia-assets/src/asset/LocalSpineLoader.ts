import { _decorator, Component } from 'cc';
import { sp } from 'cc';
import { localRes } from './LocalResManager';

const { ccclass, property, requireComponent } = _decorator;

// ============================================================================
//  LocalSpineLoader（本地 resources Spine 切换组件）
//
//  挂在 sp.Skeleton 节点上，管理 resources/ 下 Spine 资源的切换与释放
//
//  ★ 与 RemoteSpineLoader 的核心区别 ★
//  ┌──────────────────────┬───────────────────────┬────────────────────────┐
//  │                      │  RemoteSpineLoader    │  LocalSpineLoader      │
//  ├──────────────────────┼───────────────────────┼────────────────────────┤
//  │  资源来源             │  CDN URL              │  resources/ 路径       │
//  │  SkeletonData 来源   │  手动组装（XHR 加载    │  引擎打包好的          │
//  │                      │  json+atlas+png 再     │  resources.load 直接   │
//  │                      │  拼装 SkeletonData）   │  返回 SkeletonData     │
//  │  内部纹理            │  手动 new Texture2D    │  引擎内建依赖          │
//  │  释放方式             │  SkeletonData.destroy  │  只需 decRef           │
//  │                      │  → Texture2D.destroy   │  → 引擎自动沿链释放    │
//  │                      │  → ImageAsset.decRef   │                        │
//  │  需要 atlas 解析      │  需要（提取纹理名）    │  不需要（引擎处理好了）│
//  │  需要网络重试         │  需要                  │  不需要                │
//  └──────────────────────┴───────────────────────┴────────────────────────┘
//
//  本地 Spine 为什么简单这么多？
//  因为编辑器导入 .json + .atlas + .png 时，引擎会：
//    1. 把 atlas 文本嵌入 SkeletonData 资产
//    2. 把纹理作为 SkeletonData 的子依赖注册
//    3. 在 resources.load 时自动加载全部依赖
//  所以你拿到的 sp.SkeletonData 已经是完整可用的，内部所有纹理
//  都已加载完毕且依赖关系已注册。释放时只需 decRef 顶层即可。
// ============================================================================

/** 本地 Spine 句柄 */
interface LocalSpineHandle {
    path: string;
    skeletonData: sp.SkeletonData;
    release: () => void;
}

@ccclass('LocalSpineLoader')
@requireComponent(sp.Skeleton)
export class LocalSpineLoader extends Component {

    // ---- 编辑器属性 ----

    @property({ displayName:"resources/ 下的 Spine JSON 路径", tooltip: 'resources/ 下的 Spine JSON 路径（不含扩展名）\n例: spine/hero/hero' })
    initialPath: string = '';

    @property({ displayName:"加载完成后自动播放的动画名", tooltip: '加载完成后自动播放的动画名' })
    autoPlayAnimation: string = '';

    @property({ displayName:"自动播放是否循环", tooltip: '自动播放是否循环' })
    autoPlayLoop: boolean = true;

    @property({ displayName:"是否在 onLoad 时自动加载", tooltip: '是否在 onLoad 时自动加载' })
    autoLoad: boolean = true;

    // ---- 内部状态 ----

    private _skeleton: sp.Skeleton | null = null;
    private _currentHandle: LocalSpineHandle | null = null;
    private _currentPath: string = '';
    private _seq = 0;
    private _loading = false;

    // ======================== 生命周期 ========================

    onLoad() {
        this._skeleton = this.getComponent(sp.Skeleton);
        if (this.autoLoad && this.initialPath) {
            this.loadPath(this.initialPath);
        }
    }

    onDestroy() {
        this._releaseCurrent();
    }

    // ======================== 公开 API ========================

    get currentPath(): string { return this._currentPath; }
    get isLoading(): boolean { return this._loading; }
    get skeleton(): sp.Skeleton | null { return this._skeleton; }

    /**
     * 加载并切换 resources/ 下的 Spine 资源
     *
     * @param path 相对于 resources/ 的路径，不含扩展名
     *             例: "spine/hero/hero"
     *
     * 流程：
     *  1. _seq++ 使旧请求失效
     *  2. localRes.loadSpineData(path) 加载（走缓存/去重）
     *  3. 序列号校验
     *  4. _releaseCurrent() 释放旧资源（decRef → 引擎自动链式释放）
     *  5. 赋值 SkeletonData + 自动播放
     */
    async loadPath(path: string): Promise<boolean> {
        if (!path) { this.clear(); return false; }

        // 与当前相同 → 跳过
        if (path === this._currentPath && this._currentHandle) return true;

        const seq = ++this._seq;
        this._loading = true;

        let skeletonData: sp.SkeletonData;
        try {
            skeletonData = await localRes.loadSpineData(path);
        } catch (err) {
            if (seq === this._seq) {
                this._loading = false;
                console.error(`[LocalSpineLoader] 加载失败: ${path}`, err);
            }
            return false;
        }

        // ★ 竞态校验：加载期间又调了 loadPath → 丢弃此结果
        if (seq !== this._seq) {
            localRes.releaseSpineData(path);
            return false;
        }

        // 释放旧资源
        this._releaseCurrent();

        // 应用新资源
        this._currentHandle = {
            path,
            skeletonData,
            release: () => localRes.releaseSpineData(path),
        };
        this._currentPath = path;
        this._loading = false;

        this._applyToSkeleton(skeletonData);
        return true;
    }

    /**
     * 清空显示并释放
     */
    clear(): void {
        this._seq++;
        this._releaseCurrent();
        this._currentPath = '';
        this._loading = false;

        if (this._skeleton?.isValid) {
            this._skeleton.skeletonData = null as any;
        }
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
        const p = this._currentPath;
        if (!p) return false;
        this.clear();
        return this.loadPath(p);
    }

    // ======================== 内部 ========================

    /**
     * 释放当前资源
     *
     * ★ 本地 Spine 释放只需 decRef ★
     *
     * localRes.releaseSpineData(path)
     *   → LocalResManager._destroy()
     *     → skeletonData.decRef()
     *       → 引擎自动追踪并释放内部 Texture2D × N + atlas 数据
     *
     * ❌ 绝不要手动 destroy SkeletonData 或其内部纹理
     */
    private _releaseCurrent(): void {
        if (this._currentHandle) {
            // 先断开 Skeleton 对 SkeletonData 的引用
            if (this._skeleton?.isValid) {
                this._skeleton.skeletonData = null as any;
            }
            this._currentHandle.release();
            this._currentHandle = null;
        }
    }

    private _applyToSkeleton(skeletonData: sp.SkeletonData): void {
        if (!this._skeleton?.isValid) return;

        this._skeleton.skeletonData = skeletonData;

        if (this.autoPlayAnimation) {
            this._skeleton.setAnimation(0, this.autoPlayAnimation, this.autoPlayLoop);
        }
    }
}
