/**
 * JSON 解析工具
 * 提供安全、健壮的 JSON 解析功能
 * 
 * @module utils/json-parser
 * @since 0.1.0
 */

import { createLogger, type ILogger } from '../logging';

/**
 * JSON 解析结果
 */
export interface JsonParseResult<T = any> {
  /** 是否成功 */
  success: boolean;
  /** 解析后的数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
  /** 原始输入 */
  rawInput: string;
}

/**
 * JSON 解析成功结果
 */
export interface JsonParseSuccessResult<T = any> extends JsonParseResult<T> {
  success: true;
  data: T;
}

/**
 * JSON 解析选项
 */
export interface JsonParseOptions {
  /** 是否允许空字符串 */
  allowEmpty?: boolean;
  /** 空字符串时的默认值 */
  emptyValue?: any;
  /** 是否自动修复常见错误 */
  autoFix?: boolean;
  /** 最大解析长度 */
  maxLength?: number;
  /** 是否记录日志 */
  logging?: boolean;
}

/**
 * JSON 解析工具类
 * 
 * 提供安全、健壮的 JSON 解析功能
 * 
 * @example
 * ```typescript
 * const result = JsonParser.parse('{"key": "value"}');
 * if (result.success) {
 *   console.log(result.data.key);
 * }
 * 
 * const obj = JsonParser.parseOrThrow('{"key": "value"}');
 * 
 * const safe = JsonParser.safeParse(maybeJson, { allowEmpty: true, emptyValue: {} });
 * ```
 */
export class JsonParser {
  private static readonly logger: ILogger = createLogger('utils', { module: 'json-parser' });

  /**
   * 解析 JSON 字符串
   * 
   * @param input - JSON 字符串
   * @param options - 解析选项
   * @returns 解析结果
   */
  static parse<T = any>(input: string, options?: JsonParseOptions): JsonParseResult<T> {
    const opts = this.getDefaultOptions(options);
    
    if (opts.logging) {
      this.logger.debug('开始解析 JSON', { inputLength: input?.length });
    }

    // 检查空字符串
    if (!input || input.trim() === '') {
      if (opts.allowEmpty) {
        return {
          success: true,
          data: opts.emptyValue,
          rawInput: input,
        };
      }
      return {
        success: false,
        error: '输入为空',
        rawInput: input,
      };
    }

    // 检查长度限制
    if (opts.maxLength && input.length > opts.maxLength) {
      return {
        success: false,
        error: `输入超过最大长度限制 (${opts.maxLength})`,
        rawInput: input,
      };
    }

    try {
      // 自动修复（如果启用）
      let processedInput = input;
      if (opts.autoFix) {
        processedInput = this.autoFixJson(input);
      }

      const data = JSON.parse(processedInput) as T;
      
      if (opts.logging) {
        this.logger.debug('JSON 解析成功', { dataType: typeof data });
      }

      return {
        success: true,
        data,
        rawInput: input,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      if (opts.logging) {
        this.logger.warn('JSON 解析失败', { error: errorMessage });
      }

      return {
        success: false,
        error: errorMessage,
        rawInput: input,
      };
    }
  }

  /**
   * 解析 JSON，失败时抛出异常
   * 
   * @param input - JSON 字符串
   * @param options - 解析选项
   * @returns 解析后的数据
   * @throws Error 解析失败时抛出
   */
  static parseOrThrow<T = any>(input: string, options?: JsonParseOptions): T {
    const result = this.parse<T>(input, options);
    
    if (!result.success) {
      throw new Error(`JSON 解析失败：${result.error}`);
    }
    
    return result.data!;
  }

  /**
   * 安全解析 JSON，永远不抛出异常
   * 
   * @param input - JSON 字符串
   * @param defaultValue - 解析失败时的默认值
   * @param options - 解析选项
   * @returns 解析后的数据或默认值
   */
  static safeParse<T = any>(
    input: string,
    defaultValue: T,
    options?: JsonParseOptions
  ): T {
    const result = this.parse<T>(input, options);
    return result.success ? result.data! : defaultValue;
  }

  /**
   * 尝试解析多个 JSON 字符串
   * 
   * @param inputs - JSON 字符串数组
   * @param options - 解析选项
   * @returns 解析结果数组
   */
  static parseBatch<T = any>(
    inputs: string[],
    options?: JsonParseOptions
  ): JsonParseResult<T>[] {
    return inputs.map(input => this.parse<T>(input, options));
  }

  /**
   * 批量解析，返回所有成功的结果
   * 
   * @param inputs - JSON 字符串数组
   * @param options - 解析选项
   * @returns 成功解析的数据数组
   */
  static parseBatchSuccess<T = any>(
    inputs: string[],
    options?: JsonParseOptions
  ): T[] {
    return this.parseBatch<T>(inputs, options)
      .filter((result): result is JsonParseSuccessResult<T> => result.success)
      .map(result => result.data);
  }

  /**
   * 字符串化为 JSON
   * 
   * @param data - 要序列化的数据
   * @param pretty - 是否格式化输出
   * @returns JSON 字符串
   */
  static stringify(data: any, pretty: boolean = false): string {
    try {
      if (pretty) {
        return JSON.stringify(data, null, 2);
      }
      return JSON.stringify(data);
    } catch (error) {
      this.logger.error('JSON 序列化失败', {
        error: error instanceof Error ? error.message : error,
        data,
      });
      throw error;
    }
  }

  /**
   * 安全地字符串化 JSON
   * 
   * @param data - 要序列化的数据
   * @param defaultValue - 失败时的默认值
   * @param pretty - 是否格式化输出
   * @returns JSON 字符串或默认值
   */
  static safeStringify(data: any, defaultValue: string = 'null', pretty: boolean = false): string {
    try {
      return this.stringify(data, pretty);
    } catch {
      return defaultValue;
    }
  }

  /**
   * 自动修复常见的 JSON 错误
   * 
   * @param input - 原始输入
   * @returns 修复后的输入
   */
  public static autoFixJson(input: string): string {
    let fixed = input.trim();

    // 修复未闭合的引号
    const quoteCount = (fixed.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      fixed += '"';
    }

    // 修复未闭合的大括号
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    if (openBraces > closeBraces) {
      fixed += '}'.repeat(openBraces - closeBraces);
    }

    // 修复未闭合的中括号
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/]/g) || []).length;
    if (openBrackets > closeBrackets) {
      fixed += ']'.repeat(openBrackets - closeBrackets);
    }

    // 修复单引号（替换为双引号）
    fixed = fixed.replace(/'/g, '"');

    // 移除末尾逗号（JSON 不允许）
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // 修复未加引号的键
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    if (fixed !== input) {
      this.logger.debug('JSON 自动修复完成', {
        originalLength: input.length,
        fixedLength: fixed.length,
      });
    }

    return fixed;
  }

  /**
   * 获取默认选项
   */
  private static getDefaultOptions(options?: JsonParseOptions): JsonParseOptions {
    return {
      allowEmpty: false,
      emptyValue: null,
      autoFix: false,
      maxLength: 10 * 1024 * 1024, // 10MB
      logging: false,
      ...options,
    };
  }

  /**
   * 验证是否为有效的 JSON 字符串
   * 
   * @param input - JSON 字符串
   * @returns 是否有效
   */
  static isValidJson(input: string): boolean {
    try {
      JSON.parse(input);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 JSON 类型
   * 
   * @param input - JSON 字符串
   * @returns JSON 类型（object, array, string, number, boolean, null）或 null（如果无效）
   */
  static getJsonType(input: string): string | null {
    try {
      const parsed = JSON.parse(input);
      if (parsed === null) return 'null';
      if (Array.isArray(parsed)) return 'array';
      return typeof parsed;
    } catch {
      return null;
    }
  }
}
