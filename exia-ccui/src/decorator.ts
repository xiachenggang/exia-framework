/**
 * @Description: UI 装饰器（纯 TypeScript）
 *
 * 变化说明：
 *  - @uiclass  第二参数由 pkgName 改为 prefabPath（Cocos bundle 内路径，不含扩展名）
 *  - @uiprop   改为工厂形式 @uiprop() 或 @uiprop('nodePath')，支持层级路径
 *  - @uiclick  改为工厂形式 @uiclick('nodePath')，显式指定按钮节点路径
 *  - @uitransition 改为工厂形式 @uitransition('animClipName')
 */

import { InfoPool } from "./core/InfoPool";
import { IDecoratorInfo, MetadataKey } from "./interface/type";

function getObjectProp(obj: Record<string, any>, key: string): any {
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  return (obj[key] = Object.assign({}, obj[key]));
}

export namespace _uidecorator {
  /** @internal */
  const uiclassMap: Map<any, IDecoratorInfo> = new Map();
  /** @internal */
  const uicomponentMap: Map<any, IDecoratorInfo> = new Map();
  /** @internal */
  const uiheaderMap: Map<any, IDecoratorInfo> = new Map();

  export function getWindowMaps() {
    return uiclassMap;
  }
  export function getComponentMaps() {
    return uicomponentMap;
  }
  export function getHeaderMaps() {
    return uiheaderMap;
  }

  // ─────────────────────────────────────────────
  //  类装饰器
  // ─────────────────────────────────────────────

  /**
   * 窗口装饰器
   * @param groupName       窗口组名
   * @param prefabPath      预制体在 bundle 内的路径（不含扩展名），如 "ui/ShopWindow"
   * @param name            注册名（与类名相同，用于防混淆）
   * @param inlinePrefabPaths 额外需要提前加载的预制体路径列表（动态 instantiate 的子预制体）
   * @param bundleName      所在 bundle，默认 "resources"
   *
   * @example
   * @uiclass("MainGroup", "ui/ShopWindow", "ShopWindow")
   * @uiclass("MainGroup", "ui/ShopWindow", "ShopWindow", ["ui/ItemCell"], "mainBundle")
   */
  export function uiclass(
    groupName: string,
    prefabPath: string,
    name: string,
    inlinePrefabPaths?: string[] | string,
    bundleName: string = "resources",
  ): Function {
    return function (ctor: any): any {
      ctor[MetadataKey.originalName] = name;
      const inlines = Array.isArray(inlinePrefabPaths)
        ? inlinePrefabPaths
        : inlinePrefabPaths
          ? [inlinePrefabPaths]
          : [];

      uiclassMap.set(ctor, {
        ctor,
        props: ctor[MetadataKey.prop] || null,
        callbacks: ctor[MetadataKey.callback] || null,
        transitions: ctor[MetadataKey.transition] || null,
        res: {
          group: groupName,
          prefabPath,
          name,
          bundleName,
          inlinePrefabPaths: inlines,
        },
      });

      InfoPool.add(ctor, groupName, prefabPath, name, inlines, bundleName);
      return ctor;
    };
  }

  /**
   * UI 自定义组件装饰器
   * @param prefabPath 预制体路径
   * @param name       注册名
   * @param bundleName 所在 bundle
   */
  export function uicom(
    prefabPath: string,
    name: string,
    bundleName: string = "resources",
  ): Function {
    return function (ctor: any): any {
      ctor[MetadataKey.originalName] = name;
      uicomponentMap.set(ctor, {
        ctor,
        props: ctor[MetadataKey.prop] || null,
        callbacks: ctor[MetadataKey.callback] || null,
        transitions: ctor[MetadataKey.transition] || null,
        res: { prefabPath, name, bundleName },
      });
      InfoPool.addComponent(ctor, prefabPath, name, bundleName);
      return ctor;
    };
  }

  /**
   * Header 装饰器
   * @param prefabPath 预制体路径
   * @param name       注册名
   * @param bundleName 所在 bundle
   */
  export function uiheader(
    prefabPath: string,
    name: string,
    bundleName: string = "resources",
  ): Function {
    return function (ctor: any): any {
      ctor[MetadataKey.originalName] = name;
      uiheaderMap.set(ctor, {
        ctor,
        props: ctor[MetadataKey.prop] || null,
        callbacks: ctor[MetadataKey.callback] || null,
        transitions: ctor[MetadataKey.transition] || null,
        res: { prefabPath, name, bundleName },
      });
      InfoPool.addHeader(ctor, prefabPath, name, bundleName);
      return ctor;
    };
  }

  // ─────────────────────────────────────────────
  //  属性装饰器
  // ─────────────────────────────────────────────

  /**
   * UI 节点属性装饰器（工厂形式）
   * 通过 PropsHelper 在 onInit 前自动将子节点赋值到该属性。
   *
   * @param nodePath 子节点路径（相对于窗口根节点），省略时使用属性名
   *
   * @example
   * @uiprop()                  // 查找名为 "btnClose" 的子节点
   * btnClose: Node;
   *
   * @uiprop('Panel/BtnClose')  // 按路径查找
   * btnClose: Node;
   */
  export function uiprop(nodePath?: string) {
    return function (target: Object, propName: string): void {
      getObjectProp(target.constructor, MetadataKey.prop)[propName] =
        nodePath ?? propName;
    };
  }

  /**
   * 点击事件装饰器（工厂形式）
   * 在 PropsHelper 序列化时自动为指定节点绑定 Button.EventType.CLICK 或 TOUCH_END。
   *
   * @param nodePath 按钮节点路径（相对于窗口根节点）
   *
   * @example
   * @uiclick('btnClose')
   * onBtnCloseClick(): void { this.removeSelf(); }
   *
   * @uiclick('Panel/BtnConfirm')
   * onConfirm(): void { ... }
   */
  export function uiclick(nodePath: string) {
    return function (
      target: Object,
      _name: string,
      descriptor: PropertyDescriptor,
    ): void {
      getObjectProp(target.constructor, MetadataKey.callback)[nodePath] =
        descriptor.value;
    };
  }

  /**
   * 动画装饰器（工厂形式）
   * 将指定动画 clip 名对应的 AnimationState 赋值到属性。
   *
   * @param clipName Animation 组件中的 clip 名称，省略时使用属性名
   *
   * @example
   * @uitransition()          // clip 名 = "openAnim"
   * openAnim: AnimationState;
   *
   * @uitransition('open')    // clip 名 = "open"
   * openAnim: AnimationState;
   */
  export function uitransition(clipName?: string) {
    return function (target: Object, propName: string): void {
      getObjectProp(target.constructor, MetadataKey.transition)[propName] =
        clipName ?? propName;
    };
  }
}

// 全局调试入口（保持与原版一致）
const _global = (globalThis || window || global) as any;
_global["getExiaWindowMaps"] = () => _uidecorator.getWindowMaps();
_global["getExiaComponentMaps"] = () => _uidecorator.getComponentMaps();
_global["getExiaHeaderMaps"] = () => _uidecorator.getHeaderMaps();
