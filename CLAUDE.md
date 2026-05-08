# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指导。

## 项目概述

Exia Framework 是一个模块化的 Cocos Creator (3.8.x) 游戏开发框架，采用 pnpm monorepo 架构，包含 7 个独立包，均发布在 `@xiacg` 命名空间下。所有代码使用 TypeScript 编写，目标为 ES6。

## 构建命令

```bash
pnpm install              # 安装所有依赖
pnpm build:all            # 按顺序构建所有模块 + 复制 .d.ts 文件
pnpm build                # 构建所有模块（并行，不复制 dts）
pnpm build:core           # 构建单个模块（同理：build:assets, build:event, build:fgui, build:net, build:ccui, build:data）
pnpm clean                # 清除所有 dist/ 目录
```

每个模块通过 Rollup 构建到 `dist/` 目录，产出：ESM (.mjs)、CJS (.cjs)、压缩版 (.min.mjs/.min.cjs) 和类型声明 (.d.ts)。

未配置测试框架，未配置 lint 工具。可在模块目录内使用 `npx tsc --noEmit` 进行类型检查。

## 版本管理与发布

```bash
pnpm version:patch        # 所有模块升级补丁版本号
pnpm publish:all          # 发布所有模块到 npm（需先 npm login）
```

## 架构

**Monorepo 结构** — 根目录下 7 个包，每个包各自拥有 `package.json`、`tsconfig.json`、`rollup.config.mjs` 和 `src/index.ts`：

- **exia-core** — 基础核心：时间工具、GlobalTimer、Platform 平台检测、Screen 屏幕适配、Module 基类、数据结构（BinaryHeap、LinkedList、Stack）、日志、MD5、二进制工具。无外部依赖。
- **exia-event** — 支持优先级的 EventManager、GlobalEvent 单例、Command 命令模式。无外部依赖。
- **exia-assets** — 资源加载与缓存：本地/远程 Sprite 和 Spine 加载器、AssetPool、LocalResManager、RemoteAssetManager。无外部依赖。
- **exia-data** — DataSys 数据管理系统，通过 `@_dataDecorator` 实现组件绑定和自动刷新。无外部依赖。
- **exia-net** — HttpManager（请求/响应/任务）、WebSocket（Ws、WsPacker）、AES 加密。依赖 `crypto-es`。
- **exia-fgui** — 基于 FairyGUI 的 UI 管理：WindowManager、WindowGroup、Window、Header、`@_uidecorator`。依赖 `exia-core`、`fairygui-cc`。
- **exia-ccui** — 原生 Cocos Creator UI 管理：与 exia-fgui 相同的窗口模式，额外支持 Bar/BottomBar。依赖 `exia-core`。

**依赖关系：** `exia-fgui` 和 `exia-ccui` 依赖 `exia-core`，其余模块均独立。

## 关键模式

- **装饰器驱动注册**：UI 组件使用 `@_uidecorator`，数据组件使用 `@_dataDecorator`，在导入时自动向各自的管理器注册。
- **外部 `cc` 模块**：所有模块将 Cocos Creator 的 `cc` 模块视为外部依赖（不打包）。根目录 `rollup.config.base.mjs` 默认 `external` 为 `['cc']`。
- **共享 Rollup 配置**：根目录 `rollup.config.base.mjs` 导出 `createRollupConfig(packageName, external)`，各模块的 `rollup.config.mjs` 调用该函数。
- **`@internal` 剥离**：TSDoc `@internal` 标记的类型会从发布的 `.d.ts` 中排除（通过 `stripInternal: true`）。
- **`copy:dts` 脚本**：将所有生成的 `.d.ts` 文件复制到同级目录 `exia-mcp-lib/exia-framework-mcp/dts/framework/`，供外部 MCP 项目使用。

## TypeScript 注意事项

- `experimentalDecorators: true` — 使用旧版 TS 装饰器，非 TC39 Stage 3 提案。
- `strictNullChecks: false` — null/undefined 可赋值给任意类型。
- 平台类型来自 `@cocos/creator-types/engine` 和 `@cocos/creator-types/editor`。
