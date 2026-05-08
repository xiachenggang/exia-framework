/**
 * @Description: BottomBar 管理器（薄壳门面）
 *
 * 所有逻辑已移至 BarSlotManager，此类仅为保持外部 API 兼容。
 */

import { IBar } from "../interface/IBar";
import { BarInfo } from "../window/BarInfo";
import { BarRegistry } from "./BarRegistry";

export class BottomBarManager {
  public static onScreenResize(): void {
    BarRegistry.get("BottomBar").onScreenResize();
  }

  public static async requestBottomBar(
    windowName: string,
    bottomBarInfo: BarInfo<any> | null,
  ): Promise<void> {
    return BarRegistry.get("BottomBar").request(windowName, bottomBarInfo);
  }

  public static showBottomBar(windowName: string): void {
    BarRegistry.get("BottomBar").show(windowName);
  }

  public static hideBottomBar(windowName: string): void {
    BarRegistry.get("BottomBar").hide(windowName);
  }

  public static releaseBottomBar(windowName: string): void {
    BarRegistry.get("BottomBar").release(windowName);
  }

  public static async refreshWindowBottomBar(
    windowName: string,
    newInfo: BarInfo<any> | null,
  ): Promise<void> {
    return BarRegistry.get("BottomBar").refreshWindow(windowName, newInfo);
  }

  public static getBottomBarByWindow(windowName: string): IBar | null {
    return BarRegistry.get("BottomBar").getByWindow(windowName);
  }
}
