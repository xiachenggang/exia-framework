/**
 * @Description: Header 资源栏管理器
 */

import { instantiate } from "cc";
import { IHeader } from "../interface/IHeader";
import { Header } from "../window/Header";
import { HeaderInfo } from "../window/HeaderInfo";
import { WindowBase } from "../window/WindowBase";
import { InfoPool } from "./InfoPool";
import { PropsHelper } from "./PropsHelper";
import { WindowManager } from "./WindowManager";

export class HeaderManager {
  /** @internal header 名 → 实例 */
  private static _headers = new Map<string, IHeader>();
  /** @internal header 名 → 引用计数 */
  private static _refCounts = new Map<string, number>();
  /** @internal header 名 → 引用它的窗口名集合 */
  private static _headerWindowsMap = new Map<string, Set<string>>();
  /** @internal 窗口名 → HeaderInfo（含 userdata） */
  private static _headerInfos = new Map<string, HeaderInfo<any>>();
  /** @internal header 名 → 当前显示该 header 的最上层窗口名 */
  private static _cacheTopWindow = new Map<string, string>();

  // ─────────────────────────────────────────────
  //  屏幕适配
  // ─────────────────────────────────────────────

  public static onScreenResize(): void {
    this._headers.forEach((h) => h._adapted());
  }

  // ─────────────────────────────────────────────
  //  生命周期
  // ─────────────────────────────────────────────

  public static requestHeader(
    windowName: string,
    headerInfo: HeaderInfo<any> | null,
  ): void {
    if (!headerInfo) return;
    this._headerInfos.set(windowName, headerInfo);
    const headerName = headerInfo.name;

    if (!this._headers.has(headerName)) {
      const header = this._createHeader(headerInfo);
      this._headers.set(headerName, header);
      this._refCounts.set(headerName, 0);
      this._headerWindowsMap.set(headerName, new Set());
    }

    this._refCounts.set(headerName, (this._refCounts.get(headerName) ?? 0) + 1);
    this._headerWindowsMap.get(headerName)!.add(windowName);
  }

  public static showHeader(windowName: string): void {
    if (!this._hasHeader(windowName)) return;
    const headerName = this._getHeaderName(windowName)!;
    const header = this._headers.get(headerName)!;
    this._updateTopWindow(headerName, windowName, true);
    if (this._cacheTopWindow.get(headerName) === windowName) {
      header._show(this._getUserData(windowName));
    }
  }

  public static hideHeader(windowName: string): void {
    if (!this._hasHeader(windowName)) return;
    const headerName = this._getHeaderName(windowName)!;
    const header = this._headers.get(headerName)!;
    this._updateTopWindow(headerName, windowName, false);
    if (this._cacheTopWindow.has(headerName)) {
      header._show(this._getUserData(this._cacheTopWindow.get(headerName)!));
    } else if (header.isShowing()) {
      header._hide();
    }
  }

  public static releaseHeader(windowName: string): void {
    if (!this._hasHeader(windowName)) return;
    const headerName = this._getHeaderName(windowName)!;
    const refCount = (this._refCounts.get(headerName) ?? 1) - 1;

    this._headerWindowsMap.get(headerName)?.delete(windowName);
    this._headerInfos.delete(windowName);

    const header = this._headers.get(headerName)!;
    if (refCount === 0) {
      header._close();
      this._headers.delete(headerName);
      this._refCounts.delete(headerName);
      this._headerWindowsMap.delete(headerName);
      this._cacheTopWindow.delete(headerName);
    } else {
      this._refCounts.set(headerName, refCount);
      const newTop = this._findTopWindow(headerName, windowName);
      if (newTop) {
        this._cacheTopWindow.set(headerName, newTop);
        this._adjustHeaderPosition(headerName, newTop);
        header._show(this._getUserData(newTop));
      } else {
        this._cacheTopWindow.delete(headerName);
        header.isShowing() && header._hide();
      }
    }
  }

  public static refreshWindowHeader(
    windowName: string,
    newInfo: HeaderInfo<any> | null,
  ): void {
    const oldName = this._getHeaderName(windowName);
    const newName = newInfo?.name;

    if (oldName === newName) {
      if (newInfo) {
        this._headerInfos.set(windowName, newInfo);
        if (this._cacheTopWindow.get(newName!) === windowName) {
          this._headers.get(newName!)!._show(newInfo.userdata);
        }
      }
      return;
    }

    if (oldName) this.releaseHeader(windowName);
    if (newInfo) {
      this.requestHeader(windowName, newInfo);
      this.showHeader(windowName);
    }
  }

  public static getHeaderByWindow(windowName: string): IHeader | null {
    if (!this._hasHeader(windowName)) return null;
    return this._headers.get(this._getHeaderName(windowName)!) ?? null;
  }

  // ─────────────────────────────────────────────
  //  内部：创建 Header（改为 instantiate + PropsHelper）
  // ─────────────────────────────────────────────

  private static _createHeader(headerInfo: HeaderInfo<any>): IHeader {
    const info = InfoPool.getHeader(headerInfo.name);

    // 从缓存中获取 Header Prefab（Header 不走 ResLoader，假定已随窗口加载）
    // 如需独立加载可扩展 ResLoader.loadHeaderRes
    const prefab = InfoPool.getCachedPrefab(headerInfo.name);
    let header: Header;

    if (prefab) {
      const node = instantiate(prefab);
      node.name = headerInfo.name;
      header = node.getComponent(Header)!;
    } else {
      // 没有独立预制体时，直接用构造函数创建（适合内嵌在场景中的 Header）
      const node = new (require("cc").Node)(headerInfo.name);
      header = node.addComponent(info.ctor) as Header;
    }

    if (!header)
      throw new Error(
        `Header【${headerInfo.name}】预制体根节点未挂载 Header 子类组件`,
      );

    PropsHelper.serializeProps(header);
    header._init();
    header._adapted();
    return header;
  }

  // ─────────────────────────────────────────────
  //  内部：层级 / 位置调整
  // ─────────────────────────────────────────────

  private static _adjustHeaderPosition(
    headerName: string,
    windowName: string,
  ): void {
    const header = this._headers.get(headerName) as any;
    const window = WindowManager.getWindow<WindowBase>(windowName);
    if (!window) return;

    const info = InfoPool.get(windowName);
    const group = WindowManager.getWindowGroup(info.group);
    const parent = group.root;

    if (header.node.parent !== parent) {
      header.node.removeFromParent();
      parent.addChild(header.node);
    }

    // 放在当前组最上层可见窗口之上
    let maxIdx = window.node.getSiblingIndex();
    for (const name of group.windowNames) {
      const win = WindowManager.getWindow<WindowBase>(name);
      if (win?.isShowing())
        maxIdx = Math.max(maxIdx, win.node.getSiblingIndex());
    }
    header.node.setSiblingIndex(maxIdx + 1);
  }

  private static _updateTopWindow(
    headerName: string,
    changedWindow: string,
    showing: boolean,
  ): void {
    const top = this._cacheTopWindow.get(headerName);
    if (showing) {
      if (!top || this._isAbove(changedWindow, top)) {
        this._cacheTopWindow.set(headerName, changedWindow);
        this._adjustHeaderPosition(headerName, changedWindow);
      }
    } else if (top === changedWindow) {
      const newTop = this._findTopWindow(headerName, changedWindow);
      if (newTop) {
        this._cacheTopWindow.set(headerName, newTop);
        this._adjustHeaderPosition(headerName, newTop);
      } else {
        this._cacheTopWindow.delete(headerName);
        const h = this._headers.get(headerName);
        if (h?.isShowing()) h._hide();
      }
    }
  }

  private static _findTopWindow(
    headerName: string,
    exclude: string,
  ): string | null {
    const windows = this._headerWindowsMap.get(headerName);
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

  private static _isAbove(a: string, b: string): boolean {
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

  private static _hasHeader(windowName: string): boolean {
    return this._headerInfos.has(windowName);
  }
  private static _getHeaderName(windowName: string): string | undefined {
    return this._headerInfos.get(windowName)?.name;
  }
  private static _getUserData(windowName: string): any {
    return this._headerInfos.get(windowName)?.userdata;
  }
}
