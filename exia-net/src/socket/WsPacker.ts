import { Crypto } from "../crypto/Crypto";

/** 消息结构 */
export class Message {
  constructor(
    public Cmd: number,
    public Data: Uint8Array,
  ) {}
}
/** 消息编码器，提供WebSocket消息的编码加密和解码解密功能 */
export class WsPacker {
  /**
   * 消息打包（使用大端序）
   * @param msg 要打包的消息
   * @param key 加密密钥（可选）
   * @returns 打包后的字节数组
   */
  public static Pack(msg: Message, key: string = ""): Uint8Array {
    if (!msg) throw new Error("msg is not empty");

    const data = key ? Crypto.byteEncrypt(msg.Data, key) : msg.Data;
    const buffer = new Uint8Array(4 + data.length);
    this.setUint32(buffer, 0, msg.Cmd);
    buffer.set(data, 4);
    return buffer;
  }

  /**
   * 消息解包（使用大端序）
   * @param buffer 要解包的字节数组
   * @param key 解密密钥（可选）
   * @returns 解包后的消息
   */
  public static Unpack(buffer: Uint8Array, key: string = ""): Message {
    if (buffer.length < 4) throw new Error("message length is not enough");
    const cmd = this.getUint32(buffer, 0);
    const data = key
      ? Crypto.byteDecrypt(buffer.slice(4), key)
      : buffer.slice(4);
    return new Message(cmd, data);
  }

  /**
   * 通过 DataView 设置 Uint32 值（大端序）
   * @param buffer 目标缓冲区
   * @param offset 偏移量
   * @param value 要设置的值
   */
  private static setUint32(buffer: Uint8Array, offset: number, value: number) {
    new DataView(buffer.buffer).setUint32(offset, value, false);
  }

  /**
   * 通过 DataView 获取 Uint32 值（大端序）
   * @param buffer 源缓冲区
   * @param offset 偏移量
   * @returns 获取的值
   */
  private static getUint32(buffer: Uint8Array, offset: number): number {
    return new DataView(buffer.buffer).getUint32(offset, false);
  }
}
