/**
 * 对象工具模块
 * 提供对象操作、深拷贝、深比较等功能
 *
 * @module utils/object
 * @since 0.1.0
 */
import type { PathOptions, CloneOptions, CompareOptions } from './types';
/**
 * 对象工具类
 *
 * 提供对象深拷贝、深比较、路径访问等功能
 *
 * @example
 * ```typescript
 * // 深拷贝
 * const cloned = ObjectUtils.deepClone(obj);
 *
 * // 深比较
 * const equal = ObjectUtils.deepEqual(a, b);
 *
 * // 路径访问
 * const value = ObjectUtils.getByPath(obj, 'user.name');
 * ```
 */
export declare class ObjectUtils {
    /**
     * 深拷贝对象
     *
     * @param obj - 源对象
     * @param options - 克隆选项
     * @returns 克隆后的对象
     */
    static deepClone<T>(obj: T, options?: CloneOptions): T;
    /**
     * 深比较两个对象
     *
     * @param a - 对象 A
     * @param b - 对象 B
     * @param options - 比较选项
     * @returns 是否相等
     */
    static deepEqual(a: unknown, b: unknown, options?: CompareOptions): boolean;
    /**
     * 从对象中获取路径值
     *
     * @param obj - 源对象
     * @param path - 路径字符串（如 'user.name'）
     * @param options - 选项
     * @returns 路径对应的值
     */
    static getByPath(obj: unknown, path: string, options?: PathOptions): unknown;
    /**
     * 设置对象路径值
     *
     * @param obj - 目标对象
     * @param path - 路径字符串
     * @param value - 值
     * @returns 新对象
     */
    static setByPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T;
    /**
     * 删除对象路径值
     */
    static deleteByPath<T extends Record<string, unknown>>(obj: T, path: string): T;
    /**
     * 检查路径是否存在
     */
    static hasPath(obj: unknown, path: string): boolean;
    /**
     * 对象扁平化
     *
     * @param obj - 源对象
     * @param separator - 键分隔符（默认 '.'）
     * @returns 扁平化后的对象
     */
    static flatten(obj: Record<string, unknown>, separator?: string): Record<string, unknown>;
    /**
     * 对象解扁平化
     */
    static unflatten(obj: Record<string, unknown>, separator?: string): Record<string, unknown>;
    /**
     * 过滤对象
     */
    static filter<T extends Record<string, unknown>>(obj: T, predicate: (value: unknown, key: string, obj: T) => boolean): Partial<T>;
    /**
     * 映射对象
     */
    static map<T extends Record<string, unknown>, R>(obj: T, mapper: (value: T[keyof T], key: string, obj: T) => R): Record<string, R>;
    /**
     * 合并对象（深合并）
     */
    static merge<T extends Record<string, unknown>>(...objects: Array<Partial<T>>): T;
    /**
     * 提取对象的键
     */
    static keys<T extends Record<string, unknown>>(obj: T): (keyof T)[];
    /**
     * 提取对象的值
     */
    static values<T extends Record<string, unknown>>(obj: T): T[keyof T][];
    /**
     * 提取对象的键值对
     */
    static entries<T extends Record<string, unknown>>(obj: T): [keyof T, T[keyof T]][];
    /**
     * 反转对象（键值互换）
     */
    static invert<T extends Record<string, string | number | symbol>>(obj: T): Record<string | number | symbol, keyof T>;
    /**
     * 选择对象的指定键
     */
    static pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>;
    /**
     * 排除对象的指定键
     */
    static omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K>;
    /**
     * 获取对象大小（键数量）
     */
    static size(obj: Record<string, unknown>): number;
    /**
     * 判断对象是否为空
     */
    static isEmpty(obj: unknown): boolean;
    /**
     * 清除对象（移除所有键）
     */
    static clear<T extends Record<string, unknown>>(obj: T): T;
    /**
     * 冻结对象（深度）
     */
    static deepFreeze<T>(obj: T): Readonly<T>;
    /**
     * 将对象转换为 Map
     */
    static toMap<T>(obj: Record<string, T>): Map<string, T>;
    /**
     * 将 Map 转换为对象
     */
    static fromMap<T>(map: Map<string, T>): Record<string, T>;
    /**
     * 交换对象的键名
     */
    static renameKeys<T extends Record<string, unknown>>(obj: T, keyMap: Record<string, string>): Partial<T>;
    /**
     * 更新对象的指定键
     */
    static update<T extends Record<string, unknown>, K extends keyof T>(obj: T, key: K, updater: (value: T[K]) => T[K]): T;
}
