/**
 * @Description: 窗口顶部资源栏信息
 */

import { MetadataKey } from "../interface/type";
import { Header } from "./Header";

/**
 * 从 Header 类型中提取 UserData 类型
 */
type ExtractHeaderUserData<T> = T extends Header<infer U> ? U : any;

/**
 * 从 Header 构造函数中提取 Header 实例类型
 */
type ExtractHeaderInstance<T> = T extends new () => infer R ? R : never;

export class HeaderInfo<T> {
  /** header名字 */
  name: string;
  /** 自定义数据 用于Header窗口 onShow方法的自定义参数 @internal */
  userdata: T;

  /**
   * 创建 HeaderInfo (类型安全)
   * @param ctor Header类构造函数
   * @param userdata 自定义数据
   * @returns {HeaderInfo}
   */
  static create<T extends new () => Header<any>>(
    ctor: T,
    userdata?: ExtractHeaderUserData<ExtractHeaderInstance<T>>,
  ): HeaderInfo<ExtractHeaderUserData<ExtractHeaderInstance<T>>> {
    // 优先使用装饰器设置的静态属性，避免代码混淆后 constructor.name 变化
    const name = (ctor as any)[MetadataKey.originalName];
    if (!name) {
      throw new Error(
        `header【${ctor.name}】未注册，请使用 _uidecorator.uiheader 注册header`,
      );
    }
    const info = new HeaderInfo<
      ExtractHeaderUserData<ExtractHeaderInstance<T>>
    >();
    info.name = name;
    info.userdata = userdata;
    return info;
  }

  /**
   * 通过名称创建 HeaderInfo (非类型安全)
   * @param name header名称
   * @param userdata 自定义数据
   * @returns {HeaderInfo}
   */
  static createByName<T = any>(name: string, userdata?: T): HeaderInfo<T> {
    const info = new HeaderInfo<T>();
    info.name = name;
    info.userdata = userdata;
    return info;
  }
}
