/** 是否开启调试模式 */
export let EXIA_DEBUG: boolean = false;

/**
 * 启用或禁用调试模式。
 * @param enable - 如果为 true，则启用调试模式；如果为 false，则禁用调试模式。不设置默认不开启
 */
export function enableDebugMode(enable: boolean): void {
  if (enable) {
    EXIA_DEBUG = true;
    console.warn("调试模式已开启");
  } else {
    EXIA_DEBUG = false;
  }
}
/**自定义Size接口 */
export interface Size {
  width: number;
  height: number;
}
