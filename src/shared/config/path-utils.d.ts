/**
 * 配置路径工具模块
 * 提供配置路径的解析、访问和操作功能
 *
 * @module config/path-utils
 * @deprecated 直接使用 utils/object 和 utils/file 模块
 */
import type { ConfigPathMetadata } from './types';
/**
 * PathUtils - 配置路径工具类（已废弃）
 *
 * @deprecated 新代码应直接使用 ObjectUtils 和 FileUtils
 *
 * 为了保持向后兼容而保留，功能已委托给 utils 模块
 */
export declare class PathUtils {
    /**
     * 解析路径字符串为数组
     *
     * @param path - 路径字符串（如 'palace.basePath'）
     * @returns 路径数组（如 ['palace', 'basePath']）
     */
    static parsePath(path: string): string[];
    /**
     * 从对象中获取路径值
     *
     * @param obj - 源对象
     * @param path - 路径字符串
     * @returns 路径对应的值，如果不存在则返回 undefined
     */
    static getByPath(obj: unknown, path: string): unknown;
    /**
     * 设置对象路径值
     *
     * @param obj - 目标对象
     * @param path - 路径字符串
     * @param value - 要设置的值
     */
    static setByPath(obj: Record<string, unknown>, path: string, value: unknown): void;
    /**
     * 删除对象路径值
     *
     * @param obj - 目标对象
     * @param path - 路径字符串
     * @returns 是否成功删除
     */
    static deleteByPath(obj: Record<string, unknown>, path: string): boolean;
    /**
     * 检查路径是否存在
     *
     * @param obj - 源对象
     * @param path - 路径字符串
     * @returns 路径是否存在
     */
    static hasPath(obj: unknown, path: string): boolean;
    /**
     * 获取路径元数据
     *
     * @param path - 路径字符串
     * @returns 路径元数据
     */
    static getPathMetadata(path: string): ConfigPathMetadata;
    /**
     * 构建路径字符串
     *
     * @param parts - 路径部分数组
     * @returns 路径字符串
     */
    static buildPath(parts: string[]): string;
    /**
     * 获取父路径
     *
     * @param path - 路径字符串
     * @returns 父路径字符串
     */
    static getParentPath(path: string): string;
    /**
     * 拼接路径
     *
     * @param basePath - 基础路径
     * @param subPath - 子路径
     * @returns 拼接后的路径
     */
    static joinPath(basePath: string, subPath: string): string;
}
