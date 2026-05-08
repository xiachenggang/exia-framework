import { Component } from 'cc';

/** Handle 最小约束：必须有 release 方法 */
export interface Releasable {
    release: () => void;
}

/**
 * 资源加载组件基类
 *
 * 提取 4 个 Loader 组件共有的模式：
 * · _seq 竞态防护（快速切换时旧请求自动失效）
 * · _currentHandle 生命周期管理
 * · clear() / onDestroy() 自动清理
 *
 * 不加 @ccclass，只有子类加。
 */
export abstract class BaseAssetLoader<THandle extends Releasable> extends Component {

    protected _currentHandle: THandle | null = null;
    protected _currentKey: string = '';
    protected _seq = 0;
    protected _loading = false;

    // ======================== 子类必须实现 ========================

    /** 获取目标组件引用（Sprite / sp.Skeleton） */
    protected abstract onInit(): void;

    /** autoLoad 时触发的加载逻辑 */
    protected abstract doAutoLoad(): void;

    /** 将 Handle 应用到节点（设置 spriteFrame / skeletonData） */
    protected abstract applyHandle(handle: THandle): void;

    /** 清空节点显示（spriteFrame = null / skeletonData = null） */
    protected abstract clearVisual(): void;

    // ======================== 可选覆写 ========================

    /** 释放 Handle 前的回调（Spine: 先断开 skeletonData 引用；Sprite: 先断开 spriteFrame 引用） */
    protected beforeRelease(): void {}

    // ======================== 生命周期 ========================

    onLoad() {
        this.onInit();
        this.doAutoLoad();
    }

    onDestroy() {
        this._releaseCurrent();
    }

    // ======================== 公开 API ========================

    get isLoading(): boolean { return this._loading; }

    /**
     * 清空显示并释放资源
     */
    clear(): void {
        this._seq++;
        this._releaseCurrent();
        this._currentKey = '';
        this._loading = false;
        this.clearVisual();
    }

    // ======================== 核心模板 ========================

    /**
     * 竞态安全的资源加载模板
     *
     * @param key           去重 key（path / url）
     * @param acquire       异步获取 Handle 的函数
     * @param releaseStale  加载完成但 seq 已过期时的释放函数
     * @param beforeAcquire 开始加载前的回调（如显示占位）
     */
    protected async _loadTemplate(
        key: string,
        acquire: () => Promise<THandle>,
        releaseStale: (handle: THandle) => void,
        beforeAcquire?: () => void,
    ): Promise<boolean> {
        if (!key) {
            this.clear();
            return false;
        }

        // 与当前相同 → 跳过
        if (key === this._currentKey && this._currentHandle) {
            return true;
        }

        const seq = ++this._seq;
        this._loading = true;
        beforeAcquire?.();

        let handle: THandle;
        try {
            handle = await acquire();
        } catch (err) {
            if (seq === this._seq) {
                this._loading = false;
                console.error(`[${(this.constructor as any).name}] 加载失败: ${key}`, err);
            }
            return false;
        }

        // 竞态校验：加载期间 key 已变 → 丢弃
        if (seq !== this._seq) {
            releaseStale(handle);
            return false;
        }

        // 释放旧资源
        this._releaseCurrent();

        // 应用新资源
        this._currentHandle = handle;
        this._currentKey = key;
        this._loading = false;

        this.applyHandle(handle);
        return true;
    }

    // ======================== 内部 ========================

    protected _releaseCurrent(): void {
        if (this._currentHandle) {
            this.beforeRelease();
            this._currentHandle.release();
            this._currentHandle = null;
        }
    }
}
