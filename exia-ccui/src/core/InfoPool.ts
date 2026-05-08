/**
 * @Description: 信息池（ Cocos Prefab 注册表）
 */

import { debug } from "@xiacg/exia-core";
import { Prefab } from "cc";
import { IBarSlotInfo, IWindowInfo } from "./types";

export class InfoPool {
  /** @internal */ private static _windowInfos = new Map<string, IWindowInfo>();
  /** @internal Bar 注册信息：slot → (name → info) */
  private static _barInfos = new Map<string, Map<string, IBarSlotInfo>>();
  /** @internal */ private static _componentKeys = new Set<string>();

  /** @internal 窗口名 → 需要加载的所有预制体路径（主 + inline） */
  private static _windowPrefabPaths = new Map<string, string[]>();
  /** @internal 手动管理（不自动卸载）的预制体路径 */
  private static _manualPaths = new Set<string>();
  /** @internal 自定义 bundle 映射（prefabPath → bundleName），主路径优先 */
  private static _bundleMap = new Map<string, string>();
  /** @internal 已加载的 Prefab 资产缓存（windowName → Prefab） */
  private static _prefabCache = new Map<string, Prefab>();
  /** @internal Bar Prefab 缓存：slot → (name → Prefab) */
  private static _barPrefabCache = new Map<string, Map<string, Prefab>>();
  /** @internal dirty flag，手动包变化时重算路径 */
  private static _dirty = false;

  // ─────────────────────────────────────────────
  //  Bar 通用操作（slot 驱动）
  // ─────────────────────────────────────────────

  private static _getBarMap(slot: string): Map<string, IBarSlotInfo> {
    let map = this._barInfos.get(slot);
    if (!map) {
      map = new Map();
      this._barInfos.set(slot, map);
    }
    return map;
  }

  private static _getBarPrefabMap(slot: string): Map<string, Prefab> {
    let map = this._barPrefabCache.get(slot);
    if (!map) {
      map = new Map();
      this._barPrefabCache.set(slot, map);
    }
    return map;
  }

  static addBar(
    slot: string,
    ctor: any,
    prefabPath: string,
    name: string,
    bundleName: string,
  ): void {
    const map = this._getBarMap(slot);
    if (map.has(name)) {
      console.warn(`${slot}【${name}】已注册，跳过`);
      return;
    }
    debug(`${slot}注册  name:${name}  prefab:${prefabPath}`);
    map.set(name, { ctor, prefabPath, bundleName });
  }

  static hasBar(slot: string, name: string): boolean {
    return this._getBarMap(slot).has(name);
  }

  static getBar(slot: string, name: string): IBarSlotInfo {
    const info = this._getBarMap(slot).get(name);
    if (!info)
      throw new Error(`${slot}【${name}】未注册`);
    return info;
  }

  static cacheBarPrefab(slot: string, name: string, prefab: Prefab): void {
    this._getBarPrefabMap(slot).set(name, prefab);
  }

  static getCachedBarPrefab(slot: string, name: string): Prefab | undefined {
    return this._getBarPrefabMap(slot).get(name);
  }

  static removeCachedBarPrefab(slot: string, name: string): void {
    this._getBarPrefabMap(slot).delete(name);
  }

  // ── 便利方法（兼容旧调用）──

  static addHeader(ctor: any, prefabPath: string, name: string, bundleName: string): void {
    this.addBar("Header", ctor, prefabPath, name, bundleName);
  }
  static hasHeader(name: string): boolean { return this.hasBar("Header", name); }
  static getHeader(name: string): IBarSlotInfo { return this.getBar("Header", name); }
  static cacheHeaderPrefab(name: string, prefab: Prefab): void { this.cacheBarPrefab("Header", name, prefab); }
  static getCachedHeaderPrefab(name: string): Prefab | undefined { return this.getCachedBarPrefab("Header", name); }
  static removeCachedHeaderPrefab(name: string): void { this.removeCachedBarPrefab("Header", name); }

  static addBottomBar(ctor: any, prefabPath: string, name: string, bundleName: string): void {
    this.addBar("BottomBar", ctor, prefabPath, name, bundleName);
  }
  static hasBottomBar(name: string): boolean { return this.hasBar("BottomBar", name); }
  static getBottomBar(name: string): IBarSlotInfo { return this.getBar("BottomBar", name); }
  static cacheBottomBarPrefab(name: string, prefab: Prefab): void { this.cacheBarPrefab("BottomBar", name, prefab); }
  static getCachedBottomBarPrefab(name: string): Prefab | undefined { return this.getCachedBarPrefab("BottomBar", name); }
  static removeCachedBottomBarPrefab(name: string): void { this.removeCachedBarPrefab("BottomBar", name); }

  // ─────────────────────────────────────────────
  //  窗口注册
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
  }

  // ─────────────────────────────────────────────
  //  窗口查询
  // ─────────────────────────────────────────────

  static has(name: string): boolean {
    return this._windowInfos.has(name);
  }

  static get(name: string): IWindowInfo {
    if (!this.has(name))
      throw new Error(`窗口【${name}】未注册，请使用 @uiclass 装饰器注册`);
    return this._windowInfos.get(name)!;
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
  //  窗口 Prefab 缓存
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
