import CryptoES from "crypto-es";
export class Crypto {
  /**
   * 文本加密函数
   * @param plainText 明文文本
   * @param key 加密密钥
   * @returns 加密后的Base64字符串
   */
  public static strEncrypt(plainText: string, key: string): string {
    const keyString = this.getKeyString(key);
    const iv = this.generateRandomIV();

    const cipherText = CryptoES.AES.encrypt(plainText, keyString, {
      mode: CryptoES.mode.CBC,
      padding: CryptoES.pad.ZeroPadding,
      iv: iv,
    });
    const combined = iv.concat(cipherText.ciphertext);
    return CryptoES.enc.Base64.stringify(combined);
  }

  /**
   * 文本解密函数
   * @param cipherText 密文文本
   * @param key 解密密钥
   * @returns 解密后的明文
   */
  public static strDecrypt(cipherText: string, key: string): string {
    const keyString = this.getKeyString(key);
    const cipherTextBytes = CryptoES.enc.Base64.parse(cipherText);

    const iv = CryptoES.lib.WordArray.create(
      cipherTextBytes.words.slice(0, 4),
      16,
    );
    const encryptedText = CryptoES.lib.WordArray.create(
      cipherTextBytes.words.slice(4),
      cipherTextBytes.sigBytes - 16,
    );

    const decrypted = CryptoES.AES.decrypt(
      { ciphertext: encryptedText },
      keyString,
      {
        mode: CryptoES.mode.CBC,
        padding: CryptoES.pad.ZeroPadding,
        iv: iv,
      },
    );
    return decrypted.toString(CryptoES.enc.Utf8);
  }

  /**
   * 二进制数据加密函数
   * @param data 要加密的二进制数据
   * @param key 加密密钥
   * @returns 加密后的二进制数据
   */
  public static byteEncrypt(data: Uint8Array, key: string): Uint8Array {
    const keyString = this.getKeyString(key);
    const iv = this.generateRandomIV();

    const cipherText = CryptoES.AES.encrypt(
      CryptoES.lib.WordArray.create(data),
      keyString,
      {
        mode: CryptoES.mode.CBC,
        padding: CryptoES.pad.ZeroPadding,
        iv: iv,
      },
    );

    const combined = iv.concat(cipherText.ciphertext);
    return this.wordArrayToUint8Array(combined);
  }

  /**
   * 二进制数据解密函数
   * @param data 要解密的二进制数据
   * @param key 解密密钥
   * @returns 解密后的二进制数据
   */
  public static byteDecrypt(data: Uint8Array, key: string): Uint8Array {
    const keyString = this.getKeyString(key);
    const wordArray = this.uint8ArrayToWordArray(data);

    const iv = CryptoES.lib.WordArray.create(wordArray.words.slice(0, 4), 16);
    const encryptedText = CryptoES.lib.WordArray.create(
      wordArray.words.slice(4),
      wordArray.sigBytes - 16,
    );

    const decrypted = CryptoES.AES.decrypt(
      { ciphertext: encryptedText },
      keyString,
      {
        mode: CryptoES.mode.CBC,
        padding: CryptoES.pad.ZeroPadding,
        iv: iv,
      },
    );

    return this.wordArrayToUint8Array(decrypted);
  }

  /**
   * AES 加密
   */
  public static aesEncrypt(msg: string, key: string, iv: string): string {
    let encrypt = CryptoES.AES.encrypt(msg, this.utf8Parse(key), {
      iv: this.utf8Parse(iv),
      mode: CryptoES.mode.CBC,
      padding: CryptoES.pad.Pkcs7,
    });
    return encrypt.toString();
  }

  /**
   * AES 解密
   * @param str
   * @param key
   * @param iv
   * @returns
   */
  public static aesDecrypt(str: string, key: string, iv: string): string {
    let decrypt = CryptoES.AES.decrypt(str, this.utf8Parse(key), {
      iv: this.utf8Parse(iv),
      mode: CryptoES.mode.CBC,
      padding: CryptoES.pad.Pkcs7,
    });
    return CryptoES.enc.Utf8.stringify(decrypt);
  }

  private static utf8Parse(utf8Str: string): CryptoES.lib.WordArray {
    return CryptoES.enc.Utf8.parse(utf8Str);
  }

  /**
   * 生成随机 IV
   * @returns 随机生成的 IV
   */
  private static generateRandomIV(): CryptoES.lib.WordArray {
    const iv = new Uint8Array(16);
    crypto.getRandomValues(iv);
    return CryptoES.lib.WordArray.create(iv);
  }

  /**
   * 获取加密密钥的WordArray格式
   * @param key 密钥字符串
   * @returns WordArray格式的密钥
   */
  private static getKeyString(key: string): CryptoES.lib.WordArray {
    return CryptoES.enc.Utf8.parse(this.md5(key));
  }

  /**
   * 将WordArray转换为Uint8Array
   * @param wordArray 要转换的WordArray
   * @returns 转换后的Uint8Array
   */
  private static wordArrayToUint8Array(
    wordArray: CryptoES.lib.WordArray,
  ): Uint8Array {
    const base64String = CryptoES.enc.Base64.stringify(wordArray);
    return Uint8Array.from(atob(base64String), (c) => c.charCodeAt(0));
  }

  /**
   * 将Uint8Array转换为WordArray
   * @param byteArray 要转换的Uint8Array
   * @returns 转换后的WordArray
   */
  private static uint8ArrayToWordArray(
    byteArray: Uint8Array,
  ): CryptoES.lib.WordArray {
    const base64String = btoa(
      String.fromCharCode.apply(null, byteArray as any),
    );
    return CryptoES.enc.Base64.parse(base64String);
  }

  /**
   * md5加密方法
   * @param data 需要加密的数据
   * @returns 加密后的字符串
   */
  public static md5(data: string): string {
    try {
      return CryptoES.MD5(data).toString();
    } catch (error) {
      return "";
    }
  }

  /**
   * md5签名方法
   * @param data 需要加密的数据
   * @param key 可选密钥
   * @returns 加密后的字符串
   */
  public static md5Sign(data: string, key: string): string {
    try {
      return CryptoES.MD5(data + key).toString();
    } catch (error) {
      return "";
    }
  }
}
