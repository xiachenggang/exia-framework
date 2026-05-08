/**
 * @Description: 资源加载器（Cocos assetManager 加载 Prefab）
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
  /** @internal Bar 加载防并发 Promise：slot → (barName → Promise) */
  private static barLoadingPromises = new Map<string, Map<string, Promise<void>>>();
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
  //  窗口资源
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

  // ─────────────────────────────────────────────
  //  Bar 通用资源（slot 驱动）
  // ─────────────────────────────────────────────

  private static _getBarLoadingMap(slot: string): Map<string, Promise<void>> {
    let map = this.barLoadingPromises.get(slot);
    if (!map) {
      map = new Map();
      this.barLoadingPromises.set(slot, map);
    }
    return map;
  }

  /**
   * 加载 Bar 对应的 Prefab，并缓存到 InfoPool 的 bar prefab cache。
   * 多个窗口共享同一 Bar 时，第二次起直接命中缓存仅增引用计数。
   */
  static async loadBarRes(
    slot: string,
    barName: string,
    windowName: string,
  ): Promise<void> {
    const info = InfoPool.getBar(slot, barName);
    if (!info.prefabPath) return;

    if (InfoPool.getCachedBarPrefab(slot, barName)) {
      this._addRef(info.prefabPath);
      return;
    }

    const loadingMap = this._getBarLoadingMap(slot);
    const pending = loadingMap.get(barName);
    if (pending) {
      await pending;
      this._addRef(info.prefabPath);
      return;
    }

    const promise = (async () => {
      this._addWaitRef();
      try {
        await this._loadBundles([info.bundleName], windowName);
        const prefab = await this._loadSinglePrefab(
          info.prefabPath,
          info.bundleName,
          windowName,
        );
        InfoPool.cacheBarPrefab(slot, barName, prefab);
        this._addRef(info.prefabPath);
      } finally {
        this._decWaitRef();
        loadingMap.delete(barName);
      }
    })();

    loadingMap.set(barName, promise);
    await promise;
  }

  /**
   * 卸载 Bar 关联的 Prefab 资产（引用计数归零时才真正释放）。
   */
  static unloadBarRes(slot: string, barName: string): void {
    if (!this.autoRelease) return;
    if (!InfoPool.hasBar(slot, barName)) return;
    const info = InfoPool.getBar(slot, barName);
    if (!info.prefabPath) return;

    if (this._subRef(info.prefabPath) === 0) {
      const prefab = InfoPool.getCachedBarPrefab(slot, barName);
      if (prefab) {
        assetManager.releaseAsset(prefab);
        InfoPool.removeCachedBarPrefab(slot, barName);
      }
      this.pathRefs.delete(info.prefabPath);
    }
  }

  // ── 便利方法（兼容旧调用）──

  static async loadHeaderRes(headerName: string, windowName: string): Promise<void> {
    return this.loadBarRes("Header", headerName, windowName);
  }
  static unloadHeaderRes(headerName: string): void {
    this.unloadBarRes("Header", headerName);
  }
  static async loadBottomBarRes(bottomBarName: string, windowName: string): Promise<void> {
    return this.loadBarRes("BottomBar", bottomBarName, windowName);
  }
  static unloadBottomBarRes(bottomBarName: string): void {
    this.unloadBarRes("BottomBar", bottomBarName);
  }

  // ─────────────────────────────────────────────
  //  其他
  // ─────────────────────────────────────────────

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
    const pending: Promise<void>[] = [];
    for (const p of paths) {
      const pr = this.loadingPromises.get(p);
      if (pr) pending.push(pr);
    }
    if (pending.length > 0) await Promise.all(pending);

    const toLoad = paths.filter((p) => this._getRef(p) <= 0);
    if (toLoad.length === 0) {
      paths.forEach((p) => this._addRef(p));
      return;
    }

    this._addWaitRef();
    const loaded: string[] = [];

    const promise = (async () => {
      try {
        const info = InfoPool.get(windowName);

        const bundles = [
          ...new Set(
            toLoad.map((p) => InfoPool.getBundleName(p, info.bundleName)),
          ),
        ];
        await this._loadBundles(bundles, windowName);

        for (const path of toLoad) {
          const bundleName = InfoPool.getBundleName(path, info.bundleName);
          const prefab = await this._loadSinglePrefab(
            path,
            bundleName,
            windowName,
          );
          if (path === info.prefabPath) {
            InfoPool.cachePrefab(windowName, prefab);
          }
          loaded.push(path);
        }

        this._decWaitRef();
        paths.forEach((p) => this._addRef(p));
      } catch (err) {
        this._decWaitRef();
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
