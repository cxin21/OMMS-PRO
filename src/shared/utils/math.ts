/**
 * 数学工具模块
 * 提供数值计算、格式化、统计等功能
 * 
 * @module utils/math
 * @since 0.1.0
 */

import type { RandomOptions, WeightedItem } from './types';

/**
 * 数学工具类
 * 
 * 提供数值范围限制、格式化、统计计算等功能
 * 
 * @example
 * ```typescript
 * // 范围限制
 * const clamped = MathUtils.clamp(15, 0, 10); // 10
 * 
 * // 数值格式化
 * const formatted = MathUtils.format(1234.567, 2); // "1,234.57"
 * 
 * // 加权随机
 * const num = MathUtils.weightedRandom(items);
 * ```
 */
export class MathUtils {
  /**
   * 数值范围限制
   * 
   * @param value - 值
   * @param min - 最小值
   * @param max - 最大值
   * @returns 限制后的值
   */
  static clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * 数值格式化
   * 
   * @param value - 数值
   * @param decimals - 小数位数
   * @param options - 格式化选项
   * @returns 格式化后的字符串
   */
  static format(
    value: number,
    decimals = 2,
    options?: {
      thousandsSeparator?: string;
      decimalSeparator?: string;
      prefix?: string;
      suffix?: string;
    }
  ): string {
    const {
      thousandsSeparator = ',',
      decimalSeparator = '.',
      prefix = '',
      suffix = '',
    } = options ?? {};

    const fixed = value.toFixed(decimals);
    const parts = fixed.split('.');
    
    // 添加千位分隔符
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator);
    
    return `${prefix}${parts.join(decimalSeparator)}${suffix}`;
  }

  /**
   * 百分比计算
   * 
   * @param value - 值
   * @param total - 总数
   * @param decimals - 小数位数
   * @returns 百分比字符串
   */
  static percentage(value: number, total: number, decimals = 2): string {
    if (total === 0) {
      return '0%';
    }

    const percentage = (value / total) * 100;
    return `${percentage.toFixed(decimals)}%`;
  }

  /**
   * 计算平均值
   * 
   * @param numbers - 数值数组
   * @returns 平均值
   */
  static average(...numbers: number[]): number {
    if (numbers.length === 0) {
      return 0;
    }

    const sum = numbers.reduce((acc, val) => acc + val, 0);
    return sum / numbers.length;
  }

  /**
   * 计算加权平均值
   */
  static weightedAverage(items: Array<{ value: number; weight: number }>): number {
    if (items.length === 0) {
      return 0;
    }

    let totalWeight = 0;
    let weightedSum = 0;

    for (const item of items) {
      totalWeight += item.weight;
      weightedSum += item.value * item.weight;
    }

    if (totalWeight === 0) {
      return 0;
    }

    return weightedSum / totalWeight;
  }

  /**
   * 计算中位数
   */
  static median(...numbers: number[]): number {
    if (numbers.length === 0) {
      return 0;
    }

    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    return sorted[mid];
  }

  /**
   * 计算众数
   */
  static mode(...numbers: number[]): number[] {
    if (numbers.length === 0) {
      return [];
    }

    const frequency: Record<number, number> = {};
    let maxFreq = 0;

    numbers.forEach(num => {
      frequency[num] = (frequency[num] || 0) + 1;
      maxFreq = Math.max(maxFreq, frequency[num]);
    });

    return Object.keys(frequency)
      .map(Number)
      .filter(num => frequency[num] === maxFreq);
  }

  /**
   * 计算方差
   */
  static variance(...numbers: number[]): number {
    if (numbers.length === 0) {
      return 0;
    }

    const avg = this.average(...numbers);
    const squareDiffs = numbers.map(num => Math.pow(num - avg, 2));
    
    return this.average(...squareDiffs);
  }

  /**
   * 计算标准差
   */
  static standardDeviation(...numbers: number[]): number {
    return Math.sqrt(this.variance(...numbers));
  }

  /**
   * 计算几何平均数
   */
  static geometricMean(...numbers: number[]): number {
    if (numbers.length === 0) {
      return 0;
    }

    // 检查是否有负数
    if (numbers.some(n => n < 0)) {
      throw new Error('Geometric mean is not defined for negative numbers');
    }

    const product = numbers.reduce((acc, val) => acc * val, 1);
    return Math.pow(product, 1 / numbers.length);
  }

  /**
   * 计算调和平均数
   */
  static harmonicMean(...numbers: number[]): number {
    if (numbers.length === 0) {
      return 0;
    }

    // 检查是否有 0
    if (numbers.some(n => n === 0)) {
      return 0;
    }

    const sumOfReciprocals = numbers.reduce((acc, val) => acc + 1 / val, 0);
    return numbers.length / sumOfReciprocals;
  }

  /**
   * 计算增长率
   */
  static growthRate(initial: number, final: number): number {
    if (initial === 0) {
      return final === 0 ? 0 : Infinity;
    }

    return (final - initial) / Math.abs(initial);
  }

  /**
   * 计算复合增长率 (CAGR)
   */
  static cagr(initial: number, final: number, periods: number): number {
    if (initial <= 0 || periods <= 0) {
      throw new Error('Initial value and periods must be positive');
    }

    return Math.pow(final / initial, 1 / periods) - 1;
  }

  /**
   * 计算现值 (PV)
   */
  static presentValue(futureValue: number, rate: number, periods: number): number {
    return futureValue / Math.pow(1 + rate, periods);
  }

  /**
   * 计算终值 (FV)
   */
  static futureValue(presentValue: number, rate: number, periods: number): number {
    return presentValue * Math.pow(1 + rate, periods);
  }

  /**
   * 计算复利
   */
  static compoundInterest(
    principal: number,
    rate: number,
    timesCompounded: number,
    time: number
  ): number {
    return principal * Math.pow(1 + rate / timesCompounded, timesCompounded * time);
  }

  /**
   * 计算最大公约数 (GCD)
   */
  static gcd(a: number, b: number): number {
    a = Math.abs(a);
    b = Math.abs(b);

    while (b !== 0) {
      const temp = b;
      b = a % b;
      a = temp;
    }

    return a;
  }

  /**
   * 计算最小公倍数 (LCM)
   */
  static lcm(a: number, b: number): number {
    if (a === 0 || b === 0) {
      return 0;
    }

    return Math.abs(a * b) / this.gcd(a, b);
  }

  /**
   * 判断是否为质数
   */
  static isPrime(n: number): boolean {
    if (n <= 1) {
      return false;
    }

    if (n <= 3) {
      return true;
    }

    if (n % 2 === 0 || n % 3 === 0) {
      return false;
    }

    for (let i = 5; i * i <= n; i += 6) {
      if (n % i === 0 || n % (i + 2) === 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * 生成斐波那契数列
   */
  static fibonacci(count: number): number[] {
    if (count <= 0) {
      return [];
    }

    if (count === 1) {
      return [0];
    }

    const sequence = [0, 1];
    for (let i = 2; i < count; i++) {
      sequence.push(sequence[i - 1] + sequence[i - 2]);
    }

    return sequence;
  }

  /**
   * 计算阶乘
   */
  static factorial(n: number): number {
    if (n < 0) {
      throw new Error('Factorial is not defined for negative numbers');
    }

    if (n === 0 || n === 1) {
      return 1;
    }

    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }

    return result;
  }

  /**
   * 计算组合数 C(n, r)
   */
  static combination(n: number, r: number): number {
    if (r < 0 || r > n) {
      return 0;
    }

    return this.factorial(n) / (this.factorial(r) * this.factorial(n - r));
  }

  /**
   * 计算排列数 P(n, r)
   */
  static permutation(n: number, r: number): number {
    if (r < 0 || r > n) {
      return 0;
    }

    return this.factorial(n) / this.factorial(n - r);
  }

  /**
   * 生成随机数
   */
  static random(options?: Partial<RandomOptions>): number {
    const opts: RandomOptions = {
      min: 0,
      max: 1,
      integer: false,
      ...options,
    };

    const { min, max, integer } = opts;

    if (integer) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    return Math.random() * (max - min) + min;
  }

  /**
   * 生成随机整数
   */
  static randomInt(min: number, max: number): number {
    return this.random({ min, max, integer: true });
  }

  /**
   * 生成正态分布随机数
   */
  static normalRandom(mean = 0, stdDev = 1): number {
    // Box-Muller transform
    let u = 0;
    let v = 0;

    while (u === 0) {
      u = Math.random();
    }
    while (v === 0) {
      v = Math.random();
    }

    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdDev + mean;
  }

  /**
   * 四舍五入到指定位数
   */
  static roundTo(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  /**
   * 向上取整到指定位数
   */
  static ceilTo(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.ceil(value * factor) / factor;
  }

  /**
   * 向下取整到指定位数
   */
  static floorTo(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.floor(value * factor) / factor;
  }

  /**
   * 判断两个数是否近似相等
   */
  static approximatelyEqual(a: number, b: number, epsilon = 1e-10): boolean {
    return Math.abs(a - b) < epsilon;
  }

  /**
   * 线性插值
   */
  static lerp(start: number, end: number, t: number): number {
    return start + (end - start) * this.clamp(t, 0, 1);
  }

  /**
   * 角度转弧度
   */
  static degreesToRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * 弧度转角度
   */
  static radiansToDegrees(radians: number): number {
    return radians * (180 / Math.PI);
  }

  /**
   * 计算两点间距离
   */
  static distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 计算曼哈顿距离
   */
  static manhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x2 - x1) + Math.abs(y2 - y1);
  }

  /**
   * 计算幂
   */
  static power(base: number, exponent: number): number {
    return Math.pow(base, exponent);
  }

  /**
   * 计算平方根
   */
  static sqrt(value: number): number {
    return Math.sqrt(value);
  }

  /**
   * 计算立方根
   */
  static cbrt(value: number): number {
    return Math.cbrt(value);
  }

  /**
   * 计算绝对值
   */
  static abs(value: number): number {
    return Math.abs(value);
  }

  /**
   * 计算符号
   */
  static sign(value: number): number {
    return Math.sign(value);
  }

  /**
   * 判断是否为偶数
   */
  static isEven(n: number): boolean {
    return n % 2 === 0;
  }

  /**
   * 判断是否为奇数
   */
  static isOdd(n: number): boolean {
    return n % 2 !== 0;
  }

  /**
   * 判断是否为整数
   */
  static isInteger(value: number): boolean {
    return Number.isInteger(value);
  }

  /**
   * 判断是否为有限数
   */
  static isFinite(value: number): boolean {
    return Number.isFinite(value);
  }

  /**
   * 判断是否为 NaN
   */
  static isNaN(value: number): boolean {
    return Number.isNaN(value);
  }

  /**
   * 安全除法
   */
  static safeDivide(dividend: number, divisor: number, defaultValue = 0): number {
    if (divisor === 0) {
      return defaultValue;
    }
    return dividend / divisor;
  }

  /**
   * 取模（处理负数）
   */
  static mod(dividend: number, divisor: number): number {
    return ((dividend % divisor) + divisor) % divisor;
  }

  /**
   * 计算数字位数
   */
  static digitCount(n: number): number {
    if (n === 0) {
      return 1;
    }
    return Math.floor(Math.log10(Math.abs(n))) + 1;
  }

  /**
   * 反转数字
   */
  static reverseNumber(n: number): number {
    const sign = Math.sign(n);
    const reversed = parseInt(Math.abs(n).toString().split('').reverse().join(''), 10);
    return sign * reversed;
  }

  /**
   * 数字转罗马数字
   */
  static toRoman(num: number): string {
    if (num <= 0 || num > 3999) {
      throw new Error('Number must be between 1 and 3999');
    }

    const romanNumerals: [number, string][] = [
      [1000, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ];

    let result = '';
    let remaining = num;

    for (const [value, numeral] of romanNumerals) {
      while (remaining >= value) {
        result += numeral;
        remaining -= value;
      }
    }

    return result;
  }

  /**
   * 罗马数字转数字
   */
  static fromRoman(roman: string): number {
    const romanMap: Record<string, number> = {
      I: 1,
      V: 5,
      X: 10,
      L: 50,
      C: 100,
      D: 500,
      M: 1000,
    };

    let result = 0;
    let prevValue = 0;

    for (let i = roman.length - 1; i >= 0; i--) {
      const value = romanMap[roman[i]];
      
      if (value === undefined) {
        throw new Error(`Invalid Roman numeral: ${roman[i]}`);
      }

      if (value < prevValue) {
        result -= value;
      } else {
        result += value;
      }

      prevValue = value;
    }

    return result;
  }

  /**
   * 格式化字节大小
   */
  static formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) {
      return '0 B';
    }

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
  }

  /**
   * 解析字节大小
   */
  static parseBytes(size: string): number {
    const units: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
      TB: 1024 * 1024 * 1024 * 1024,
      PB: 1024 * 1024 * 1024 * 1024 * 1024,
    };

    const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)?$/i);
    
    if (!match) {
      throw new Error(`Invalid size format: ${size}`);
    }

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    return value * (units[unit] || 1);
  }

  /**
   * 计算两个数的最大者
   */
  static max(...numbers: number[]): number {
    return Math.max(...numbers);
  }

  /**
   * 计算两个数的最小者
   */
  static min(...numbers: number[]): number {
    return Math.min(...numbers);
  }

  /**
   * 求和
   */
  static sum(...numbers: number[]): number {
    return numbers.reduce((acc, val) => acc + val, 0);
  }

  /**
   * 映射数值范围
   */
  static mapRange(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number
  ): number {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  }

  /**
   * 判断数值是否在范围内
   */
  static inRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
  }

  /**
   * 计算乘数
   */
  static product(...numbers: number[]): number {
    return numbers.reduce((acc, val) => acc * val, 1);
  }

  /**
   * 计算差值
   */
  static difference(a: number, b: number): number {
    return Math.abs(a - b);
  }

  /**
   * 计算比率
   */
  static ratio(a: number, b: number): number {
    if (b === 0) {
      return Infinity;
    }
    return a / b;
  }

  /**
   * 计算比例
   */
  static proportion(part: number, whole: number): number {
    if (whole === 0) {
      return 0;
    }
    return part / whole;
  }

  /**
   * 计算余弦相似度
   * 
   * @param a - 向量 a
   * @param b - 向量 b
   * @returns 余弦相似度 [-1, 1]
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 计算 L2 距离（欧几里得距离）
   * 
   * @param a - 向量 a
   * @param b - 向量 b
   * @returns L2 距离
   */
  static l2Distance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * 计算内积（点积）
   * 
   * @param a - 向量 a
   * @param b - 向量 b
   * @returns 内积
   */
  static innerProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * 计算曼哈顿距离（向量版）
   * 
   * @param a - 向量 a
   * @param b - 向量 b
   * @returns 曼哈顿距离
   */
  static vectorManhattanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.abs(a[i] - b[i]);
    }
    return sum;
  }

  /**
   * 计算切比雪夫距离
   * 
   * @param a - 向量 a
   * @param b - 向量 b
   * @returns 切比雪夫距离
   */
  static chebyshevDistance(a: number[], b: number[]): number {
    let max = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = Math.abs(a[i] - b[i]);
      if (diff > max) {
        max = diff;
      }
    }
    return max;
  }

  /**
   * 向量归一化
   * 
   * @param vector - 向量
   * @returns 归一化后的向量
   */
  static normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    
    if (norm === 0) {
      return [...vector];
    }
    
    return vector.map(v => v / norm);
  }

  /**
   * 向量加法
   * 
   * @param a - 向量 a
   * @param b - 向量 b
   * @returns a + b
   */
  static vectorAdd(a: number[], b: number[]): number[] {
    return a.map((val, i) => val + b[i]);
  }

  /**
   * 向量减法
   * 
   * @param a - 向量 a
   * @param b - 向量 b
   * @returns a - b
   */
  static vectorSubtract(a: number[], b: number[]): number[] {
    return a.map((val, i) => val - b[i]);
  }

  /**
   * 向量数乘
   * 
   * @param vector - 向量
   * @param scalar - 标量
   * @returns vector * scalar
   */
  static vectorScale(vector: number[], scalar: number): number[] {
    return vector.map(v => v * scalar);
  }

  /**
   * 向量长度（范数）
   * 
   * @param vector - 向量
   * @returns 向量长度
   */
  static vectorNorm(vector: number[]): number {
    return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  }
}
