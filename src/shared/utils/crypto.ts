/**
 * 加密工具模块
 * 提供哈希、编码、加密等功能
 * 
 * @module utils/crypto
 * @since 0.1.0
 */

import { createHash, createHmac, randomBytes, pbkdf2Sync, generateKeyPairSync, createSign, createVerify, createCipheriv, createDecipheriv, getHashes } from 'node:crypto';
import type { CryptoOptions, CryptoAlgorithm } from './types';

// Capture crypto functions before class definition to avoid shadowing
const cryptoCreateSign = createSign;
const cryptoCreateVerify = createVerify;

/**
 * 加密工具类
 * 
 * 提供哈希计算、Base64 编码、HMAC 签名等功能
 * 
 * @example
 * ```typescript
 * // 计算哈希
 * const hash = CryptoUtils.hash('text', { algorithm: 'sha256' });
 * 
 * // Base64 编码
 * const encoded = CryptoUtils.base64Encode('text');
 * 
 * // HMAC 签名
 * const signature = CryptoUtils.hmac('text', 'secret');
 * ```
 */
export class CryptoUtils {
  private static defaultAlgorithm: string = 'sha256'; // Sensible default; individual calls may override
  private static defaultEncoding: 'hex' | 'base64' = 'hex';

  /**
   * 配置加密工具
   */
  static configure(options: Partial<CryptoOptions>): void {
    if (options.algorithm) {
      this.defaultAlgorithm = options.algorithm;
    }
    if (options.encoding) {
      this.defaultEncoding = options.encoding as 'hex' | 'base64';
    }
  }

  /**
   * 计算哈希
   * 
   * @param data - 数据
   * @param options - 选项
   * @returns 哈希值
   */
  static hash(data: string | Buffer, options?: CryptoOptions): string {
    const {
      algorithm = this.defaultAlgorithm,
      encoding = this.defaultEncoding,
    } = options ?? {};

    const hash = createHash(algorithm);
    hash.update(data);

    return hash.digest(encoding);
  }

  /**
   * MD5 哈希
   */
  static md5(data: string | Buffer): string {
    return this.hash(data, { algorithm: 'md5' });
  }

  /**
   * SHA1 哈希
   */
  static sha1(data: string | Buffer): string {
    return this.hash(data, { algorithm: 'sha1' });
  }

  /**
   * SHA256 哈希
   */
  static sha256(data: string | Buffer): string {
    return this.hash(data, { algorithm: 'sha256' });
  }

  /**
   * SHA512 哈希
   */
  static sha512(data: string | Buffer): string {
    return this.hash(data, { algorithm: 'sha512' });
  }

  /**
   * HMAC 签名
   * 
   * @param data - 数据
   * @param key - 密钥
   * @param options - 选项
   * @returns HMAC 签名
   */
  static hmac(data: string | Buffer, key: string, options?: CryptoOptions): string {
    const {
      algorithm = this.defaultAlgorithm,
      encoding = this.defaultEncoding,
    } = options ?? {};

    const hmac = createHmac(algorithm, key);
    hmac.update(data);

    return hmac.digest(encoding);
  }

  /**
   * HMAC-MD5
   */
  static hmacMD5(data: string | Buffer, key: string): string {
    return this.hmac(data, key, { algorithm: 'md5' });
  }

  /**
   * HMAC-SHA256
   */
  static hmacSHA256(data: string | Buffer, key: string): string {
    return this.hmac(data, key, { algorithm: 'sha256' });
  }

  /**
   * HMAC-SHA512
   */
  static hmacSHA512(data: string | Buffer, key: string): string {
    return this.hmac(data, key, { algorithm: 'sha512' });
  }

  /**
   * Base64 编码
   * 
   * @param data - 原始数据
   * @param inputEncoding - 输入编码
   * @returns Base64 编码字符串
   */
  static base64Encode(data: string, inputEncoding: BufferEncoding = 'utf-8'): string {
    return Buffer.from(data, inputEncoding).toString('base64');
  }

  /**
   * Base64 解码
   * 
   * @param data - Base64 数据
   * @param outputEncoding - 输出编码
   * @returns 解码后的字符串
   */
  static base64Decode(data: string, outputEncoding: BufferEncoding = 'utf-8'): string {
    return Buffer.from(data, 'base64').toString(outputEncoding);
  }

  /**
   * URL Safe Base64 编码
   */
  static base64UrlEncode(data: string, inputEncoding: BufferEncoding = 'utf-8'): string {
    return this.base64Encode(data, inputEncoding)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * URL Safe Base64 解码
   */
  static base64UrlDecode(data: string, outputEncoding: BufferEncoding = 'utf-8'): string {
    // 添加填充
    const padded = data + '='.repeat((4 - (data.length % 4)) % 4);
    
    return Buffer.from(
      padded.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString(outputEncoding);
  }

  /**
   * Hex 编码
   */
  static hexEncode(data: string | Buffer, inputEncoding: BufferEncoding = 'utf-8'): string {
    if (typeof data === 'string') {
      return Buffer.from(data, inputEncoding).toString('hex');
    }
    return data.toString('hex');
  }

  /**
   * Hex 解码
   */
  static hexDecode(data: string, outputEncoding: BufferEncoding = 'utf-8'): string {
    return Buffer.from(data, 'hex').toString(outputEncoding);
  }

  /**
   * 生成随机字符串
   * 
   * @param length - 长度
   * @param charset - 字符集
   * @returns 随机字符串
   */
  static randomString(length = 32, charset = 'A-Za-z0-9'): string {
    const bytes = randomBytes(length);
    let result = '';

    for (let i = 0; i < length; i++) {
      result += charset[bytes[i] % charset.length];
    }

    return result;
  }

  /**
   * 生成随机 Token
   */
  static randomToken(length = 32): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * 生成 UUID v4
   */
  static uuid(): string {
    const bytes = randomBytes(16);
    
    // 设置 UUID v4 版本和变体
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * 验证 HMAC 签名
   * 
   * @param data - 数据
   * @param signature - 签名
   * @param key - 密钥
   * @param options - 选项
   * @returns 是否有效
   */
  static verifyHmac(
    data: string | Buffer,
    signature: string,
    key: string,
    options?: CryptoOptions
  ): boolean {
    const {
      algorithm = this.defaultAlgorithm,
      encoding = this.defaultEncoding,
    } = options ?? {};

    const expectedSignature = this.hmac(data, key, { algorithm: algorithm as CryptoAlgorithm, encoding });
    
    // 使用时间常量比较防止时序攻击
    return this.timingSafeCompare(expectedSignature, signature);
  }

  /**
   * 时间常量字符串比较
   */
  static timingSafeCompare(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return false;
    }

    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);

    if (aBuffer.length !== bBuffer.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < aBuffer.length; i++) {
      result |= aBuffer[i] ^ bBuffer[i];
    }

    return result === 0;
  }

  /**
   * PBKDF2 密钥派生
   * 
   * @param password - 密码
   * @param salt - 盐
   * @param iterations - 迭代次数
   * @param keylen - 密钥长度
   * @param digest - 摘要算法
   * @returns 派生密钥
   */
  static pbkdf2(
    password: string,
    salt: string,
    iterations = 100000,
    keylen = 32,
    digest = 'sha256'
  ): string {
    const key = pbkdf2Sync(password, salt, iterations, keylen, digest);
    return key.toString('hex');
  }

  /**
   * 生成盐
   * 
   * @param length - 长度（字节）
   * @returns 盐的 hex 字符串
   */
  static generateSalt(length = 16): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * 简单异或加密
   * 
   * @param data - 数据
   * @param key - 密钥
   * @returns 加密/解密后的数据
   */
  static xor(data: string | Buffer, key: string): Buffer {
    const dataBuffer = typeof data === 'string' ? Buffer.from(data) : data;
    const keyBuffer = Buffer.from(key);
    
    const result = Buffer.alloc(dataBuffer.length);
    
    for (let i = 0; i < dataBuffer.length; i++) {
      result[i] = dataBuffer[i] ^ keyBuffer[i % keyBuffer.length];
    }

    return result;
  }

  /**
   * ROT13 编码
   */
  static rot13(text: string): string {
    return text.replace(/[a-zA-Z]/g, char => {
      const code = char.charCodeAt(0);
      const base = code >= 97 ? 97 : 65;
      return String.fromCharCode(((code - base + 13) % 26) + base);
    });
  }

  /**
   * Caesar 密码加密
   */
  static caesarEncrypt(text: string, shift: number): string {
    return text.replace(/[a-zA-Z]/g, char => {
      const code = char.charCodeAt(0);
      const base = code >= 97 ? 97 : 65;
      return String.fromCharCode(((code - base + shift) % 26) + base);
    });
  }

  /**
   * Caesar 密码解密
   */
  static caesarDecrypt(text: string, shift: number): string {
    return this.caesarEncrypt(text, -shift);
  }

  /**
   * 计算校验和
   */
  static checksum(data: string | Buffer, algorithm: CryptoAlgorithm = 'md5'): string {
    return this.hash(data, { algorithm });
  }

  /**
   * 验证校验和
   */
  static verifyChecksum(data: string | Buffer, checksum: string, algorithm: CryptoAlgorithm = 'md5'): boolean {
    const expected = this.checksum(data, algorithm);
    return this.timingSafeCompare(expected, checksum);
  }

  /**
   * 计算 CRC32
   */
  static crc32(data: string | Buffer): string {
    const hash = createHash('crc32');
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * 生成密钥对（简单实现）
   * 
   * 注意：生产环境应使用专门的密钥管理库
   */
  static generateKeyPair(algorithm = 'rsa', bits = 2048): {
    publicKey: string;
    privateKey: string;
  } {
    const { publicKey, privateKey } = generateKeyPairSync(algorithm as any, {
      modulusLength: bits,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return { publicKey, privateKey };
  }

  /**
   * 签名数据
   */
  static sign(data: string | Buffer, privateKey: string, algorithm = 'sha256'): string {
    const signer = cryptoCreateSign(algorithm);
    signer.update(data);
    signer.end();

    const signature = signer.sign(privateKey, 'hex');
    return signature;
  }

  /**
   * 验证签名
   */
  static verify(
    data: string | Buffer,
    signature: string,
    publicKey: string,
    algorithm = 'sha256'
  ): boolean {
    const verifier = cryptoCreateVerify(algorithm);
    verifier.update(data);
    verifier.end();

    return verifier.verify(publicKey, signature, 'hex');
  }

  /**
   * 加密数据（AES）
   */
  static encrypt(data: string, key: string, algorithm = 'aes-256-cbc'): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(algorithm, Buffer.from(key, 'hex'), iv);
    
    let encrypted = cipher.update(data, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * 解密数据（AES）
   */
  static decrypt(encrypted: string, key: string, algorithm = 'aes-256-cbc'): string {
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = parts[1];

    const decipher = createDecipheriv(algorithm, Buffer.from(key, 'hex'), iv);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }

  /**
   * 比较两个哈希是否相等（时间常量）
   */
  static compareHash(hash1: string, hash2: string): boolean {
    return this.timingSafeCompare(hash1, hash2);
  }

  /**
   * 验证密码
   */
  static verifyPassword(password: string, hash: string, salt: string): boolean {
    const expectedHash = this.pbkdf2(password, salt);
    return this.timingSafeCompare(expectedHash, hash);
  }

  /**
   * 哈希密码
   */
  static hashPassword(password: string, salt?: string): {
    hash: string;
    salt: string;
  } {
    const actualSalt = salt ?? this.generateSalt();
    const hash = this.pbkdf2(password, actualSalt);
    
    return { hash, salt: actualSalt };
  }

  /**
   * 生成 API 密钥
   */
  static generateApiKey(prefix = 'sk'): string {
    const randomPart = this.randomString(32, 'A-Za-z0-9');
    return `${prefix}_${randomPart}`;
  }

  /**
   * 验证 API 密钥格式
   */
  static isValidApiKey(apiKey: string): boolean {
    return /^[a-z]+_[A-Za-z0-9]{32}$/.test(apiKey);
  }

  /**
   * 哈希对象
   */
  static hashObject<T extends Record<string, unknown>>(obj: T, algorithm: CryptoAlgorithm = 'sha256'): string {
    const sorted = JSON.stringify(obj, Object.keys(obj).sort());
    return this.hash(sorted, { algorithm });
  }

  /**
   * 深度哈希
   */
  static deepHash(value: unknown, algorithm: CryptoAlgorithm = 'sha256'): string {
    const serialized = JSON.stringify(value);
    return this.hash(serialized, { algorithm });
  }

  /**
   * 生成指纹
   */
  static fingerprint(data: string | Buffer): string {
    return this.sha256(data);
  }

  /**
   * 计算熵
   */
  static entropy(data: string): number {
    if (!data) {
      return 0;
    }

    const frequency: Record<string, number> = {};
    
    for (const char of data) {
      frequency[char] = (frequency[char] || 0) + 1;
    }

    let entropy = 0;
    const length = data.length;

    for (const count of Object.values(frequency)) {
      const p = count / length;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * 判断哈希是否安全
   */
  static isSecureHash(algorithm: string): boolean {
    const secureAlgorithms = ['sha256', 'sha384', 'sha512', 'sha3-256', 'sha3-512'];
    return secureAlgorithms.includes(algorithm.toLowerCase());
  }

  /**
   * 获取支持的哈希算法
   */
  static getSupportedAlgorithms(): string[] {
    return getHashes();
  }
}
