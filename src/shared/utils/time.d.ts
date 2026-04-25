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
export declare class TimeUtils {
    private static timezone;
    private static defaultFormat;
    /**
     * 配置时间工具
     */
    static configure(options: Partial<TimeFormatOptions>): void;
    /**
     * 格式化时间戳
     *
     * @param timestamp - 时间戳（毫秒）
     * @param format - 格式模板（可选）
     * @returns 格式化后的字符串
     */
    static format(timestamp: number, format?: string): string;
    /**
     * 相对时间格式化
     *
     * @param timestamp - 时间戳（毫秒）
     * @param now - 当前时间（可选，默认 Date.now()）
     * @returns 相对时间字符串
     */
    static relative(timestamp: number, now?: number): string;
    /**
     * 持续时间格式化
     *
     * @param ms - 毫秒数
     * @param options - 选项
     * @returns 持续时间字符串
     */
    static duration(ms: number, options?: {
        verbose?: boolean;
    }): string;
    /**
     * 解析时间字符串
     *
     * @param dateString - 时间字符串
     * @returns 时间戳（毫秒）
     */
    static parse(dateString: string): number;
    /**
     * 判断是否过期
     *
     * @param timestamp - 时间戳
     * @param ttl - 生存时间（毫秒）
     * @param now - 当前时间（可选）
     * @returns 是否过期
     */
    static isExpired(timestamp: number, ttl: number, now?: number): boolean;
    /**
     * 获取剩余时间
     *
     * @param timestamp - 时间戳
     * @param ttl - 生存时间（毫秒）
     * @param now - 当前时间（可选）
     * @returns 剩余时间（毫秒），如果已过期返回 0
     */
    static getRemainingTime(timestamp: number, ttl: number, now?: number): number;
    /**
     * 格式化剩余时间
     *
     * @param timestamp - 时间戳
     * @param ttl - 生存时间（毫秒）
     * @param now - 当前时间（可选）
     * @returns 剩余时间字符串
     */
    static formatRemaining(timestamp: number, ttl: number, now?: number): string;
    /**
     * 计算年龄
     *
     * @param birthDate - 出生日期
     * @returns 年龄
     */
    static calculateAge(birthDate: Date | number): number;
    /**
     * 判断是否是今天
     */
    static isToday(timestamp: number): boolean;
    /**
     * 判断是否是昨天
     */
    static isYesterday(timestamp: number): boolean;
    /**
     * 获取日期部分（零点时间戳）
     */
    static startOfDay(timestamp: number): number;
    /**
     * 获取结束部分（23:59:59.999 时间戳）
     */
    static endOfDay(timestamp: number): number;
    /**
     * 添加天数
     */
    static addDays(timestamp: number, days: number): number;
    /**
     * 添加月数
     */
    static addMonths(timestamp: number, months: number): number;
    /**
     * 添加年数
     */
    static addYears(timestamp: number, years: number): number;
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
    };
    /**
     * 睡眠（延迟）
     *
     * @param ms - 延迟毫秒数
     * @returns Promise
     */
    static sleep(ms: number): Promise<void>;
    /**
     * 获取当前时间戳
     */
    static now(): number;
    /**
     * 获取当前 ISO 字符串
     */
    static toISOString(timestamp?: number): string;
    /**
     * 格式化 Unix 时间戳
     */
    static formatUnix(timestamp: number, format?: string): string;
    /**
     * 获取当前 Unix 时间戳
     */
    static unixNow(): number;
    /**
     * 计算距离某个时间的毫秒数
     *
     * @param timestamp - 时间戳
     * @param now - 当前时间（可选，默认 Date.now()）
     * @returns 毫秒差
     */
    static since(timestamp: number, now?: number): number;
    /**
     * 计算距离某个时间的天数
     *
     * @param timestamp - 时间戳
     * @param now - 当前时间（可选）
     * @returns 天数差
     */
    static daysSince(timestamp: number, now?: number): number;
    /**
     * 计算距离某个时间的小时数
     *
     * @param timestamp - 时间戳
     * @param now - 当前时间（可选）
     * @returns 小时差
     */
    static hoursSince(timestamp: number, now?: number): number;
    /**
     * 判断时间是否在指定范围内
     *
     * @param timestamp - 时间戳
     * @param start - 开始时间
     * @param end - 结束时间
     * @returns 是否在范围内
     */
    static isInRange(timestamp: number, start: number, end: number): boolean;
    /**
     * 获取星期几
     */
    static getDayOfWeek(timestamp: number): number;
    /**
     * 获取星期几的中文名称
     */
    static getDayOfWeekName(timestamp: number): string;
    /**
     * 获取月份的天数
     */
    static getDaysInMonth(timestamp: number): number;
    /**
     * 判断是否是闰年
     */
    static isLeapYear(timestamp: number): boolean;
    /**
     * 格式化时间范围
     */
    static formatRange(start: number, end: number, format?: string): string;
    /**
     * 判断是否是未来时间
     */
    static isFuture(timestamp: number, now?: number): boolean;
    /**
     * 判断是否是过去时间
     */
    static isPast(timestamp: number, now?: number): boolean;
}
