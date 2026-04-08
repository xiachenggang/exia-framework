/**
 * @Description: 全局窗口管理器
 *  - 半透明遮罩： Node + Graphics 组件
 *  - adjustAlphaGraph 使用 graphics.clear() / fillColor / rect / fill()
 *  - 通知所有窗口调用 screenResize（原版相同逻辑）
 */

import { Color, Graphics, Node, UITransform, view } from "cc";
import { IWindow } from "../interface/IWindow";
import { MetadataKey } from "../interface/type";
import { Window } from "../window/Window";
import { WindowBase } from "../window/WindowBase";
import { HeaderManager } from "./HeaderManager";
import { InfoPool } from "./InfoPool";
import { ResLoader } from "./ResLoader";
import { WindowGroup } from "./WindowGroup";

type ExtractUserData<T> = T extends Window<infer U, any> ? U : any;
type ExtractWindowInstance<T> = T extends new () => infer R ? R : never;

export class WindowManager {
  private static _bgAlpha: number = 0.75;
  private static _bgColor = new Color(0, 0, 0, 0);

  /** @internal 半透明遮罩（Graphics 节点） */
  private static _overlayNode: Node | null = null;
  private static _overlayGraphics: Graphics | null = null;

  /** @internal 窗口组 */
  private static _groups = new Map<string, WindowGroup>();
  private static _groupNames: string[] = [];

  /** @internal 所有窗口引用 */
  private static _windows = new Map<string, IWindow>();

  public static get bgAlpha(): number {
    return this._bgAlpha;
  }
  public static set bgAlpha(v: number) {
    this._bgAlpha = v;
  }

  // ─────────────────────────────────────────────
  //  初始化 / 配置
  // ─────────────────────────────────────────────

  /** 设置半透明遮罩节点（由 UIModule 创建后传入） @internal */
  public static setOverlayNode(node: Node): void {
    this._overlayNode = node;
    this._overlayGraphics =
      node.getComponent(Graphics) ?? node.addComponent(Graphics);
  }

  public static setPackageCallbacks(callbacks: {
    showWaitWindow: () => void;
    hideWaitWindow: () => void;
    fail: (windowName: string, code: 1 | 2, message: string) => void;
  }): void {
    ResLoader.setCallbacks(callbacks);
  }

  public static addManualPath(prefabPath: string): void {
    InfoPool.addManualPath(prefabPath);
  }

  /**
   * 设置预制体所在的 bundle 名（特殊需求，覆盖 @uiclass 中声明的 bundleName）
   */
  public static setPackageInfo(prefabPath: string, bundleName: string): void {
    InfoPool.setBundleName(prefabPath, bundleName);
  }

  // ─────────────────────────────────────────────
  //  屏幕 resize
  // ─────────────────────────────────────────────

  /** @internal */
  public static onScreenResize(): void {
    // 遮罩适配
    if (this._overlayNode) {
      this._overlayNode.setPosition(0, 0, 0);
      const visSize = view.getVisibleSize();
      this._overlayNode
        .getComponent(UITransform)
        ?.setContentSize(visSize.width, visSize.height);
    }
    // 所有窗口适配
    this._windows.forEach((win) => win._adapted());
    // 所有 Header 适配
    HeaderManager.onScreenResize();
  }

  // ─────────────────────────────────────────────
  //  窗口组管理
  // ─────────────────────────────────────────────

  /** @internal */
  public static addWindowGroup(group: WindowGroup): void {
    if (this._groups.has(group.name))
      throw new Error(`窗口组【${group.name}】已存在`);
    this._groups.set(group.name, group);
    this._groupNames.push(group.name);
  }

  public static getWindowGroup(name: string): WindowGroup {
    if (this._groups.has(name)) return this._groups.get(name)!;
    throw new Error(`窗口组【${name}】不存在`);
  }

  public static getGroupNames(): string[] {
    return this._groupNames;
  }

  // ─────────────────────────────────────────────
  //  窗口操作（公开 API）
  // ─────────────────────────────────────────────

  /**
   * 异步打开窗口（自动加载 Prefab 资产）
   * @param windowClass 窗口类（构造函数，非实例）
   * @param userdata    传递给 onShow 的数据
   */
  public static showWindow<T extends new () => Window<any, any>>(
    windowClass: T,
    userdata?: ExtractUserData<ExtractWindowInstance<T>>,
  ): Promise<ExtractWindowInstance<T>> {
    const name = (windowClass as any)[MetadataKey.originalName];
    if (!name)
      throw new Error(
        `窗口【${windowClass.name}】未注册，请使用 @uiclass 装饰器注册`,
      );
    return this._showWindowByName(name, userdata) as Promise<
      ExtractWindowInstance<T>
    >;
  }

  /** @internal */
  public static _showWindowByName<T = any, U = any>(
    name: string,
    userdata?: T,
  ): Promise<IWindow<T, U>> {
    const info = InfoPool.get(name);
    const group = this.getWindowGroup(info.group);
    return group.showWindow<T, U>(info, userdata);
  }

  public static closeWindow<T extends new () => IWindow>(windowClass: T): void {
    const name = (windowClass as any)[MetadataKey.originalName];
    this.closeWindowByName(name);
  }

  public static closeWindowByName(name: string): void {
    if (!this.hasWindow(name)) {
      console.warn(`窗口【${name}】不存在，无需关闭`);
      return;
    }
    const info = InfoPool.get(name);
    const group = this.getWindowGroup(info.group);
    group.removeWindow(name);
    this.adjustAlphaGraph();
    const top = this.getTopWindow<IWindow, any>();
    if (top && !top.isTop()) top._toTop();
  }

  public static closeAllWindow(ignores: IWindow[] = []): void {
    for (let i = this._groupNames.length - 1; i >= 0; i--) {
      this.getWindowGroup(this._groupNames[i]).closeAllWindow(ignores);
    }
    const top = this.getTopWindow<IWindow, any>();
    if (top && !top.isTop()) top._toTop();
  }

  public static hasWindow(name: string): boolean {
    return this._windows.has(name);
  }

  public static getWindow<T extends IWindow>(name: string): T | undefined {
    return this._windows.get(name) as T;
  }

  public static getTopWindow<T extends IWindow, U>(isAll = true): T | null {
    for (let i = this._groupNames.length - 1; i >= 0; i--) {
      const group = this.getWindowGroup(this._groupNames[i]);
      if (group.isIgnore && !isAll) continue;
      if (group.size === 0) continue;
      return group.getTopWindow() as T;
    }
    return null;
  }

  // ─────────────────────────────────────────────
  //  内部：窗口引用表
  // ─────────────────────────────────────────────

  /** @internal */ public static addWindow(name: string, win: IWindow): void {
    this._windows.set(name, win);
  }
  /** @internal */ public static removeWindow(name: string): void {
    this._windows.delete(name);
  }

  // ─────────────────────────────────────────────
  //  半透明遮罩（原 GGraph，现 Node + Graphics）
  // ─────────────────────────────────────────────

  /**
   * 从上到下找第一个 bgAlpha > 0 的窗口，将遮罩放到该窗口下方并绘制。
   * @internal
   */
  public static adjustAlphaGraph(): void {
    if (!this._overlayNode || !this._overlayGraphics) return;

    let topWindow: WindowBase | null = null;

    outer: for (let i = this._groupNames.length - 1; i >= 0; i--) {
      const group = this._groups.get(this._groupNames[i])!;
      if (group.size === 0) continue;
      for (let j = group.windowNames.length - 1; j >= 0; j--) {
        const win = WindowManager.getWindow<WindowBase>(group.windowNames[j]);
        if (win && win.bgAlpha > 0) {
          topWindow = win;
          break outer;
        }
      }
    }

    if (topWindow && topWindow.node.parent) {
      const parent = topWindow.node.parent;

      // 将遮罩移动到目标窗口所在的父节点
      if (this._overlayNode.parent !== parent) {
        this._overlayNode.removeFromParent();
        parent.addChild(this._overlayNode);
      }

      // 层级：目标窗口正下方
      const winIdx = topWindow.node.getSiblingIndex();
      const overlayIdx = this._overlayNode.getSiblingIndex();
      const newIdx = overlayIdx >= winIdx ? winIdx : winIdx - 1;
      this._overlayNode.setSiblingIndex(Math.max(0, newIdx));
      this._overlayNode.active = true;

      // 绘制纯色矩形（Graphics 组件）
      const visSize = view.getVisibleSize();
      const g = this._overlayGraphics;
      g.clear();
      this._bgColor.a = Math.floor(topWindow.bgAlpha * 255);
      g.fillColor = this._bgColor;
      g.rect(
        -visSize.width * 0.5,
        -visSize.height * 0.5,
        visSize.width,
        visSize.height,
      );
      g.fill();
    } else {
      this._overlayNode.active = false;
    }
  }

  public static releaseUnusedRes(): void {
    ResLoader.releaseUnusedRes();
  }
}
