/**
 * 时间工具模块
 * 提供时间格式化、解析、计算等功能
 * 
 * @module utils/time
 * @since 0.1.0
 */

import type { TimeFormatOptions } from './types';

/**
 * 时间工具类
 * 
 * 提供时间格式化、解析、相对时间计算等功能
 * 
 * @example
 * ```typescript
 * // 格式化时间戳
 * const formatted = TimeUtils.format(Date.now());
 * 
 * // 相对时间
 * const relative = TimeUtils.relative(Date.now() - 60000); // "1 分钟前"
 * 
 * // 持续时间格式化
 * const duration = TimeUtils.duration(3661000); // "1h 1m 1s"
 * ```
 */
export class TimeUtils {
  private static timezone = 'Asia/Shanghai';
  private static defaultFormat = 'YYYY-MM-DD HH:mm:ss';

  /**
   * 配置时间工具
   */
  static configure(options: Partial<TimeFormatOptions>): void {
    if (options.timezone) {
      this.timezone = options.timezone;
    }
    if (options.format) {
      this.defaultFormat = options.format;
    }
  }

  /**
   * 格式化时间戳
   * 
   * @param timestamp - 时间戳（毫秒）
   * @param format - 格式模板（可选）
   * @returns 格式化后的字符串
   */
  static format(timestamp: number, format?: string): string {
    const date = new Date(timestamp);
    const template = format ?? this.defaultFormat;

    const replacements: Record<string, string | number> = {
      YYYY: date.getFullYear(),
      MM: String(date.getMonth() + 1).padStart(2, '0'),
      DD: String(date.getDate()).padStart(2, '0'),
      HH: String(date.getHours()).padStart(2, '0'),
      mm: String(date.getMinutes()).padStart(2, '0'),
      ss: String(date.getSeconds()).padStart(2, '0'),
      SSS: String(date.getMilliseconds()).padStart(3, '0'),
    };

    return template.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g, match => {
      const value = replacements[match];
      return String(value);
    });
  }

  /**
   * 相对时间格式化
   * 
   * @param timestamp - 时间戳（毫秒）
   * @param now - 当前时间（可选，默认 Date.now()）
   * @returns 相对时间字符串
   */
  static relative(timestamp: number, now = Date.now()): string {
    const diff = now - timestamp;
    const absDiff = Math.abs(diff);
    const isPast = diff >= 0;

    const seconds = Math.floor(absDiff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    let result: string;

    if (years > 0) {
      result = `${years}年前`;
    } else if (months > 0) {
      result = `${months}个月前`;
    } else if (weeks > 0) {
      result = `${weeks}周前`;
    } else if (days > 0) {
      result = `${days}天前`;
    } else if (hours > 0) {
      result = `${hours}小时前`;
    } else if (minutes > 0) {
      result = `${minutes}分钟前`;
    } else if (seconds > 0) {
      result = `${seconds}秒前`;
    } else {
      result = '刚刚';
    }

    return isPast ? result : result.replace('前', '后');
  }

  /**
   * 持续时间格式化
   * 
   * @param ms - 毫秒数
   * @param options - 选项
   * @returns 持续时间字符串
   */
  static duration(ms: number, options?: { verbose?: boolean }): string {
    const verbose = options?.verbose ?? false;
    const absMs = Math.abs(ms);

    const seconds = Math.floor(absMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const parts: string[] = [];

    if (days > 0) {
      parts.push(verbose ? `${days}天` : `${days}d`);
    }
    if (hours > 0) {
      parts.push(verbose ? `${hours}小时` : `${hours}h`);
    }
    if (minutes > 0) {
      parts.push(verbose ? `${minutes}分钟` : `${minutes}m`);
    }
    if (seconds % 60 > 0) {
      parts.push(verbose ? `${seconds % 60}秒` : `${seconds % 60}s`);
    }

    if (parts.length === 0) {
      return verbose ? '0 秒' : '0s';
    }

    return parts.slice(0, 4).join(' ');
  }

  /**
   * 解析时间字符串
   * 
   * @param dateString - 时间字符串
   * @returns 时间戳（毫秒）
   */
  static parse(dateString: string): number {
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date string: ${dateString}`);
    }

    return date.getTime();
  }

  /**
   * 判断是否过期
   * 
   * @param timestamp - 时间戳
   * @param ttl - 生存时间（毫秒）
   * @param now - 当前时间（可选）
   * @returns 是否过期
   */
  static isExpired(timestamp: number, ttl: number, now = Date.now()): boolean {
    return now > timestamp + ttl;
  }

  /**
   * 获取剩余时间
   * 
   * @param timestamp - 时间戳
   * @param ttl - 生存时间（毫秒）
   * @param now - 当前时间（可选）
   * @returns 剩余时间（毫秒），如果已过期返回 0
   */
  static getRemainingTime(timestamp: number, ttl: number, now = Date.now()): number {
    const remaining = timestamp + ttl - now;
    return Math.max(0, remaining);
  }

  /**
   * 格式化剩余时间
   * 
   * @param timestamp - 时间戳
   * @param ttl - 生存时间（毫秒）
   * @param now - 当前时间（可选）
   * @returns 剩余时间字符串
   */
  static formatRemaining(timestamp: number, ttl: number, now = Date.now()): string {
    const remaining = this.getRemainingTime(timestamp, ttl, now);
    
    if (remaining === 0) {
      return '已过期';
    }

    return this.duration(remaining);
  }

  /**
   * 计算年龄
   * 
   * @param birthDate - 出生日期
   * @returns 年龄
   */
  static calculateAge(birthDate: Date | number): number {
    const birth = birthDate instanceof Date ? birthDate : new Date(birthDate);
    const now = new Date();

    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--;
    }

    return age;
  }

  /**
   * 判断是否是今天
   */
  static isToday(timestamp: number): boolean {
    const date = new Date(timestamp);
    const now = new Date();

    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  }

  /**
   * 判断是否是昨天
   */
  static isYesterday(timestamp: number): boolean {
    const date = new Date(timestamp);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    return (
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate()
    );
  }

  /**
   * 获取日期部分（零点时间戳）
   */
  static startOfDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * 获取结束部分（23:59:59.999 时间戳）
   */
  static endOfDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  /**
   * 添加天数
   */
  static addDays(timestamp: number, days: number): number {
    const date = new Date(timestamp);
    date.setDate(date.getDate() + days);
    return date.getTime();
  }

  /**
   * 添加月数
   */
  static addMonths(timestamp: number, months: number): number {
    const date = new Date(timestamp);
    date.setMonth(date.getMonth() + months);
    return date.getTime();
  }

  /**
   * 添加年数
   */
  static addYears(timestamp: number, years: number): number {
    const date = new Date(timestamp);
    date.setFullYear(date.getFullYear() + years);
    return date.getTime();
  }

  /**
   * 计算两个时间的差值
   * 
   * @param start - 开始时间
   * @param end - 结束时间
   * @returns 差值对象
   */
  static diff(start: number, end: number): {
    milliseconds: number;
    seconds: number;
    minutes: number;
    hours: number;
    days: number;
    weeks: number;
    months: number;
    years: number;
  } {
    const diff = end - start;
    const absDiff = Math.abs(diff);

    return {
      milliseconds: absDiff,
      seconds: Math.floor(absDiff / 1000),
      minutes: Math.floor(absDiff / 60000),
      hours: Math.floor(absDiff / 3600000),
      days: Math.floor(absDiff / 86400000),
      weeks: Math.floor(absDiff / 604800000),
      months: Math.floor(absDiff / 2592000000),
      years: Math.floor(absDiff / 31536000000),
    };
  }

  /**
   * 睡眠（延迟）
   * 
   * @param ms - 延迟毫秒数
   * @returns Promise
   */
  static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取当前时间戳
   */
  static now(): number {
    return Date.now();
  }

  /**
   * 获取当前 ISO 字符串
   */
  static toISOString(timestamp?: number): string {
    return new Date(timestamp ?? Date.now()).toISOString();
  }

  /**
   * 格式化 Unix 时间戳
   */
  static formatUnix(timestamp: number, format?: string): string {
    return this.format(timestamp * 1000, format);
  }

  /**
   * 获取当前 Unix 时间戳
   */
  static unixNow(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * 计算距离某个时间的毫秒数
   * 
   * @param timestamp - 时间戳
   * @param now - 当前时间（可选，默认 Date.now()）
   * @returns 毫秒差
   */
  static since(timestamp: number, now = Date.now()): number {
    return now - timestamp;
  }

  /**
   * 计算距离某个时间的天数
   * 
   * @param timestamp - 时间戳
   * @param now - 当前时间（可选）
   * @returns 天数差
   */
  static daysSince(timestamp: number, now = Date.now()): number {
    return Math.floor(this.since(timestamp, now) / (24 * 60 * 60 * 1000));
  }

  /**
   * 计算距离某个时间的小时数
   * 
   * @param timestamp - 时间戳
   * @param now - 当前时间（可选）
   * @returns 小时差
   */
  static hoursSince(timestamp: number, now = Date.now()): number {
    return Math.floor(this.since(timestamp, now) / (60 * 60 * 1000));
  }

  /**
   * 判断时间是否在指定范围内
   * 
   * @param timestamp - 时间戳
   * @param start - 开始时间
   * @param end - 结束时间
   * @returns 是否在范围内
   */
  static isInRange(timestamp: number, start: number, end: number): boolean {
    return timestamp >= start && timestamp <= end;
  }

  /**
   * 获取星期几
   */
  static getDayOfWeek(timestamp: number): number {
    return new Date(timestamp).getDay();
  }

  /**
   * 获取星期几的中文名称
   */
  static getDayOfWeekName(timestamp: number): string {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[this.getDayOfWeek(timestamp)];
  }

  /**
   * 获取月份的天数
   */
  static getDaysInMonth(timestamp: number): number {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month + 1, 0).getDate();
  }

  /**
   * 判断是否是闰年
   */
  static isLeapYear(timestamp: number): boolean {
    const year = new Date(timestamp).getFullYear();
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  /**
   * 格式化时间范围
   */
  static formatRange(start: number, end: number, format?: string): string {
    const startStr = this.format(start, format);
    const endStr = this.format(end, format);
    return `${startStr} - ${endStr}`;
  }

  /**
   * 判断是否是未来时间
   */
  static isFuture(timestamp: number, now = Date.now()): boolean {
    return timestamp > now;
  }

  /**
   * 判断是否是过去时间
   */
  static isPast(timestamp: number, now = Date.now()): boolean {
    return timestamp < now;
  }
}
