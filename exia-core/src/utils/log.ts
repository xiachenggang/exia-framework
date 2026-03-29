import { EXIA_DEBUG } from "../header";

function log(...args: any[]): void {
  console.log("exia-framework:", ...args);
}

/**
 * 开启debug模式后 输出调试信息
 * @param args
 */
function debug(...args: any[]): void {
  EXIA_DEBUG && console.log("exia-framework:", ...args);
}

/**
 * 信息性消息 某些浏览器中会带有小图标，但颜色通常与 log 相同
 * @param args
 */
function info(...args: any[]): void {
  EXIA_DEBUG && console.info("exia-framework:", ...args);
}

/**
 * 警告信息 黄色背景，通常带有警告图标
 * @param args
 */
function warn(...args: any[]): void {
  EXIA_DEBUG && console.warn("exia-framework:", ...args);
}

/**
 * 错误消息 红色背景，通常带有错误图标
 * @param args
 */
function error(...args: any[]): void {
  EXIA_DEBUG && console.error("exia-framework:", ...args);
}
export { debug, error, info, log, warn };
