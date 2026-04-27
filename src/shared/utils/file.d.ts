/**
 * 文件工具模块
 * 提供文件路径处理、大小格式化、目录操作等功能
 *
 * @module utils/file
 * @since 0.1.0
 */
import type { ParsedPath, FileSizeOptions } from './types';
/**
 * 文件工具类
 *
 * 提供文件路径处理、大小格式化、目录操作等功能
 *
 * @example
 * ```typescript
 * // 解析路径
 * const parsed = FileUtils.parsePath('/home/user/file.txt');
 *
 * // 格式化大小
 * const size = FileUtils.formatSize(1024 * 1024); // "1 MB"
 *
 * // 确保目录存在
 * await FileUtils.ensureDir('./data');
 * ```
 */
export declare class FileUtils {
    /**
     * 解析文件路径
     *
     * @param filePath - 文件路径
     * @returns 解析结果
     */
    static parsePath(filePath: string): ParsedPath;
    /**
     * 格式化文件大小
     *
     * @param bytes - 字节数
     * @param options - 格式化选项
     * @returns 格式化后的字符串
     */
    static formatSize(bytes: number, options?: FileSizeOptions): string;
    /**
     * 解析文件大小字符串
     *
     * @param size - 大小字符串（如 "1.5 MB"）
     * @returns 字节数
     */
    static parseSize(size: string): number;
    /**
     * 确保目录存在
     *
     * @param dirPath - 目录路径
     * @returns 是否创建了新目录
     */
    static ensureDir(dirPath: string): Promise<boolean>;
    /**
     * 确保目录存在（别名，为了兼容性）
     * @alias ensureDir
     */
    static ensureDirectory(dirPath: string): Promise<boolean>;
    /**
     * 检查文件是否存在
     */
    static fileExists(filePath: string): Promise<boolean>;
    /**
     * 检查文件是否存在（别名，为了兼容性）
     * @alias fileExists
     */
    static exists(filePath: string): Promise<boolean>;
    /**
     * 检查是否是目录
     */
    static isDirectory(dirPath: string): Promise<boolean>;
    /**
     * 检查是否是文件
     */
    static isFile(filePath: string): Promise<boolean>;
    /**
     * 获取文件大小
     */
    static getFileSize(filePath: string): Promise<number>;
    /**
     * 获取文件扩展名
     */
    static getExtension(filePath: string): string;
    /**
     * 获取文件名（不含扩展名）
     */
    static getFileName(filePath: string): string;
    /**
     * 获取完整文件名（含扩展名）
     */
    static getBaseName(filePath: string): string;
    /**
     * 获取目录路径
     */
    static getDirPath(filePath: string): string;
    /**
     * 连接路径
     */
    static joinPath(...paths: string[]): string;
    /**
     * 解析绝对路径
     */
    static resolvePath(...paths: string[]): string;
    /**
     * 标准化路径
     */
    static normalizePath(filePath: string): string;
    /**
     * 判断是否是绝对路径
     */
    static isAbsolutePath(filePath: string): boolean;
    /**
     * 判断是否是相对路径
     */
    static isRelativePath(filePath: string): boolean;
    /**
     * 获取相对路径
     */
    static getRelativePath(from: string, to: string): string;
    /**
     * 展开波浪号路径（~/）
     */
    static expandTilde(filePath: string): string;
    /**
     * 收缩路径为波浪号格式
     */
    static contractPath(filePath: string): string;
    /**
     * 获取文件 MIME 类型（简单实现）
     */
    static getMimeType(filePath: string): string;
    /**
     * 判断是否是文本文件
     */
    static isTextFile(filePath: string): boolean;
    /**
     * 判断是否是二进制文件
     */
    static isBinaryFile(filePath: string): boolean;
    /**
     * 判断是否是隐藏文件
     */
    static isHiddenFile(filePath: string): boolean;
    /**
     * 判断是否是临时文件
     */
    static isTempFile(filePath: string): boolean;
    /**
     * 生成临时文件路径
     */
    static tempPath(prefix?: string, extension?: string): string;
    /**
     * 获取文件最后修改时间
     */
    static getModifiedTime(filePath: string): Promise<number>;
    /**
     * 获取文件创建时间
     */
    static getCreatedTime(filePath: string): Promise<number>;
    /**
     * 获取文件访问时间
     */
    static getAccessTime(filePath: string): Promise<number>;
    /**
     * 判断文件是否过期
     */
    static isFileExpired(filePath: string, maxAge: number): Promise<boolean>;
    /**
     * 计算路径深度
     */
    static getPathDepth(filePath: string): number;
    /**
     * 获取父目录
     */
    static getParentDir(filePath: string): string;
    /**
     * 改变文件扩展名
     */
    static changeExtension(filePath: string, newExt: string): string;
    /**
     * 添加文件扩展名
     */
    static addExtension(filePath: string, ext: string): string;
    /**
     * 移除文件扩展名
     */
    static removeExtension(filePath: string): string;
    /**
     * 路径安全（移除非法字符）
     */
    static sanitizePath(filePath: string): string;
    /**
     * 比较两个路径是否相同
     */
    static isSamePath(path1: string, path2: string): boolean;
    /**
     * 获取公共父目录
     */
    static getCommonParentPath(...paths: string[]): string;
    /**
     * 路径转义（用于命令行）
     */
    static escapePath(filePath: string): string;
    /**
     * 计算路径哈希
     */
    static hashPath(filePath: string): string;
    /**
     * 判断路径是否在另一个路径内
     */
    static isPathInside(childPath: string, parentPath: string): boolean;
    /**
     * 创建目录路径数组
     */
    static getPathParts(filePath: string): string[];
    /**
     * 从部分构建路径
     */
    static fromPathParts(parts: string[], absolute?: boolean): string;
    /**
     * 获取当前工作目录
     */
    static getCurrentDir(): string;
    /**
     * 获取用户主目录
     */
    static getHomeDir(): string;
    /**
     * 获取临时目录
     */
    static getTempDir(): string;
}
