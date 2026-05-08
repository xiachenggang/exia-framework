/**
 * @Description: Bar 插槽管理器（通用管理逻辑，非静态类）
 *
 * 一个实例管理一种 Bar 类型（Header / BottomBar / 未来扩展）。
 * 包含：实例缓存、引用计数、z-index 管理、屏幕适配广播。
 */

import { instantiate, Node } from "cc";
import { IBar } from "../interface/IBar";
import { Bar } from "../window/Bar";
import { BarInfo } from "../window/BarInfo";
import { WindowBase } from "../window/WindowBase";
import { InfoPool } from "./InfoPool";
import { PropsHelper } from "./PropsHelper";
import { ResLoader } from "./ResLoader";
import { WindowManager } from "./WindowManager";

export class BarSlotManager {
  /** 插槽标识（如 "Header" / "BottomBar"），用于路由 InfoPool / ResLoader */
  public readonly slotKey: string;
  /** 显示用标签（用于错误信息） */
  public readonly label: string;

  /** @internal bar 名 → 实例 */
  private _bars = new Map<string, IBar>();
  /** @internal bar 名 → 引用计数 */
  private _refCounts = new Map<string, number>();
  /** @internal bar 名 → 引用它的窗口名集合 */
  private _barWindowsMap = new Map<string, Set<string>>();
  /** @internal 窗口名 → BarInfo（含 userdata） */
  private _barInfos = new Map<string, BarInfo<any>>();
  /** @internal bar 名 → 当前显示该 bar 的最上层窗口名 */
  private _cacheTopWindow = new Map<string, string>();

  constructor(slotKey: string, label: string) {
    this.slotKey = slotKey;
    this.label = label;
  }

  // ─────────────────────────────────────────────
  //  屏幕适配
  // ─────────────────────────────────────────────

  public onScreenResize(): void {
    this._bars.forEach((b) => b._adapted());
  }

  // ─────────────────────────────────────────────
  //  生命周期
  // ─────────────────────────────────────────────

  public async request(
    windowName: string,
    barInfo: BarInfo<any> | null,
  ): Promise<void> {
    if (!barInfo) return;
    this._barInfos.set(windowName, barInfo);
    const barName = barInfo.name;

    if (!this._bars.has(barName)) {
      await ResLoader.loadBarRes(this.slotKey, barName, windowName);
      const bar = await this._createBar(barInfo);
      this._bars.set(barName, bar);
      this._refCounts.set(barName, 0);
      this._barWindowsMap.set(barName, new Set());
    }

    this._refCounts.set(barName, (this._refCounts.get(barName) ?? 0) + 1);
    this._barWindowsMap.get(barName)!.add(windowName);
  }

  public show(windowName: string): void {
    if (!this._hasBar(windowName)) return;
    const barName = this._getBarName(windowName)!;
    const bar = this._bars.get(barName)!;
    this._updateTopWindow(barName, windowName, true);
    if (this._cacheTopWindow.get(barName) === windowName) {
      bar._show(this._getUserData(windowName));
    }
  }

  public hide(windowName: string): void {
    if (!this._hasBar(windowName)) return;
    const barName = this._getBarName(windowName)!;
    const bar = this._bars.get(barName)!;
    this._updateTopWindow(barName, windowName, false);
    if (this._cacheTopWindow.has(barName)) {
      bar._show(this._getUserData(this._cacheTopWindow.get(barName)!));
    } else if (bar.isShowing()) {
      bar._hide();
    }
  }

  public release(windowName: string): void {
    if (!this._hasBar(windowName)) return;
    const barName = this._getBarName(windowName)!;
    const refCount = (this._refCounts.get(barName) ?? 1) - 1;

    this._barWindowsMap.get(barName)?.delete(windowName);
    this._barInfos.delete(windowName);

    const bar = this._bars.get(barName)!;
    if (refCount === 0) {
      bar._close();
      this._bars.delete(barName);
      this._refCounts.delete(barName);
      this._barWindowsMap.delete(barName);
      this._cacheTopWindow.delete(barName);
      ResLoader.unloadBarRes(this.slotKey, barName);
    } else {
      this._refCounts.set(barName, refCount);
      const newTop = this._findTopWindow(barName, windowName);
      if (newTop) {
        this._cacheTopWindow.set(barName, newTop);
        this._adjustBarPosition(barName, newTop);
        bar._show(this._getUserData(newTop));
      } else {
        this._cacheTopWindow.delete(barName);
        bar.isShowing() && bar._hide();
      }
    }
  }

  public async refreshWindow(
    windowName: string,
    newInfo: BarInfo<any> | null,
  ): Promise<void> {
    const oldName = this._getBarName(windowName);
    const newName = newInfo?.name;

    if (oldName === newName) {
      if (newInfo) {
        this._barInfos.set(windowName, newInfo);
        if (this._cacheTopWindow.get(newName!) === windowName) {
          this._bars.get(newName!)!._show(newInfo.userdata);
        }
      }
      return;
    }

    if (oldName) this.release(windowName);
    if (newInfo) {
      await this.request(windowName, newInfo);
      this.show(windowName);
    }
  }

  public getByWindow(windowName: string): IBar | null {
    if (!this._hasBar(windowName)) return null;
    return this._bars.get(this._getBarName(windowName)!) ?? null;
  }

  // ─────────────────────────────────────────────
  //  内部：创建 Bar
  // ─────────────────────────────────────────────

  private async _createBar(barInfo: BarInfo<any>): Promise<IBar> {
    const info = InfoPool.getBar(this.slotKey, barInfo.name);
    const prefab = InfoPool.getCachedBarPrefab(this.slotKey, barInfo.name);
    let bar: Bar;

    if (prefab) {
      const node = instantiate(prefab);
      node.name = barInfo.name;
      bar = node.getComponent(Bar)!;
    } else {
      const node = new Node(barInfo.name);
      bar = node.addComponent(info.ctor) as Bar;
    }

    if (!bar)
      throw new Error(
        `${this.label}【${barInfo.name}】预制体根节点未挂载 ${this.label} 子类组件`,
      );

    PropsHelper.serializeProps(bar);
    bar._init();
    bar._adapted();
    return bar;
  }

  // ─────────────────────────────────────────────
  //  内部：层级 / 位置调整
  // ─────────────────────────────────────────────

  private _adjustBarPosition(barName: string, windowName: string): void {
    const bar = this._bars.get(barName) as any;
    const window = WindowManager.getWindow<WindowBase>(windowName);
    if (!window) return;

    const info = InfoPool.get(windowName);
    const group = WindowManager.getWindowGroup(info.group);
    const parent = group.root;

    if (bar.node.parent !== parent) {
      bar.node.removeFromParent();
      parent.addChild(bar.node);
    }

    let maxIdx = window.node.getSiblingIndex();
    for (const name of group.windowNames) {
      const win = WindowManager.getWindow<WindowBase>(name);
      if (win?.isShowing())
        maxIdx = Math.max(maxIdx, win.node.getSiblingIndex());
    }
    bar.node.setSiblingIndex(maxIdx + 1);
  }

  private _updateTopWindow(
    barName: string,
    changedWindow: string,
    showing: boolean,
  ): void {
    const top = this._cacheTopWindow.get(barName);
    if (showing) {
      if (!top || this._isAbove(changedWindow, top)) {
        this._cacheTopWindow.set(barName, changedWindow);
        this._adjustBarPosition(barName, changedWindow);
      }
    } else if (top === changedWindow) {
      const newTop = this._findTopWindow(barName, changedWindow);
      if (newTop) {
        this._cacheTopWindow.set(barName, newTop);
        this._adjustBarPosition(barName, newTop);
      } else {
        this._cacheTopWindow.delete(barName);
        const b = this._bars.get(barName);
        if (b?.isShowing()) b._hide();
      }
    }
  }

  private _findTopWindow(barName: string, exclude: string): string | null {
    const windows = this._barWindowsMap.get(barName);
    if (!windows?.size) return null;
    for (let i = WindowManager.getGroupNames().length - 1; i >= 0; i--) {
      const group = WindowManager.getWindowGroup(
        WindowManager.getGroupNames()[i],
      );
      for (let j = group.windowNames.length - 1; j >= 0; j--) {
        const name = group.windowNames[j];
        if (name === exclude || !windows.has(name)) continue;
        const win = WindowManager.getWindow(name);
        if (win?.isShowing()) return name;
      }
    }
    return null;
  }

  private _isAbove(a: string, b: string): boolean {
    if (a === b) return true;
    const infoA = InfoPool.get(a);
    const infoB = InfoPool.get(b);
    const groups = WindowManager.getGroupNames();
    const gA = groups.indexOf(infoA.group);
    const gB = groups.indexOf(infoB.group);
    if (gA !== gB) return gA > gB;
    const group = WindowManager.getWindowGroup(infoA.group);
    return group.windowNames.indexOf(a) > group.windowNames.indexOf(b);
  }

  private _hasBar(windowName: string): boolean {
    return this._barInfos.has(windowName);
  }
  private _getBarName(windowName: string): string | undefined {
    return this._barInfos.get(windowName)?.name;
  }
  private _getUserData(windowName: string): any {
    return this._barInfos.get(windowName)?.userdata;
  }
}
