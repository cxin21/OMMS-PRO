/**
 * ID 生成器模块
 * 提供多种 ID 生成策略
 * 
 * @module utils/id-generator
 * @since 0.1.0
 */

import type { IDStrategy, IDGeneratorConfig } from './types';

/**
 * ID 生成器类
 * 
 * 支持多种 ID 生成策略：UUID、ULID、Snowflake、Timestamp
 * 
 * @example
 * ```typescript
 * // 生成 UUID
 * const uuid = IDGenerator.uuid();
 * 
 * // 生成 ULID
 * const ulid = IDGenerator.ulid();
 * 
 * // 生成带前缀的 ID
 * const id = IDGenerator.generate('user');
 * ```
 */
export class IDGenerator {
  private static counter = 0;
  private static lastTimestamp = 0;
  private static nodeId = 1;
  private static strategy: IDStrategy = 'ulid';

  /**
   * 配置 ID 生成器
   */
  static configure(config: Partial<IDGeneratorConfig>): void {
    if (config.defaultStrategy) {
      this.strategy = config.defaultStrategy;
    }
    if (config.nodeId !== undefined) {
      this.nodeId = config.nodeId & 0x3FF; // 限制在 0-1023
    }
  }

  /**
   * 生成 ID（使用默认策略）
   */
  static generate(prefix?: string): string {
    let id: string;

    switch (this.strategy) {
      case 'uuid':
        id = this.uuid();
        break;
      case 'ulid':
        id = this.ulid();
        break;
      case 'snowflake':
        id = this.snowflake();
        break;
      case 'timestamp':
        id = this.timestamp();
        break;
      default:
        id = this.ulid();
    }

    return prefix ? `${prefix}_${id}` : id;
  }

  /**
   * 生成 UUID v4
   * 
   * 基于随机数的 UUID，碰撞概率极低
   */
  static uuid(): string {
    const bytes = new Uint8Array(16);
    
    // 使用 crypto.getRandomValues 生成随机数
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
      crypto.getRandomValues(bytes);
    } else {
      // Node.js 环境 fallback
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    // 设置 UUID v4 版本和变体
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * 生成 ULID（Universally Unique Lexicographically Sortable Identifier）
   * 
   * 时间有序的 UUID，适合用作数据库索引
   */
  static ulid(): string {
    const now = Date.now();
    
    // 时间部分（48 位）
    const timePart = this.encodeTime(now);
    
    // 随机部分（80 位）
    const randomPart = this.encodeRandom();

    return timePart + randomPart;
  }

  /**
   * 生成 Snowflake ID
   * 
   * 分布式 ID 生成算法，生成 64 位整数 ID
   * 结构：时间戳 (41 位) + 节点 ID(10 位) + 序列号 (12 位)
   */
  static snowflake(nodeId?: number): string {
    const node = (nodeId ?? this.nodeId) & 0x3FF;
    const maxWaitMs = 100; // 最多等待100ms避免无限循环
    const startTime = Date.now();

    // 使用循环而非递归，等待下一毫秒或直到counter有空间
    while (Date.now() - startTime < maxWaitMs) {
      const timestamp = Date.now();

      if (timestamp <= this.lastTimestamp) {
        // 同一毫秒内，尝试递增counter
        this.counter = (this.counter + 1) & 0xFFF;
        if (this.counter === 0) {
          // Counter溢出，等待下一毫秒
          const waitTime = this.lastTimestamp + 1 - Date.now();
          if (waitTime > 0) {
            // 短暂spin等待
            const busyWait = Date.now();
            while (Date.now() - busyWait < Math.min(waitTime, 10)) { /* spin */ }
          }
          continue;
        }
      } else {
        // 新毫秒，重置counter
        this.counter = 0;
        this.lastTimestamp = timestamp;
        break;
      }

      // 计算 ID
      const timePart = (timestamp - 1288834974657) << 22;
      const nodePart = node << 12;
      const id = timePart | nodePart | this.counter;
      return id.toString();
    }

    // 如果等待超时，使用纳秒时间戳+随机数作为后备
    const timePart = (Date.now() - 1288834974657) << 22;
    const nodePart = node << 12;
    const fallbackId = timePart | nodePart | (Math.floor(Math.random() * 0xFFF));
    return fallbackId.toString();
  }

  /**
   * 生成基于时间戳的 ID
   * 
   * 简单的时间戳 + 随机数组合
   */
  static timestamp(prefix = 'id'): string {
    const now = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${now}_${random}`;
  }

  /**
   * 生成短 ID
   * 
   * 适合 URL 缩短等场景
   */
  static short(length = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * chars.length);
      result += chars[randomIndex];
    }
    
    return result;
  }

  /**
   * 生成人类可读的 ID
   * 
   * 使用形容词 + 名词的组合
   */
  static readable(): string {
    const adjectives = [
      'happy', 'sad', 'angry', 'calm', 'excited',
      'brave', 'clever', 'kind', 'lazy', 'wise',
    ];
    const nouns = [
      'cat', 'dog', 'bird', 'fish', 'rabbit',
      'tiger', 'lion', 'bear', 'wolf', 'fox',
    ];

    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 1000);

    return `${adj}-${noun}-${num}`;
  }

  /**
   * 验证 UUID 格式
   */
  static isValidUUID(uuid: string): boolean {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return regex.test(uuid);
  }

  /**
   * 验证 ULID 格式
   */
  static isValidULID(ulid: string): boolean {
    const regex = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;
    return regex.test(ulid);
  }

  /**
   * 从 ULID 提取时间戳
   */
  static ulidToTimestamp(ulid: string): number {
    if (!this.isValidULID(ulid)) {
      throw new Error('Invalid ULID format');
    }

    const timePart = ulid.slice(0, 10);
    return this.decodeTime(timePart);
  }

  /**
   * 编码时间为 Crockford's base32
   */
  private static encodeTime(timestamp: number): string {
    const base32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let result = '';
    let remaining = timestamp;

    for (let i = 0; i < 10; i++) {
      result = base32[remaining % 32] + result;
      remaining = Math.floor(remaining / 32);
    }

    return result;
  }

  /**
   * 解码 Crockford's base32 时间
   */
  private static decodeTime(timePart: string): number {
    const base32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let result = 0;

    for (let i = 0; i < timePart.length; i++) {
      result = result * 32 + base32.indexOf(timePart[i].toUpperCase());
    }

    return result;
  }

  /**
   * 编码随机部分
   */
  private static encodeRandom(): string {
    const bytes = new Uint8Array(10);
    
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 10; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    const base32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let result = '';

    for (let i = 0; i < 10; i++) {
      const byte = bytes[i];
      result += base32[byte & 0x1F];
      result += base32[(byte >> 5) & 0x1F];
    }

    return result;
  }

  /**
   * 重置计数器（用于测试）
   */
  static reset(): void {
    this.counter = 0;
    this.lastTimestamp = 0;
  }

  /**
   * 获取当前策略
   */
  static getStrategy(): IDStrategy {
    return this.strategy;
  }

  /**
   * 设置策略
   */
  static setStrategy(strategy: IDStrategy): void {
    this.strategy = strategy;
  }

  /**
   * 生成安全的唯一 ID（使用 UUID）
   *
   * 相比 timestamp() 方法，使用 crypto.getRandomValues 生成，
   * 碰撞概率极低，适合用作数据库主键、事件 ID 等
   *
   * @param prefix 前缀（可选），如 'webhook', 'event', 'delivery'
   * @returns 格式为 'prefix_uuid' 的字符串
   */
  static unique(prefix = 'id'): string {
    const id = this.uuid();
    return prefix ? `${prefix}_${id}` : id;
  }
}
