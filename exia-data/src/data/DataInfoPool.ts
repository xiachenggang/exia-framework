/**
 * @Description: 数据信息池
 *
 * 统一管理 DataComp 和 DataWatcher 的注册信息。
 * 装饰器负责写入，DataSys 通过此池读取，两者解耦。
 */

import { DataCompType, DataMetadataKey } from "./DataConstant";

// ─────────────────────────────────────────────
//  注册信息接口
// ─────────────────────────────────────────────

export interface IDataCompInfo {
  /** 构造函数 */
  ctor: new () => any;
  /** DataCompType 枚举值（字符串） */
  type: DataCompType;
  /** 类的原始名称（防混淆） */
  name: string;
}

export interface IDataWatcherInfo {
  /** 构造函数 */
  ctor: new () => any;
  /** Watcher 唯一 key，格式 "10000_<firstCompType>" */
  watcherKey: string;
  /** 该 Watcher 持有的 DataComp type 列表 */
  compTypes: DataCompType[];
  /** 类的原始名称 */
  name: string;
}

// ─────────────────────────────────────────────
//  DataInfoPool
// ─────────────────────────────────────────────

export class DataInfoPool {
  /** @internal compType → IDataCompInfo */
  private static readonly _compInfos = new Map<string, IDataCompInfo>();
  /** @internal watcherKey → IDataWatcherInfo */
  private static readonly _watcherInfos = new Map<string, IDataWatcherInfo>();

  // ── 注册 ──────────────────────────────────

  /**
   * 注册 DataComp（由 @_dataDecorator.dataComp 调用）
   */
  static addComp(ctor: new () => any, type: DataCompType, name: string): void {
    if (this._compInfos.has(type)) {
      console.warn(`DataComp【${name}】type=${type} 已注册，跳过`);
      return;
    }
    this._compInfos.set(type, { ctor, type, name });
  }

  /**
   * 注册 DataWatcher（由 @_dataDecorator.dataWatcher 调用）
   */
  static addWatcher(
    ctor: new () => any,
    watcherKey: string,
    compTypes: DataCompType[],
    name: string,
  ): void {
    if (this._watcherInfos.has(watcherKey)) {
      console.warn(`DataWatcher【${name}】key=${watcherKey} 已注册，跳过`);
      return;
    }
    this._watcherInfos.set(watcherKey, { ctor, watcherKey, compTypes, name });
  }

  // ── 查询 ──────────────────────────────────

  static hasComp(type: DataCompType): boolean {
    return this._compInfos.has(type);
  }

  static hasWatcher(watcherKey: string): boolean {
    return this._watcherInfos.has(watcherKey);
  }

  static getComp(type: DataCompType): IDataCompInfo {
    const info = this._compInfos.get(type);
    if (!info)
      throw new Error(
        `DataComp type=${type} 未注册，请使用 @_dataDecorator.dataComp 装饰器注册`,
      );
    return info;
  }

  static getWatcher(watcherKey: string): IDataWatcherInfo {
    const info = this._watcherInfos.get(watcherKey);
    if (!info)
      throw new Error(
        `DataWatcher key=${watcherKey} 未注册，请使用 @_dataDecorator.dataWatcher 装饰器注册`,
      );
    return info;
  }

  /**
   * 通过构造函数获取 DataComp 的 type（防混淆，走静态属性）
   */
  static getCompType(ctor: Function): DataCompType {
    const type = (ctor as any)[DataMetadataKey.compType] as DataCompType;
    if (type == null)
      throw new Error(`${ctor.name} 未使用 @_dataDecorator.dataComp 注册`);
    return type;
  }

  /**
   * 通过构造函数获取 DataWatcher 的 watcherKey
   */
  static getWatcherKey(ctor: Function): string {
    const key = (ctor as any)[DataMetadataKey.watcherKey] as string;
    if (!key)
      throw new Error(`${ctor.name} 未使用 @_dataDecorator.dataWatcher 注册`);
    return key;
  }

  // ── 调试 ──────────────────────────────────

  static getAllCompInfos(): ReadonlyMap<string, IDataCompInfo> {
    return this._compInfos;
  }

  static getAllWatcherInfos(): ReadonlyMap<string, IDataWatcherInfo> {
    return this._watcherInfos;
  }
}
