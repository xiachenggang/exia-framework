/**
 * @Description: UI 装饰器（扩展版）
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
  /** @internal Bar 装饰器 Map：slot → (ctor → info) */
  const uibarMaps = new Map<string, Map<any, IDecoratorInfo>>();

  export function getWindowMaps()    { return uiclassMap; }
  export function getComponentMaps() { return uicomponentMap; }
  export function getBarMaps(slot: string): Map<any, IDecoratorInfo> {
    let map = uibarMaps.get(slot);
    if (!map) {
      map = new Map();
      uibarMaps.set(slot, map);
    }
    return map;
  }
  /** @deprecated 请使用 getBarMaps('Header') */
  export function getHeaderMaps()    { return getBarMaps("Header"); }
  /** @deprecated 请使用 getBarMaps('BottomBar') */
  export function getBottomBarMaps() { return getBarMaps("BottomBar"); }

  // ─────────────────────────────────────────────
  //  共享 Bar 装饰器工厂
  // ─────────────────────────────────────────────

  function _createBarDecorator(
    slot: string,
    prefabPath: string,
    name: string,
    bundleName: string,
  ): Function {
    return function (ctor: any): any {
      ctor[MetadataKey.originalName] = name;
      const map = getBarMaps(slot);
      map.set(ctor, {
        ctor,
        props:       ctor[MetadataKey.prop]       || null,
        callbacks:   ctor[MetadataKey.callback]   || null,
        transitions: ctor[MetadataKey.transition] || null,
        res: { prefabPath, name, bundleName },
      });
      InfoPool.addBar(slot, ctor, prefabPath, name, bundleName);
      return ctor;
    };
  }

  // ─────────────────────────────────────────────
  //  类装饰器
  // ─────────────────────────────────────────────

  /**
   * 窗口装饰器
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
    return _createBarDecorator("Header", prefabPath, name, bundleName);
  }

  /** BottomBar 装饰器 */
  export function uibottombar(
    prefabPath: string,
    name: string,
    bundleName: string = "resources",
  ): Function {
    return _createBarDecorator("BottomBar", prefabPath, name, bundleName);
  }

  // ─────────────────────────────────────────────
  //  属性装饰器
  // ─────────────────────────────────────────────

  /**
   * 节点属性装饰器 —— 绑定子节点 Node
   */
  export function uiprop(nodePath?: string) {
    return function (target: Object, propName: string): void {
      getObjectProp(target.constructor, MetadataKey.prop)[propName] =
        nodePath ?? propName;
    };
  }

  /**
   * 组件属性装饰器 —— 绑定子节点上的 Component 实例
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
_global["getExiaBottomBarMaps"]  = () => _uidecorator.getBottomBarMaps();
