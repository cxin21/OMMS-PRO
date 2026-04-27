/**
 * 文件工具模块
 * 提供文件路径处理、大小格式化、目录操作等功能
 *
 * @module utils/file
 * @since 0.1.0
 */
import { join, resolve, normalize, dirname, basename, extname, parse, relative, isAbsolute } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { cwd } from 'node:process';
import { mkdir, access, stat, constants as fsConstants } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
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
export class FileUtils {
    /**
     * 解析文件路径
     *
     * @param filePath - 文件路径
     * @returns 解析结果
     */
    static parsePath(filePath) {
        const parsed = parse(filePath);
        return {
            root: parsed.root,
            dir: parsed.dir,
            base: parsed.base,
            ext: parsed.ext,
            name: parsed.name,
        };
    }
    /**
     * 格式化文件大小
     *
     * @param bytes - 字节数
     * @param options - 格式化选项
     * @returns 格式化后的字符串
     */
    static formatSize(bytes, options) {
        const { decimals = 2, unit, binary = false, } = options ?? {};
        if (bytes === 0) {
            return '0 B';
        }
        const k = binary ? 1024 : 1000;
        const units = binary
            ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
            : ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        let i = 0;
        if (unit) {
            i = units.indexOf(unit);
            if (i === -1) {
                i = 0;
            }
        }
        else {
            i = Math.floor(Math.log(bytes) / Math.log(k));
        }
        const size = (bytes / Math.pow(k, i)).toFixed(decimals);
        return `${size} ${units[i]}`;
    }
    /**
     * 解析文件大小字符串
     *
     * @param size - 大小字符串（如 "1.5 MB"）
     * @returns 字节数
     */
    static parseSize(size) {
        const units = {
            B: 1,
            KB: 1000,
            MB: 1000 * 1000,
            GB: 1000 * 1000 * 1000,
            TB: 1000 * 1000 * 1000 * 1000,
            PB: 1000 * 1000 * 1000 * 1000 * 1000,
            KiB: 1024,
            MiB: 1024 * 1024,
            GiB: 1024 * 1024 * 1024,
            TiB: 1024 * 1024 * 1024 * 1024,
            PiB: 1024 * 1024 * 1024 * 1024 * 1024,
        };
        const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB|KiB|MiB|GiB|TiB|PiB)?$/i);
        if (!match) {
            throw new Error(`Invalid size format: ${size}`);
        }
        const value = parseFloat(match[1]);
        const unit = (match[2] || 'B').toUpperCase();
        return value * (units[unit] || 1);
    }
    /**
     * 确保目录存在
     *
     * @param dirPath - 目录路径
     * @returns 是否创建了新目录
     */
    static async ensureDir(dirPath) {
        try {
            await access(dirPath, fsConstants.F_OK);
            return false; // 目录已存在
        }
        catch {
            await mkdir(dirPath, { recursive: true });
            return true; // 创建了新目录
        }
    }
    /**
     * 确保目录存在（别名，为了兼容性）
     * @alias ensureDir
     */
    static async ensureDirectory(dirPath) {
        return this.ensureDir(dirPath);
    }
    /**
     * 检查文件是否存在
     */
    static async fileExists(filePath) {
        try {
            await access(filePath, fsConstants.F_OK);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 检查文件是否存在（别名，为了兼容性）
     * @alias fileExists
     */
    static async exists(filePath) {
        return this.fileExists(filePath);
    }
    /**
     * 检查是否是目录
     */
    static async isDirectory(dirPath) {
        try {
            const stats = await stat(dirPath);
            return stats.isDirectory();
        }
        catch {
            return false;
        }
    }
    /**
     * 检查是否是文件
     */
    static async isFile(filePath) {
        try {
            const stats = await stat(filePath);
            return stats.isFile();
        }
        catch {
            return false;
        }
    }
    /**
     * 获取文件大小
     */
    static async getFileSize(filePath) {
        const stats = await stat(filePath);
        return stats.size;
    }
    /**
     * 获取文件扩展名
     */
    static getExtension(filePath) {
        return extname(filePath);
    }
    /**
     * 获取文件名（不含扩展名）
     */
    static getFileName(filePath) {
        const base = basename(filePath);
        const ext = extname(base);
        return base.slice(0, -ext.length);
    }
    /**
     * 获取完整文件名（含扩展名）
     */
    static getBaseName(filePath) {
        return basename(filePath);
    }
    /**
     * 获取目录路径
     */
    static getDirPath(filePath) {
        return dirname(filePath);
    }
    /**
     * 连接路径
     */
    static joinPath(...paths) {
        return join(...paths);
    }
    /**
     * 解析绝对路径
     */
    static resolvePath(...paths) {
        return resolve(...paths);
    }
    /**
     * 标准化路径
     */
    static normalizePath(filePath) {
        return normalize(filePath);
    }
    /**
     * 判断是否是绝对路径
     */
    static isAbsolutePath(filePath) {
        return isAbsolute(filePath);
    }
    /**
     * 判断是否是相对路径
     */
    static isRelativePath(filePath) {
        return !isAbsolute(filePath);
    }
    /**
     * 获取相对路径
     */
    static getRelativePath(from, to) {
        return relative(from, to);
    }
    /**
     * 展开波浪号路径（~/）
     */
    static expandTilde(filePath) {
        if (filePath.startsWith('~')) {
            return join(homedir(), filePath.slice(1));
        }
        return filePath;
    }
    /**
     * 收缩路径为波浪号格式
     */
    static contractPath(filePath) {
        const home = homedir();
        if (filePath.startsWith(home)) {
            return filePath.replace(home, '~');
        }
        return filePath;
    }
    /**
     * 获取文件 MIME 类型（简单实现）
     */
    static getMimeType(filePath) {
        const ext = extname(filePath).toLowerCase();
        const mimeTypes = {
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.zip': 'application/zip',
            '.tar': 'application/x-tar',
            '.gz': 'application/gzip',
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }
    /**
     * 判断是否是文本文件
     */
    static isTextFile(filePath) {
        const textExtensions = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts', '.log'];
        const ext = extname(filePath).toLowerCase();
        return textExtensions.includes(ext);
    }
    /**
     * 判断是否是二进制文件
     */
    static isBinaryFile(filePath) {
        return !this.isTextFile(filePath);
    }
    /**
     * 判断是否是隐藏文件
     */
    static isHiddenFile(filePath) {
        const name = basename(filePath);
        return name.startsWith('.');
    }
    /**
     * 判断是否是临时文件
     */
    static isTempFile(filePath) {
        const name = basename(filePath);
        const tempPatterns = ['.tmp', '.temp', '~$', '$', '.swp', '.bak'];
        return tempPatterns.some(pattern => name.includes(pattern));
    }
    /**
     * 生成临时文件路径
     */
    static tempPath(prefix = 'tmp', extension = '') {
        const name = `${prefix}_${randomUUID()}${extension}`;
        return join(tmpdir(), name);
    }
    /**
     * 获取文件最后修改时间
     */
    static async getModifiedTime(filePath) {
        const stats = await stat(filePath);
        return stats.mtimeMs;
    }
    /**
     * 获取文件创建时间
     */
    static async getCreatedTime(filePath) {
        const stats = await stat(filePath);
        return stats.ctimeMs;
    }
    /**
     * 获取文件访问时间
     */
    static async getAccessTime(filePath) {
        const stats = await stat(filePath);
        return stats.atimeMs;
    }
    /**
     * 判断文件是否过期
     */
    static async isFileExpired(filePath, maxAge) {
        const mtime = await this.getModifiedTime(filePath);
        return Date.now() - mtime > maxAge;
    }
    /**
     * 计算路径深度
     */
    static getPathDepth(filePath) {
        const normalized = normalize(filePath);
        const parts = normalized.split(isAbsolute(filePath) ? '/' : '\\').filter(p => p.length > 0);
        return parts.length;
    }
    /**
     * 获取父目录
     */
    static getParentDir(filePath) {
        return dirname(filePath);
    }
    /**
     * 改变文件扩展名
     */
    static changeExtension(filePath, newExt) {
        const parsed = this.parsePath(filePath);
        return join(parsed.dir, parsed.name + newExt);
    }
    /**
     * 添加文件扩展名
     */
    static addExtension(filePath, ext) {
        if (!ext.startsWith('.')) {
            ext = '.' + ext;
        }
        return filePath + ext;
    }
    /**
     * 移除文件扩展名
     */
    static removeExtension(filePath) {
        const parsed = this.parsePath(filePath);
        return join(parsed.dir, parsed.name);
    }
    /**
     * 路径安全（移除非法字符）
     */
    static sanitizePath(filePath) {
        // 移除 Windows 非法字符
        const illegalChars = /[<>:"|?*]/g;
        return filePath.replace(illegalChars, '_');
    }
    /**
     * 比较两个路径是否相同
     */
    static isSamePath(path1, path2) {
        const normalized1 = normalize(resolve(path1)).toLowerCase();
        const normalized2 = normalize(resolve(path2)).toLowerCase();
        return normalized1 === normalized2;
    }
    /**
     * 获取公共父目录
     */
    static getCommonParentPath(...paths) {
        if (paths.length === 0) {
            return '';
        }
        if (paths.length === 1) {
            return dirname(paths[0]);
        }
        const normalized = paths.map(p => normalize(resolve(p)).split(/[\\/]/));
        const minLength = Math.min(...normalized.map(p => p.length));
        const common = [];
        for (let i = 0; i < minLength; i++) {
            const part = normalized[0][i];
            if (normalized.every(p => p[i] === part)) {
                common.push(part);
            }
            else {
                break;
            }
        }
        return common.length > 0 ? (isAbsolute(paths[0]) ? '/' : '') + common.join('/') : '';
    }
    /**
     * 路径转义（用于命令行）
     */
    static escapePath(filePath) {
        if (filePath.includes(' ') || filePath.includes("'") || filePath.includes('"')) {
            return `"${filePath.replace(/"/g, '\\"')}"`;
        }
        return filePath;
    }
    /**
     * 计算路径哈希
     */
    static hashPath(filePath) {
        const normalized = normalize(filePath);
        const hash = createHash('md5');
        hash.update(normalized);
        return hash.digest('hex');
    }
    /**
     * 判断路径是否在另一个路径内
     */
    static isPathInside(childPath, parentPath) {
        const relativePath = relative(parentPath, childPath);
        return !relativePath.startsWith('..') && !isAbsolute(relativePath);
    }
    /**
     * 创建目录路径数组
     */
    static getPathParts(filePath) {
        const normalized = normalize(filePath);
        return normalized.split(/[\\/]/).filter(p => p.length > 0);
    }
    /**
     * 从部分构建路径
     */
    static fromPathParts(parts, absolute = false) {
        const path = join(...parts);
        return absolute ? resolve(path) : path;
    }
    /**
     * 获取当前工作目录
     */
    static getCurrentDir() {
        return cwd();
    }
    /**
     * 获取用户主目录
     */
    static getHomeDir() {
        return homedir();
    }
    /**
     * 获取临时目录
     */
    static getTempDir() {
        return tmpdir();
    }
}
