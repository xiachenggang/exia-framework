# exia-data

轻量级数据系统，提供全局数据管理和数据组件。

## 简介

`exia-data` 是一个轻量级、高性能的数据系统，提供全局数据管理和数据组件。

**核心特性**：

- 数据组件和数据观察者机制
- 数据组件自动更新
- 支持数据装饰器
- 完整的数据装卸
- 简洁的操作和定义数据

## 安装

```bash
npm install @xiacg/exia-data
```

## 使用说明

### 数据 装饰器

使用装饰器简化数据组件定义和配置。

**数据组件装饰器**：

- `@_dataDecorator.dataComp(PlayerDataCompType)` - 注册数据组件
  - `PlayerDataCompType` - 数据组件类型

**数据观察者装饰器**：

- `@_dataDecorator.dataWatcher(PlayerBaseDataComp, PlayerItemDataComp, PlayerUnitDataComp)` - 注册数据观察者需要的数据组件类型
  - 用于定义数据观察者需要的数据组件类型

**DataComp 前置注入装饰器（方法级）**：

- `@_dataDecorator.dataCompDependency([PlayerBaseDataComp])` - 只有注入参数，无业务参数
  - 用于方法需要注入的数据组件

### DataSys

数据组件和观察者管理系统

**主要方法**：

- `Get<T>(ctor: new () => T): T` - 获取 DataComp 或 DataWatcher 实例
- `RegisterWatcher<T>(ctor: new () => T): T` - 注册数据观察者
- `AutoWatcher()` - 自观察 flush 方法。

详细 API 请查看 `exia-data.d.ts` 类型定义文件。

## 依赖

无外部依赖

## 许可证

MIT License

## 作者

**xiacg** (xiacg)  
**邮箱**: <xiacg@163.com>

## 源码仓库

- [GitHub](https://github.com/xiachenggang/exia-framework.git)
- [npm](https://www.npmjs.com/package/@xiacg/exia-data)
