/**
 * @Description: UI 模块（Cocos Component 入口）
 *  - 自建 uiRoot Node
 *  - 半透明遮罩： Node + Graphics 组件，通过 WindowManager.setOverlayNode 注入
 *  - 移除 ui_config（IPropsConfig）字段 —— 新版 @uiprop 装饰器直接绑定，无需编辑器导出 JSON
 *  - 屏幕 resize 监听、遍历 CocosWindowContainer
 */

import { Adapter, debug, Module } from "@xiacg/exia-core";
import { _decorator, Graphics, Node, UITransform, view } from "cc";
import { ResLoader } from "../core/ResLoader";
import { WindowManager } from "../core/WindowManager";
import { CocosWindowContainer } from "./CocosWindowContainer";

const { ccclass, menu, property } = _decorator;

@ccclass("UIModule")
@menu("exia/UIModule")
export class UIModule extends Module {
  @property({
    displayName: "底部遮罩透明度",
    tooltip: "半透明遮罩的默认透明度（0~1）",
    min: 0,
    max: 1,
    step: 0.01,
  })
  bgAlpha: number = 0.75;

  @property({
    displayName: "自动释放 UI 资源",
    tooltip: "窗口关闭时自动释放已加载的 Prefab 资产",
  })
  autoReleaseUIRes: boolean = true;

  public moduleName: string = "UI模块";

  public onInit(): void {
    ResLoader.setAutoRelease(this.autoReleaseUIRes);
    WindowManager.bgAlpha = this.bgAlpha;

    // ── 创建全局 UI 根节点 ──────────────────────
    const uiRoot = new Node("UIRoot");
    uiRoot.layer = this.node.layer; // 继承父节点 layer（通常是 UI_2D）
    this.node.scene.getChildByName("Canvas").addChild(uiRoot);

    const uiRootTf = uiRoot.addComponent(UITransform);
    const visSize = view.getVisibleSize();
    uiRootTf.setContentSize(visSize.width, visSize.height);
    uiRoot.setPosition(visSize.width * 0.5, visSize.height * 0.5, 0);

    // ── 创建半透明遮罩节点（替代原 GGraph）──────
    const overlayNode = new Node("bgAlpha");
    overlayNode.layer = this.node.layer;

    const overlayTf = overlayNode.addComponent(UITransform);
    overlayTf.setContentSize(visSize.width, visSize.height);
    overlayNode.setPosition(0, 0, 0);

    // Graphics 组件用于绘制纯色矩形（adjustAlphaGraph 中调用）
    overlayNode.addComponent(Graphics);
    overlayNode.active = false; // 初始不可见

    uiRoot.addChild(overlayNode);
    WindowManager.setOverlayNode(overlayNode);

    debug("初始化 UIContainers");

    // ── 初始化所有窗口容器 ───────────────────────
    for (const container of this.getComponentsInChildren(
      CocosWindowContainer,
    )) {
      container.init(uiRoot);
    }

    // 容器节点使命完成，清理（与原版一致）
    this.node.destroyAllChildren();

    // ── 屏幕 resize 监听 ─────────────────────────
    Adapter.instance.addResizeListener(this._onScreenResize.bind(this));
  }

  private _onScreenResize(): void {
    WindowManager.onScreenResize();
  }
}
