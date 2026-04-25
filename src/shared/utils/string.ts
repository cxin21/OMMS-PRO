/**
 * 字符串工具模块
 * 提供字符串处理、格式化、哈希等功能
 * 
 * @module utils/string
 * @since 0.1.0
 */

import { createHash } from 'node:crypto';
import type { TruncateOptions, CleanTextOptions, StringHashOptions } from './types';

/**
 * 字符串工具类
 * 
 * 提供字符串截断、哈希、清理、格式化等功能
 * 
 * @example
 * ```typescript
 * // 截断字符串
 * const truncated = StringUtils.truncate('Hello World', 5);
 * 
 * // 字符串哈希
 * const hash = StringUtils.hash('text', 'sha256');
 * 
 * // 清理文本
 * const cleaned = StringUtils.clean('  Hello   World  ');
 * ```
 */
export class StringUtils {
  /**
   * 截断字符串
   * 
   * @param text - 原始文本
   * @param options - 截断选项
   * @returns 截断后的字符串
   */
  static truncate(text: string, options: number | TruncateOptions): string {
    const opts = typeof options === 'number'
      ? { maxLength: options, suffix: '...' }
      : { suffix: '...', ...options };

    const { maxLength, suffix = '...', byWord = false } = opts;

    if (!text || text.length <= maxLength) {
      return text;
    }

    if (byWord) {
      // 按单词截断
      const words = text.split(/\s+/);
      let result = '';
      
      for (const word of words) {
        if ((result + word).length <= maxLength - suffix.length) {
          result += (result ? ' ' : '') + word;
        } else {
          break;
        }
      }

      return result + suffix;
    }

    // 直接截断
    return text.slice(0, maxLength - suffix.length) + suffix;
  }

  /**
   * 字符串哈希
   * 
   * @param text - 文本
   * @param options - 哈希选项
   * @returns 哈希值
   */
  static hash(text: string, options?: StringHashOptions): string {
    const algorithm = options?.algorithm ?? 'sha256';
    const encoding = options?.encoding ?? 'hex';

    const hash = createHash(algorithm);
    hash.update(text, 'utf-8');

    return hash.digest(encoding);
  }

  /**
   * 清理文本
   * 
   * 移除多余空白、控制字符，标准化标点符号
   * 
   * @param text - 文本
   * @param options - 清理选项
   * @returns 清理后的文本
   */
  static clean(text: string, options?: CleanTextOptions): string {
    const opts = {
      removeExtraWhitespace: true,
      removeControlChars: true,
      normalizeQuotes: false,
      normalizeDashes: false,
      ...options,
    };

    let result = text;

    // 移除控制字符
    if (opts.removeControlChars) {
      result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }

    // 移除多余空白
    if (opts.removeExtraWhitespace) {
      result = result.replace(/[ \t]+/g, ' ');
      result = result.replace(/\n\s*\n/g, '\n\n');
    }

    // 标准化引号
    if (opts.normalizeQuotes) {
      result = result
        .replace(/['']/g, "'")
        .replace(/[""]/g, '"')
        .replace(/[``]/g, '`');
    }

    // 标准化破折号
    if (opts.normalizeDashes) {
      result = result.replace(/--/g, '—');
    }

    // 移除首尾空白
    result = result.trim();

    return result;
  }

  /**
   * 首字母大写
   */
  static capitalize(text: string): string {
    if (!text) {
      return text;
    }

    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  /**
   * 每个单词首字母大写
   */
  static titleCase(text: string): string {
    return text
      .split(/\s+/)
      .map(word => this.capitalize(word))
      .join(' ');
  }

  /**
   * 驼峰转短横线
   */
  static kebabCase(text: string): string {
    return text
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  /**
   * 短横线转驼峰
   */
  static camelCase(text: string): string {
    return text
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase())
      .replace(/^([a-z])/, char => char.toUpperCase());
  }

  /**
   * 蛇形转驼峰
   */
  static snakeToCamel(text: string): string {
    return text.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  }

  /**
   * 驼峰转蛇形
   */
  static camelToSnake(text: string): string {
    return text
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }

  /**
   * 移除 HTML 标签
   */
  static stripHtml(text: string): string {
    return text.replace(/<[^>]*>/g, '');
  }

  /**
   * 转义 HTML 特殊字符
   */
  static escapeHtml(text: string): string {
    const escapeMap: Record<string, string> = {
      '&': '&',
      '<': '<',
      '>': '>',
      '"': '&quot;',
      "'": '&#39;',
    };

    return text.replace(/[&<>"']/g, char => escapeMap[char]);
  }

  /**
   * 反转义 HTML 特殊字符
   */
  static unescapeHtml(text: string): string {
    const unescapeMap: Record<string, string> = {
      '&': '&',
      '<': '<',
      '>': '>',
      '&quot;': '"',
      '&#39;': "'",
    };

    return text.replace(/&(amp|lt|gt|quot|#39);/g, match => unescapeMap[match]);
  }

  /**
   * 移除 Emoji
   */
  static removeEmoji(text: string): string {
    const emojiRegex = /[\p{Emoji_Presentation}\p{Emoji}]/gu;
    return text.replace(emojiRegex, '');
  }

  /**
   * 统计字符数（考虑 Unicode）
   */
  static countChars(text: string): number {
    return [...text].length;
  }

  /**
   * 统计单词数
   */
  static countWords(text: string): number {
    const words = text.trim().split(/\s+/);
    return words.filter(word => word.length > 0).length;
  }

  /**
   * 统计行数
   */
  static countLines(text: string): number {
    if (!text) {
      return 0;
    }
    return text.split(/\r\n|\r|\n/).length;
  }

  /**
   * 填充字符串到指定长度
   */
  static pad(text: string, length: number, char = ' ', position: 'left' | 'right' = 'left'): string {
    if (text.length >= length) {
      return text;
    }

    const padding = char.repeat(length - text.length);
    return position === 'left' ? padding + text : text + padding;
  }

  /**
   * 重复字符串
   */
  static repeat(text: string, count: number): string {
    if (count <= 0) {
      return '';
    }
    return text.repeat(count);
  }

  /**
   * 反转字符串
   */
  static reverse(text: string): string {
    return [...text].reverse().join('');
  }

  /**
   * 随机打乱字符串
   */
  static shuffle(text: string): string {
    const chars = [...text];
    
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  }

  /**
   * 检查是否包含子字符串
   */
  static contains(text: string, search: string, caseSensitive = true): boolean {
    if (!caseSensitive) {
      return text.toLowerCase().includes(search.toLowerCase());
    }
    return text.includes(search);
  }

  /**
   * 检查是否以指定字符串开头
   */
  static startsWith(text: string, prefix: string, caseSensitive = true): boolean {
    if (!caseSensitive) {
      return text.toLowerCase().startsWith(prefix.toLowerCase());
    }
    return text.startsWith(prefix);
  }

  /**
   * 检查是否以指定字符串结尾
   */
  static endsWith(text: string, suffix: string, caseSensitive = true): boolean {
    if (!caseSensitive) {
      return text.toLowerCase().endsWith(suffix.toLowerCase());
    }
    return text.endsWith(suffix);
  }

  /**
   * 提取数字
   */
  static extractNumbers(text: string): number[] {
    const matches = text.match(/-?\d+(?:\.\d+)?/g);
    return matches ? matches.map(Number) : [];
  }

  /**
   * 提取 URL
   */
  static extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    return text.match(urlRegex) || [];
  }

  /**
   * 提取邮箱
   */
  static extractEmails(text: string): string[] {
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    return text.match(emailRegex) || [];
  }

  /**
   * 替换多个模式
   */
  static replaceAll(text: string, replacements: Record<string, string>): string {
    let result = text;
    
    for (const [pattern, replacement] of Object.entries(replacements)) {
      result = result.split(pattern).join(replacement);
    }

    return result;
  }

  /**
   * 移除首尾指定字符
   */
  static trimChars(text: string, chars = ' \t\n\r'): string {
    let start = 0;
    let end = text.length;

    while (start < end && chars.includes(text[start])) {
      start++;
    }

    while (end > start && chars.includes(text[end - 1])) {
      end--;
    }

    return text.slice(start, end);
  }

  /**
   * 提取关键词
   * 
   * @param text - 文本
   * @param options - 提取选项
   * @returns 关键词数组
   * 
   * @example
   * ```typescript
   * // 基本用法
   * const keywords = StringUtils.extractKeywords('这是一个测试文本');
   * 
   * // 自定义选项
   * const keywords = StringUtils.extractKeywords('文本内容', { maxCount: 10, minLength: 3 });
   * ```
   */
  static extractKeywords(
    text: string,
    options: { maxCount?: number; minLength?: number } = {}
  ): string[] {
    const { maxCount = 5, minLength = 2 } = options;
    const words = text.split(/[\s,，.。!?！？;：:]+/);
    return words
      .filter(w => w.length >= minLength)
      .slice(0, maxCount);
  }

  /**
   * 确保字符串以指定前缀开头
   */
  static ensurePrefix(text: string, prefix: string): string {
    return text.startsWith(prefix) ? text : prefix + text;
  }

  /**
   * 确保字符串以指定后缀结尾
   */
  static ensureSuffix(text: string, suffix: string): string {
    return text.endsWith(suffix) ? text : text + suffix;
  }

  /**
   * 移除前缀
   */
  static removePrefix(text: string, prefix: string): string {
    return text.startsWith(prefix) ? text.slice(prefix.length) : text;
  }

  /**
   * 移除后缀
   */
  static removeSuffix(text: string, suffix: string): string {
    return text.endsWith(suffix)
      ? text.slice(0, -suffix.length)
      : text;
  }

  /**
   * 生成文本摘要
   * 
   * @param content - 原始内容
   * @param maxLength - 最大长度
   * @param options - 摘要选项
   * @returns 摘要文本
   * 
   * @example
   * ```typescript
   * // 基本用法
   * const summary = StringUtils.summarize('Long text...', 200);
   * 
   * // 按句子截断
   * const summary = StringUtils.summarize('Long text...', 200, { bySentence: true });
   * 
   * // 自定义后缀
   * const summary = StringUtils.summarize('Long text...', 200, { suffix: ' [more]' });
   * ```
   */
  static summarize(
    content: string,
    maxLength: number = 200,
    options: {
      bySentence?: boolean;
      suffix?: string;
      minSentenceRatio?: number;
    } = {}
  ): string {
    const {
      bySentence = true,
      suffix = '...',
      minSentenceRatio = 0.5,
    } = options;

    if (!content || content.length <= maxLength) {
      return content;
    }

    if (!bySentence) {
      // 直接截断
      return content.substring(0, maxLength) + suffix;
    }

    // 截取到最后一个完整的句子
    let summary = content.substring(0, maxLength);
    const lastPeriod = summary.lastIndexOf('.');
    const lastQuestion = summary.lastIndexOf('?');
    const lastExclamation = summary.lastIndexOf('!');

    // 找到最后一个句子结束符
    const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

    if (lastSentenceEnd > maxLength * minSentenceRatio) {
      summary = summary.substring(0, lastSentenceEnd + 1);
    }

    return summary + (summary.length < content.length ? suffix : '');
  }
  /**
   * 获取字符串的字节长度
   */
  static byteLength(text: string, encoding: 'utf-8' | 'ascii' = 'utf-8'): number {
    if (encoding === 'ascii') {
      return text.length;
    }
    return Buffer.byteLength(text, 'utf-8');
  }

  /**
   * 判断是否为空字符串
   */
  static isEmpty(text: string): boolean {
    return !text || text.trim().length === 0;
  }

  /**
   * 判断是否不为空字符串
   */
  static isNotEmpty(text: string): boolean {
    return !this.isEmpty(text);
  }

  /**
   * 判断是否只包含空白字符
   */
  static isBlank(text: string): boolean {
    return !text || /^\s*$/.test(text);
  }

  /**
   * 判断是否包含非空白字符
   */
  static isNotBlank(text: string): boolean {
    return !this.isBlank(text);
  }

  /**
   * 比较两个字符串是否相等
   */
  static equals(a: string, b: string, caseSensitive = true): boolean {
    if (a === b) {
      return true;
    }

    if (!caseSensitive) {
      return a.toLowerCase() === b.toLowerCase();
    }

    return false;
  }

  /**
   * 计算相似度（Levenshtein 距离）
   */
  static similarity(a: string, b: string): number {
    if (!a || !b) {
      return 0;
    }

    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;

    if (longer.length === 0) {
      return 1;
    }

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Levenshtein 距离算法
   */
  private static levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
      dp[i][0] = i;
    }

    for (let j = 0; j <= n; j++) {
      dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * 生成占位符文本
   */
  static placeholder(data: Record<string, unknown>, template: string): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (key in data) {
        return String(data[key]);
      }
      return _;
    });
  }

  /**
   * 格式化模板字符串
   */
  static template(template: string, ...args: unknown[]): string {
    return template.replace(/\{(\d+)\}/g, (_, index) => {
      const i = parseInt(index, 10);
      if (i < args.length) {
        return String(args[i]);
      }
      return _;
    });
  }

  /**
   * 生成标签实体 ID
   * 用于知识图谱中标签概念节点的 ID 生成
   *
   * 编码规则：
   * 1. 使用 URL 编码处理特殊字符
   * 2. 移除编码后的 % 符号
   * 3. 转为小写
   * 4. 限制最大长度以避免 ID 过长
   * 5. 添加原始标签长度作为后缀，防止不同标签编码后冲突
   *
   * @param tag - 原始标签
   * @param maxEncodedLength - 编码后最大长度（默认 200，确保长度后缀有空间）
   * @returns 格式: tag_{encoded_tag}_{length}
   *
   * @example
   * ```typescript
   * const tagId = StringUtils.encodeTagEntityId('项目'); // tag_e9a1b9e7ae_2
   * const tagId = StringUtils.encodeTagEntityId('project'); // tag_project_7
   * ```
   */
  static encodeTagEntityId(tag: string, maxEncodedLength: number = 200): string {
    // 编码：处理特殊字符和 Unicode
    const encoded = encodeURIComponent(tag)
      .replace(/%/g, '')
      .toLowerCase();

    // 限制长度，确保能添加长度后缀
    // 需要空间：1 (_) + 最多 3 位数字 (length) + 1 (防止刚好截断) = 5
    const maxTagLength = Math.max(1, maxEncodedLength - 5);
    const truncated = encoded.length > maxTagLength
      ? encoded.substring(0, maxTagLength)
      : encoded;

    return `tag_${truncated}_${tag.length}`;
  }
}
