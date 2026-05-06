/**
 * 配置路径工具模块
 * 提供配置路径的解析、访问和操作功能
 * 被 ConfigManager、ConfigValidator 内部使用
 *
 * @module config/path-utils
 */

import type { ConfigPathMetadata } from './types';

/**
 * PathUtils - 配置路径工具类
 *
 * 提供点号分隔路径（如 'memoryService.storage.dbPath'）的 get/set/delete 操作，
 * 是 ConfigManager 的核心依赖。
 */
export class PathUtils {
  /**
   * 解析路径字符串为数组
   *
   * @param path - 路径字符串（如 'palace.basePath'）
   * @returns 路径数组（如 ['palace', 'basePath']）
   */
  static parsePath(path: string): string[] {
    if (!path || path.trim() === '') {
      return [];
    }
    return path
      .split(/\.|\[(\d+)\]/)
      .filter(part => part !== undefined && part !== '');
  }

  /**
   * 从对象中获取路径值
   *
   * @param obj - 源对象
   * @param path - 路径字符串
   * @returns 路径对应的值，如果不存在则返回 undefined
   */
  static getByPath(obj: unknown, path: string): unknown {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }
    const pathArray = this.parsePath(path);
    if (pathArray.length === 0) {
      return obj;
    }

    let current: any = obj;
    for (const key of pathArray) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      const indexMatch = key.match(/^\d+$/);
      if (indexMatch && Array.isArray(current)) {
        const index = parseInt(key, 10);
        current = current[index];
      } else {
        current = current[key];
      }
    }
    return current;
  }

  /**
   * 设置对象路径值
   *
   * @param obj - 目标对象
   * @param path - 路径字符串
   * @param value - 要设置的值
   */
  static setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const pathArray = this.parsePath(path);
    if (pathArray.length === 0) {
      return;
    }

    let current: any = obj;
    for (let i = 0; i < pathArray.length - 1; i++) {
      const key = pathArray[i];
      if (!(key in current) || current[key] === undefined) {
        const nextKey = pathArray[i + 1];
        const isNextIndex = /^\d+$/.test(nextKey);
        current[key] = isNextIndex ? [] : {};
      }
      const nextValue = current[key];
      if (typeof nextValue === 'object' && nextValue !== null) {
        current = nextValue;
      } else {
        return;
      }
    }

    const lastKey = pathArray[pathArray.length - 1];
    if (/^\d+$/.test(lastKey) && Array.isArray(current)) {
      const index = parseInt(lastKey, 10);
      current[index] = value;
    } else {
      current[lastKey] = value;
    }
  }

  /**
   * 删除对象路径值
   *
   * @param obj - 目标对象
   * @param path - 路径字符串
   * @returns 是否成功删除
   */
  static deleteByPath(obj: Record<string, unknown>, path: string): boolean {
    const pathArray = this.parsePath(path);
    if (pathArray.length === 0) {
      return false;
    }

    let current: any = obj;
    for (let i = 0; i < pathArray.length - 1; i++) {
      const key = pathArray[i];
      if (typeof current !== 'object' || current === null) {
        return false;
      }
      current = current[key];
    }

    const lastKey = pathArray[pathArray.length - 1];
    if (typeof current === 'object' && current !== null) {
      if (lastKey in current) {
        delete current[lastKey];
        return true;
      }
    }
    return false;
  }

  /**
   * 检查路径是否存在
   *
   * @param obj - 源对象
   * @param path - 路径字符串
   * @returns 路径是否存在
   */
  static hasPath(obj: unknown, path: string): boolean {
    const pathArray = this.parsePath(path);
    if (pathArray.length === 0) {
      return obj !== undefined && obj !== null;
    }

    let current: any = obj;
    for (const key of pathArray) {
      if (current === null || current === undefined) {
        return false;
      }
      if (typeof current !== 'object') {
        return false;
      }
      if (/^\d+$/.test(key) && Array.isArray(current)) {
        const index = parseInt(key, 10);
        if (index >= current.length) {
          return false;
        }
        current = current[index];
      } else {
        if (!(key in current)) {
          return false;
        }
        current = current[key];
      }
    }
    return current !== undefined;
  }

  /**
   * 获取路径元数据
   *
   * @param path - 路径字符串
   * @returns 路径元数据
   */
  static getPathMetadata(path: string): ConfigPathMetadata {
    const pathArray = this.parsePath(path);
    const isRoot = pathArray.length === 0;
    let parentPath = '';
    let key = '';

    if (pathArray.length > 0) {
      key = pathArray[pathArray.length - 1];
      parentPath = pathArray.slice(0, -1).join('.');
    }

    return {
      pathArray,
      parentPath,
      key,
      isRoot,
    };
  }

  /**
   * 构建路径字符串
   *
   * @param parts - 路径部分数组
   * @returns 路径字符串
   */
  static buildPath(parts: string[]): string {
    return parts.join('.');
  }

  /**
   * 获取父路径
   *
   * @param path - 路径字符串
   * @returns 父路径字符串
   */
  static getParentPath(path: string): string {
    const parts = this.parsePath(path);
    if (parts.length <= 1) {
      return '';
    }
    return this.buildPath(parts.slice(0, -1));
  }

  /**
   * 拼接路径
   *
   * @param basePath - 基础路径
   * @param subPath - 子路径
   * @returns 拼接后的路径
   */
  static joinPath(basePath: string, subPath: string): string {
    const baseParts = this.parsePath(basePath);
    const subParts = this.parsePath(subPath);
    return this.buildPath([...baseParts, ...subParts]);
  }
}
