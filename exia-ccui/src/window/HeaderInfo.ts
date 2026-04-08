/**
 * @Description: 顶部资源栏数据载体
 */

import { MetadataKey } from "../interface/type";
import { Header } from "./Header";

type ExtractHeaderUserData<T> = T extends Header<infer U> ? U : any;
type ExtractHeaderInstance<T> = T extends new () => infer R ? R : never;

export class HeaderInfo<T> {
  name: string;
  /** @internal */
  userdata: T;

  /**
   * 类型安全工厂方法
   * @param ctor    Header 构造函数（需已注册 @uiheader 装饰器）
   * @param userdata 传递给 Header.onShow 的自定义数据
   */
  static create<T extends new () => Header<any>>(
    ctor: T,
    userdata?: ExtractHeaderUserData<ExtractHeaderInstance<T>>,
  ): HeaderInfo<ExtractHeaderUserData<ExtractHeaderInstance<T>>> {
    const name = (ctor as any)[MetadataKey.originalName];
    if (!name) {
      throw new Error(
        `Header【${ctor.name}】未注册，请使用 @uiheader 装饰器注册`,
      );
    }
    const info = new HeaderInfo<
      ExtractHeaderUserData<ExtractHeaderInstance<T>>
    >();
    info.name = name;
    info.userdata = userdata as any;
    return info;
  }

  /**
   * 非类型安全工厂方法（适用于字符串名称动态创建）
   */
  static createByName<T = any>(name: string, userdata?: T): HeaderInfo<T> {
    const info = new HeaderInfo<T>();
    info.name = name;
    info.userdata = userdata as any;
    return info;
  }
}
