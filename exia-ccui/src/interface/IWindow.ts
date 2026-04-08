import { HeaderInfo } from "../window/HeaderInfo";
import { AdapterType, WindowType } from "./type";

export interface IWindow<TUserData = any, THeaderData = any> {
  name: string;
  type: WindowType;
  adapterType: AdapterType;
  bgAlpha: number;

  /** @internal */
  _init(swallowTouch: boolean): void;
  /** @internal */
  _adapted(): void;
  /** @internal */
  _close(): void;
  /** @internal */
  _show(userdata?: TUserData): void;
  /** @internal */
  _toTop(): void;
  /** @internal */
  _toBottom(): void;
  /** @internal */
  _hide(): void;
  /** @internal */
  _showFromHide(): void;

  isShowing(): boolean;
  isTop(): boolean;

  /** @internal */
  setDepth(depth: number): void;

  getHeaderInfo(): HeaderInfo<any>;
  refreshHeader(): void;
}
