/**
 * @Description: 数据系统
 *
 * AutoWatcher 流程：
 *   DataWatcher 协议方法直接修改 DataComp 属性
 *     → Proxy set 拦截，将 compType 写入 _dirtySet
 *     → 调用 AutoWatcher() 触发 flush
 *     → 遍历 _dirtySet，逐 compType 通知所有订阅回调
 *     → 回调内若调用 UpdateDataComp（回源），新的脏标记进入下一轮 flush
 *     → while 循环处理多轮回源，MAX_FLUSH_DEPTH 防无限反馈
 *
 * 对 Map / Array 深层变更：Proxy 只拦截顶层属性赋值，
 * 集合内部 .set() / .push() 不触发拦截，需手动调用
 * DataSys.NotifyChanged(PlayerUnitDataComp) 标脏。
 */

import { DataCompFormatUtil } from "./DataCompFormatUtil";
import { DataCompConstructor } from "./DataComps";
import { DataMetadataKey } from "./DataConstant";

// ─────────────────────────────────────────────
//  内部类型
// ─────────────────────────────────────────────

/** Watch 订阅条目 */
interface IWatchEntry {
  callback: (comp: any) => void;
  /** 绑定的 this 对象（通常是 UI 组件），卸载时用来批量清理 */
  target?: any;
}

// ─────────────────────────────────────────────
//  DataSys
// ─────────────────────────────────────────────

export class DataSys {
  private static _instance: DataSys | null = null;

  /** compType string → DataComp Proxy 实例 */
  private readonly _recordDataComp = new Map<string, any>();

  /** 索引签名，允许通过字符串访问动态添加的属性 */
  [key: string]: any;

  // ── AutoWatcher 状态 ──────────────────────

  /** compType string → 订阅回调集合 */
  private readonly _subscribers = new Map<string, Set<IWatchEntry>>();

  /** 待通知的脏 compType 集合（Set 自动去重） */
  private readonly _dirtySet = new Set<string>();

  /** flush 正在执行，防止同一轮重入 */
  private _flushing = false;

  /** 当前 flush 深度，超过上限视为无限反馈，强制终止 */
  private _flushDepth = 0;

  /** 最大回源深度（每一轮 flush 后业务回源再次标脏算一层） */
  private static readonly MAX_FLUSH_DEPTH = 10;

  // ── 单例 ─────────────────────────────────

  public static GetDataSys(): DataSys {
    if (!this._instance) this._instance = new DataSys();
    return this._instance;
  }

  // ── 生命周期 ──────────────────────────────

  /** 清除 / 重置所有数据及订阅状态 */
  public Clear(): void {
    this._recordDataComp.clear();
    this._subscribers.clear();
    this._dirtySet.clear();
    this._flushing = false;
    this._flushDepth = 0;
  }

  // ── 核心 API ──────────────────────────────

  /**
   * 获取 DataComp 或 DataWatcher 实例。
   * 传入什么类型就返回什么类型。
   *
   * @example
   * const base    = DataSys.Get(PlayerBaseDataComp);
   * const watcher = DataSys.Get(PlayerDataWatcher);
   */
  public static Get<T>(ctor: new () => T): T {
    const sys = DataSys.GetDataSys();
    const watcherKey = (ctor as any)[DataMetadataKey.watcherKey] as
      | string
      | undefined;
    if (watcherKey) return sys._getWatcher<T>(watcherKey);

    const compType = (ctor as any)[DataMetadataKey.compType] as
      | string
      | undefined;
    if (compType) return sys._getDataComp<T>(compType);

    console.log(
      `DataSys.Get: ${ctor.name} 既未注册为 DataComp 也未注册为 DataWatcher`,
    );
    return null;
  }

  /**
   * 注册 DataWatcher（含其持有的所有 DataComp）。
   * DataComp 实例会被 Proxy 包裹，属性赋值自动标脏。
   */
  public RegisterWatcher<T>(ctor: new () => T): T {
    const watcherKey = (ctor as any)[DataMetadataKey.watcherKey] as
      | string
      | undefined;
    if (!watcherKey) {
      console.log(
        `RegisterWatcher 失败：${ctor.name} 未使用 @_dataDecorator.dataWatcher 注册`,
      );
      return null;
    }
    if (this[watcherKey]) return this[watcherKey] as T;

    this[watcherKey] = new ctor();
    const compTypes: string[] = this[watcherKey]["DATA_COMP_LIST"] ?? [];

    for (const type of compTypes) {
      // 用 Proxy 包裹 DataComp：顶层属性赋值自动标脏
      const observable = this._createObservable(this[watcherKey][type], type);
      this[watcherKey][type] = observable; // watcher 的访问器也指向 Proxy
      this._recordDataComp.set(type, observable);
    }

    return this[watcherKey] as T;
  }

  /**
   * 卸载 DataWatcher（含清理其持有的 DataComp 引用及订阅）
   */
  public UninstallWatcher(ctor: Function): void {
    const watcherKey = (ctor as any)[DataMetadataKey.watcherKey] as
      | string
      | undefined;
    if (!watcherKey || !this[watcherKey]) return;

    // 清理该 watcher 持有的所有 DataComp 订阅
    const compTypes: string[] = this[watcherKey]["DATA_COMP_LIST"] ?? [];
    for (const type of compTypes) {
      this._subscribers.delete(type);
      this._dirtySet.delete(type);
    }

    this._clearDataComp(watcherKey);
    this[watcherKey].Clear?.();
    this[watcherKey] = null;
    delete this[watcherKey];
  }

  /**
   * 用服务器数据批量更新 DataComp（浅拷贝）。
   * 因为目标是 Proxy，CloneObject 内部的赋值会自动触发标脏。
   */
  public UpdateDataComp(ctor: DataCompConstructor, source: object): void {
    const compType = (ctor as any)[DataMetadataKey.compType] as
      | string
      | undefined;
    if (!compType) {
      console.log(
        "UpdateDataComp 失败：传入的类未使用 @_dataDecorator.dataComp 注册",
      );
      return;
    }
    if (this._recordDataComp.has(compType)) {
      // 目标是 Proxy，每次 target[key]=value 都会触发 set 拦截并标脏
      DataCompFormatUtil.CloneObject(
        this._recordDataComp.get(compType),
        source,
      );
    } else {
      console.log(`UpdateDataComp 失败：compType=${compType} 尚未注册`);
    }
  }

  // ── AutoWatcher ───────────────────────────

  /**
   * 订阅 DataComp 变更通知。
   * callback 在每次 AutoWatcher flush 时收到最新的 DataComp 实例。
   *
   * @param ctor     DataComp 构造函数（已被 @_dataDecorator.dataComp 注册）
   * @param callback 回调，参数为 DataComp 实例
   * @param target   回调绑定的 this（用于 UnwatchByTarget 批量卸载）
   *
   * @example
   * DataSys.Watch(PlayerBaseDataComp, (base) => {
   *     this.lblLevel.string = String(base.Level);
   * }, this);
   */
  public static Watch<T>(
    ctor: new () => T,
    callback: (comp: T) => void,
    target?: any,
  ): void {
    const compType = (ctor as any)[DataMetadataKey.compType] as
      | string
      | undefined;
    if (!compType) {
      console.log(
        `Watch 失败：${ctor.name} 未使用 @_dataDecorator.dataComp 注册`,
      );
      return;
    }
    DataSys.GetDataSys()._addSubscriber(compType, callback, target);
  }

  /**
   * 取消订阅指定回调。
   *
   * @example
   * DataSys.Unwatch(PlayerBaseDataComp, this.onLevelChange);
   */
  public static Unwatch<T>(
    ctor: new () => T,
    callback: (comp: T) => void,
  ): void {
    const compType = (ctor as any)[DataMetadataKey.compType] as
      | string
      | undefined;
    if (!compType) return;
    DataSys.GetDataSys()._removeSubscriber(compType, callback);
  }

  /**
   * 批量取消某个 target 对象绑定的所有订阅。
   * 适合在 UI 组件 onClose / onDestroy 时统一卸载：
   *
   * @example
   * DataSys.UnwatchByTarget(this);
   */
  public static UnwatchByTarget(target: any): void {
    const sys = DataSys.GetDataSys();
    for (const [, entries] of sys._subscribers) {
      for (const entry of entries) {
        if (entry.target === target) entries.delete(entry);
      }
    }
  }

  /**
   * 手动标记 DataComp 为脏（用于 Map / Array 深层变更）。
   * Proxy 只拦截顶层属性赋值，Map.set() / Array.push() 等集合操作
   * 不会被自动捕获，需在操作后手动调用此方法。
   *
   * @example
   * this.playerUnitDataComp.skills.set(id, skill);
   * DataSys.NotifyChanged(PlayerUnitDataComp);   // 手动标脏
   */
  public static NotifyChanged<T>(ctor: new () => T): void {
    const compType = (ctor as any)[DataMetadataKey.compType] as
      | string
      | undefined;
    if (!compType) {
      console.log(`NotifyChanged 失败：${ctor.name} 未注册`);
      return;
    }
    DataSys.GetDataSys()._markDirty(compType);
  }

  /**
   * 自观察 flush 方法。
   *
   * 流程：
   *   数据观察者 → 检测到数据改变（Proxy 标脏 / NotifyChanged）
   *     → 修改数据 → 通知各 DataComp 订阅者
   *     → 业务逻辑若调用了 UpdateDataComp（回源）则再次标脏
   *     → while 循环继续 flush，直至无脏或超出 MAX_FLUSH_DEPTH
   *
   * 调用时机：
   *   - 协议批处理完成后手动调用（推荐）：DataSys.GetDataSys().AutoWatcher()
   *   - 或在游戏帧更新（Update）中每帧调用，实现全自动响应
   */
  public AutoWatcher(): void {
    // 防止同轮 flush 内重入（同轮内新产生的脏留给 while 下一轮处理）
    if (this._flushing) return;

    while (this._dirtySet.size > 0) {
      if (this._flushDepth >= DataSys.MAX_FLUSH_DEPTH) {
        console.log(
          "[DataSys] AutoWatcher 检测到回源反馈循环超过最大深度" +
            ` (${DataSys.MAX_FLUSH_DEPTH})，已强制终止。` +
            " 请检查 Watch 回调中是否存在无条件的 UpdateDataComp 调用。",
        );
        this._dirtySet.clear();
        break;
      }

      this._flushing = true;
      this._flushDepth++;

      // 快照当前脏集合，清空后再通知
      // 通知期间产生的新脏标记会进入已清空的 _dirtySet，由 while 下一轮处理
      const snapshot = Array.from(this._dirtySet);
      this._dirtySet.clear();

      for (const compType of snapshot) {
        const comp = this._recordDataComp.get(compType);
        const subs = this._subscribers.get(compType);
        if (!comp || !subs || subs.size === 0) continue;

        for (const entry of subs) {
          try {
            entry.target
              ? entry.callback.call(entry.target, comp)
              : entry.callback(comp);
          } catch (e) {
            console.log(
              `[DataSys] AutoWatcher 通知异常 [compType=${compType}]: ${e}`,
            );
          }
        }
      }

      this._flushing = false;
    }

    // 无论是否正常退出，重置深度计数器供下次 flush 使用
    this._flushDepth = 0;
    this._flushing = false;
  }

  // ── 内部 ──────────────────────────────────

  /**
   * 用 Proxy 包裹 DataComp 实例。
   * 拦截顶层属性的 set 操作，将 compType 写入 _dirtySet。
   * 注意：Proxy 只感知浅层赋值，Map / Array 内部变更需手动 NotifyChanged。
   */
  private _createObservable<T extends object>(comp: T, compType: string): T {
    return new Proxy(comp, {
      set: (target, prop, value, receiver) => {
        const ok = Reflect.set(target, prop, value, receiver);
        if (ok) this._markDirty(compType);
        return ok;
      },
    });
  }

  private _markDirty(compType: string): void {
    this._dirtySet.add(compType);
  }

  private _addSubscriber(
    compType: string,
    callback: Function,
    target?: any,
  ): void {
    if (!this._subscribers.has(compType)) {
      this._subscribers.set(compType, new Set());
    }
    // 同一 callback + target 组合只注册一次，防重复订阅
    const subs = this._subscribers.get(compType)!;
    for (const e of subs) {
      if (e.callback === callback && e.target === target) return;
    }
    subs.add({ callback: callback as (comp: any) => void, target });
  }

  private _removeSubscriber(compType: string, callback: Function): void {
    const subs = this._subscribers.get(compType);
    if (!subs) return;
    for (const entry of subs) {
      if (entry.callback === callback) {
        subs.delete(entry);
        return;
      }
    }
  }

  private _getWatcher<T>(watcherKey: string): T {
    if (this[watcherKey]) return this[watcherKey] as T;
    console.log(
      `DataSys._getWatcher: key=${watcherKey} 尚未注册，请先调用 RegisterWatcher`,
    );
    return null;
  }

  private _getDataComp<T>(compType: string): T {
    if (this._recordDataComp.has(compType))
      return this._recordDataComp.get(compType) as T;
    console.log(`DataSys._getDataComp: compType=${compType} 尚未注册`);
    return null;
  }

  private _clearDataComp(watcherKey: string): void {
    const compTypes: string[] = this[watcherKey]?.["DATA_COMP_LIST"] ?? [];
    for (const type of compTypes) {
      this._recordDataComp.delete(type);
      this[watcherKey][type] = null;
      delete this[watcherKey][type];
    }
  }
}
