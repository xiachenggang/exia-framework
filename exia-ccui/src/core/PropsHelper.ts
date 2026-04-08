/**
 * @Description: 属性序列化器
 *
 *  - 直接读取装饰器写入的 节点名/路径 字符串，通过 node.getChildByPath 查找
 *  - 保留 IPropsConfig 接口（可选，用于兼容编辑器插件导出的静态绑定数据）
 */

import { Animation, Button, Component, Node } from "cc";
import { MetadataKey } from "../interface/type";

export class PropsHelper {
  /**
   * 序列化窗口/Header 组件的属性绑定
   * 按装饰器元数据查找子节点并赋值，绑定点击事件，绑定动画片段。
   *
   * @param component WindowBase 或 Header 实例
   */
  static serializeProps(component: Component): void {
    const ctor = component.constructor as any;

    // ── 1. 节点属性绑定（@uiprop）─────────────────
    const props = ctor[MetadataKey.prop] as Record<string, string> | undefined;
    if (props) {
      for (const [propName, nodePath] of Object.entries(props)) {
        const child = component.node.getChildByPath(nodePath);
        if (!child) {
          console.warn(
            `[PropsHelper] 组件【${ctor.name}】属性【${propName}】找不到节点路径【${nodePath}】`,
          );
        }
        (component as any)[propName] = child ?? null;
      }
    }

    // ── 2. 点击事件绑定（@uiclick）─────────────────
    const callbacks = ctor[MetadataKey.callback] as
      | Record<string, Function>
      | undefined;
    if (callbacks) {
      for (const [nodePath, handler] of Object.entries(callbacks)) {
        const child = component.node.getChildByPath(nodePath);
        if (!child) {
          console.warn(
            `[PropsHelper] 组件【${ctor.name}】找不到点击节点路径【${nodePath}】`,
          );
          continue;
        }
        const btn = child.getComponent(Button);
        if (btn) {
          // Cocos Button 点击事件
          btn.node.on(Button.EventType.CLICK, handler, component);
        } else {
          // 无 Button 组件时降级为 TOUCH_END
          child.on(Node.EventType.TOUCH_END, handler, component);
        }
      }
    }

    // ── 3. 动画绑定（@uitransition）───────────────
    const transitions = ctor[MetadataKey.transition] as
      | Record<string, string>
      | undefined;
    if (transitions) {
      // 查找组件自身节点上的 Animation（或第一个子节点上的）
      const anim =
        component.node.getComponent(Animation) ??
        component.node.getComponentInChildren(Animation);
      if (anim) {
        for (const [propName, clipName] of Object.entries(transitions)) {
          const state = anim.getState(clipName);
          if (!state) {
            console.warn(
              `[PropsHelper] 组件【${ctor.name}】找不到动画 clip【${clipName}】`,
            );
          }
          (component as any)[propName] = state ?? null;
        }
      } else {
        console.warn(
          `[PropsHelper] 组件【${ctor.name}】节点上未找到 Animation 组件`,
        );
      }
    }
  }
}
