/**
 * @Description: Header 管理器（薄壳门面）
 *
 * 所有逻辑已移至 BarSlotManager，此类仅为保持外部 API 兼容。
 */

import { IBar } from "../interface/IBar";
import { BarInfo } from "../window/BarInfo";
import { BarRegistry } from "./BarRegistry";

export class HeaderManager {
  public static onScreenResize(): void {
    BarRegistry.get("Header").onScreenResize();
  }

  public static async requestHeader(
    windowName: string,
    headerInfo: BarInfo<any> | null,
  ): Promise<void> {
    return BarRegistry.get("Header").request(windowName, headerInfo);
  }

  public static showHeader(windowName: string): void {
    BarRegistry.get("Header").show(windowName);
  }

  public static hideHeader(windowName: string): void {
    BarRegistry.get("Header").hide(windowName);
  }

  public static releaseHeader(windowName: string): void {
    BarRegistry.get("Header").release(windowName);
  }

  public static async refreshWindowHeader(
    windowName: string,
    newInfo: BarInfo<any> | null,
  ): Promise<void> {
    return BarRegistry.get("Header").refreshWindow(windowName, newInfo);
  }

  public static getHeaderByWindow(windowName: string): IBar | null {
    return BarRegistry.get("Header").getByWindow(windowName);
  }
}
