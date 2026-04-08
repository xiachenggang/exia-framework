/**
 * @Description: 窗口类型配置
 */

export let EXIA_DEBUG: boolean = false;

export function enableDebugMode(enable: boolean): void {
  EXIA_DEBUG = enable;
  if (enable) console.warn("调试模式已开启");
}

/** 窗口显示时对其他窗口的处理方式 */
export enum WindowType {
  Normal = 0,
  CloseAll = 1 << 0,
  CloseOne = 1 << 1,
  HideAll = 1 << 2,
  HideOne = 1 << 3,
}

/** 窗口适配类型 */
export enum AdapterType {
  /** 全屏适配 */
  Full = 0,
  /** 刘海屏安全区 */
  Bang = 1,
  /** 固定尺寸，不适配 */
  Fixed = 2,
}

/** 装饰器元数据 key */
export enum MetadataKey {
  /** 属性 → nodePath */
  prop = "__uipropmeta__",
  /** 点击回调 → nodePath */
  callback = "__uicbmeta__",
  /** 动画 */
  transition = "__uitransitionmeta__",
  /** 原始类名（防混淆） */
  originalName = "__UI_ORIGINAL_NAME__",
}

/** 装饰器注册信息 */
export interface IDecoratorInfo {
  ctor: any;
  /** propName → nodePath */
  props: Record<string, string>;
  /** nodePath → handler */
  callbacks: Record<string, Function>;
  /** propName → animClipName */
  transitions: Record<string, string>;
  res: {
    /** Cocos 预制体路径（在 bundle 内，不含扩展名） e.g. "ui/ShopWindow" */
    prefabPath: string;
    /** 窗口注册名（同类名） */
    name: string;
    /** 窗口组名（仅 Window 有） */
    group?: string;
    /** 所在 bundle，默认 "resources" */
    bundleName?: string;
    /** 额外需要同步加载的预制体路径列表 */
    inlinePrefabPaths?: string[];
  };
}
