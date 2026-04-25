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
export class ObjectUtils {
  /**
   * 深拷贝对象
   * 
   * @param obj - 源对象
   * @param options - 克隆选项
   * @returns 克隆后的对象
   */
  static deepClone<T>(obj: T, options?: CloneOptions): T {
    const opts: CloneOptions = {
      circular: false,
      customClone: undefined,
      ...options,
    };

    // 使用自定义克隆函数
    if (opts.customClone) {
      const customResult = opts.customClone(obj);
      if (customResult !== undefined) {
        return customResult as T;
      }
    }

    // 处理 null、undefined、基本类型
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // 处理日期
    if (obj instanceof Date) {
      return new Date(obj.getTime()) as T;
    }

    // 处理正则
    if (obj instanceof RegExp) {
      return new RegExp(obj.source, obj.flags) as T;
    }

    // 处理 Map
    if (obj instanceof Map) {
      const map = new Map();
      for (const [key, value] of obj.entries()) {
        map.set(key, this.deepClone(value, opts));
      }
      return map as T;
    }

    // 处理 Set
    if (obj instanceof Set) {
      const set = new Set();
      for (const value of obj) {
        set.add(this.deepClone(value, opts));
      }
      return set as T;
    }

    // 处理 ArrayBuffer
    if (obj instanceof ArrayBuffer) {
      return obj.slice(0) as T;
    }

    // 处理 TypedArray
    if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
      const TypedArray = Object.getPrototypeOf(obj).constructor;
      return new TypedArray(obj) as T;
    }

    // 处理数组
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item, opts)) as T;
    }

    // 处理普通对象
    const cloned: Record<string, unknown> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = this.deepClone(obj[key], opts);
      }
    }

    return cloned as T;
  }

  /**
   * 深比较两个对象
   * 
   * @param a - 对象 A
   * @param b - 对象 B
   * @param options - 比较选项
   * @returns 是否相等
   */
  static deepEqual(a: unknown, b: unknown, options?: CompareOptions): boolean {
    const opts: CompareOptions = {
      strict: false,
      ignoreKeys: [],
      ...options,
    };

    // 同一引用或值
    if (a === b) {
      return true;
    }

    // null 和 undefined 不相等
    if (a == null || b == null) {
      return false;
    }

    // 类型不同
    if (typeof a !== typeof b) {
      return false;
    }

    // 基本类型
    if (typeof a !== 'object') {
      if (opts.strict) {
        return a === b;
      }
      return a == b;
    }

    // 构造函数不同
    if (a.constructor !== b.constructor) {
      return false;
    }

    // 日期比较
    if (a instanceof Date) {
      return a.getTime() === (b as Date).getTime();
    }

    // 正则比较
    if (a instanceof RegExp) {
      return a.source === (b as RegExp).source && a.flags === (b as RegExp).flags;
    }

    // Map 比较
    if (a instanceof Map) {
      if ((a as Map<unknown, unknown>).size !== (b as Map<unknown, unknown>).size) {
        return false;
      }
      for (const [key, value] of a.entries()) {
        if (!(b as Map<unknown, unknown>).has(key)) {
          return false;
        }
        if (!this.deepEqual(value, (b as Map<unknown, unknown>).get(key), opts)) {
          return false;
        }
      }
      return true;
    }

    // Set 比较
    if (a instanceof Set) {
      if ((a as Set<unknown>).size !== (b as Set<unknown>).size) {
        return false;
      }
      for (const value of a) {
        if (!(b as Set<unknown>).has(value)) {
          return false;
        }
      }
      return true;
    }

    // ArrayBuffer 比较
    if (a instanceof ArrayBuffer) {
      const a1 = new Uint8Array(a);
      const b1 = new Uint8Array(b as ArrayBuffer);
      if (a1.length !== b1.length) {
        return false;
      }
      for (let i = 0; i < a1.length; i++) {
        if (a1[i] !== b1[i]) {
          return false;
        }
      }
      return true;
    }

    // 数组比较
    if (Array.isArray(a)) {
      const arrA = a;
      const arrB = b as unknown[];
      if (arrA.length !== arrB.length) {
        return false;
      }
      for (let i = 0; i < arrA.length; i++) {
        if (!this.deepEqual(arrA[i], arrB[i], opts)) {
          return false;
        }
      }
      return true;
    }

    // 对象比较
    const keysA = Object.keys(a).filter(key => !opts.ignoreKeys?.includes(key));
    const keysB = Object.keys(b).filter(key => !opts.ignoreKeys?.includes(key));

    if (keysA.length !== keysB.length) {
      return false;
    }

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        return false;
      }
      if (!this.deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], opts)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 从对象中获取路径值
   * 
   * @param obj - 源对象
   * @param path - 路径字符串（如 'user.name'）
   * @param options - 选项
   * @returns 路径对应的值
   */
  static getByPath(obj: unknown, path: string, options?: PathOptions): unknown {
    const opts: PathOptions = {
      defaultValue: undefined,
      throwIfMissing: false,
      ...options,
    };

    if (!obj || typeof obj !== 'object') {
      if (opts.throwIfMissing) {
        throw new Error(`Cannot get path "${path}" from non-object`);
      }
      return opts.defaultValue;
    }

    const parts = path.split(/\.|\[(\d+)\]/).filter(p => p !== undefined && p !== '');
    let current: unknown = obj;

    for (const key of parts) {
      if (current === null || current === undefined) {
        if (opts.throwIfMissing) {
          throw new Error(`Path "${path}" not found: missing at "${key}"`);
        }
        return opts.defaultValue;
      }

      if (typeof current !== 'object') {
        if (opts.throwIfMissing) {
          throw new Error(`Path "${path}" not found: "${key}" is not an object`);
        }
        return opts.defaultValue;
      }

      // 数组索引
      if (/^\d+$/.test(key) && Array.isArray(current)) {
        const index = parseInt(key, 10);
        current = current[index];
      } else {
        current = (current as Record<string, unknown>)[key];
      }
    }

    if (current === undefined && opts.throwIfMissing) {
      throw new Error(`Path "${path}" not found`);
    }

    return current ?? opts.defaultValue;
  }

  /**
   * 设置对象路径值
   * 
   * @param obj - 目标对象
   * @param path - 路径字符串
   * @param value - 值
   * @returns 新对象
   */
  static setByPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
    const result = this.deepClone(obj);
    const parts = path.split(/\.|\[(\d+)\]/).filter(p => p !== undefined && p !== '');

    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      
      if (!(key in current) || current[key] === undefined) {
        const nextKey = parts[i + 1];
        const isNextIndex = /^\d+$/.test(nextKey);
        current[key] = isNextIndex ? [] : {};
      }

      const nextValue = current[key];
      if (typeof nextValue === 'object' && nextValue !== null) {
        current = nextValue as Record<string, unknown>;
      } else {
        throw new Error(`Cannot set path "${path}": "${key}" is not an object`);
      }
    }

    const lastKey = parts[parts.length - 1];
    if (/^\d+$/.test(lastKey) && Array.isArray(current)) {
      const index = parseInt(lastKey, 10);
      current[index] = value;
    } else {
      current[lastKey] = value;
    }

    return result;
  }

  /**
   * 删除对象路径值
   */
  static deleteByPath<T extends Record<string, unknown>>(obj: T, path: string): T {
    const result = this.deepClone(obj);
    const parts = path.split(/\.|\[(\d+)\]/).filter(p => p !== undefined && p !== '');

    let current: unknown = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      
      if (typeof current !== 'object' || current === null) {
        return result;
      }

      current = (current as Record<string, unknown>)[key];
    }

    const lastKey = parts[parts.length - 1];
    if (typeof current === 'object' && current !== null) {
      if (/^\d+$/.test(lastKey) && Array.isArray(current)) {
        const index = parseInt(lastKey, 10);
        if (index < (current as unknown[]).length) {
          (current as unknown[]).splice(index, 1);
        }
      } else {
        delete (current as Record<string, unknown>)[lastKey];
      }
    }

    return result;
  }

  /**
   * 检查路径是否存在
   */
  static hasPath(obj: unknown, path: string): boolean {
    if (!obj || typeof obj !== 'object') {
      return false;
    }

    const parts = path.split(/\.|\[(\d+)\]/).filter(p => p !== undefined && p !== '');
    let current: unknown = obj;

    for (const key of parts) {
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
        current = (current as Record<string, unknown>)[key];
      }
    }

    return current !== undefined;
  }

  /**
   * 对象扁平化
   * 
   * @param obj - 源对象
   * @param separator - 键分隔符（默认 '.'）
   * @returns 扁平化后的对象
   */
  static flatten(obj: Record<string, unknown>, separator = '.'): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const flattenRecursive = (current: unknown, prefix: string): void => {
      if (current === null || typeof current !== 'object') {
        result[prefix] = current;
        return;
      }

      if (Array.isArray(current)) {
        current.forEach((item, index) => {
          flattenRecursive(item, `${prefix}${separator}${index}`);
        });
        return;
      }

      for (const key in current) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          const newKey = prefix ? `${prefix}${separator}${key}` : key;
          flattenRecursive((current as Record<string, unknown>)[key], newKey);
        }
      }
    };

    flattenRecursive(obj, '');
    return result;
  }

  /**
   * 对象解扁平化
   */
  static unflatten(obj: Record<string, unknown>, separator = '.'): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const parts = key.split(separator);
        let current: Record<string, unknown> = result;

        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          
          if (!(part in current)) {
            const nextPart = parts[i + 1];
            const isNextIndex = /^\d+$/.test(nextPart);
            current[part] = isNextIndex ? [] : {};
          }

          current = current[part] as Record<string, unknown>;
        }

        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart) && Array.isArray(current)) {
          const index = parseInt(lastPart, 10);
          current[index] = obj[key];
        } else {
          current[lastPart] = obj[key];
        }
      }
    }

    return result;
  }

  /**
   * 过滤对象
   */
  static filter<T extends Record<string, unknown>>(
    obj: T,
    predicate: (value: unknown, key: string, obj: T) => boolean
  ): Partial<T> {
    const result: Partial<T> = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (predicate(obj[key], key, obj)) {
          result[key] = obj[key];
        }
      }
    }

    return result;
  }

  /**
   * 映射对象
   */
  static map<T extends Record<string, unknown>, R>(
    obj: T,
    mapper: (value: T[keyof T], key: string, obj: T) => R
  ): Record<string, R> {
    const result: Record<string, R> = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = mapper(obj[key], key, obj);
      }
    }

    return result;
  }

  /**
   * 合并对象（深合并）
   */
  static merge<T extends Record<string, unknown>>(...objects: Array<Partial<T>>): T {
    const result: Record<string, unknown> = {};

    for (const obj of objects) {
      if (!obj || typeof obj !== 'object') {
        continue;
      }

      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const sourceValue = obj[key];
          const targetValue = result[key];

          if (
            typeof sourceValue === 'object' &&
            typeof targetValue === 'object' &&
            !Array.isArray(sourceValue) &&
            !Array.isArray(targetValue) &&
            targetValue !== null
          ) {
            result[key] = this.merge(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>);
          } else {
            result[key] = sourceValue;
          }
        }
      }
    }

    return result as T;
  }

  /**
   * 提取对象的键
   */
  static keys<T extends Record<string, unknown>>(obj: T): (keyof T)[] {
    return Object.keys(obj) as (keyof T)[];
  }

  /**
   * 提取对象的值
   */
  static values<T extends Record<string, unknown>>(obj: T): T[keyof T][] {
    return Object.values(obj) as T[keyof T][];
  }

  /**
   * 提取对象的键值对
   */
  static entries<T extends Record<string, unknown>>(obj: T): [keyof T, T[keyof T]][] {
    return Object.entries(obj) as [keyof T, T[keyof T]][];
  }

  /**
   * 反转对象（键值互换）
   */
  static invert<T extends Record<string, string | number | symbol>>(obj: T): Record<string | number | symbol, keyof T> {
    const result: Record<string | number | symbol, keyof T> = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[obj[key]] = key;
      }
    }

    return result;
  }

  /**
   * 选择对象的指定键
   */
  static pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
    const result: Partial<Pick<T, K>> = {};

    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }

    return result as Pick<T, K>;
  }

  /**
   * 排除对象的指定键
   */
  static omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
    const result: Partial<T> = { ...obj };

    for (const key of keys) {
      delete result[key];
    }

    return result as Omit<T, K>;
  }

  /**
   * 获取对象大小（键数量）
   */
  static size(obj: Record<string, unknown>): number {
    return Object.keys(obj).length;
  }

  /**
   * 判断对象是否为空
   */
  static isEmpty(obj: unknown): boolean {
    if (obj === null || obj === undefined) {
      return true;
    }

    if (typeof obj !== 'object') {
      return false;
    }

    return Object.keys(obj).length === 0;
  }

  /**
   * 清除对象（移除所有键）
   */
  static clear<T extends Record<string, unknown>>(obj: T): T {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        delete obj[key];
      }
    }
    return obj;
  }

  /**
   * 冻结对象（深度）
   */
  static deepFreeze<T>(obj: T): Readonly<T> {
    if (obj === null || typeof obj !== 'object') {
      return obj as Readonly<T>;
    }

    Object.freeze(obj);

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = (obj as Record<string, unknown>)[key];
        if (typeof value === 'object' && value !== null) {
          this.deepFreeze(value);
        }
      }
    }

    return obj as Readonly<T>;
  }

  /**
   * 将对象转换为 Map
   */
  static toMap<T>(obj: Record<string, T>): Map<string, T> {
    return new Map(Object.entries(obj));
  }

  /**
   * 将 Map 转换为对象
   */
  static fromMap<T>(map: Map<string, T>): Record<string, T> {
    const obj: Record<string, T> = {};
    for (const [key, value] of map.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  /**
   * 交换对象的键名
   */
  static renameKeys<T extends Record<string, unknown>>(
    obj: T,
    keyMap: Record<string, string>
  ): Partial<T> {
    const result: Partial<T> = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const newKey = keyMap[key] || key;
        result[newKey as keyof T] = obj[key];
      }
    }

    return result;
  }

  /**
   * 更新对象的指定键
   */
  static update<T extends Record<string, unknown>, K extends keyof T>(
    obj: T,
    key: K,
    updater: (value: T[K]) => T[K]
  ): T {
    return {
      ...obj,
      [key]: updater(obj[key]),
    };
  }
}
