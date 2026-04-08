/**
 * @Description: 窗口组
 */

import { instantiate, Node } from "cc";
import { IWindow } from "../interface/IWindow";
import { WindowType } from "../interface/type";
import { WindowBase } from "../window/WindowBase";
import { HeaderManager } from "./HeaderManager";
import { InfoPool } from "./InfoPool";
import { PropsHelper } from "./PropsHelper";
import { ResLoader } from "./ResLoader";
import { IWindowInfo } from "./types";
import { WindowManager } from "./WindowManager";

export class WindowGroup {
  /** @internal */ private _name: string;
  /** @internal */ private _root: Node;
  /** @internal */ private _ignore: boolean;
  /** @internal */ private _swallowTouch: boolean;
  /** @internal */ private _windowNames: string[] = [];

  public get name(): string {
    return this._name;
  }
  public get root(): Node {
    return this._root;
  }
  public get size(): number {
    return this._windowNames.length;
  }
  public get windowNames(): string[] {
    return this._windowNames;
  }
  public get isIgnore(): boolean {
    return this._ignore;
  }

  constructor(
    name: string,
    root: Node,
    ignoreQuery: boolean,
    swallowTouch: boolean,
  ) {
    this._name = name;
    this._root = root;
    this._ignore = ignoreQuery;
    this._swallowTouch = swallowTouch;
  }

  // ─────────────────────────────────────────────
  //  显示窗口
  // ─────────────────────────────────────────────

  public async showWindow<T = any, U = any>(
    info: IWindowInfo,
    userdata?: T,
  ): Promise<IWindow<T, U>> {
    const lastTop = WindowManager.getTopWindow();

    if (WindowManager.hasWindow(info.name)) {
      const win = WindowManager.getWindow<IWindow>(info.name);
      this._showAdjustment(win, userdata);
      if (lastTop && lastTop.name !== win.name) {
        lastTop._toBottom();
        win._toTop();
      }
      return win as IWindow<T, U>;
    }

    try {
      await ResLoader.loadWindowRes(info.name);
      const win = this._createWindow(info.name);
      this._showAdjustment(win, userdata);
      if (lastTop && lastTop.name !== win.name) {
        lastTop._toBottom();
      }
      return win as IWindow<T, U>;
    } catch (err: any) {
      throw new Error(`窗口【${info.name}】打开失败: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────
  //  内部：创建窗口
  // ─────────────────────────────────────────────

  /**
   * 从已加载的 Prefab 实例化窗口，挂载到当前组的根节点
   */
  private _createWindow(name: string): WindowBase {
    const prefab = InfoPool.getCachedPrefab(name);
    if (!prefab)
      throw new Error(`窗口【${name}】预制体未缓存，请先调用 loadWindowRes`);

    // ① 实例化预制体
    const windowNode = instantiate(prefab);
    windowNode.name = name;

    // ② 获取 WindowBase 组件（预制体根节点上必须挂载继承自 Window 的组件）
    const window = windowNode.getComponent(WindowBase);
    if (!window)
      throw new Error(`窗口【${name}】预制体根节点未挂载 WindowBase 子类组件`);

    // ③ 序列化 @uiprop / @uiclick / @uitransition 绑定
    PropsHelper.serializeProps(window);

    // ④ 初始化、适配
    window._init(this._swallowTouch);
    window._adapted();

    // ⑤ 加入显示树
    this._root.addChild(windowNode);
    if (this.size === 0) this._root.active = true;

    this._windowNames.push(name);
    WindowManager.addWindow(name, window);

    // ⑥ 请求 Header
    HeaderManager.requestHeader(name, window.getHeaderInfo());

    return window;
  }

  // ─────────────────────────────────────────────
  //  内部：show 后的调整
  // ─────────────────────────────────────────────

  private _showAdjustment(window: IWindow, userdata?: any): void {
    this._moveWindowToTop(window);
    window._show(userdata);
    HeaderManager.showHeader(window.name);
    WindowManager.adjustAlphaGraph();
  }

  private _moveWindowToTop(window: IWindow): void {
    const lastName = this._windowNames[this.size - 1];
    if (window.name !== lastName) {
      const idx = this._windowNames.indexOf(window.name);
      if (idx < 0) {
        console.error(`[BUG] 窗口【${window.name}】不在数组中`);
        return;
      }
      this._windowNames.splice(idx, 1);
      this._windowNames.push(window.name);
    }

    this._processWindowCloseStatus(window);
    // 调整在父节点中的层级（最后渲染 = 最顶层）
    window.setDepth(this._root.children.length - 1);
    this._processWindowHideStatus(this.size - 1);
  }

  // ─────────────────────────────────────────────
  //  内部：隐藏/显示状态维护
  // ─────────────────────────────────────────────

  private _processWindowHideStatus(startIndex: number): void {
    const curWin = WindowManager.getWindow(this._windowNames[startIndex]);
    if (curWin && startIndex === this.size - 1 && !curWin.isShowing()) {
      curWin._showFromHide();
      HeaderManager.showHeader(curWin.name);
    }
    if (startIndex <= 0) return;

    for (let i = startIndex; i > 0; i--) {
      const win = WindowManager.getWindow(this._windowNames[i]);
      if (!win) {
        console.error(`[BUG] 窗口【${this._windowNames[i]}】不存在`);
        return;
      }

      if (win.type === WindowType.HideAll) {
        for (let j = i - 1; j >= 0; j--) {
          const prev = WindowManager.getWindow(this._windowNames[j]);
          if (prev?.isShowing()) {
            prev._hide();
            HeaderManager.hideHeader(prev.name);
          }
        }
        break;
      } else if (win.type === WindowType.HideOne) {
        const prev = WindowManager.getWindow(this._windowNames[i - 1]);
        if (prev?.isShowing()) {
          prev._hide();
          HeaderManager.hideHeader(prev.name);
        }
      } else {
        const prev = WindowManager.getWindow(this._windowNames[i - 1]);
        if (prev && !prev.isShowing()) {
          prev._showFromHide();
          HeaderManager.showHeader(prev.name);
        }
      }
    }
  }

  private _processWindowCloseStatus(window: IWindow): void {
    if (window.type === WindowType.CloseOne) {
      if (this.size < 2) return;
      const name = this._windowNames[this.size - 2];
      this._windowNames.splice(this.size - 2, 1);
      const win = WindowManager.getWindow<IWindow>(name);
      if (!win) {
        console.error(`[BUG] 窗口【${name}】不存在`);
        return;
      }
      HeaderManager.releaseHeader(name);
      win._close();
      WindowManager.removeWindow(name);
    } else if (window.type === WindowType.CloseAll) {
      for (let i = this.size - 2; i >= 0; i--) {
        const name = this._windowNames[i];
        const win = WindowManager.getWindow(name);
        if (!win) {
          console.error(`[BUG] 窗口【${name}】不存在`);
          continue;
        }
        try {
          HeaderManager.releaseHeader(name);
          win._close();
          WindowManager.removeWindow(name);
        } catch (e) {
          console.error(`关闭窗口【${name}】异常:`, e);
        }
      }
      this._windowNames.splice(0, this.size - 1);
    }
  }

  // ─────────────────────────────────────────────
  //  关闭
  // ─────────────────────────────────────────────

  public removeWindow(name: string): void {
    const window = WindowManager.getWindow<IWindow>(name);
    if (!window) {
      console.error(`[BUG] 窗口【${name}】不存在`);
      return;
    }

    HeaderManager.releaseHeader(name);
    window._close();

    const idx = this._windowNames.lastIndexOf(name);
    if (idx < 0) {
      console.error(`[BUG] 窗口【${name}】不在数组中`);
      return;
    }
    this._windowNames.splice(idx, 1);
    WindowManager.removeWindow(name);
    ResLoader.unloadWindowRes(name);

    if (this.size === 0) {
      this._root.active = false;
    } else {
      this._processWindowHideStatus(this.size - 1);
    }
  }

  public closeAllWindow(ignores: IWindow[] = []): void {
    for (let i = this.size - 1; i >= 0; i--) {
      const name = this._windowNames[i];
      if (ignores.some((ig) => ig.name === name)) continue;
      const win = WindowManager.getWindow<IWindow>(name);
      if (!win) {
        console.error(`[BUG] 窗口【${name}】不存在`);
        return;
      }
      HeaderManager.releaseHeader(name);
      win._close();
      WindowManager.removeWindow(name);
      this._windowNames.splice(i, 1);
    }
    if (this.size === 0) {
      this._root.active = false;
    } else {
      this._processWindowHideStatus(this.size - 1);
    }
  }

  public hasWindow(name: string): boolean {
    return this._windowNames.includes(name);
  }

  public getTopWindow<T extends IWindow>(): T | null {
    if (this.size > 0)
      return WindowManager.getWindow<T>(this._windowNames[this.size - 1]);
    console.warn(`窗口组【${this._name}】中无窗口`);
    return null;
  }
}
