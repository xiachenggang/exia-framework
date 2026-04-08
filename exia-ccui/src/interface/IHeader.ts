import { AdapterType } from "./type";

export interface IHeader<T = any> {
  name: string;
  adapterType: AdapterType;

  /** @internal */ _init(): void;
  /** @internal */ _close(): void;
  /** @internal */ _adapted(): void;
  /** @internal */ _show(userdata: T): void;
  /** @internal */ _hide(): void;

  isShowing(): boolean;
}
