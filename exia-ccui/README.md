# exia-ccui

基于 Cocos Creator 3.8 的 UI 框架，提供灵活的窗口管理和装饰器支持。

## 简介

`exia-ccui` 是基于 Cocos Creator 3.8 的 UI 框架，提供窗口生命周期管理、资源自动加载与引用计数卸载、多窗口组管理、Header 复用等功能。支持配套的可视化编辑器一键导出界面配置。

**核心特性**：

- 灵活的 UI 装饰器（窗口、Header、组件、属性、事件、动画）
- 完整的窗口生命周期管理
- Prefab 资源自动加载与引用计数卸载
- 窗口间关系控制（隐藏/关闭前一个界面）
- 多窗口组（WindowGroup）管理
- Header 资源栏复用（多窗口共享同一 Header）
- 半透明遮罩层自动管理
- 配套可视化编辑器（插件）

**依赖**：

- Cocos Creator 3.8 - [官方文档](https://docs.cocos.com/creator/3.8/manual/zh/)
- [@xiacg/exia-core](https://www.npmjs.com/package/@xiacg/exia-core) - 核心模块（Module 基类）

## 安装

```bash
npm install @xiacg/exia-ccui
```

## 使用说明

### UI 装饰器

所有装饰器位于 `_uidecorator` 命名空间中，使用装饰器简化 UI 组件定义和配置。

**窗口装饰器**：

- `@uiclass(groupName, prefabPath, name, inlinePrefabPaths?, bundleName?)` - 注册窗口类
  - `groupName` - 窗口组名称（对应 CocosWindowContainer 的名称）
  - `prefabPath` - Prefab 资源路径
  - `name` - 组件名（必须和类名相同）
  - `inlinePrefabPaths` - 内联 Prefab 路径（可选，`string | string[]`，当前界面引用其他 Prefab 资源时使用）
  - `bundleName` - 所在 Bundle 名称（可选，默认 `"resources"`）

**Header 装饰器**：

- `@uiheader(prefabPath, name, bundleName?)` - 注册 Header 类
  - `prefabPath` - Prefab 资源路径
  - `name` - 组件名
  - `bundleName` - 所在 Bundle 名称（可选，默认 `"resources"`）

**UI 组件装饰器**：

- `@uicom(prefabPath, name, bundleName?)` - 注册自定义 UI 组件类
  - `prefabPath` - Prefab 资源路径
  - `name` - 组件名
  - `bundleName` - 所在 Bundle 名称（可选，默认 `"resources"`）

**属性装饰器**：

- `@uiprop(nodePath?)` - 绑定子节点（Node 类型），通过节点路径查找
- `@uicomponent<T>(componentType, nodePath?)` - 绑定组件实例，自动通过 `getComponent()` 获取指定类型的组件
- `@uitransition(clipName?)` - 绑定动画状态（AnimationState），从 Animation 组件获取

**事件装饰器**：

- `@uiclick(nodePath)` - 绑定点击事件处理函数（优先使用 Button 组件的 CLICK 事件，无 Button 时降级为 Node 的 TOUCH_END 事件）

### 窗口基类 (Window)

所有窗口继承自 `Window`（`Window` 继承自 `WindowBase`，`WindowBase` 继承自 Cocos `Component`）。

**属性**：

- `type: WindowType` - 窗口类型，默认 `WindowType.Normal`
- `adapterType: AdapterType` - 适配类型，默认 `AdapterType.Full`
- `bgAlpha: number` - 背景遮罩透明度，默认 `0`（大于 0 时显示半透明遮罩）

**必须实现的生命周期方法**：

- `onInit()` - 窗口初始化（仅首次创建时调用）
- `onShow(userdata?)` - 窗口显示
- `onClose()` - 窗口关闭销毁

**可选覆盖的生命周期方法**（默认空实现）：

- `onHide()` - 窗口被隐藏
- `onShowFromHide()` - 从隐藏状态恢复显示
- `onToTop()` - 窗口到顶层
- `onToBottom()` - 窗口被其他窗口覆盖
- `onEmptyAreaClick()` - 点击空白区域（吞噬触摸节点的点击事件）
- `onAdapted()` - 窗口适配完成

**公开方法**：

- `isShowing(): boolean` - 当前是否显示
- `isTop(): boolean` - 当前是否在最顶层
- `getHeaderInfo(): HeaderInfo | null` - 返回关联的 Header 信息（默认返回 `null`，需覆盖）
- `refreshHeader()` - 刷新当前窗口的 Header
- `removeSelf()` - 关闭自身（protected）

### HeaderInfo

Header 信息数据类，用于窗口与 Header 的关联。

**工厂方法**：

- `HeaderInfo.create<T>(headerClass, userdata?)` - 类型安全的创建方式，参数为 Header 类（构造函数）
- `HeaderInfo.createByName<T>(name, userdata?)` - 通过名称创建

### Header 基类 (Header)

窗口顶部资源栏基类（继承自 Cocos `Component`），支持多窗口复用同一个 Header 实例。

**属性**：

- `adapterType: AdapterType` - 适配类型，默认 `AdapterType.Full`

**必须实现的生命周期方法**：

- `onInit()` - Header 初始化
- `onShow(userdata?)` - Header 显示

**可选覆盖的生命周期方法**（默认空实现）：

- `onHide()` - Header 隐藏
- `onClose()` - Header 关闭
- `onShowFromHide()` - 从隐藏状态恢复
- `onAdapted()` - 适配完成

**公开方法**：

- `isShowing(): boolean` - 当前是否显示

### 窗口管理器 (WindowManager)

全局静态窗口管理器，负责窗口的创建、显示、关闭等。

**配置方法**：

- `setOverlayNode(node)` - 设置遮罩层节点
- `setPackageCallbacks(callbacks)` - 设置资源加载回调
  - `callbacks.showWaitWindow` - 显示加载等待窗口
  - `callbacks.hideWaitWindow` - 隐藏加载等待窗口
  - `callbacks.fail` - 加载失败回调
- `addManualPath(prefabPath)` - 添加手动管理资源的 Prefab 路径（不自动加载/卸载）
- `setPackageInfo(prefabPath, bundleName)` - 设置 Prefab 所在的 Bundle 名称
- `bgAlpha` - 全局背景遮罩透明度（getter/setter）

**窗口操作**：

- `showWindow<T>(windowClass, userdata?): Promise<Window>` - 异步打开窗口（自动加载资源）
  - 参数是窗口类（构造函数），非窗口名称
- `closeWindow<T>(windowClass)` - 关闭窗口（通过窗口类）
- `closeWindowByName(name)` - 关闭窗口（通过窗口名称）
- `getWindow<T>(name): T | undefined` - 获取窗口实例
- `getTopWindow<T>(isAll?): T | null` - 获取最顶层窗口
- `hasWindow(name): boolean` - 检查窗口是否存在

**窗口组操作**：

- `getGroupNames(): string[]` - 获取所有窗口组名称
- `getWindowGroup(name): WindowGroup` - 获取指定窗口组
- `addWindowGroup(group)` - 注册窗口组（通常由 CocosWindowContainer 自动调用）
- `closeAllWindow(ignores?)` - 关闭所有窗口（可排除指定窗口）
- `releaseUnusedRes()` - 释放不再使用的 UI 资源

### 窗口组 (WindowGroup)

窗口组管理类，每个 CocosWindowContainer 对应一个 WindowGroup。

**构造函数**：

- `new WindowGroup(name, root, ignoreQuery, swallowTouch)`
  - `name` - 组名称
  - `root` - 根节点
  - `ignoreQuery` - 是否在查询顶层窗口时忽略此组
  - `swallowTouch` - 组内窗口是否吞噬触摸事件

**属性**：

- `name: string` - 组名称
- `root: Node` - 根节点
- `size: number` - 当前窗口数量
- `windowNames: string[]` - 所有窗口名称
- `isIgnore: boolean` - 是否忽略查询

**方法**：

- `showWindow<T, U>(info, userdata?): Promise<IWindow>` - 在组内显示窗口
- `removeWindow(name)` - 移除窗口
- `closeAllWindow(ignores)` - 关闭组内所有窗口
- `hasWindow(name): boolean` - 检查窗口是否在组内
- `getTopWindow<T>(): T | null` - 获取组内最顶层窗口

### 引擎组件

**UIModule** - UI 模块（继承自 `@xiacg/exia-core` 的 `Module`）

Cocos Creator 编辑器组件，用于初始化 UI 系统。

- `bgAlpha: number` - 全局背景遮罩透明度（编辑器属性，默认 `0.75`）
- `autoReleaseUIRes: boolean` - 是否自动释放 UI 资源（编辑器属性，默认 `true`）

**CocosWindowContainer** - 窗口容器组件

Cocos Creator 编辑器组件，挂载到节点上作为窗口组容器。

- `ignoreQuery: boolean` - 查询顶层窗口时是否忽略此容器（编辑器属性，默认 `false`）
- `swallowTouch: boolean` - 窗口是否吞噬触摸事件（编辑器属性，默认 `false`）

### 窗口类型 (WindowType)

定义窗口显示时对其他窗口的处理方式（位标志枚举，可组合使用）：

- `Normal = 0` - 不做任何处理
- `CloseAll = 1` - 关闭所有窗口
- `CloseOne = 2` - 关闭上一个窗口
- `HideAll = 4` - 隐藏所有窗口
- `HideOne = 8` - 隐藏上一个窗口

### 适配类型 (AdapterType)

窗口/Header 适配类型：

- `Full = 0` - 全屏适配（默认）
- `Bang = 1` - 空出刘海区域
- `Fixed = 2` - 固定尺寸，不适配

### 调试模式

- `enableDebugMode(enable: boolean)` - 启用/禁用调试模式日志输出

### 典型使用流程

1. **场景搭建** - 在 Cocos Creator 编辑器中，添加 `UIModule` 组件到场景节点，添加 `CocosWindowContainer` 子节点作为窗口容器
2. **定义窗口类** - 继承 `Window` 并使用 `@uiclass` 装饰器注册
3. **配置属性和事件** - 使用 `@uiprop`、`@uicomponent`、`@uiclick`、`@uitransition` 标记
4. **关联 Header（可选）** - 覆盖 `getHeaderInfo()` 方法，返回 `HeaderInfo.create(MyHeader, data)`
5. **配置加载回调（可选）** - 调用 `WindowManager.setPackageCallbacks()` 设置等待窗口和失败回调
6. **打开窗口** - 调用 `WindowManager.showWindow(MyWindow, userdata)`
7. **管理生命周期** - 实现窗口的 `onInit`、`onShow`、`onClose` 等生命周期方法

### 示例代码

```typescript
import { _uidecorator, Window, WindowManager, HeaderInfo, WindowType, AdapterType } from "@xiacg/exia-ccui";
const { uiclass, uiprop, uiclick, uicomponent, uitransition } = _uidecorator;

@uiclass("main", "prefabs/MyWindow", "MyWindow")
class MyWindow extends Window<{ msg: string }> {
    type = WindowType.HideOne;
    adapterType = AdapterType.Full;
    bgAlpha = 0.5;

    @uiprop("title")
    titleNode: Node;

    @uiclick("btnClose")
    onCloseClick() {
        this.removeSelf();
    }

    onInit() {
        // 初始化逻辑
    }

    onShow(userdata?: { msg: string }) {
        // 显示逻辑
    }

    onClose() {
        // 清理逻辑
    }

    getHeaderInfo() {
        return HeaderInfo.create(MyHeader, { coins: 100 });
    }
}

// 打开窗口
await WindowManager.showWindow(MyWindow, { msg: "hello" });

// 关闭窗口
WindowManager.closeWindow(MyWindow);
```

详细 API 请查看 `exia-ccui.d.ts` 类型定义文件和 [Cocos Creator 官方文档](https://docs.cocos.com/creator/3.8/manual/zh/)。

## 依赖

- [Cocos Creator 3.8](https://docs.cocos.com/creator/3.8/manual/zh/) - 游戏引擎
- [@xiacg/exia-core](https://www.npmjs.com/package/@xiacg/exia-core) - 核心模块

## 许可证

MIT License

## 作者

**exia** (xiacg)
**邮箱**: <xiacg@163.com>

## 源码仓库

- [GitHub](https://github.com/xiachenggang/exia-framework.git)
- [npm](https://www.npmjs.com/package/@xiacg/exia-ccui)
