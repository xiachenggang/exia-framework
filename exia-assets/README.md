# exia-assets

基于 Cocos Creator 的资源加载管理库，提供简单易用的资源加载和批量管理功能。

## 简介

`exia-assets` 是一个专为 Cocos Creator 设计的资源管理库，支持通过路径或 UUID 加载资源，提供批量加载、并行控制、失败重试等功能。资源加载采用手动管理模式，支持按批次卸载资源，适合需要精细控制资源生命周期的场景（如战斗场景切换）。

**核心特性**：

- 📦 支持路径和 UUID 两种方式获取资源
- 🔄 资源加载多次等同于加载一次，避免重复加载
- 🎯 按批次管理资源，支持批量卸载
- ⚡ 支持并行加载控制和失败重试
- 📊 提供加载进度、完成、失败回调
- 🖼️ 支持本地和远程 SpriteFrame 加载与切换
- 🦴 支持本地和远程 Spine 骨骼动画加载与切换
- 🔋 分层架构：加载层 (AssetLoader) → 管理器层 (LocalResManager/RemoteAssetManager) → 组件层 (Loader)

## 安装

```bash
npm install @xiacg/exia-assets
```

## 核心模块

本库采用分层架构，包含本地资源管理和远程资源管理两大体系：

### 本地资源管理（resources/）

| 模块 | 说明 |
|------|------|
| [LocalResManager](src/asset/LocalResManager.ts) | 本地 resources 资源管理器，提供加载去重、引用计数、批量加载等功能 |
| [LocalSpriteLoader](src/asset/LocalSpriteLoader.ts) | 本地 Sprite 图片切换组件，挂在 Sprite 节点上使用 |
| [LocalSpineLoader](src/asset/LocalSpineLoader.ts) | 本地 Spine 骨骼动画切换组件，挂在 sp.Skeleton 节点上使用 |

### 远程资源管理（CDN）

| 模块 | 说明 |
|------|------|
| [RemoteAssetManager](src/asset/RemoteAssetManager.ts) | 远程资源管理器底层，网络请求去重、失败重试、超时控制、LRU 缓存 |
| [RemoteSpriteManager](src/asset/RemoteSpriteManager.ts) | 远程图片纹理池，管理 Texture2D 共享与生命周期 |
| [RemoteSpriteLoader](src/asset/RemoteSpriteLoader.ts) | 远程图片切换组件，挂在 Sprite 节点上使用 |
| [RemoteSpineManager](src/asset/RemoteSpineManager.ts) | 远程 Spine 资源池，管理骨骼数据三件套加载与共享 |
| [RemoteSpineLoader](src/asset/RemoteSpineLoader.ts) | 远程 Spine 骨骼动画切换组件，挂在 sp.Skeleton 节点上使用 |

### 原有模块

| 模块 | 说明 |
|------|------|
| [AssetLoader](src/asset/AssetLoader.ts) | 资源加载器，支持批量加载、并行控制、失败重试 |
| [AssetPool](src/asset/AssetPool.ts) | 全局资源池，提供资源获取和释放功能 |

## 使用说明

### LocalResManager（本地资源管理器）

本地 resources 资源的统一管理，提供加载去重和引用计数功能：

**核心方法**：

- `load<T>(path, type)` - 加载 resources 下的资源（自动去重）
- `loadSpriteFrame(path)` - 加载 SpriteFrame（自动补全 /spriteFrame 后缀）
- `loadFromAtlas(atlasPath, frameName)` - 从 SpriteAtlas 图集中获取指定帧
- `loadSpriteFrames(paths, onProgress?)` - 批量加载 SpriteFrame
- `loadDir(dir)` - 加载目录下全部 SpriteFrame
- `loadSpineData(path)` - 加载 Spine 骨骼数据
- `release(path, type)` - 释放资源（引用计数-1）
- `releaseAll()` - 释放所有缓存资源
- `releaseIdle(maxIdleMs)` - 释放超过指定时长的空闲资源

**导出实例**：`localRes`

### LocalSpriteLoader（本地图片切换组件）

挂在 Sprite 节点上的组件，管理本地图片资源的切换与释放：

**编辑器属性**：
- `initialPath` - 初始图片路径（resources/ 下的路径）
- `autoLoad` - 是否在 onLoad 时自动加载

**核心方法**：
- `loadPath(path)` - 加载并切换图片
- `loadFromAtlas(atlasPath, frameName)` - 从图集加载指定帧
- `clear()` - 清空显示并释放资源

### LocalSpineLoader（本地 Spine 切换组件）

挂在 sp.Skeleton 节点上的组件，管理本地 Spine 资源的切换与释放：

**编辑器属性**：
- `initialPath` - 初始 Spine JSON 路径
- `autoPlayAnimation` - 加载完成后自动播放的动画名
- `autoPlayLoop` - 自动播放是否循环
- `autoLoad` - 是否在 onLoad 时自动加载

**核心方法**：
- `loadPath(path)` - 加载并切换 Spine 资源
- `setAnimation(name, loop, trackIndex)` - 设置当前动画
- `addAnimation(name, loop, delay, trackIndex)` - 添加后续动画
- `setSkin(skinName)` - 设置皮肤
- `getAnimationNames()` - 获取所有动画名
- `getSkinNames()` - 获取所有皮肤名
- `reload()` - 重新加载当前资源
- `clear()` - 清空显示并释放资源

### RemoteAssetManager（远程资源管理器）

远程资源加载的底层基础设施，提供网络请求去重、失败重试、超时控制：

**核心方法**：

- `load<T>(url, options?)` - 加载远程资源
- `configure(opts)` - 配置重试策略、超时、缓存大小
- `addRef(url, options?)` - 手动增加引用
- `release(url, options?)` - 释放资源（引用计数-1）
- `forceRelease(url, options?)` - 强制释放资源
- `releaseAll()` - 释放所有缓存
- `releaseIdle(maxIdleMs)` - 释放空闲资源
- `has(url, opts?)` - 检查资源是否已缓存
- `isLoading(url, opts?)` - 检查资源是否正在加载
- `dump()` - 打印缓存状态

**导出实例**：`remoteAssets`

### RemoteSpriteManager（远程纹理池）

在 RemoteAssetManager 之上管理 Texture2D 的共享与生命周期：

**核心方法**：

- `acquire(url, retry?)` - 获取远程图片的 SpriteHandle
- `acquireBatch(urls, onProgress?)` - 批量获取
- `preload(url)` - 预热到缓存
- `getTextureRefCount(url)` - 获取纹理引用计数
- `purgeAll()` - 清空纹理池和所有缓存
- `dump()` - 打印池状态

**导出实例**：`remoteSpriteManager`

### RemoteSpriteLoader（远程图片切换组件）

挂在 Sprite 节点上的组件，管理远程图片的加载、切换与释放：

**编辑器属性**：
- `initialUrl` - 初始远程图片 URL
- `placeholderColor` - 加载中显示的占位颜色
- `autoLoad` - 是否在 onLoad 时自动加载
- `fadeInDuration` - 加载完成后淡入时长（秒）

**核心方法**：
- `loadUrl(url)` - 加载并切换远程图片
- `clear()` - 清空显示并释放资源
- `reload()` - 强制刷新（清缓存重新下载）

### RemoteSpineManager（远程 Spine 资源池）

管理远程 Spine 骨骼数据的加载、组装与共享：

**核心方法**：

- `acquire(config)` - 获取 SpineHandle
- `preload(config)` - 预加载（不占引用）
- `getRefCount(config)` - 获取引用计数
- `purgeAll()` - 清空资源池
- `dump()` - 打印池状态

**配置项 (SpineLoadConfig)**：
- `skelUrl` - 骨骼数据 URL（必填）
- `atlasUrl` - Atlas 文件 URL（可选，自动推导）
- `textureBaseUrl` - 纹理基础路径（可选，自动推导）

### RemoteSpineLoader（远程 Spine 切换组件）

挂在 sp.Skeleton 节点上的组件，管理远程 Spine 的加载、切换与释放：

**编辑器属性**：
- `initialSkelUrl` - 初始骨骼 JSON/SKEL 的远程 URL
- `initialAtlasUrl` - 初始 Atlas URL
- `autoPlayAnimation` - 加载完成后自动播放的动画名
- `autoPlayLoop` - 自动播放是否循环
- `autoLoad` - 是否在 onLoad 时自动加载

**核心方法**：
- `loadSpine(config)` - 加载并切换 Spine 资源
- `loadUrl(skelUrl, atlasUrl?)` - 便捷方法（只传 URL）
- `setAnimation(name, loop, trackIndex)` - 设置当前动画
- `addAnimation(name, loop, delay, trackIndex)` - 添加后续动画
- `setSkin(skinName)` - 设置皮肤
- `getAnimationNames()` - 获取所有动画名
- `reload()` - 强制刷新
- `clear()` - 清空显示并释放资源

### 典型使用场景

**本地资源加载**：

```typescript
import { localRes } from '@xiacg/exia-assets';

// 加载单个图片
const sf = await localRes.loadSpriteFrame('textures/hero');

// 加载图集子帧
const frame = await localRes.loadFromAtlas('ui/common-atlas', 'btn_close');

// 批量加载
const sprites = await localRes.loadSpriteFrames(['ui/icon1', 'ui/icon2']);

// 释放资源
localRes.releaseSpriteFrame('textures/hero');
```

**本地 Sprite/Atlas 切换**：

```typescript
import { LocalSpriteLoader } from '@xiacg/exia-assets';

// 在 Sprite 节点上挂载 LocalSpriteLoader 组件
// 通过编辑器配置 initialPath 或代码加载
const loader = node.getComponent(LocalSpriteLoader);
await loader.loadPath('textures/player');
await loader.loadFromAtlas('ui/main-atlas', 'hero_001');
```

**远程图片加载**：

```typescript
import { remoteSpriteManager, RemoteSpriteLoader } from '@xiacg/exia-assets';

// 通过管理器获取
const handle = await remoteSpriteManager.acquire('https://cdn.example.com/image.png');
sprite.spriteFrame = handle.spriteFrame;
handle.release();

// 或通过组件（自动管理生命周期）
const loader = node.getComponent(RemoteSpriteLoader);
await loader.loadUrl('https://cdn.example.com/image.png');
```

**远程 Spine 加载**：

```typescript
import { remoteSpineManager, RemoteSpineLoader } from '@xiacg/exia-assets';

// 通过管理器获取
const handle = await remoteSpineManager.acquire({
    skelUrl: 'https://cdn.example.com/spine/hero/hero.json',
    atlasUrl: 'https://cdn.example.com/spine/hero/hero.atlas',
});
skeleton.skeletonData = handle.skeletonData;
handle.release();

// 或通过组件
const loader = node.getComponent(RemoteSpineLoader);
await loader.loadSpine({
    skelUrl: 'https://cdn.example.com/spine/hero/hero.json',
});
```

## 许可证

MIT License

## 作者

**exia** (xiacg)  
**邮箱**: <xiacg@163.com>

## 源码仓库

- [GitHub](https://github.com/xiachenggang/exia-framework.git)
- [npm](https://www.npmjs.com/package/@xiacg/exia-assets)
