import { ISocket, WsData } from "./ISocket";
import { Message, WsPacker } from "./WsPacker";

/** WebSocket类，实现ISocket接口 */
export class Ws implements ISocket {
  private ws: WebSocket | null = null; /** WebSocket对象 */
  /** 连接成功时的回调 */
  onConnected() {}
  /** 收到消息时的回调 */
  onMessage(msg: WsData) {}
  /** 错误处理回调 */
  onError(err: any) {}
  /** 连接关闭时的回调 */
  onClosed() {}
  /**
   * 连接到WebSocket服务器
   * @param urlOrIp URL地址或IP地址
   * @param port 端口号（可选）
   * @returns 是否成功发起连接
   */
  connect(urlOrIp: string, port?: number): boolean {
    if (this.isConnecting) return false;

    const url = port ? `${urlOrIp}:${port}` : urlOrIp;

    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = this.onConnected.bind(this);
      this.ws.onmessage = (event) => this.onMessage(event.data);
      this.ws.onerror = (event) => this.onError(event);
      this.ws.onclose = this.onClosed.bind(this);

      console.log(`start connect ws【${url}】 `);
      return true;
    } catch (error) {
      this.onError(error instanceof Error ? error.message : "Unknown error");
      return false;
    }
  }

  /**
   * 发送数据
   * @param data 指定格式数据
   * @returns 是否发送成功
   */
  send(data: WsData): boolean {
    if (this.isActive) {
      this.ws!.send(data);
      return true;
    }
    return false;
  }

  /**
   * 发送命令和数据
   * @param cmd 主命令码
   * @param buffer 数据
   * @param key 加密密钥（可选）
   * @returns 是否发送成功
   */
  sendBuffer(cmd: number, buffer: Uint8Array, key: string = ""): boolean {
    const message = new Message(cmd, buffer);
    const packedData = WsPacker.Pack(message, key);
    return this.send(packedData);
  }

  /**
   * 关闭WebSocket连接
   * @param code 关闭代码（可选）
   * @param reason 关闭原因（可选）
   */
  close(code?: number, reason?: string): void {
    this.ws?.close(code, reason);
  }

  /**
   * 获取当前连接状态
   * @returns 是否处于活动状态
   */
  get isActive(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 检查是否正在连接
   * @returns 是否正在连接
   */
  private get isConnecting(): boolean {
    return this.ws?.readyState === WebSocket.CONNECTING;
  }
}
