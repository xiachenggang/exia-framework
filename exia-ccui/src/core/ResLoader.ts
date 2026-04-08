/**
 * @Description: 资源加载器（Cocos assetManager 加载 Prefab）
 *
 * 主要变化：
 *  - loadWindowRes  → 加载 Prefab 资产并缓存到 InfoPool
 *  - unloadWindowRes → 引用计数归零时 assetManager.releaseAsset
 *  - 保留并发防重机制（loadingPromises Map）
 *  - 保留等待窗口引用计数（showWaitWindow / hideWaitWindow）
 *  - 保留 bundle 懒加载逻辑
 */

import { assetManager, Prefab, resources } from "cc";
import { InfoPool } from "./InfoPool";

export class ResLoader {
  /** @internal 等待窗口引用计数 */
  private static waitRef: number = 0;
  /** @internal 预制体路径引用计数 */
  private static pathRefs = new Map<string, number>();
  /** @internal 正在加载的 Promise（防并发重复加载） */
  private static loadingPromises = new Map<string, Promise<void>>();
  /** @internal 是否自动释放 */
  private static autoRelease = true;

  private static _showWaitWindow: (() => void) | null = null;
  private static _hideWaitWindow: (() => void) | null = null;
  private static _onLoadFail:
    | ((windowName: string, code: 1 | 2, msg: string) => void)
    | null = null;

  // ─────────────────────────────────────────────
  //  配置
  // ─────────────────────────────────────────────

  static setCallbacks(callbacks: {
    showWaitWindow: () => void;
    hideWaitWindow: () => void;
    fail: (windowName: string, code: 1 | 2, message: string) => void;
  }): void {
    this._showWaitWindow = callbacks.showWaitWindow;
    this._hideWaitWindow = callbacks.hideWaitWindow;
    this._onLoadFail = callbacks.fail;
  }

  static setAutoRelease(auto: boolean): void {
    this.autoRelease = auto;
  }

  // ─────────────────────────────────────────────
  //  对外接口
  // ─────────────────────────────────────────────

  /**
   * 加载窗口所需的全部 Prefab 资产。
   * 加载完成后主预制体缓存至 InfoPool.cachePrefab。
   */
  static async loadWindowRes(windowName: string): Promise<void> {
    const paths = InfoPool.getWindowPrefabPaths(windowName);
    if (paths.length === 0) return;
    await this._loadPrefabs(paths, windowName);
  }

  /**
   * 卸载窗口关联的 Prefab 资产（引用计数归零时才真正释放）。
   */
  static unloadWindowRes(windowName: string): void {
    if (!this.autoRelease) return;
    const paths = InfoPool.getWindowPrefabPaths(windowName);
    for (const path of paths) {
      if (this._subRef(path) === 0) {
        // 释放主预制体资产
        const info = InfoPool.get(windowName);
        if (path === info.prefabPath) {
          const prefab = InfoPool.getCachedPrefab(windowName);
          if (prefab) {
            assetManager.releaseAsset(prefab);
            InfoPool.removeCachedPrefab(windowName);
          }
        }
        this.pathRefs.delete(path);
      }
    }
  }

  /** 释放所有引用计数 ≤ 0 的资产 */
  static releaseUnusedRes(): void {
    for (const [path, count] of this.pathRefs) {
      if (count <= 0) this.pathRefs.delete(path);
    }
  }

  // ─────────────────────────────────────────────
  //  内部 - 加载逻辑
  // ─────────────────────────────────────────────

  private static async _loadPrefabs(
    paths: string[],
    windowName: string,
  ): Promise<void> {
    // 等待同路径正在进行的加载
    const pending: Promise<void>[] = [];
    for (const p of paths) {
      const pr = this.loadingPromises.get(p);
      if (pr) pending.push(pr);
    }
    if (pending.length > 0) await Promise.all(pending);

    // 只加载引用计数为 0 的路径
    const toLoad = paths.filter((p) => this._getRef(p) <= 0);
    if (toLoad.length === 0) {
      // 全部已缓存，只增加引用计数
      paths.forEach((p) => this._addRef(p));
      return;
    }

    this._addWaitRef();
    const loaded: string[] = [];

    const promise = (async () => {
      try {
        const info = InfoPool.get(windowName);

        // 收集需要加载的 bundle 名
        const bundles = [
          ...new Set(
            toLoad.map((p) => InfoPool.getBundleName(p, info.bundleName)),
          ),
        ];
        await this._loadBundles(bundles, windowName);

        // 顺序加载每个预制体
        for (const path of toLoad) {
          const bundleName = InfoPool.getBundleName(path, info.bundleName);
          const prefab = await this._loadSinglePrefab(
            path,
            bundleName,
            windowName,
          );
          // 缓存主预制体
          if (path === info.prefabPath) {
            InfoPool.cachePrefab(windowName, prefab);
          }
          loaded.push(path);
        }

        this._decWaitRef();
        paths.forEach((p) => this._addRef(p));
      } catch (err) {
        this._decWaitRef();
        // 回滚已加载的资产
        for (const path of loaded) {
          const prefab = InfoPool.getCachedPrefab(windowName);
          if (prefab) {
            assetManager.releaseAsset(prefab);
            InfoPool.removeCachedPrefab(windowName);
          }
        }
        throw err;
      } finally {
        toLoad.forEach((p) => this.loadingPromises.delete(p));
      }
    })();

    toLoad.forEach((p) => this.loadingPromises.set(p, promise));
    await promise;
  }

  /**
   * 懒加载 bundle（已加载的跳过）
   */
  private static async _loadBundles(
    bundleNames: string[],
    windowName: string,
  ): Promise<void> {
    const unloaded = bundleNames.filter(
      (n) => n !== "resources" && !assetManager.getBundle(n),
    );
    for (const bundleName of unloaded) {
      await new Promise<void>((resolve, reject) => {
        assetManager.loadBundle(bundleName, (err) => {
          if (err) {
            this._onLoadFail?.(windowName, 1, bundleName);
            reject(new Error(`Bundle【${bundleName}】加载失败`));
          } else {
            resolve();
          }
        });
      });
    }
  }

  /**
   * 加载单个 Prefab 资产
   * @param path       bundle 内路径（不含扩展名）
   * @param bundleName 所在 bundle
   * @param windowName 用于失败回调
   */
  private static _loadSinglePrefab(
    path: string,
    bundleName: string,
    windowName: string,
  ): Promise<Prefab> {
    return new Promise((resolve, reject) => {
      const cb = (err: Error | null, asset: Prefab) => {
        if (err) {
          this._onLoadFail?.(windowName, 2, path);
          reject(new Error(`Prefab【${path}】加载失败: ${err.message}`));
        } else {
          resolve(asset);
        }
      };

      if (!bundleName || bundleName === "resources") {
        resources.load(path, Prefab, cb);
      } else {
        const bundle = assetManager.getBundle(bundleName);
        if (!bundle) {
          reject(
            new Error(
              `Bundle【${bundleName}】未加载，无法加载 Prefab【${path}】`,
            ),
          );
          return;
        }
        bundle.load(path, Prefab, cb);
      }
    });
  }

  // ─────────────────────────────────────────────
  //  引用计数辅助
  // ─────────────────────────────────────────────

  private static _getRef(p: string): number {
    return this.pathRefs.get(p) ?? 0;
  }
  private static _addRef(p: string): void {
    this.pathRefs.set(p, this._getRef(p) + 1);
  }
  private static _subRef(p: string): number {
    const v = Math.max(0, this._getRef(p) - 1);
    this.pathRefs.set(p, v);
    return v;
  }

  private static _addWaitRef(): void {
    if (this.waitRef++ === 0) this._showWaitWindow?.();
  }
  private static _decWaitRef(): void {
    this.waitRef = Math.max(0, this.waitRef - 1);
    if (this.waitRef === 0) this._hideWaitWindow?.();
  }
}
