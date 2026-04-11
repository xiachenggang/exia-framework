/**
 * @Description: UI 装饰器（扩展版）
 *
 * 新增：
 *  @uicomponent(ComponentType, nodePath?)
 *    自动将子节点（或根节点）上的指定 Component 实例绑定到属性，
 *    无需在 onInit 中手动调用 getComponent。
 *
 * 其余装饰器与原版保持一致。
 */

import { Constructor } from "cc";
import { Component } from "cc";
import { InfoPool } from "./core/InfoPool";
import { COMPONENT_META_KEY, IComponentMeta } from "./core/PropsHelper";
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

  export function getWindowMaps()    { return uiclassMap; }
  export function getComponentMaps() { return uicomponentMap; }
  export function getHeaderMaps()    { return uiheaderMap; }

  // ─────────────────────────────────────────────
  //  类装饰器
  // ─────────────────────────────────────────────

  /**
   * 窗口装饰器
   * @param groupName         窗口组名
   * @param prefabPath        预制体在 bundle 内的路径（不含扩展名）
   * @param name              注册名（与类名相同，防混淆）
   * @param inlinePrefabPaths 额外需要提前加载的预制体路径列表
   * @param bundleName        所在 bundle，默认 "resources"
   *
   * @example
   * // 预制体根节点已在编辑器挂好脚本（旧流程，兼容）
   * @uiclass("MainGroup", "ui/ShopWindow", "ShopWindow")
   *
   * // 纯美术预制体，框架自动 addComponent（新流程）
   * @uiclass("MainGroup", "ui/ShopWindow", "ShopWindow")
   * export class ShopWindow extends Window { ... }
   * // _createWindow 发现根节点没有 ShopWindow 组件时，自动 addComponent(ShopWindow)
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
        : inlinePrefabPaths ? [inlinePrefabPaths] : [];

      uiclassMap.set(ctor, {
        ctor,
        props:       ctor[MetadataKey.prop]        || null,
        callbacks:   ctor[MetadataKey.callback]    || null,
        transitions: ctor[MetadataKey.transition]  || null,
        res: { group: groupName, prefabPath, name, bundleName, inlinePrefabPaths: inlines },
      });

      // ctor 本身存入 InfoPool，_createWindow 自动挂载时使用
      InfoPool.add(ctor, groupName, prefabPath, name, inlines, bundleName);
      return ctor;
    };
  }

  /** UI 自定义组件装饰器 */
  export function uicom(
    prefabPath: string,
    name: string,
    bundleName: string = "resources",
  ): Function {
    return function (ctor: any): any {
      ctor[MetadataKey.originalName] = name;
      uicomponentMap.set(ctor, {
        ctor,
        props:       ctor[MetadataKey.prop]       || null,
        callbacks:   ctor[MetadataKey.callback]   || null,
        transitions: ctor[MetadataKey.transition] || null,
        res: { prefabPath, name, bundleName },
      });
      InfoPool.addComponent(ctor, prefabPath, name, bundleName);
      return ctor;
    };
  }

  /** Header 装饰器 */
  export function uiheader(
    prefabPath: string,
    name: string,
    bundleName: string = "resources",
  ): Function {
    return function (ctor: any): any {
      ctor[MetadataKey.originalName] = name;
      uiheaderMap.set(ctor, {
        ctor,
        props:       ctor[MetadataKey.prop]       || null,
        callbacks:   ctor[MetadataKey.callback]   || null,
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
   * 节点属性装饰器 —— 绑定子节点 Node
   *
   * @param nodePath 子节点路径（省略时使用属性名）
   *
   * @example
   * @uiprop()               // 查找名为 "btnClose" 的子节点
   * btnClose: Node;
   *
   * @uiprop('Panel/BtnClose')
   * btnClose: Node;
   */
  export function uiprop(nodePath?: string) {
    return function (target: Object, propName: string): void {
      getObjectProp(target.constructor, MetadataKey.prop)[propName] =
        nodePath ?? propName;
    };
  }

  /**
   * 组件属性装饰器 —— 绑定子节点上的 Component 实例（新增）
   *
   * PropsHelper 会在序列化阶段自动调用 targetNode.getComponent(ComponentType)
   * 并将结果赋值给该属性，无需在 onInit 手动获取。
   *
   * @param componentType  要获取的 Component 类型
   * @param nodePath       子节点路径（省略时在根节点上找该组件）
   *
   * @example
   * // 在根节点上找 Label 组件
   * @uicomponent(Label)
   * titleLabel: Label;
   *
   * // 在子节点 "Panel/LblGold" 上找 Label 组件
   * @uicomponent(Label, 'Panel/LblGold')
   * lblGold: Label;
   *
   * // 在子节点 "BtnBuy" 上找 Button 组件
   * @uicomponent(Button, 'BtnBuy')
   * btnBuy: Button;
   *
   * // 在子节点 "SpineNode" 上找自定义 sp.Skeleton 组件
   * @uicomponent(sp.Skeleton, 'SpineNode')
   * heroSpine: sp.Skeleton;
   */
  export function uicomponent<T extends Component>(
    componentType: Constructor<T>,
    nodePath?: string,
  ) {
    return function (target: Object, propName: string): void {
      const meta: IComponentMeta = { componentType, nodePath };
      getObjectProp(target.constructor, COMPONENT_META_KEY)[propName] = meta;
    };
  }

  /**
   * 点击事件装饰器
   *
   * @param nodePath 按钮节点路径
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
   * 动画装饰器
   *
   * @param clipName Animation 组件中的 clip 名称（省略时使用属性名）
   *
   * @example
   * @uitransition()
   * openAnim: AnimationState;
   *
   * @uitransition('open')
   * openAnim: AnimationState;
   */
  export function uitransition(clipName?: string) {
    return function (target: Object, propName: string): void {
      getObjectProp(target.constructor, MetadataKey.transition)[propName] =
        clipName ?? propName;
    };
  }
}

// 全局调试入口
const _global = (globalThis || window || global) as any;
_global["getExiaWindowMaps"]     = () => _uidecorator.getWindowMaps();
_global["getExiaComponentMaps"]  = () => _uidecorator.getComponentMaps();
_global["getExiaHeaderMaps"]     = () => _uidecorator.getHeaderMaps();
