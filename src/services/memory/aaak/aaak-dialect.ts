/**
 * AAAK Dialect - 压缩索引格式
 * ==============================
 *
 * AAAK (Additive Abbreviated Aggregate Knowledge) 是一种结构化的符号摘要格式
 * 用于 LLM 快速扫描大量记忆条目，而无需读取完整内容
 *
 * 格式: ENTITY|TOPICS|"key_quote"|EMOTIONS|FLAGS
 * 示例: CHN|ai_memory+optimization|"we decided to use vector search"|determ|DECISION+TECHNICAL
 *
 * 设计原则（来自 MemPalace）:
 * - 压缩但非无损压缩（original 不能从 AAAK 重建）
 * - 结构化提取：实体、主题、引用、情感、标记
 * - LLM 可直接读取，无需解码器
 */

import { MemoryType } from '../../../types/memory';

// ============================================================
// 常量定义
// ============================================================

// 情感代码（统一编码）
export const EMOTION_CODES: Record<string, string> = {
  vulnerability: 'vul',
  vulnerable: 'vul',
  joy: 'joy',
  joyful: 'joy',
  fear: 'fear',
  mild_fear: 'fear',
  trust: 'trust',
  trust_building: 'trust',
  grief: 'grief',
  raw_grief: 'grief',
  wonder: 'wonder',
  philosophical_wonder: 'wonder',
  rage: 'rage',
  anger: 'rage',
  love: 'love',
  devotion: 'love',
  hope: 'hope',
  despair: 'despair',
  hopelessness: 'despair',
  peace: 'peace',
  relief: 'relief',
  humor: 'humor',
  dark_humor: 'humor',
  tenderness: 'tender',
  raw_honesty: 'raw',
  brutal_honesty: 'raw',
  self_doubt: 'doubt',
  anxiety: 'anx',
  exhaustion: 'exhaust',
  conviction: 'convict',
  quiet_passion: 'passion',
  warmth: 'warmth',
  curiosity: 'curious',
  gratitude: 'grat',
  frustration: 'frust',
  confusion: 'confuse',
  satisfaction: 'satis',
  excitement: 'excite',
  determination: 'determ',
  surprise: 'surprise',
};

// 情感关键词信号
const _EMOTION_SIGNALS: Record<string, string> = {
  // 英文情感关键词
  decided: 'determ',
  prefer: 'convict',
  worried: 'anx',
  excited: 'excite',
  frustrated: 'frust',
  confused: 'confuse',
  love: 'love',
  hate: 'rage',
  hope: 'hope',
  fear: 'fear',
  trust: 'trust',
  happy: 'joy',
  sad: 'grief',
  surprised: 'surprise',
  grateful: 'grat',
  curious: 'curious',
  wonder: 'wonder',
  anxious: 'anx',
  relieved: 'relief',
  disappoint: 'grief',
  concern: 'anx',
  // 中文情感关键词
  '决定': 'determ',
  '喜欢': 'joy',
  '讨厌': 'rage',
  '担心': 'anx',
  '希望': 'hope',
  '相信': 'trust',
  '惊讶': 'surprise',
  '满意': 'satis',
  '兴奋': 'excite',
  '感激': 'grat',
  '失望': 'despair',
  '困惑': 'confuse',
  '后悔': 'grief',
  '害怕': 'fear',
};

// 标记信号
const _FLAG_SIGNALS: Record<string, string> = {
  // 英文标记关键词
  decided: 'DECISION',
  chose: 'DECISION',
  switched: 'DECISION',
  migrated: 'DECISION',
  replaced: 'DECISION',
  'instead of': 'DECISION',
  because: 'DECISION',
  founded: 'ORIGIN',
  created: 'ORIGIN',
  started: 'ORIGIN',
  born: 'ORIGIN',
  launched: 'ORIGIN',
  'first time': 'ORIGIN',
  core: 'CORE',
  fundamental: 'CORE',
  essential: 'CORE',
  principle: 'CORE',
  belief: 'CORE',
  always: 'CORE',
  'never forget': 'CORE',
  'turning point': 'PIVOT',
  'changed everything': 'PIVOT',
  realized: 'PIVOT',
  breakthrough: 'PIVOT',
  epiphany: 'PIVOT',
  api: 'TECHNICAL',
  database: 'TECHNICAL',
  architecture: 'TECHNICAL',
  deploy: 'TECHNICAL',
  infrastructure: 'TECHNICAL',
  algorithm: 'TECHNICAL',
  framework: 'TECHNICAL',
  server: 'TECHNICAL',
  config: 'TECHNICAL',
  // 中文标记关键词
  '决定': 'DECISION',
  '选择': 'DECISION',
  '因为': 'DECISION',
  '所以': 'DECISION',
  '创建': 'ORIGIN',
  '开始': 'ORIGIN',
  '启动': 'ORIGIN',
  '诞生': 'ORIGIN',
  '核心': 'CORE',
  '基础': 'CORE',
  '本质': 'CORE',
  '原则': 'CORE',
  '转折点': 'PIVOT',
  '改变': 'PIVOT',
  '突破': 'PIVOT',
  '意识到': 'PIVOT',
  '技术': 'TECHNICAL',
  '架构': 'TECHNICAL',
  '算法': 'TECHNICAL',
  '部署': 'TECHNICAL',
  '数据库': 'TECHNICAL',
  '服务器': 'TECHNICAL',
};

// 停用词
const _STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
  'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'don', 'now', 'and', 'but', 'or', 'if', 'while', 'that', 'this',
  'these', 'those', 'it', 'its', 'i', 'we', 'you', 'he', 'she', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',
  'what', 'which', 'who', 'whom', 'also', 'much', 'many', 'like', 'because',
  'since', 'get', 'got', 'use', 'used', 'using', 'make', 'made', 'thing',
  'things', 'way', 'well', 'really', 'want', 'need',
]);

// ============================================================
// 类型定义
// ============================================================

/**
 * AAAK 记忆条目格式
 */
export interface AAAKEntry {
  format: 'AAAK';
  entity: string;      // 实体代码（如 CHN, AI, SYS）
  topics: string;      // 主题关键词（下划线分隔）
  quote: string;       // 关键引用（55字符内）
  emotions: string;    // 情感代码（加号分隔）
  flags: string;        // 标记（加号分隔）
}

/**
 * AAAK 压缩记忆
 */
export interface AAAKMemory {
  uid: string;
  palaceRef: string;
  aaakEntry: AAAKEntry;
  memoryType: MemoryType;
  createdAt: number;
  importance: number;
}

/**
 * 实体编码映射
 */
export interface EntityMapping {
  [name: string]: string;  // 完整名 -> 短码
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 提取词频（支持中文和英文）
 * 中文词：2个或以上连续汉字
 * 英文词：3个或以上字母/连字符
 */
function extractWordFrequency(text: string): Map<string, number> {
  // 支持中文（2+汉字）和英文（3+字母）
  const words = text.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z][a-zA-Z_-]{2,}/g) || [];
  const freq = new Map<string, number>();

  for (const word of words) {
    const lower = word.toLowerCase();
    if (_STOP_WORDS.has(lower) || lower.length < 3) continue;

    // 大写词（专有名词）权重 +2
    const firstChar = word[0];
    const isProperNoun = firstChar >= 'A' && firstChar <= 'Z' && word.slice(1).match(/[a-z]/);
    const weight = isProperNoun ? 2 : 1;

    freq.set(lower, (freq.get(lower) || 0) + weight);
  }

  return freq;
}

/**
 * 提取主题关键词
 */
export function extractTopics(text: string, maxTopics: number = 3): string[] {
  const freq = extractWordFrequency(text);
  const ranked = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTopics)
    .map(([word]) => word);

  return ranked;
}

/**
 * 提取关键引用句
 */
export function extractKeySentence(text: string, maxLength: number = 55): string {
  // 决策关键词
  const decisionWords = [
    // 英文决策关键词
    'decided', 'because', 'instead', 'prefer', 'switched', 'chose',
    'realized', 'important', 'key', 'critical', 'discovered', 'learned',
    'conclusion', 'solution', 'reason', 'why', 'breakthrough', 'insight',
    // 中文决策关键词
    '决定', '选择', '因为', '所以', '重要的是',
    '发现', '学到了', '解决方案', '原因', '结果',
  ];

  // 分割句子
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
  if (sentences.length === 0) return '';

  // 评分
  let bestScore = -1;
  let bestSentence = sentences[0];

  for (const sentence of sentences) {
    let score = 0;
    const lower = sentence.toLowerCase();

    for (const word of decisionWords) {
      if (lower.includes(word)) score += 2;
    }

    // 短句优先
    if (sentence.length < 80) score += 1;
    if (sentence.length < 40) score += 1;

    // 长句惩罚
    if (sentence.length > 150) score -= 2;

    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  // 截断
  if (bestSentence.length > maxLength) {
    return bestSentence.substring(0, maxLength - 3) + '...';
  }
  return bestSentence;
}

/**
 * 检测情感
 */
export function detectEmotions(text: string): string[] {
  const lower = text.toLowerCase();
  const detected: string[] = [];
  const seen = new Set<string>();

  for (const [keyword, code] of Object.entries(_EMOTION_SIGNALS)) {
    if (lower.includes(keyword) && !seen.has(code)) {
      detected.push(code);
      seen.add(code);
      if (detected.length >= 3) break;
    }
  }

  return detected;
}

/**
 * 检测标记
 */
export function detectFlags(text: string): string[] {
  const lower = text.toLowerCase();
  const detected: string[] = [];
  const seen = new Set<string>();

  for (const [keyword, flag] of Object.entries(_FLAG_SIGNALS)) {
    if (lower.includes(keyword) && !seen.has(flag)) {
      detected.push(flag);
      seen.add(flag);
      if (detected.length >= 3) break;
    }
  }

  return detected;
}

/**
 * 编码实体名称
 */
export function encodeEntity(name: string, mapping?: EntityMapping): string {
  if (mapping && mapping[name]) {
    return mapping[name];
  }
  // 自动编码：前3个字符大写
  return name.substring(0, 3).toUpperCase();
}

/**
 * 检测专有名词（在文本中出现 >= 2 次）
 * 支持中文（汉字词出现 >= 2 次）和英文（大写开头专有名词）
 */
export function detectEntities(text: string, minOccurrences: number = 2): string[] {
  const freq = extractWordFrequency(text);
  const entities: string[] = [];

  for (const [word, count] of freq.entries()) {
    // 英文专有名词：首字母大写
    const firstChar = word[0];
    const isEnglishProperNoun = firstChar >= 'A' && firstChar <= 'Z';
    // 中文词：连续汉字
    const isChinese = /^[\u4e00-\u9fa5]+$/.test(word);

    if (count >= minOccurrences) {
      if (isEnglishProperNoun) {
        entities.push(word);
      } else if (isChinese && word.length >= 2) {
        // 中文词直接作为实体
        entities.push(word);
      }
    }
  }

  return entities.slice(0, 5);
}

// ============================================================
// AAAK Dialect 类
// ============================================================

/**
 * AAAK Dialect 编码器
 */
export class AAAKDialect {
  private entityMapping: EntityMapping;

  constructor(entityMapping?: EntityMapping) {
    this.entityMapping = entityMapping || {};
  }

  /**
   * 从实体映射创建
   */
  static fromMapping(mapping: EntityMapping): AAAKDialect {
    return new AAAKDialect(mapping);
  }

  /**
   * 压缩单条记忆为 AAAK 格式
   */
  compress(
    content: string,
    options: {
      memoryType?: MemoryType;
      entities?: string[];
      topics?: string[];
      quote?: string;
      emotions?: string[];
      flags?: string[];
    } = {}
  ): AAAKEntry {
    // 检测或使用提供的实体
    const entityCodes = options.entities || detectEntities(content);
    const entity = entityCodes.length > 0
      ? entityCodes.map(e => encodeEntity(e, this.entityMapping)).slice(0, 3).join('+')
      : '???';

    // 主题
    const topics = (options.topics || extractTopics(content)).slice(0, 3).join('_');

    // 引用
    const quote = options.quote || extractKeySentence(content);

    // 情感
    const emotions = options.emotions || detectEmotions(content);

    // 标记
    const flags = options.flags || detectFlags(content);

    return {
      format: 'AAAK',
      entity,
      topics,
      quote: quote ? `"${quote}"` : '',
      emotions: emotions.join('+'),
      flags: flags.join('+'),
    };
  }

  /**
   * 编码 AAAK 条目为字符串
   */
  encode(entry: AAAKEntry): string {
    const parts: string[] = [entry.entity, entry.topics];
    if (entry.quote) parts.push(entry.quote);
    if (entry.emotions) parts.push(entry.emotions);
    if (entry.flags) parts.push(entry.flags);
    return parts.join('|');
  }

  /**
   * 解码字符串为 AAAK 条目
   */
  decode(text: string): AAAKEntry | null {
    const parts = text.split('|');
    if (parts.length < 2) return null;

    return {
      format: 'AAAK',
      entity: parts[0] || '???',
      topics: parts[1] || 'misc',
      quote: parts[2] || '',
      emotions: parts[3] || '',
      flags: parts[4] || '',
    };
  }

  /**
   * 批量压缩记忆为 AAAK 索引文件
   */
  compressAll(
    memories: Array<{
      uid: string;
      content: string;
      memoryType?: MemoryType;
      entities?: string[];
      topics?: string[];
    }>
  ): string {
    const lines: string[] = [];

    for (const memory of memories) {
      const entry = this.compress(memory.content, {
        memoryType: memory.memoryType,
        entities: memory.entities,
        topics: memory.topics,
      });
      lines.push(this.encode(entry));
    }

    return lines.join('\n');
  }

  /**
   * 获取压缩统计
   */
  compressionStats(originalLength: number, compressedLength: number): {
    ratio: number;
    originalChars: number;
    compressedChars: number;
  } {
    return {
      ratio: originalLength / Math.max(compressedLength, 1),
      originalChars: originalLength,
      compressedChars: compressedLength,
    };
  }
}

// ============================================================
// 默认实例
// ============================================================

export const defaultAAAKDialect = new AAAKDialect();

/**
 * 快捷函数：压缩文本为 AAAK 条目
 */
export function compressToAAAK(
  content: string,
  options?: Parameters<AAAKDialect['compress']>[1]
): AAAKEntry {
  return defaultAAAKDialect.compress(content, options);
}

/**
 * 快捷函数：编码 AAAK 条目为字符串
 */
export function encodeAAAK(entry: AAAKEntry): string {
  return defaultAAAKDialect.encode(entry);
}