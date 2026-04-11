/**
 * @Description: 属性序列化器（扩展版）
 *
 * 新增：
 *  - @uicomponent(ComponentType, nodePath?) 绑定子节点上的 Component 实例
 *    原 @uiprop 只能绑定 Node，新装饰器直接拿到对应组件，无需再手动 getComponent
 *
 * 保留：
 *  - @uiprop   → 绑定子节点 Node
 *  - @uiclick  → 绑定点击事件（Button 或 TOUCH_END 降级）
 *  - @uitransition → 绑定 AnimationState
 */

import { Animation, Button, Component, Node, Constructor } from "cc";
import { MetadataKey } from "../interface/type";

// ─────────────────────────────────────────────
// 新增元数据 key（与现有 key 互不冲突）
// ─────────────────────────────────────────────
export const COMPONENT_META_KEY = "__uicomponentmeta__";

/**
 * 单条 @uicomponent 元数据
 * propName → { componentType, nodePath }
 */
export interface IComponentMeta {
  componentType: Constructor<Component>;
  /** 子节点路径，省略时在根节点上找该组件 */
  nodePath?: string;
}

export class PropsHelper {

  /**
   * 序列化窗口/Header 组件的全部装饰器绑定
   * 调用顺序：节点绑定 → 组件绑定 → 点击事件 → 动画
   *
   * @param component WindowBase 或 Header 实例
   */
  static serializeProps(component: Component): void {
    const ctor = component.constructor as any;

    // ── 1. 节点属性绑定（@uiprop）─────────────────────────
    const props = ctor[MetadataKey.prop] as Record<string, string> | undefined;
    if (props) {
      for (const [propName, nodePath] of Object.entries(props)) {
        const child = component.node.getChildByPath(nodePath);
        if (!child) {
          console.warn(
            `[PropsHelper] 【${ctor.name}】@uiprop "${propName}" ` +
            `找不到节点路径 "${nodePath}"`,
          );
        }
        (component as any)[propName] = child ?? null;
      }
    }

    // ── 2. 组件属性绑定（@uicomponent）────────────────────
    //    propName → { componentType, nodePath? }
    const comps = ctor[COMPONENT_META_KEY] as
      | Record<string, IComponentMeta>
      | undefined;
    if (comps) {
      for (const [propName, meta] of Object.entries(comps)) {
        const targetNode = meta.nodePath
          ? component.node.getChildByPath(meta.nodePath)
          : component.node;

        if (!targetNode) {
          console.warn(
            `[PropsHelper] 【${ctor.name}】@uicomponent "${propName}" ` +
            `找不到节点路径 "${meta.nodePath}"`,
          );
          (component as any)[propName] = null;
          continue;
        }

        const comp = targetNode.getComponent(meta.componentType);
        if (!comp) {
          console.warn(
            `[PropsHelper] 【${ctor.name}】@uicomponent "${propName}" ` +
            `节点 "${meta.nodePath ?? '(root)'}" 上未找到组件 ` +
            `"${meta.componentType.name}"`,
          );
        }
        (component as any)[propName] = comp ?? null;
      }
    }

    // ── 3. 点击事件绑定（@uiclick）────────────────────────
    const callbacks = ctor[MetadataKey.callback] as
      | Record<string, Function>
      | undefined;
    if (callbacks) {
      for (const [nodePath, handler] of Object.entries(callbacks)) {
        const child = component.node.getChildByPath(nodePath);
        if (!child) {
          console.warn(
            `[PropsHelper] 【${ctor.name}】@uiclick ` +
            `找不到节点路径 "${nodePath}"`,
          );
          continue;
        }
        const btn = child.getComponent(Button);
        if (btn) {
          btn.node.on(Button.EventType.CLICK, handler, component);
        } else {
          child.on(Node.EventType.TOUCH_END, handler, component);
        }
      }
    }

    // ── 4. 动画绑定（@uitransition）───────────────────────
    const transitions = ctor[MetadataKey.transition] as
      | Record<string, string>
      | undefined;
    if (transitions) {
      const anim =
        component.node.getComponent(Animation) ??
        component.node.getComponentInChildren(Animation);
      if (anim) {
        for (const [propName, clipName] of Object.entries(transitions)) {
          const state = anim.getState(clipName);
          if (!state) {
            console.warn(
              `[PropsHelper] 【${ctor.name}】@uitransition ` +
              `找不到动画 clip "${clipName}"`,
            );
          }
          (component as any)[propName] = state ?? null;
        }
      } else {
        console.warn(
          `[PropsHelper] 【${ctor.name}】节点上未找到 Animation 组件`,
        );
      }
    }
  }
}
