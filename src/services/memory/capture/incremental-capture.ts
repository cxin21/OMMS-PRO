/**
 * Incremental Capture Module - 增量摄取模块
 *
 * 基于 MemPalace 的 Sweeper 光标恢复和内容 hash 预检机制
 * 实现增量摄取，跳过已处理的输入，避免重复 LLM 提取
 *
 * @module memory-service/incremental-capture
 */

import { createServiceLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import type { CaptureInput } from '../../../core/types/memory';

/**
 * 内容 hash 缓存条目
 */
interface ContentHashEntry {
  memoryUid: string;
  timestamp: number;
}

/**
 * CursorManager - 管理 capture 光标
 *
 * 跟踪每个 session 最后处理的 timestamp，
 * 用于跳过已处理的输入
 */
export class CursorManager {
  private cursors: Map<string, number> = new Map();
  private logger: ILogger;

  constructor() {
    this.logger = createServiceLogger('CursorManager');
  }

  /**
   * 获取 session 的当前光标
   * @param sessionId session ID
   * @returns 最后处理的 timestamp，如果不存在返回 0
   */
  getCursor(sessionId: string): number {
    return this.cursors.get(sessionId) ?? 0;
  }

  /**
   * 更新 session 的光标
   * @param sessionId session ID
   * @param timestamp 当前处理的 timestamp
   */
  updateCursor(sessionId: string, timestamp: number): void {
    const current = this.cursors.get(sessionId) ?? 0;
    if (timestamp > current) {
      this.cursors.set(sessionId, timestamp);
      this.logger.debug('Cursor updated', { sessionId, timestamp });
    }
  }

  /**
   * 检查输入是否应该被跳过（timestamp <= cursor）
   * @param sessionId session ID
   * @param timestamp 输入的 timestamp
   * @returns true 如果应该跳过
   */
  shouldSkip(sessionId: string, timestamp: number): boolean {
    const cursor = this.getCursor(sessionId);
    return timestamp > 0 && timestamp <= cursor;
  }

  /**
   * 清除 session 的光标
   * @param sessionId session ID
   */
  clearCursor(sessionId: string): void {
    this.cursors.delete(sessionId);
    this.logger.debug('Cursor cleared', { sessionId });
  }

  /**
   * 清除所有光标
   */
  clearAll(): void {
    this.cursors.clear();
    this.logger.debug('All cursors cleared');
  }

  /**
   * 获取所有 session 的光标状态（调试用）
   */
  getAllCursors(): Map<string, number> {
    return new Map(this.cursors);
  }
}

/**
 * ContentHashCache - 内容 hash 缓存
 *
 * 保留最近的内容 hash → memoryUid 映射，
 * 用于快速去重，避免重复 LLM 提取
 */
export class ContentHashCache {
  private cache: Map<string, ContentHashEntry> = new Map();
  private maxSize: number;
  private logger: ILogger;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
    this.logger = createServiceLogger('ContentHashCache');
  }

  /**
   * 根据 content hash 检查是否已存在记忆 UID
   * @param contentHash 内容 hash
   * @returns 如果存在返回 memoryUid，否则返回 null
   */
  checkDuplicate(contentHash: string): string | null {
    const entry = this.cache.get(contentHash);
    if (entry) {
      this.logger.debug('Duplicate detected via content hash', {
        contentHash: contentHash.substring(0, 16) + '...',
        memoryUid: entry.memoryUid,
      });
      return entry.memoryUid;
    }
    return null;
  }

  /**
   * 添加 content hash → memoryUid 映射
   * @param contentHash 内容 hash
   * @param memoryUid 记忆 UID
   */
  add(contentHash: string, memoryUid: string): void {
    // 如果缓存已满，执行 LRU 清理
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(contentHash, {
      memoryUid,
      timestamp: Date.now(),
    });
    this.logger.debug('Content hash cached', {
      contentHash: contentHash.substring(0, 16) + '...',
      memoryUid,
      cacheSize: this.cache.size,
    });
  }

  /**
   * 检查内容是否需要跳过（基于 hash）
   * @param content 需要检查的内容
   * @returns 存在则返回已有 memoryUid，不存在返回 null
   */
  checkContent(content: string): string | null {
    const hash = computeContentHash(content);
    return this.checkDuplicate(hash);
  }

  /**
   * 添加内容及其 memoryUid
   * @param content 内容
   * @param memoryUid 记忆 UID
   */
  addContent(content: string, memoryUid: string): void {
    const hash = computeContentHash(content);
    this.add(hash, memoryUid);
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.logger.debug('Content hash cache cleared');
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 清理最老的条目（LRU）
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug('Evicted oldest content hash entry', {
        contentHash: oldestKey.substring(0, 16) + '...',
        age: Date.now() - oldestTimestamp,
      });
    }
  }
}

/**
 * 计算内容的 SHA-256 hash
 * @param content 内容字符串
 * @returns 十六进制格式的 hash 字符串
 */
export function computeContentHash(content: string): string {
  // 使用 SubtleCrypto API 计算 SHA-256
  // 注意：在 Node.js 环境中使用 crypto 模块
  let hashHex: string;

  try {
    // Node.js 环境
    const crypto = require('crypto');
    hashHex = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  } catch {
    // 浏览器环境（fallback）
    // 使用简单的 hash 实现作为后备
    hashHex = simpleHash(content);
  }

  return hashHex;
}

/**
 * 简单的后备 hash 函数（当 SubtleCrypto 不可用时使用）
 * 注意：仅用于浏览器环境的后备，Node.js 环境使用 crypto 模块
 */
function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // 转换为十六进制并填充到 64 字符（SHA-256 长度）
  const hex = Math.abs(hash).toString(16);
  return hex.padStart(64, '0').substring(0, 64);
}

/**
 * 检查输入是否是新内容（基于 timestamp 比较）
 * @param captureInput 捕获输入
 * @param cursor 当前光标
 * @returns true 如果是新内容
 */
export function isNewContent(captureInput: CaptureInput, cursor: number): boolean {
  // 如果没有 timestamp，视为新内容
  if (!captureInput.timestamp || captureInput.timestamp <= 0) {
    return true;
  }

  // 如果没有 cursor（首次处理），视为新内容
  if (cursor <= 0) {
    return true;
  }

  // timestamp > cursor 则为新内容
  return captureInput.timestamp > cursor;
}

/**
 * IncrementalCaptureManager - 增量摄取管理器
 *
 * 整合 CursorManager 和 ContentHashCache，
 * 提供完整的增量摄取逻辑
 */
export class IncrementalCaptureManager {
  private cursorManager: CursorManager;
  private contentHashCache: ContentHashCache;
  private enableIncrementalCapture: boolean;
  private logger: ILogger;

  constructor() {
    this.cursorManager = new CursorManager();
    this.logger = createServiceLogger('IncrementalCaptureManager');

    // 从配置加载
    const captureConfig = config.getConfigOrThrow<Record<string, unknown>>('memoryService.capture');
    this.enableIncrementalCapture = (captureConfig['enableIncrementalCapture'] as boolean) ?? true;

    // contentHashCacheSize 必须配置，不提供默认值
    const cacheSize = captureConfig['contentHashCacheSize'] as number;
    if (cacheSize === undefined || cacheSize === null) {
      throw new Error('memoryService.capture.contentHashCacheSize is required but not configured');
    }
    this.contentHashCache = new ContentHashCache(cacheSize);

    this.logger.info('IncrementalCaptureManager initialized', {
      enableIncrementalCapture: this.enableIncrementalCapture,
      contentHashCacheSize: cacheSize,
    });
  }

  /**
   * 检查是否应该跳过此输入
   * @param captureInput 捕获输入
   * @returns 跳过原因，如果不应跳过则返回 null
   */
  checkShouldSkip(captureInput: CaptureInput): { reason: string; existingMemoryUid?: string } | null {
    if (!this.enableIncrementalCapture) {
      return null;
    }

    const sessionId = captureInput.sessionId ?? 'default-session';

    // 1. 光标检查：timestamp <= cursor 则跳过
    const cursor = this.cursorManager.getCursor(sessionId);
    if (captureInput.timestamp && captureInput.timestamp <= cursor) {
      this.logger.info('Skipping input due to cursor', {
        sessionId,
        inputTimestamp: captureInput.timestamp,
        cursor,
      });
      return { reason: 'cursor_skip' };
    }

    // 2. 内容 hash 检查：重复内容跳过去重
    const contentText = extractContentText(captureInput);
    const existingUid = this.contentHashCache.checkContent(contentText);
    if (existingUid) {
      this.logger.info('Skipping duplicate content via hash', {
        sessionId,
        existingMemoryUid: existingUid,
      });
      return { reason: 'content_hash_duplicate', existingMemoryUid: existingUid };
    }

    return null;
  }

  /**
   * 标记内容已被处理
   * @param captureInput 捕获输入
   * @param memoryUid 关联的记忆 UID
   */
  markProcessed(captureInput: CaptureInput, memoryUid: string): void {
    const sessionId = captureInput.sessionId ?? 'default-session';

    // 更新光标
    if (captureInput.timestamp) {
      this.cursorManager.updateCursor(sessionId, captureInput.timestamp);
    }

    // 缓存内容 hash
    const contentText = extractContentText(captureInput);
    this.contentHashCache.addContent(contentText, memoryUid);
  }

  /**
   * 获取 CursorManager 实例
   */
  getCursorManager(): CursorManager {
    return this.cursorManager;
  }

  /**
   * 获取 ContentHashCache 实例
   */
  getContentHashCache(): ContentHashCache {
    return this.contentHashCache;
  }

  /**
   * 计算 CaptureInput 的内容 hash
   * 使用与增量管理器内部相同的文本提取逻辑
   * @param captureInput 捕获输入
   * @returns 内容 hash
   */
  computeContentHash(captureInput: CaptureInput): string {
    const text = extractContentText(captureInput);
    return computeContentHash(text);
  }

  /**
   * 从 CaptureInput 提取文本用于 hash 计算
   * @param captureInput 捕获输入
   * @returns 纯文本内容
   */
  extractTextForHash(captureInput: CaptureInput): string {
    return extractContentText(captureInput);
  }

  /**
   * 更新配置
   */
  updateConfig(enable: boolean, cacheSize?: number): void {
    this.enableIncrementalCapture = enable;
    if (cacheSize !== undefined) {
      this.contentHashCache = new ContentHashCache(cacheSize);
    }
    this.logger.info('Incremental capture config updated', {
      enableIncrementalCapture: this.enableIncrementalCapture,
      cacheSize: cacheSize ?? this.contentHashCache.size(),
    });
  }
}

/**
 * 从 CaptureInput 提取纯文本内容
 */
function extractContentText(captureInput: CaptureInput): string {
  if (typeof captureInput.content === 'string') {
    return captureInput.content;
  }

  // 处理对话轮次
  const turns = captureInput.content as Array<{ role: string; content: string }>;
  return turns.map(turn => `${turn.role}: ${turn.content}`).join('\n');
}