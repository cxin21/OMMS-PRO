/**
 * Utils 模块 - 统一导出
 * 
 * OMMS-PRO 通用工具库
 * 
 * @module utils
 * @since 0.1.0
 */

// 类型导出
export type {
  IDStrategy,
  IDGeneratorConfig,
  TimeFormatOptions,
  TruncateOptions,
  PathOptions,
  RetryConfig,
  RetryOptions,
  BatchConfig,
  BatchOptions,
  CryptoAlgorithm,
  CryptoOptions,
  ParsedPath,
  FileSizeUnit,
  FileSizeOptions,
  RandomOptions,
  WeightedItem,
  CloneOptions,
  CompareOptions,
  ChunkOptions,
  StringHashOptions,
  CleanTextOptions,
  Result,
  ProgressTracker,
  DelayOptions,
  TimeoutOptions,
  CacheOptions,
  DebounceOptions,
  ThrottleOptions,
  UtilsConfig,
  DEFAULT_UTILS_CONFIG,
} from './types';

// ID 生成器
export { IDGenerator } from './id-generator';

// 时间工具
export { TimeUtils } from './time';

// 字符串工具
export { StringUtils } from './string';

// 对象工具
export { ObjectUtils } from './object';

// 数组工具
export { ArrayUtils } from './array';

// 数学工具
export { MathUtils } from './math';

// 加密工具
export { CryptoUtils } from './crypto';

// 文件工具
export { FileUtils } from './file';

// 重试工具
export { RetryUtils } from './retry';

// 批处理工具
export { BatchUtils } from './batch';

// JSON 解析工具
export { JsonParser } from './json-parser';
export type { JsonParseResult, JsonParseOptions } from './json-parser';

// 关键词提取工具
export { KeywordExtractor } from './keyword-extractor';
export type { KeywordInfo, KeywordExtractorOptions, KeywordExtractionAlgorithm } from './keyword-extractor';

// 配置工具类
import { IDGenerator } from './id-generator';
import { TimeUtils } from './time';
import { StringUtils } from './string';
import { ObjectUtils } from './object';
import { ArrayUtils } from './array';
import { MathUtils } from './math';
import { CryptoUtils } from './crypto';
import { FileUtils } from './file';
import { RetryUtils } from './retry';
import { BatchUtils } from './batch';
import { JsonParser } from './json-parser';
import { KeywordExtractor } from './keyword-extractor';
import type {
  IDGeneratorConfig,
  TimeFormatOptions,
  CryptoOptions,
  RetryConfig,
  BatchConfig,
} from './types';

/**
 * 工具模块配置
 * 
 * @param config - 配置对象
 */
export function configure(config: {
  idGenerator?: Partial<IDGeneratorConfig>;
  time?: Partial<TimeFormatOptions>;
  crypto?: Partial<CryptoOptions>;
  retry?: Partial<RetryConfig>;
  batch?: Partial<BatchConfig>;
}): void {
  if (config.idGenerator) {
    IDGenerator.configure(config.idGenerator);
  }
  if (config.time) {
    TimeUtils.configure(config.time);
  }
  if (config.crypto) {
    CryptoUtils.configure(config.crypto);
  }
  if (config.retry) {
    RetryUtils.configure(config.retry);
  }
  if (config.batch) {
    BatchUtils.configure(config.batch);
  }
}

/**
 * 默认导出
 */
export default {
  IDGenerator,
  TimeUtils,
  StringUtils,
  ObjectUtils,
  ArrayUtils,
  MathUtils,
  CryptoUtils,
  FileUtils,
  RetryUtils,
  BatchUtils,
  JsonParser,
  KeywordExtractor,
  configure,
};
