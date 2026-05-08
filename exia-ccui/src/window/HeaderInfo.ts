/**
 * @Description: 顶部资源栏数据载体
 */

import { BarInfo } from "./BarInfo";
import { Header } from "./Header";

type ExtractHeaderUserData<T> = T extends Header<infer U> ? U : any;
type ExtractHeaderInstance<T> = T extends new () => infer R ? R : never;

export class HeaderInfo<T> extends BarInfo<T> {
  /**
   * 类型安全工厂方法
   * @param ctor    Header 构造函数（需已注册 @uiheader 装饰器）
   * @param userdata 传递给 Header.onShow 的自定义数据
   */
  static create<T extends new () => Header<any>>(
    ctor: T,
    userdata?: ExtractHeaderUserData<ExtractHeaderInstance<T>>,
  ): HeaderInfo<ExtractHeaderUserData<ExtractHeaderInstance<T>>> {
    return BarInfo._create(ctor, userdata, "Header", "@uiheader") as HeaderInfo<
      ExtractHeaderUserData<ExtractHeaderInstance<T>>
    >;
  }

  /**
   * 非类型安全工厂方法（适用于字符串名称动态创建）
   */
  static createByName<T = any>(name: string, userdata?: T): HeaderInfo<T> {
    return BarInfo.createByName(name, userdata) as HeaderInfo<T>;
  }
}
