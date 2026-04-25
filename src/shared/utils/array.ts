/**
 * 数组工具模块
 * 提供数组操作、去重、分块、洗牌等功能
 * 
 * @module utils/array
 * @since 0.1.0
 */

import type { ChunkOptions, WeightedItem } from './types';

/**
 * 数组工具类
 * 
 * 提供数组去重、分块、洗牌、安全访问等功能
 * 
 * @example
 * ```typescript
 * // 数组去重
 * const unique = ArrayUtils.unique([1, 2, 2, 3]);
 * 
 * // 数组分块
 * const chunks = ArrayUtils.chunk([1, 2, 3, 4, 5], 2);
 * 
 * // 加权随机
 * const item = ArrayUtils.weightedRandom(items);
 * ```
 */
export class ArrayUtils {
  /**
   * 数组去重
   * 
   * @param array - 源数组
   * @param keyFn - 可选的键提取函数（用于对象数组）
   * @returns 去重后的数组
   */
  static unique<T>(array: T[], keyFn?: (item: T) => unknown): T[] {
    if (!array || array.length === 0) {
      return [];
    }

    if (keyFn) {
      const seen = new Set();
      return array.filter(item => {
        const key = keyFn(item);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }

    return [...new Set(array)];
  }

  /**
   * 数组分块
   * 
   * @param array - 源数组
   * @param options - 分块选项
   * @returns 分块后的二维数组
   */
  static chunk<T>(array: T[], options: number | ChunkOptions): T[][] {
    const opts = typeof options === 'number'
      ? { size: options, fill: false }
      : { ...options };  // 移除重复的 size 和 fill 属性
    
    const { size = 1, fill = false, fillValue } = opts;

    if (!array || array.length === 0 || size <= 0) {
      return [];
    }

    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      const chunk = array.slice(i, i + size);
      
      if (fill && chunk.length < size) {
        while (chunk.length < size) {
          chunk.push(fillValue as T);
        }
      }
      
      result.push(chunk);
    }

    return result;
  }

  /**
   * 数组洗牌（Fisher-Yates 算法）
   * 
   * @param array - 源数组
   * @returns 洗牌后的新数组
   */
  static shuffle<T>(array: T[]): T[] {
    if (!array || array.length === 0) {
      return [];
    }

    const result = [...array];
    
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  /**
   * 安全获取数组元素
   * 
   * @param array - 数组
   * @param index - 索引（支持负数）
   * @param defaultValue - 默认值
   * @returns 元素值或默认值
   */
  static safeGet<T>(array: T[], index: number, defaultValue?: T): T {
    if (!array || array.length === 0) {
      return defaultValue as T;
    }

    const normalizedIndex = index < 0 ? array.length + index : index;
    
    if (normalizedIndex < 0 || normalizedIndex >= array.length) {
      return defaultValue as T;
    }

    return array[normalizedIndex];
  }

  /**
   * 数组差异
   * 
   * @param array1 - 数组 1
   * @param array2 - 数组 2
   * @returns array1 中有但 array2 中没有的元素
   */
  static difference<T>(array1: T[], array2: T[]): T[] {
    if (!array1 || array1.length === 0) {
      return [];
    }
    
    if (!array2 || array2.length === 0) {
      return [...array1];
    }

    const set2 = new Set(array2);
    return array1.filter(item => !set2.has(item));
  }

  /**
   * 数组交集
   */
  static intersection<T>(array1: T[], array2: T[]): T[] {
    if (!array1 || array1.length === 0 || !array2 || array2.length === 0) {
      return [];
    }

    const set2 = new Set(array2);
    return array1.filter(item => set2.has(item));
  }

  /**
   * 数组并集
   */
  static union<T>(array1: T[], array2: T[]): T[] {
    const combined = [...(array1 || []), ...(array2 || [])];
    return this.unique(combined);
  }

  /**
   * 对称差异
   */
  static symmetricDifference<T>(array1: T[], array2: T[]): T[] {
    const diff1 = this.difference(array1, array2);
    const diff2 = this.difference(array2, array1);
    return [...diff1, ...diff2];
  }

  /**
   * 数组扁平化
   */
  static flatten<T>(array: T[] | T[][], depth = 1): T[] {
    if (!array || array.length === 0) {
      return [];
    }

    const result: T[] = [];
    
    const flattenRecursive = (arr: unknown[], currentDepth: number): void => {
      for (const item of arr) {
        if (Array.isArray(item) && currentDepth < depth) {
          flattenRecursive(item, currentDepth + 1);
        } else {
          result.push(item as T);
        }
      }
    };

    flattenRecursive(array as unknown[], 0);
    return result;
  }

  /**
   * 数组分组
   */
  static groupBy<T>(array: T[], keyFn: (item: T, index: number) => string): Record<string, T[]> {
    if (!array || array.length === 0) {
      return {};
    }

    const result: Record<string, T[]> = {};

    array.forEach((item, index) => {
      const key = keyFn(item, index);
      if (!result[key]) {
        result[key] = [];
      }
      result[key].push(item);
    });

    return result;
  }

  /**
   * 数组分区
   */
  static partition<T>(array: T[], predicate: (item: T, index: number) => boolean): [T[], T[]] {
    if (!array || array.length === 0) {
      return [[], []];
    }

    const truthy: T[] = [];
    const falsy: T[] = [];

    array.forEach((item, index) => {
      if (predicate(item, index)) {
        truthy.push(item);
      } else {
        falsy.push(item);
      }
    });

    return [truthy, falsy];
  }

  /**
   * 数组排序（稳定排序）
   */
  static sortBy<T>(array: T[], keyFn: (item: T) => number | string, ascending = true): T[] {
    if (!array || array.length === 0) {
      return [];
    }

    return [...array].sort((a, b) => {
      const keyA = keyFn(a);
      const keyB = keyFn(b);

      if (keyA < keyB) {
        return ascending ? -1 : 1;
      }
      if (keyA > keyB) {
        return ascending ? 1 : -1;
      }
      return 0;
    });
  }

  /**
   * 数组最大值
   */
  static max<T>(array: T[], keyFn?: (item: T) => number): T | undefined {
    if (!array || array.length === 0) {
      return undefined;
    }

    if (!keyFn) {
      return Math.max(...(array as number[])) as unknown as T;
    }

    let maxItem = array[0];
    let maxValue = keyFn(array[0]);

    for (let i = 1; i < array.length; i++) {
      const value = keyFn(array[i]);
      if (value > maxValue) {
        maxValue = value;
        maxItem = array[i];
      }
    }

    return maxItem;
  }

  /**
   * 数组最小值
   */
  static min<T>(array: T[], keyFn?: (item: T) => number): T | undefined {
    if (!array || array.length === 0) {
      return undefined;
    }

    if (!keyFn) {
      return Math.min(...(array as number[])) as unknown as T;
    }

    let minItem = array[0];
    let minValue = keyFn(array[0]);

    for (let i = 1; i < array.length; i++) {
      const value = keyFn(array[i]);
      if (value < minValue) {
        minValue = value;
        minItem = array[i];
      }
    }

    return minItem;
  }

  /**
   * 数组求和
   */
  static sum(array: number[]): number {
    if (!array || array.length === 0) {
      return 0;
    }
    return array.reduce((acc, val) => acc + val, 0);
  }

  /**
   * 数组平均值
   */
  static average(array: number[]): number {
    if (!array || array.length === 0) {
      return 0;
    }
    return this.sum(array) / array.length;
  }

  /**
   * 数组中位数
   */
  static median(array: number[]): number {
    if (!array || array.length === 0) {
      return 0;
    }

    const sorted = [...array].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    return sorted[mid];
  }

  /**
   * 数组众数
   */
  static mode(array: number[]): number[] {
    if (!array || array.length === 0) {
      return [];
    }

    const frequency: Record<number, number> = {};
    let maxFreq = 0;

    array.forEach(num => {
      frequency[num] = (frequency[num] || 0) + 1;
      maxFreq = Math.max(maxFreq, frequency[num]);
    });

    return Object.keys(frequency)
      .map(Number)
      .filter(num => frequency[num] === maxFreq);
  }

  /**
   * 数组填充
   */
  static fill<T>(array: T[], value: T, start = 0, end?: number): T[] {
    if (!array || array.length === 0) {
      return [];
    }

    const result = [...array];
    const actualEnd = end ?? result.length;

    for (let i = start; i < actualEnd && i < result.length; i++) {
      result[i] = value;
    }

    return result;
  }

  /**
   * 数组旋转
   */
  static rotate<T>(array: T[], steps: number): T[] {
    if (!array || array.length === 0) {
      return [];
    }

    const result = [...array];
    const actualSteps = ((steps % result.length) + result.length) % result.length;

    return [...result.slice(-actualSteps), ...result.slice(0, -actualSteps)];
  }

  /**
   * 数组合并（去重）
   */
  static merge<T>(...arrays: Array<T[]>): T[] {
    const merged: T[] = [];
    
    for (const array of arrays) {
      if (array && array.length > 0) {
        merged.push(...array);
      }
    }

    return this.unique(merged);
  }

  /**
   * 数组抽取
   */
  static sample<T>(array: T[], count = 1): T[] {
    if (!array || array.length === 0 || count <= 0) {
      return [];
    }

    const shuffled = this.shuffle(array);
    return shuffled.slice(0, Math.min(count, array.length));
  }

  /**
   * 加权随机选择
   */
  static weightedRandom<T>(items: WeightedItem<T>[]): T {
    if (!items || items.length === 0) {
      throw new Error('Items array cannot be empty');
    }

    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    
    if (totalWeight <= 0) {
      throw new Error('Total weight must be positive');
    }

    let random = Math.random() * totalWeight;
    
    for (const item of items) {
      if (random < item.weight) {
        return item.value;
      }
      random -= item.weight;
    }

    // Fallback
    return items[items.length - 1].value;
  }

  /**
   * 数组压缩（移除 falsy 值）
   */
  static compact<T>(array: T[]): NonNullable<T>[] {
    if (!array || array.length === 0) {
      return [];
    }

    return array.filter(item => {
      return item !== null && item !== undefined && item !== false && item !== '' && !Number.isNaN(item);
    }) as NonNullable<T>[];
  }

  /**
   * 数组拉链
   */
  static zip<T>(...arrays: Array<T[]>): T[][] {
    if (!arrays || arrays.length === 0) {
      return [];
    }

    const maxLength = Math.max(...arrays.map(arr => arr?.length || 0));
    const result: T[][] = [];

    for (let i = 0; i < maxLength; i++) {
      const group: T[] = [];
      for (const array of arrays) {
        group.push(array?.[i]);
      }
      result.push(group);
    }

    return result;
  }

  /**
   * 数组解拉链
   */
  static unzip<T>(array: T[][]): T[][] {
    if (!array || array.length === 0) {
      return [];
    }

    return this.zip(...array);
  }

  /**
   * 数组范围
   */
  static range(start: number, end: number, step = 1): number[] {
    if (step === 0) {
      throw new Error('Step cannot be zero');
    }

    const result: number[] = [];
    
    if (step > 0) {
      for (let i = start; i < end; i += step) {
        result.push(i);
      }
    } else {
      for (let i = start; i > end; i += step) {
        result.push(i);
      }
    }

    return result;
  }

  /**
   * 数组反转
   */
  static reverse<T>(array: T[]): T[] {
    if (!array || array.length === 0) {
      return [];
    }

    return [...array].reverse();
  }

  /**
   * 数组循环右移
   */
  static cycleRight<T>(array: T[], steps = 1): T[] {
    return this.rotate(array, steps);
  }

  /**
   * 数组循环左移
   */
  static cycleLeft<T>(array: T[], steps = 1): T[] {
    return this.rotate(array, -steps);
  }

  /**
   * 数组是否包含
   */
  static includes<T>(array: T[], value: T, fromIndex = 0): boolean {
    if (!array || array.length === 0) {
      return false;
    }

    const index = fromIndex < 0
      ? Math.max(0, array.length + fromIndex)
      : fromIndex;

    for (let i = index; i < array.length; i++) {
      if (array[i] === value) {
        return true;
      }
    }

    return false;
  }

  /**
   * 数组查找索引
   */
  static findIndex<T>(array: T[], predicate: (item: T, index: number) => boolean, fromIndex = 0): number {
    if (!array || array.length === 0) {
      return -1;
    }

    const index = fromIndex < 0
      ? Math.max(0, array.length + fromIndex)
      : fromIndex;

    for (let i = index; i < array.length; i++) {
      if (predicate(array[i], i)) {
        return i;
      }
    }

    return -1;
  }

  /**
   * 数组查找最后索引
   */
  static findLastIndex<T>(array: T[], predicate: (item: T, index: number) => boolean, fromIndex?: number): number {
    if (!array || array.length === 0) {
      return -1;
    }

    const index = fromIndex === undefined
      ? array.length - 1
      : fromIndex < 0
        ? Math.max(0, array.length + fromIndex)
        : fromIndex;

    for (let i = index; i >= 0; i--) {
      if (predicate(array[i], i)) {
        return i;
      }
    }

    return -1;
  }

  /**
   * 数组计数
   */
  static countBy<T>(array: T[], keyFn: (item: T) => string): Record<string, number> {
    const grouped = this.groupBy(array, keyFn);
    const result: Record<string, number> = {};

    for (const key in grouped) {
      if (Object.prototype.hasOwnProperty.call(grouped, key)) {
        result[key] = grouped[key].length;
      }
    }

    return result;
  }

  /**
   * 数组每个元素执行函数
   */
  static forEach<T>(array: T[], fn: (item: T, index: number, array: T[]) => void): void {
    if (!array || array.length === 0) {
      return;
    }

    array.forEach(fn);
  }

  /**
   * 数组映射
   */
  static map<T, R>(array: T[], fn: (item: T, index: number, array: T[]) => R): R[] {
    if (!array || array.length === 0) {
      return [];
    }

    return array.map(fn);
  }

  /**
   * 数组过滤
   */
  static filter<T>(array: T[], fn: (item: T, index: number, array: T[]) => boolean): T[] {
    if (!array || array.length === 0) {
      return [];
    }

    return array.filter(fn);
  }

  /**
   * 数组归约
   */
  static reduce<T, R>(array: T[], fn: (acc: R, item: T, index: number, array: T[]) => R, initial: R): R {
    if (!array || array.length === 0) {
      return initial;
    }

    return array.reduce(fn, initial);
  }

  /**
   * 数组是否相等
   */
  static equals<T>(array1: T[], array2: T[]): boolean {
    if (!array1 || !array2) {
      return false;
    }

    if (array1.length !== array2.length) {
      return false;
    }

    for (let i = 0; i < array1.length; i++) {
      if (array1[i] !== array2[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * 数组清空
   */
  static clear<T>(array: T[]): T[] {
    array.length = 0;
    return array;
  }

  /**
   * 获取数组第一个元素
   */
  static first<T>(array: T[]): T | undefined {
    return array?.[0];
  }

  /**
   * 获取数组最后一个元素
   */
  static last<T>(array: T[]): T | undefined {
    return array?.[array.length - 1];
  }

  /**
   * 获取数组初始部分（除最后一个元素）
   */
  static initial<T>(array: T[]): T[] {
    if (!array || array.length === 0) {
      return [];
    }
    return array.slice(0, -1);
  }

  /**
   * 获取数组尾部（除第一个元素）
   */
  static rest<T>(array: T[]): T[] {
    if (!array || array.length === 0) {
      return [];
    }
    return array.slice(1);
  }

  /**
   * 数组长度
   */
  static length<T>(array: T[]): number {
    return array?.length ?? 0;
  }

  /**
   * 判断是否为数组
   */
  static isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
  }

  /**
   * 判断是否为空数组
   */
  static isEmpty<T>(array: T[]): boolean {
    return !array || array.length === 0;
  }

  /**
   * 判断是否不为空数组
   */
  static isNotEmpty<T>(array: T[]): boolean {
    return !this.isEmpty(array);
  }
}
