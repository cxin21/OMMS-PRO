/**
 * AAAK Module - 压缩索引层
 *
 * 提供 AAAK (Additive Abbreviated Aggregate Knowledge) 格式的压缩索引
 * 用于 LLM 快速扫描大量记忆条目
 */

export {
  AAAKDialect,
  defaultAAAKDialect,
  compressToAAAK,
  encodeAAAK,
  extractTopics,
  extractKeySentence,
  detectEmotions,
  detectFlags,
  encodeEntity,
  detectEntities,
  EMOTION_CODES,
  type AAAKEntry,
  type AAAKMemory,
  type EntityMapping,
} from './aaak-dialect';