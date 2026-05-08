/**
 * @Description: 业务窗口基类
 *
 * 将 WindowBase 中的非必须抽象方法提供空实现，
 * 业务代码只需实现 onInit / onClose / onShow 三个方法。
 */

import { BottomBarInfo } from "./BottomBarInfo";
import { HeaderInfo } from "./HeaderInfo";
import { WindowBase } from "./WindowBase";

export abstract class Window<T = any, U = any> extends WindowBase<T, U> {
  // ── 必须实现 ──────────────────────────────────
  protected abstract onInit(): void;
  protected abstract onClose(): void;
  protected abstract onShow(userdata?: T): void;

  // ── 按需覆写（默认空实现）────────────────────
  protected onAdapted(): void {}
  protected onHide(): void {}
  protected onShowFromHide(): void {}
  protected onToTop(): void {}
  protected onToBottom(): void {}
  protected onEmptyAreaClick(): void {}

  /**
   * 返回 null 表示该窗口不使用顶部 Header。
   * 覆写此方法并返回 HeaderInfo 实例即可启用 Header 复用。
   */
  public getHeaderInfo(): HeaderInfo<any> | null {
    return null;
  }

  /**
   * 返回 null 表示该窗口不使用底部 BottomBar。
   * 覆写此方法并返回 BottomBarInfo 实例即可启用 BottomBar 复用。
   */
  public getBottomBarInfo(): BottomBarInfo<any> | null {
    return null;
  }
}
