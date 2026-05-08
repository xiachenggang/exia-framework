/**
 * @Description: Bar 数据载体（HeaderInfo / BottomBarInfo 共享实现）
 */

import { MetadataKey } from "../interface/type";
import { Bar } from "./Bar";

type ExtractBarUserData<T> = T extends Bar<infer U> ? U : any;
type ExtractBarInstance<T> = T extends new () => infer R ? R : never;

export class BarInfo<T> {
  name: string;
  /** @internal */
  userdata: T;

  /**
   * 通用工厂方法（内部使用），带自定义 label / decorator 提示
   * @internal
   */
  static _create<T extends new () => Bar<any>>(
    ctor: T,
    userdata: ExtractBarUserData<ExtractBarInstance<T>> | undefined,
    label: string,
    decoratorHint: string,
  ): BarInfo<ExtractBarUserData<ExtractBarInstance<T>>> {
    const name = (ctor as any)[MetadataKey.originalName];
    if (!name) {
      throw new Error(
        `${label}【${ctor.name}】未注册，请使用 ${decoratorHint} 装饰器注册`,
      );
    }
    const info = new BarInfo<ExtractBarUserData<ExtractBarInstance<T>>>();
    info.name = name;
    info.userdata = userdata as any;
    return info;
  }

  /**
   * 非类型安全工厂方法（适用于字符串名称动态创建）
   */
  static createByName<T = any>(name: string, userdata?: T): BarInfo<T> {
    const info = new BarInfo<T>();
    info.name = name;
    info.userdata = userdata as any;
    return info;
  }
}
