/**
 * @Description: 核心类型定义
 */

export interface IWindowInfo {
  ctor: any;
  /** 窗口组名 */
  group: string;
  /** 预制体路径（bundle 内，不含扩展名） */
  prefabPath: string;
  /** 所在 bundle，默认 "resources" */
  bundleName: string;
  /** 窗口注册名 */
  name: string;
  /** 需要同步加载的额外预制体路径 */
  inlinePrefabPaths: string[];
}

export interface IHeaderInfo {
  ctor: any;
  /** Header 预制体路径 */
  prefabPath: string;
  /** 所在 bundle */
  bundleName: string;
}
