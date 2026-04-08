/**
 * @Description: 数据装饰器
 *
 * dataCompDependency / dataCompInject 重构说明：
 *  - 原实现用 args.push 将 DataComp 追加到末尾，方法签名和注入顺序对不上
 *  - 新实现改为 prepend（前置注入）：DataComp 实例插在参数列表最前面
 *  - 方法签名直接声明注入参数，调用时只需传业务参数，装饰器自动填入 DataComp 实例
 *  - 提供 Inject<T> 类型标记，让签名在 IDE 中一眼区分"自动注入"和"手动传入"
 */

import { DataCompType, DataMetadataKey, WatcherType } from "./DataConstant";
import { DataInfoPool } from "./DataInfoPool";
import { DataSys } from "./DataSys";

/** 构造函数类型 */
export type DataCompConstructor<T = any> = new () => T;

// ─────────────────────────────────────────────────────────────────
//  类型辅助
// ─────────────────────────────────────────────────────────────────

/**
 * 标记一个方法参数为"自动注入的 DataComp"。
 * 运行时无影响（透明类型），仅用于提升可读性和 IDE 提示。
 *
 * 规则：被 @dataCompDependency 注入的参数写在签名最前面，
 *       手动传入的业务参数写在后面。
 *
 * @example
 * @_dataDecorator.dataCompDependency([PlayerBaseDataComp, PlayerItemDataComp])
 * onLevelUp(base: Inject<PlayerBaseDataComp>, item: Inject<PlayerItemDataComp>, newLv: number) {
 *     base.Level = newLv;   // 直接使用，无需 DataSys.Get(...)
 *     item.SetNowSkin(...);
 * }
 * // 调用时只传业务参数：this.onLevelUp(10)
 */
export type Inject<T> = T;

// ─────────────────────────────────────────────────────────────────
//  内部工具：在装饰器定义时预校验注册状态，提前暴露配置错误
// ─────────────────────────────────────────────────────────────────

function assertRegistered(
  comps: DataCompConstructor[],
  decoratorName: string,
): void {
  for (const comp of comps) {
    const type = (comp as any)[DataMetadataKey.compType];
    if (!type) {
      throw new Error(
        `[${decoratorName}] 传入的类 "${comp.name}" 未使用 @_dataDecorator.dataComp 注册，` +
          "请确认装饰器执行顺序（被注入类需先于宿主类加载）。",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────
//  _dataDecorator 命名空间
// ─────────────────────────────────────────────────────────────────

export namespace _dataDecorator {
  // ── 类装饰器 ─────────────────────────────

  /**
   * 数据组件装饰器
   * 将类注册为指定 DataCompType 的数据组件。
   * 同时在构造函数上写入 DataMetadataKey.compType 静态属性（防混淆）。
   *
   * @param type DataCompType 枚举值
   *
   * @example
   * // 在各模块的 XxxDataCompType.ts 中定义类型常量，再传入
   * @_dataDecorator.dataComp(PlayerDataCompType.PlayerBaseDataComp)
   * export class PlayerBaseDataComp { ... }
   */
  export function dataComp(type: DataCompType): ClassDecorator {
    return function (ctor: Function): void {
      const name = ctor.name;
      (ctor as any)[DataMetadataKey.compType] = type;
      (ctor as any)[DataMetadataKey.originalName] = name;
      DataInfoPool.addComp(ctor as DataCompConstructor, type, name);
    };
  }

  /**
   * 数据观察者装饰器
   * 将类标记为 DataWatcher，并声明它持有哪些 DataComp。
   * 持有的 DataComp 实例会以 compType 为 key 挂载到 watcher 原型上，
   * DataSys.RegisterWatcher 时统一实例化并纳入 _recordDataComp。
   *
   * @param comps 该 Watcher 持有的 DataComp 构造函数列表（已被 @dataComp 注册）
   *
   * @example
   * @_dataDecorator.dataWatcher(PlayerBaseDataComp, PlayerItemDataComp, PlayerUnitDataComp)
   * export class PlayerDataWatcher { ... }
   */
  export function dataWatcher(...comps: DataCompConstructor[]): ClassDecorator {
    return function (ctor: Function): void {
      const name = ctor.name;
      const compTypes = comps.map((c) => DataInfoPool.getCompType(c));
      const watcherKey = `${WatcherType}_${compTypes.length > 0 ? compTypes[0] : "1"}`;

      (ctor as any)[DataMetadataKey.watcherKey] = watcherKey;
      (ctor as any)[DataMetadataKey.compList] = compTypes;
      (ctor as any)[DataMetadataKey.originalName] = name;

      compTypes.forEach((type, i) => {
        ctor.prototype[type] = new comps[i]();
      });
      ctor.prototype["DATA_COMP_LIST"] = compTypes;
      ctor.prototype["WATCHER_TYPE"] = watcherKey;

      DataInfoPool.addWatcher(
        ctor as DataCompConstructor,
        watcherKey,
        compTypes,
        name,
      );
    };
  }

  // ── 方法装饰器 ───────────────────────────

  /**
   * DataComp 前置注入装饰器（方法级）
   *
   * 调用被装饰的方法时，自动将指定 DataComp 实例作为方法的**前几个参数**注入。
   * 方法签名中，注入参数写在最前面，手动传入的业务参数写在后面。
   * 调用方只需传业务参数，注入参数由装饰器自动填充。
   *
   * @param comps 需要注入的 DataComp 构造函数列表（顺序对应参数顺序）
   *
   * ─── 使用示例 ──────────────────────────────────────────────────
   *
   * // 1. 只有注入参数，无业务参数
   * @_dataDecorator.dataCompDependency([PlayerBaseDataComp])
   * refreshUI(base: Inject<PlayerBaseDataComp>) {
   *     this.lblName.string  = base.PlayerName;
   *     this.lblLevel.string = String(base.Level);
   * }
   * // 调用：this.refreshUI()
   *
   * // 2. 注入参数 + 业务参数（注入在前，业务在后）
   * @_dataDecorator.dataCompDependency([PlayerBaseDataComp, PlayerItemDataComp])
   * onLevelUp(
   *     base : Inject<PlayerBaseDataComp>,
   *     item : Inject<PlayerItemDataComp>,
   *     newLv: number,                      // ← 手动传入
   * ) {
   *     base.SetLevel(newLv);
   *     item.SetNowSkin(base.RoleID as any);
   * }
   * // 调用：this.onLevelUp(10)  → 实际执行: original(baseInst, itemInst, 10)
   *
   * // 3. 多个 DataComp，无额外参数
   * @_dataDecorator.dataCompDependency([PlayerBaseDataComp, PlayerUnitDataComp])
   * calcPower(
   *     base : Inject<PlayerBaseDataComp>,
   *     unit : Inject<PlayerUnitDataComp>,
   * ): number {
   *     return base.Level * unit.skills.size;
   * }
   * // 调用：const power = this.calcPower()
   * ───────────────────────────────────────────────────────────────
   */
  export function dataCompDependency(
    comps: DataCompConstructor[],
  ): MethodDecorator {
    // 装饰器定义阶段预校验（尽早暴露配置错误）
    assertRegistered(comps, "dataCompDependency");

    return function (
      _target: object,
      methodKey: string | symbol,
      descriptor: PropertyDescriptor,
    ) {
      const original = descriptor.value as Function;
      const methodName = String(methodKey);

      descriptor.value = function (...callArgs: any[]) {
        // 运行时从 DataSys 取最新实例（确保拿到 Proxy 包裹后的对象）
        const injected = comps.map((comp) => {
          const instance = DataSys.Get(comp);
          if (instance == null) {
            throw new Error(
              `[dataCompDependency] 方法 "${methodName}" 注入 "${comp.name}" 失败：` +
                "实例为 null，请确认已调用 DataSys.RegisterWatcher。",
            );
          }
          return instance;
        });

        // 前置注入：[...injectedComps, ...originalCallArgs]
        // 方法签名：(injected0, injected1, ..., businessArg0, businessArg1, ...)
        // 调用方  ：只传 businessArgs，injected 部分由装饰器填充
        return original.apply(this, [...injected, ...callArgs]);
      };
    };
  }
}

// ─────────────────────────────────────────────────────────────────
//  向后兼容导出（保留原名称，防止存量代码编译报错）
//  建议逐步迁移到 _dataDecorator.xxx
// ─────────────────────────────────────────────────────────────────

/** @deprecated 请使用 _dataDecorator.dataComp */
export const DataComp = _dataDecorator.dataComp;

/** @deprecated 请使用 _dataDecorator.dataWatcher */
export const DataWatcherComp = _dataDecorator.dataWatcher;

/** @deprecated 请使用 _dataDecorator.dataCompDependency */
export const DataCompDependency = _dataDecorator.dataCompDependency;

// ── 工具函数（供 DataSys 使用） ───────────────

/**
 * 通过构造函数获取已注册的 DataCompType
 * @deprecated DataSys 内部请改用 DataInfoPool.getCompType
 */
export function GetDataCompConstructorType<T>(ctor: {
  prototype: T;
}): DataCompType {
  return DataInfoPool.getCompType(ctor as Function);
}

/**
 * 通过 DataCompType 获取构造函数
 * @deprecated DataSys 内部请改用 DataInfoPool.getComp(type).ctor
 */
export function GetComConstructor(type: DataCompType): DataCompConstructor {
  return DataInfoPool.getComp(type).ctor;
}
