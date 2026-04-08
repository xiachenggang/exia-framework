export type EntityIndex = number;
export type ComPoolIndex = number;

// ─────────────────────────────────────────────────────────────────
//  DataCompType：开放字符串类型
//
//  核心系统不再持有任何业务类型枚举。
//  各业务模块在自己的目录下定义类型常量（const 对象），
//  通过 @_dataDecorator.dataComp(MyModuleDataCompType.FooComp) 注册。
//
//  示例布局：
//    data/player/PlayerDataCompType.ts  ← 玩家模块类型
//    data/guild/GuildDataCompType.ts    ← 公会模块类型
//    data/hero/HeroDataCompType.ts      ← 英雄模块类型
//    ...（各模块自持，互不依赖）
//
//  唯一约束：同一进程内所有模块的类型字符串值不能重复，
//  建议按模块号段划分（见各模块类型文件注释）。
// ─────────────────────────────────────────────────────────────────
export type DataCompType = string;

/** DataWatcher 类型前缀（内部使用，生成 watcherKey） */
export const WatcherType = "10000";

// ─────────────────────────────────────────────────────────────────
//  装饰器元数据 key
//  写入构造函数静态属性，打包混淆后 constructor.name 变化也不影响查找。
// ─────────────────────────────────────────────────────────────────
export enum DataMetadataKey {
  /** DataComp 的类型字符串，对应各模块 DataCompType 常量的值 */
  compType = "__DATA_COMP_TYPE__",
  /** DataWatcher 的唯一 key，格式 "10000_<firstCompType>" */
  watcherKey = "__DATA_WATCHER_KEY__",
  /** DataWatcher 持有的 compType 列表 string[] */
  compList = "__DATA_COMP_LIST__",
  /** 防混淆：类的原始名称 */
  originalName = "__DATA_ORIGINAL_NAME__",
}
