/**
 * @Description: 网络socket
 */

import { sys } from "cc";

type BinaryType = "blob" | "arraybuffer";

interface SocketOptions {
  /**
   * 给原生平台 和 web 用
   * 一个协议字符串或者一个包含协议字符串的数组。
   * 这些字符串用于指定子协议，这样单个服务器可以实现多个 WebSocket 子协议（
   * 例如，你可能希望一台服务器能够根据指定的协议（protocol）处理不同类型的交互。
   * 如果不指定协议字符串，则假定为空字符串。
   */
  protocols?: string[];

  /**
   * 使用 Blob 对象处理二进制数据。这是默认值
   * 使用 ArrayBuffer 对象处理二进制数据
   * @url https://developer.mozilla.org/docs/Web/API/WebSocket/binaryType
   */
  binaryType?: BinaryType;

  /** 超时时间 默认3000毫秒 */
  timeout?: number;
}

export class Socket {
  /**
   * socket对象
   * @internal
   */
  private _socket: WebSocket | WechatMiniprogram.SocketTask;

  /**
   * @param {string} url 要连接的 URL；这应该是 WebSocket 服务器将响应的 URL
   * @param {SocketOptions} options 可选参数 针对不同平台的一些特殊参数 详细信息见定义
   */
  constructor(url: string, options?: SocketOptions) {
    if (sys.platform == sys.Platform.WECHAT_GAME) {
      this._socket = this.createWechatSocket(
        url,
        options?.timeout || 3000,
        options?.protocols,
      );
    } else {
      this._socket = this.createOtherSocket(
        url,
        options?.binaryType,
        options?.timeout || 3000,
        options?.protocols,
      );
    }
  }

  /**
   * 微信小游戏创建socket
   * @internal
   */
  private createWechatSocket(
    url: string,
    timeout?: number,
    protocols?: string[],
  ): WechatMiniprogram.SocketTask {
    let socket = wx.connectSocket({
      url,
      protocols: protocols,
      timeout: timeout,
      success: () => {
        console.log("socket success");
      },
      fail: () => {
        console.warn("socket fail");
      },
    });
    socket.onOpen(() => {
      this.onopen && this.onopen();
    });
    socket.onMessage((res: { data: string | ArrayBuffer }) => {
      this.onmessage && this.onmessage(res.data);
    });
    socket.onError((res: { errMsg: string }) => {
      // 微信上socket和原生平台以及浏览器不一致 所以这里特殊处理 给他一个默认的错误码
      this.onclose?.(1000, res?.errMsg);
    });
    socket.onClose((res: { code: number; reason: string }) => {
      this.onclose?.(res.code, res.reason);
    });
    return socket;
  }

  /**
   * 除微信小游戏、支付宝小游戏、抖音小游戏之外的平台创建socket
   * @internal
   */
  private createOtherSocket(
    url: string,
    binaryType: BinaryType,
    timeout?: number,
    protocols?: string[],
  ): WebSocket {
    let socket = new WebSocket(url, protocols);
    if (binaryType) {
      socket.binaryType = binaryType;
    }

    let timer = setTimeout(() => {
      socket.close();
    }, timeout);

    socket.onopen = () => {
      timer && clearTimeout(timer);
      timer = null;
      this.onopen?.();
    };
    socket.onmessage = (event: MessageEvent) => {
      this.onmessage?.(event.data);
    };
    socket.onerror = () => {
      timer && clearTimeout(timer);
      timer = null;
      this.onerror?.();
    };
    socket.onclose = (event: CloseEvent) => {
      timer && clearTimeout(timer);
      timer = null;
      this.onclose?.(event?.code, event?.reason);
    };
    return socket;
  }

  /**
   * 发送文本数据
   * @param data - 文本数据
   */
  public send(data: string): void {
    if (sys.platform == sys.Platform.WECHAT_GAME) {
      (this._socket as WechatMiniprogram.SocketTask).send({ data: data });
    } else {
      (this._socket as WebSocket).send(data);
    }
  }

  /**
   * 发送二进制数据
   * @param data - 二进制数据
   */
  public sendBuffer(data: ArrayBuffer): void {
    if (sys.platform == sys.Platform.WECHAT_GAME) {
      (this._socket as WechatMiniprogram.SocketTask).send({ data: data });
    } else {
      (this._socket as WebSocket).send(data);
    }
  }

  /**
   * 客户端主动断开
   * @param code - 关闭代码: 如果没有传这个参数，默认使用1000, 客户端可使用的数字范围: [3001-3999]
   * @param reason - 关闭原因: 一个人类可读的字符串，它解释了连接关闭的原因。这个 UTF-8 编码的字符串不能超过 123 个字节
   */
  public close(code?: number, reason?: string): void {
    if (sys.platform == sys.Platform.WECHAT_GAME) {
      (this._socket as WechatMiniprogram.SocketTask).close({
        code: code,
        reason: reason,
      });
    } else {
      (this._socket as WebSocket).close(code, reason);
    }
  }

  /**
   * 获取socket示例
   * 在微信小游戏、支付宝小游戏、抖音小游戏 返回的是他们平台的socket实例类型
   */
  public socket<T>(): T {
    return this._socket as T;
  }

  /**
   * socket已准备好 open成功
   * 当前连接已经准备好发送和接受数据
   */
  public onopen: () => void;

  /**
   * 接收到服务端发送的消息
   * @param data - 消息数据
   */
  public onmessage: (data: string | ArrayBuffer) => void;

  /**
   * 监听可能发生的错误，一般用不到
   */
  public onerror: () => void;

  /**
   * 关闭连接
   * @param code - 关闭代码
   * @param reason - 关闭原因
   */
  public onclose: (code: number, reason: string) => void;
}
