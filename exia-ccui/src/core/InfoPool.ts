/**
 * @Description: 信息池（ Cocos Prefab 注册表）
 */

import { debug } from "@xiacg/exia-core";
import { Prefab } from "cc";
import { IHeaderInfo, IWindowInfo } from "./types";

export class InfoPool {
  /** @internal */ private static _windowInfos = new Map<string, IWindowInfo>();
  /** @internal */ private static _headerInfos = new Map<string, IHeaderInfo>();
  /** @internal */ private static _componentKeys = new Set<string>();

  /** @internal 窗口名 → 需要加载的所有预制体路径（主 + inline） */
  private static _windowPrefabPaths = new Map<string, string[]>();
  /** @internal 手动管理（不自动卸载）的预制体路径 */
  private static _manualPaths = new Set<string>();
  /** @internal 自定义 bundle 映射（prefabPath → bundleName），主路径优先 */
  private static _bundleMap = new Map<string, string>();
  /** @internal 已加载的 Prefab 资产缓存（windowName → Prefab） */
  private static _prefabCache = new Map<string, Prefab>();
  /** @internal dirty flag，手动包变化时重算路径 */
  private static _dirty = false;

  // ─────────────────────────────────────────────
  //  注册
  // ─────────────────────────────────────────────

  static add(
    ctor: any,
    group: string,
    prefabPath: string,
    name: string,
    inlinePrefabPaths: string[],
    bundleName: string,
  ): void {
    if (this.has(name)) {
      console.warn(`窗口【${name}】已注册，跳过`);
      return;
    }
    debug(`窗口注册  name:${name}  prefab:${prefabPath}  group:${group}`);
    this._windowInfos.set(name, {
      ctor,
      group,
      prefabPath,
      bundleName,
      name,
      inlinePrefabPaths,
    });

    // 构建需要加载的路径列表
    const paths = [prefabPath, ...inlinePrefabPaths];
    this._windowPrefabPaths.set(name, paths);
    this._dirty = true;
  }

  static addHeader(
    ctor: any,
    prefabPath: string,
    name: string,
    bundleName: string,
  ): void {
    if (this.hasHeader(name)) {
      console.warn(`Header【${name}】已注册，跳过`);
      return;
    }
    debug(`Header注册  name:${name}  prefab:${prefabPath}`);
    this._headerInfos.set(name, { ctor, prefabPath, bundleName });
  }

  /**
   * 注册自定义组件（无需 prefab 路径，挂载在父预制体上）
   * 自定义组件的序列化在 PropsHelper 中通过 onLoad 时机触发
   */
  static addComponent(
    ctor: any,
    prefabPath: string,
    name: string,
    _bundleName: string,
  ): void {
    const key = `${prefabPath}/${name}`;
    if (this._componentKeys.has(key)) return;
    debug(`自定义组件注册  name:${name}  prefab:${prefabPath}`);
    this._componentKeys.add(key);
    // 注入生命周期（由 PropsHelper 负责序列化，无需 UIObjectFactory）
  }

  // ─────────────────────────────────────────────
  //  查询
  // ─────────────────────────────────────────────

  static has(name: string): boolean {
    return this._windowInfos.has(name);
  }
  static hasHeader(name: string): boolean {
    return this._headerInfos.has(name);
  }

  static get(name: string): IWindowInfo {
    if (!this.has(name))
      throw new Error(`窗口【${name}】未注册，请使用 @uiclass 装饰器注册`);
    return this._windowInfos.get(name)!;
  }

  static getHeader(name: string): IHeaderInfo {
    if (!this.hasHeader(name))
      throw new Error(`Header【${name}】未注册，请使用 @uiheader 装饰器注册`);
    return this._headerInfos.get(name)!;
  }

  /**
   * 获取窗口需要加载的预制体路径列表（已排除手动管理的路径）
   */
  static getWindowPrefabPaths(windowName: string): string[] {
    if (this._dirty) {
      this._refreshPaths();
      this._dirty = false;
    }
    return this._windowPrefabPaths.get(windowName) ?? [];
  }

  static getBundleName(prefabPath: string, defaultBundle: string): string {
    return this._bundleMap.get(prefabPath) ?? defaultBundle;
  }

  // ─────────────────────────────────────────────
  //  Prefab 缓存
  // ─────────────────────────────────────────────

  static cachePrefab(windowName: string, prefab: Prefab): void {
    this._prefabCache.set(windowName, prefab);
  }

  static getCachedPrefab(windowName: string): Prefab | undefined {
    return this._prefabCache.get(windowName);
  }

  static removeCachedPrefab(windowName: string): void {
    this._prefabCache.delete(windowName);
  }

  // ─────────────────────────────────────────────
  //  手动管理包
  // ─────────────────────────────────────────────

  static addManualPath(prefabPath: string): void {
    this._dirty = true;
    this._manualPaths.add(prefabPath);
  }

  static setBundleName(prefabPath: string, bundleName: string): void {
    this._bundleMap.set(prefabPath, bundleName);
  }

  // ─────────────────────────────────────────────
  //  内部
  // ─────────────────────────────────────────────

  private static _refreshPaths(): void {
    for (const [, paths] of this._windowPrefabPaths) {
      for (let i = paths.length - 1; i >= 0; i--) {
        if (this._manualPaths.has(paths[i])) paths.splice(i, 1);
      }
    }
  }
}
