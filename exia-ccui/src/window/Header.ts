/**
 * @Description: 顶部资源栏基类（类型区分子类）
 */

import { Bar } from "./Bar";

export abstract class Header<T = any> extends Bar<T> {}
