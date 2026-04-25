/**
 * 关键词提取工具
 * 提供多种关键词提取算法
 * 
 * @module utils/keyword-extractor
 * @since 0.1.0
 */

import { createLogger, type ILogger } from '../logging';

/**
 * 关键词提取算法
 */
export type KeywordExtractionAlgorithm = 
  | 'frequency'      // 词频统计
  | 'tfidf'          // TF-IDF
  | 'textrank'       // TextRank
  | 'simple';        // 简单分词

/**
 * 关键词信息
 */
export interface KeywordInfo {
  /** 关键词文本 */
  text: string;
  /** 权重评分 */
  weight: number;
  /** 出现次数 */
  frequency?: number;
}

/**
 * 关键词提取选项
 */
export interface KeywordExtractorOptions {
  /** 提取算法 */
  algorithm?: KeywordExtractionAlgorithm;
  /** 最大关键词数量 */
  maxCount?: number;
  /** 最小关键词长度 */
  minLength?: number;
  /** 停用词列表 */
  stopWords?: string[];
  /** 是否保留词频信息 */
  keepFrequency?: boolean;
}

/**
 * 默认停用词列表（中文）
 */
const DEFAULT_STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
  '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
  '你', '会', '着', '没有', '看', '好', '自己', '这', '那',
  '他', '她', '它', '们', '这', '那', '哪个', '哪些', '怎样',
  '怎么', '什么', '为什么', '的', '地', '得', '之', '乎', '者',
  '也', '而', '且', '或', '与', '及', '并', '又', '既', '既然',
  '虽然', '但是', '不过', '可是', '然而', '因为', '所以', '因此',
  '如果', '即使', '尽管', '无论', '不管', '只有', '只要', '除非',
  '因为', '所以', '因此', '由于', '鉴于', '以致', '从而', '进而',
  '的', '地', '得', '之', '其', '该', '该', '此', '这个', '那个',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'can', 'a', 'an', 'the', 'and', 'or',
  'but', 'if', 'then', 'else', 'when', 'where', 'what', 'who',
  'which', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
]);

/**
 * 关键词提取器
 * 
 * 提供多种关键词提取算法
 * 
 * @example
 * ```typescript
 * // 基本用法
 * const keywords = KeywordExtractor.extract('这是一个测试文本');
 * 
 * // 使用 TF-IDF 算法
 * const keywords = KeywordExtractor.extract('文本内容', { algorithm: 'tfidf' });
 * 
 * // 自定义停用词
 * const keywords = KeywordExtractor.extract('文本', { stopWords: ['自定义', '停用词'] });
 * ```
 */
export class KeywordExtractor {
  private static readonly logger: ILogger = createLogger('utils', { module: 'keyword-extractor' });

  /**
   * 提取关键词
   * 
   * @param text - 输入文本
   * @param options - 提取选项
   * @returns 关键词信息列表
   */
  static extract(text: string, options: KeywordExtractorOptions = {}): KeywordInfo[] {
    const {
      algorithm = 'simple',
      maxCount = 5,
      minLength = 2,
      stopWords = DEFAULT_STOP_WORDS,
      keepFrequency = false,
    } = options;

    this.logger.debug('开始提取关键词', {
      algorithm,
      textLength: text.length,
      maxCount,
      minLength,
    });

    let keywords: KeywordInfo[];

    // 统一将 stopWords 转换为 Set
    const stopWordsSet = Array.isArray(stopWords) ? new Set(stopWords) : stopWords;

    switch (algorithm) {
      case 'frequency':
        keywords = this.extractByFrequency(text, stopWordsSet, minLength);
        break;
      case 'tfidf':
        keywords = this.extractByTFIDF(text, stopWordsSet, minLength);
        break;
      case 'textrank':
        keywords = this.extractByTextRank(text, stopWordsSet, minLength);
        break;
      case 'simple':
      default:
        keywords = this.extractSimple(text, stopWordsSet, minLength);
        break;
    }

    // 限制数量
    keywords = keywords.slice(0, maxCount);

    // 如果不保留词频，简化返回
    if (!keepFrequency) {
      keywords = keywords.map(k => ({ text: k.text, weight: k.weight }));
    }

    this.logger.debug('关键词提取完成', {
      count: keywords.length,
      keywords: keywords.map(k => k.text),
    });

    return keywords;
  }

  /**
   * 简单分词提取
   */
  private static extractSimple(
    text: string,
    stopWords: Set<string>,
    minLength: number
  ): KeywordInfo[] {
    // 按标点和空白分词
    const words = text.split(/[\s,，.。!?！？;：:\n\r\t]+/);
    
    const wordCount = new Map<string, number>();
    for (const word of words) {
      const trimmed = word.trim();
      if (
        trimmed.length >= minLength &&
        !stopWords.has(trimmed) &&
        !/^[0-9]+$/.test(trimmed)
      ) {
        wordCount.set(trimmed, (wordCount.get(trimmed) || 0) + 1);
      }
    }

    // 转换为 KeywordInfo 数组
    const keywords: KeywordInfo[] = [];
    for (const [word, count] of wordCount.entries()) {
      keywords.push({
        text: word,
        weight: count / words.length, // 简单权重：词频/总词数
        frequency: count,
      });
    }

    // 按权重排序
    return keywords.sort((a, b) => b.weight - a.weight);
  }

  /**
   * 词频统计方法
   */
  private static extractByFrequency(
    text: string,
    stopWords: Set<string>,
    minLength: number
  ): KeywordInfo[] {
    return this.extractSimple(text, stopWords, minLength);
  }

  /**
   * TF-IDF 方法（简化版）
   * 
   * 注意：完整的 TF-IDF 需要语料库支持
   * 这里使用简化版本，假设 IDF 为常数
   */
  private static extractByTFIDF(
    text: string,
    stopWords: Set<string>,
    minLength: number
  ): KeywordInfo[] {
    const wordFreq = this.extractSimple(text, stopWords, minLength);
    
    // 简化 TF-IDF：TF * log(N)
    // 假设 N = 100（语料库大小）
    const N = 100;
    const idf = Math.log(N);
    
    return wordFreq.map(k => ({
      text: k.text,
      weight: k.weight * idf,
      frequency: k.frequency,
    }));
  }

  /**
   * TextRank 方法（简化版）
   * 
   * 注意：完整的 TextRank 需要构建图并进行迭代
   * 这里使用简化版本
   */
  private static extractByTextRank(
    text: string,
    stopWords: Set<string>,
    minLength: number
  ): KeywordInfo[] {
    // 简单分词
    const words = text.split(/[\s,，.。!?！？;：:\n\r\t]+/);
    const validWords = words.filter(w => 
      w.trim().length >= minLength && !stopWords.has(w.trim())
    );

    // 构建共现矩阵（简化为相邻词）
    const wordGraph = new Map<string, Map<string, number>>();
    
    for (let i = 0; i < validWords.length - 1; i++) {
      const word1 = validWords[i].trim();
      const word2 = validWords[i + 1].trim();
      
      if (!wordGraph.has(word1)) {
        wordGraph.set(word1, new Map());
      }
      if (!wordGraph.has(word2)) {
        wordGraph.set(word2, new Map());
      }
      
      const neighbors1 = wordGraph.get(word1)!;
      const neighbors2 = wordGraph.get(word2)!;
      
      neighbors1.set(word2, (neighbors1.get(word2) || 0) + 1);
      neighbors2.set(word1, (neighbors2.get(word1) || 0) + 1);
    }

    // PageRank 迭代（简化为 10 次）
    const scores = new Map<string, number>();
    const damping = 0.85;
    const iterations = 10;
    
    // 初始化分数
    for (const word of wordGraph.keys()) {
      scores.set(word, 1.0);
    }

    // 迭代
    for (let i = 0; i < iterations; i++) {
      const newScores = new Map<string, number>();
      
      for (const [word, neighbors] of wordGraph.entries()) {
        let score = (1 - damping);
        
        for (const [neighbor, weight] of neighbors.entries()) {
          const neighborScore = scores.get(neighbor) || 0;
          const neighborOutDegree = Array.from(wordGraph.get(neighbor)?.values() || []).reduce((a, b) => a + b, 0);
          
          if (neighborOutDegree > 0) {
            score += damping * (weight / neighborOutDegree) * neighborScore;
          }
        }
        
        newScores.set(word, score);
      }
      
      scores.clear();
      for (const [word, score] of newScores.entries()) {
        scores.set(word, score);
      }
    }

    // 转换为 KeywordInfo
    const keywords: KeywordInfo[] = [];
    for (const [word, score] of scores.entries()) {
      keywords.push({
        text: word,
        weight: score,
      });
    }

    return keywords.sort((a, b) => b.weight - a.weight);
  }

  /**
   * 提取关键词文本（不包含权重）
   * 
   * @param text - 输入文本
   * @param options - 提取选项
   * @returns 关键词文本列表
   */
  static extractAsText(text: string, options: KeywordExtractorOptions = {}): string[] {
    return this.extract(text, options).map(k => k.text);
  }

  /**
   * 批量提取关键词
   * 
   * @param texts - 文本列表
   * @param options - 提取选项
   * @returns 关键词列表数组
   */
  static extractBatch(texts: string[], options: KeywordExtractorOptions = {}): KeywordInfo[][] {
    return texts.map(text => this.extract(text, options));
  }

  /**
   * 合并多个文本的关键词
   * 
   * @param texts - 文本列表
   * @param options - 提取选项
   * @returns 合并后的关键词列表
   */
  static extractMerged(texts: string[], options: KeywordExtractorOptions = {}): KeywordInfo[] {
    const allKeywords = this.extractBatch(texts, options);
    const merged = new Map<string, number>();

    for (const keywords of allKeywords) {
      for (const keyword of keywords) {
        merged.set(keyword.text, Math.max(merged.get(keyword.text) || 0, keyword.weight));
      }
    }

    return Array.from(merged.entries())
      .map(([text, weight]) => ({ text, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, options.maxCount || 5);
  }
}
