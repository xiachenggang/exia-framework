/**
 * @Description: 顶部资源栏基类（替换 GComponent → Component）
 */

import { Screen } from "@xiacg/exia-core";
import { Component, UITransform, view } from "cc";
import { IHeader } from "../interface/IHeader";
import { AdapterType } from "../interface/type";

export abstract class Header<T = any> extends Component implements IHeader<T> {
  public adapterType: AdapterType = AdapterType.Full;

  public get name(): string {
    return this.node.name;
  }
  public set name(v: string) {
    this.node.name = v;
  }

  public isShowing(): boolean {
    return this.node.active;
  }

  // ─────────────────────────────────────────────
  //  框架内部方法
  // ─────────────────────────────────────────────

  /** @internal */
  public _init(): void {
    this.onInit();
  }

  /** @internal */
  public _close(): void {
    this.onClose();
    this.node.destroy();
  }

  /** @internal */
  public _adapted(): void {
    const visSize = view.getVisibleSize();
    this.node.setPosition(0, 0, 0);

    const uitf = this.node.getComponent(UITransform);
    if (uitf) {
      switch (this.adapterType) {
        case AdapterType.Full:
          uitf.setContentSize(visSize.width, visSize.height);
          break;
        case AdapterType.Bang:
          uitf.setContentSize(Screen.SafeWidth, Screen.SafeHeight);
          break;
        default:
          break;
      }
    }

    this.onAdapted();
  }

  /** @internal */
  public _show(userdata: T): void {
    this.node.active = true;
    this.onShow(userdata);
  }

  /** @internal */
  public _hide(): void {
    this.node.active = false;
    this.onHide();
  }

  // ─────────────────────────────────────────────
  //  子类钩子
  // ─────────────────────────────────────────────

  protected abstract onInit(): void;
  protected abstract onShow(userdata?: T): void;

  protected onAdapted(): void {}
  protected onClose(): void {}
  protected onHide(): void {}
  protected onShowFromHide(): void {}
}
