/** 定义WebSocket数据类型 */
export type WsData = string | Blob | ArrayBufferView | ArrayBuffer;

export interface ISocket {
  /** 连接成功时的回调 */
  onConnected: () => void;

  /** 收到消息时的回调 */
  onMessage: (msg: WsData) => void;

  /** 错误处理回调 */
  onError: (error: string) => void;

  /** 连接关闭时的回调 */
  onClosed: () => void;

  /**
   * 连接到WebSocket服务器
   * @param urlOrIp URL地址或IP地址
   * @param port 端口号（可选）
   * @returns 是否成功发起连接
   */
  connect(urlOrIp: string, port?: number): boolean;

  /**
   * 发送数据
   * @param data 要发送的数据
   * @returns 是否成功发送数据
   */
  send(data: WsData): boolean;

  /**
   * 关闭WebSocket连接
   * @param code 关闭代码（可选）
   * @param reason 关闭原因（可选）
   */
  close(code?: number, reason?: string): void;

  /**
   * 获取当前连接状态
   * @returns 是否处于活动状态
   */
  isActive: boolean;
}
