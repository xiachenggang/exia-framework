/**
 * @Description: 窗口基类
 */

import { Screen } from "@xiacg/exia-core";
import { BlockInputEvents, Component, Node, UITransform, view } from "cc";
import { HeaderManager } from "../core/HeaderManager";
import { WindowManager } from "../core/WindowManager";
import { IWindow } from "../interface/IWindow";
import { AdapterType, WindowType } from "../interface/type";
import { HeaderInfo } from "./HeaderInfo";

export abstract class WindowBase<T = any, U = any>
  extends Component
  implements IWindow<T, U>
{
  /** 窗口类型：显示时对其他窗口的处理方式 */
  public type: WindowType = WindowType.Normal;

  /** 窗口适配类型 */
  public adapterType: AdapterType = AdapterType.Full;

  /** 背景遮罩透明度（0 = 无遮罩） */
  public bgAlpha: number = 0;

  /** @internal */
  private _swallowNode: Node | null = null;
  /** @internal */
  private _isTop: boolean = true;

  // ─────────────────────────────────────────────
  //  name 代理（Component 本身没有 name，用 node.name）
  // ─────────────────────────────────────────────

  public get name(): string {
    return this.node.name;
  }
  public set name(v: string) {
    this.node.name = v;
  }

  // ─────────────────────────────────────────────
  //  框架内部方法（@internal）
  // ─────────────────────────────────────────────

  /**
   * 初始化（首次创建时调用）
   * @param swallowTouch 是否吞噬触摸事件，防止穿透到底层窗口
   * @internal
   */
  public _init(swallowTouch: boolean): void {
    // ── 创建全屏背景触摸拦截节点 ──
    const bgNode = new Node("swallow");
    const uiTf = bgNode.addComponent(UITransform);
    uiTf.setContentSize(view.getVisibleSize());

    if (swallowTouch) {
      // BlockInputEvents 组件会吞掉该节点区域内的所有触摸/键盘事件
      bgNode.addComponent(BlockInputEvents);
    }

    // 空白区域点击回调（透明背景层）
    bgNode.on(Node.EventType.TOUCH_END, this._onEmptyAreaTap, this);

    this.node.insertChild(bgNode, 0); // 置于最底层
    this._swallowNode = bgNode;

    this._isTop = true;
    this.bgAlpha = WindowManager.bgAlpha;

    this.onInit();
  }

  private _onEmptyAreaTap(): void {
    this.onEmptyAreaClick();
  }

  /**
   * 屏幕适配（创建后 + 每次 resize 都会调用）
   * @internal
   */
  public _adapted(): void {
    const visSize = view.getVisibleSize();
    const sw = visSize.width;
    const sh = visSize.height;

    // 窗口居中
    this.node.setPosition(0, 0, 0);

    const uitf = this.node.getComponent(UITransform);
    if (uitf) {
      switch (this.adapterType) {
        case AdapterType.Full:
          uitf.setContentSize(sw, sh);
          break;
        case AdapterType.Bang:
          uitf.setContentSize(Screen.SafeWidth, Screen.SafeHeight);
          break;
        case AdapterType.Fixed:
          // 固定尺寸，不做任何操作
          break;
      }
    }

    // 同步吞噬节点为全屏大小
    if (this._swallowNode) {
      this._swallowNode.getComponent(UITransform)?.setContentSize(sw, sh);
      this._swallowNode.setPosition(0, 0, 0);
    }

    this.onAdapted();
  }

  /**
   * 关闭并销毁窗口
   * @internal
   */
  public _close(): void {
    this.onClose();
    this.node.destroy();
  }

  /**
   * 显示窗口
   * @internal
   */
  public _show(userdata?: T): void {
    this.node.active = true;
    this.onShow(userdata);
  }

  /**
   * 隐藏窗口（保留实例，可恢复）
   * @internal
   */
  public _hide(): void {
    this.node.active = false;
    this.onHide();
  }

  /**
   * 从隐藏状态恢复显示（不重传 userdata）
   * @internal
   */
  public _showFromHide(): void {
    this.node.active = true;
    this.onShowFromHide();
  }

  /**
   * 窗口回到最顶层
   * @internal
   */
  public _toTop(): void {
    this._isTop = true;
    this.onToTop();
  }

  /**
   * 被上层窗口覆盖
   * @internal
   */
  public _toBottom(): void {
    this._isTop = false;
    this.onToBottom();
  }

  /**
   * 设置在父节点中的渲染层级（使用 setSiblingIndex）
   * @internal
   */
  public setDepth(depth: number): void {
    this.node.setSiblingIndex(depth);
  }

  // ─────────────────────────────────────────────
  //  公开查询方法
  // ─────────────────────────────────────────────

  public isShowing(): boolean {
    return this.node.active;
  }
  public isTop(): boolean {
    return this._isTop;
  }

  /** 供 WindowManager 屏幕 resize 时调用 */
  public screenResize(): void {
    this._adapted();
  }

  // ─────────────────────────────────────────────
  //  Header 相关
  // ─────────────────────────────────────────────

  public abstract getHeaderInfo(): HeaderInfo<any> | null;

  /**
   * 刷新/切换顶部 Header
   * 在同一窗口需要显示不同 Header 时调用（如 Tab 切换）
   */
  public refreshHeader(): void {
    HeaderManager.refreshWindowHeader(this.name, this.getHeaderInfo());
  }

  // ─────────────────────────────────────────────
  //  内部工具方法
  // ─────────────────────────────────────────────

  /** 在窗口内部关闭自己，无需持有 WindowManager 引用 */
  protected removeSelf(): void {
    WindowManager.closeWindowByName(this.name);
  }

  // ─────────────────────────────────────────────
  //  子类生命周期钩子（子类实现）
  // ─────────────────────────────────────────────

  /** 窗口首次初始化（@uiprop 绑定已完成，可安全访问子节点） */
  protected abstract onInit(): void;

  /** 窗口关闭前（清理定时器、取消事件订阅等） */
  protected abstract onClose(): void;

  /** 窗口显示，携带 userdata */
  protected abstract onShow(userdata?: T): void;

  /** 屏幕适配完成后（可在此做自定义布局微调） */
  protected abstract onAdapted(): void;

  /** 窗口被隐藏（HideOne / HideAll 触发） */
  protected abstract onHide(): void;

  /** 从隐藏状态恢复（无新 userdata） */
  protected abstract onShowFromHide(): void;

  /** 回到最顶层（可恢复音效/动画等） */
  protected abstract onToTop(): void;

  /** 被上层窗口覆盖（可暂停音效/动画等） */
  protected abstract onToBottom(): void;

  /** 点击窗口空白背景区域 */
  protected abstract onEmptyAreaClick(): void;
}
