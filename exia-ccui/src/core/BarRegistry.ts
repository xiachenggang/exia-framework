/**
 * @Description: Bar 注册表（静态协调器）
 *
 * 持有所有 BarSlotManager 实例，提供批量操作。
 * 框架启动时自动注册 "Header" 和 "BottomBar" 两个默认插槽。
 */

import { BarInfo } from "../window/BarInfo";
import { BarSlotManager } from "./BarSlotManager";

export class BarRegistry {
  /** @internal 所有已注册的 slot */
  private static _slots: BarSlotManager[] = [];
  /** @internal slotKey → BarSlotManager */
  private static _slotMap = new Map<string, BarSlotManager>();

  /**
   * 注册一个 Bar 插槽（Header / BottomBar / 未来扩展）
   */
  static register(slot: BarSlotManager): void {
    if (this._slotMap.has(slot.slotKey)) {
      console.warn(`BarRegistry: slot【${slot.slotKey}】已注册，跳过`);
      return;
    }
    this._slots.push(slot);
    this._slotMap.set(slot.slotKey, slot);
  }

  /**
   * 获取指定 slot 的管理器
   */
  static get(slotKey: string): BarSlotManager {
    const slot = this._slotMap.get(slotKey);
    if (!slot)
      throw new Error(`BarRegistry: slot【${slotKey}】未注册`);
    return slot;
  }

  // ─────────────────────────────────────────────
  //  批量操作
  // ─────────────────────────────────────────────

  /**
   * 请求所有 slot 的 Bar
   * @param getInfo 按 slotKey 返回对应的 BarInfo（返回 null 表示该窗口不使用此 slot）
   */
  static async requestAll(
    windowName: string,
    getInfo: (slotKey: string) => BarInfo<any> | null,
  ): Promise<void> {
    for (const slot of this._slots) {
      await slot.request(windowName, getInfo(slot.slotKey));
    }
  }

  static showAll(windowName: string): void {
    for (const slot of this._slots) {
      slot.show(windowName);
    }
  }

  static hideAll(windowName: string): void {
    for (const slot of this._slots) {
      slot.hide(windowName);
    }
  }

  static releaseAll(windowName: string): void {
    for (const slot of this._slots) {
      slot.release(windowName);
    }
  }

  static onScreenResize(): void {
    for (const slot of this._slots) {
      slot.onScreenResize();
    }
  }
}

// ── 自动注册默认插槽 ──
BarRegistry.register(new BarSlotManager("Header", "Header"));
BarRegistry.register(new BarSlotManager("BottomBar", "BottomBar"));
