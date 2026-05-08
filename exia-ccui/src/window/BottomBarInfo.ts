/**
 * @Description: 底部导航栏数据载体
 */

import { BarInfo } from "./BarInfo";
import { BottomBar } from "./BottomBar";

type ExtractBottomBarUserData<T> = T extends BottomBar<infer U> ? U : any;
type ExtractBottomBarInstance<T> = T extends new () => infer R ? R : never;

export class BottomBarInfo<T> extends BarInfo<T> {
  /**
   * 类型安全工厂方法
   * @param ctor    BottomBar 构造函数（需已注册 @uibottombar 装饰器）
   * @param userdata 传递给 BottomBar.onShow 的自定义数据
   */
  static create<T extends new () => BottomBar<any>>(
    ctor: T,
    userdata?: ExtractBottomBarUserData<ExtractBottomBarInstance<T>>,
  ): BottomBarInfo<ExtractBottomBarUserData<ExtractBottomBarInstance<T>>> {
    return BarInfo._create(ctor, userdata, "BottomBar", "@uibottombar") as BottomBarInfo<
      ExtractBottomBarUserData<ExtractBottomBarInstance<T>>
    >;
  }

  /**
   * 非类型安全工厂方法（适用于字符串名称动态创建）
   */
  static createByName<T = any>(name: string, userdata?: T): BottomBarInfo<T> {
    return BarInfo.createByName(name, userdata) as BottomBarInfo<T>;
  }
}
