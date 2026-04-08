/**
 * @Description: 窗口容器组件
 * 在编辑器场景中，为每个 UI 层（如 Normal / PopUp / Top）挂载一个此组件。
 * UIModule.onInit 遍历子节点中的 CocosWindowContainer，并依次调用 init(uiRoot)。
 * 每个容器对应一个 WindowGroup，负责管理同层窗口的堆叠和显示。
 */

import { debug } from "@xiacg/exia-core";
import { _decorator, Component, Node, UITransform, view } from "cc";
import { WindowGroup } from "../core/WindowGroup";
import { WindowManager } from "../core/WindowManager";

const { ccclass, property, menu } = _decorator;

@ccclass("CocosWindowContainer")
@menu("exia/UIContainer")
export class CocosWindowContainer extends Component {
  @property({
    displayName: "忽略顶部窗口查询",
    tooltip: "调用 getTopWindow 时是否跳过本组（适用于常驻 HUD 层）",
  })
  ignoreQuery: boolean = false;

  @property({
    displayName: "吞噬触摸事件",
    tooltip: "本组窗口是否拦截触摸，防止穿透到下层",
  })
  swallowTouch: boolean = false;

  /**
   * 初始化容器，创建一个 Node 作为本组所有窗口的父节点，
   * 并向 WindowManager 注册对应的 WindowGroup。
   *
   * @param uiRoot 全局 UI 根节点（由 UIModule 传入）
   * @internal
   */
  public init(uiRoot: Node): void {
    const name = this.node.name;
    debug(
      `\tUIContainer name:${name}` +
        ` ignoreQuery:${this.ignoreQuery}` +
        ` swallowTouch:${this.swallowTouch}`,
    );

    // 为本组创建专属根节点，加入全局 UI 根下
    const root = new Node(name);
    root.layer = uiRoot.layer;

    const uitf = root.addComponent(UITransform);
    const vis = view.getVisibleSize();
    uitf.setContentSize(vis.width, vis.height);
    root.setPosition(0, 0, 0);
    root.active = false; // 无窗口时隐藏本组节点

    uiRoot.addChild(root);

    WindowManager.addWindowGroup(
      new WindowGroup(name, root, this.ignoreQuery, this.swallowTouch),
    );
  }
}
