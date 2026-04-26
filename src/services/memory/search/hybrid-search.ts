/**
 * Hybrid Search - BM25 + Vector 混合搜索
 * =========================================
 *
 * 结合 BM25 关键词匹配和向量语义相似度
 * 提供更准确的记忆召回
 *
 * 参考 MemPalace searcher.py 的混合搜索实现
 */

import { createServiceLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';

// ============================================================
// 常量
// ============================================================

const TOKEN_RE = /\w{2,}/gu;

const DEFAULT_CONFIG = {
  vectorWeight: 0.6,
  bm25Weight: 0.4,
  k1: 1.5,
  b: 0.75,
  minTokenLength: 2,
};

// ============================================================
// 类型
// ============================================================

export interface SearchResult {
  uid: string;
  text: string;
  vectorScore: number;   // 0-1, 向量相似度
  bm25Score: number;    // BM25 得分
  combinedScore: number; // 组合得分
  metadata?: Record<string, unknown>;
}

export interface HybridSearchConfig {
  vectorWeight?: number;
  bm25Weight?: number;
  k1?: number;
  b?: number;
  minTokenLength?: number;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 分词
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
  while ((match = re.exec(text)) !== null) {
    const token = match[0].toLowerCase();
    if (token.length >= DEFAULT_CONFIG.minTokenLength) {
      tokens.push(token);
    }
  }

  return tokens;
}

/**
 * 计算 IDF（逆文档频率）
 */
function computeIDF(documents: string[][]): Map<string, number> {
  const nDocs = documents.length;
  const df = new Map<string, number>();

  for (const doc of documents) {
    const seen = new Set<string>();
    for (const token of doc) {
      if (!seen.has(token)) {
        df.set(token, (df.get(token) || 0) + 1);
        seen.add(token);
      }
    }
  }

  const idf = new Map<string, number>();
  for (const [term, dfVal] of df) {
    // Lucene/BM25+ 平滑公式
    idf.set(term, Math.log((nDocs - dfVal + 0.5) / (dfVal + 0.5) + 1));
  }

  return idf;
}

/**
 * 计算 BM25 得分
 */
function bm25Score(
  queryTokens: string[],
  documentTokens: string[],
  idf: Map<string, number>,
  k1: number = 1.5,
  b: number = 0.75
): number {
  const docLen = documentTokens.length;
  if (docLen === 0) return 0;

  const avgDocLen = docLen; // 对于单文档搜索，使用自身作为平均
  const tf = new Map<string, number>();

  for (const token of documentTokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  let score = 0;
  for (const term of queryTokens) {
    const dfVal = idf.get(term) || 0;
    const freq = tf.get(term) || 0;

    if (freq === 0) continue;

    // Okapi BM25 公式
    const numerator = freq * (k1 + 1);
    const denominator = freq + k1 * (1 - b + b * docLen / Math.max(avgDocLen, 1));
    score += dfVal * numerator / denominator;
  }

  return score;
}

/**
 * 从余弦距离计算相似度
 */
function cosineSimilarity(distance: number): number {
  // ChromaDB 的 hnsw 余弦距离范围 [0, 2]
  // 转换为 [0, 1] 相似度：1 - distance/2 或 max(0, 1 - distance)
  return Math.max(0, 1 - distance);
}

// ============================================================
// HybridSearch 类
// ============================================================

/**
 * HybridSearch - BM25 + Vector 混合搜索
 */
export class HybridSearch {
  private logger: ILogger;
  private config: Required<HybridSearchConfig>;

  constructor(userConfig?: HybridSearchConfig) {
    this.logger = createServiceLogger('HybridSearch');
    this.config = { ...DEFAULT_CONFIG, ...userConfig } as Required<HybridSearchConfig>;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<HybridSearchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 对结果集进行 BM25 重排序
   */
  rerankByBM25(
    results: Array<{
      uid: string;
      text: string;
      distance: number;
      metadata?: Record<string, unknown>;
    }>,
    query: string
  ): SearchResult[] {
    if (results.length === 0) return [];

    // 分词
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      // 无查询词，回退到纯向量搜索
      return results.map(r => ({
        uid: r.uid,
        text: r.text,
        vectorScore: cosineSimilarity(r.distance),
        bm25Score: 0,
        combinedScore: cosineSimilarity(r.distance),
        metadata: r.metadata,
      }));
    }

    // 计算 IDF
    const documents = results.map(r => tokenize(r.text));
    const idf = computeIDF(documents);

    // 计算每条结果的 BM25 和组合得分
    const scored = results.map(r => {
      const docTokens = tokenize(r.text);
      const bmRaw = bm25Score(queryTokens, docTokens, idf, this.config.k1, this.config.b);
      const vecSim = cosineSimilarity(r.distance);

      // 归一化 BM25（在同一候选集内）
      const allBmRaw = documents.map(doc => bm25Score(queryTokens, doc, idf, this.config.k1, this.config.b));
      const maxBm = Math.max(...allBmRaw, 0.001);
      const bmNorm = bmRaw / maxBm;

      // 组合得分
      const combined = this.config.vectorWeight * vecSim + this.config.bm25Weight * bmNorm;

      return {
        uid: r.uid,
        text: r.text,
        vectorScore: vecSim,
        bm25Score: bmRaw,
        combinedScore: combined,
        metadata: r.metadata,
      };
    });

    // 按组合得分排序
    scored.sort((a, b) => b.combinedScore - a.combinedScore);

    this.logger.debug('BM25 reranking completed', {
      queryLength: query.length,
      resultCount: results.length,
      topScore: scored[0]?.combinedScore,
    });

    return scored;
  }

  /**
   * 调整向量权重的重排序
   */
  rerankWithWeights(
    results: SearchResult[],
    vectorWeight?: number,
    bm25Weight?: number
  ): SearchResult[] {
    const vw = vectorWeight ?? this.config.vectorWeight;
    const bw = bm25Weight ?? this.config.bm25Weight;

    const adjusted = results.map(r => ({
      ...r,
      combinedScore: vw * r.vectorScore + bw * (r.bm25Score > 0 ? r.bm25Score / 100 : 0),
    }));

    adjusted.sort((a, b) => b.combinedScore - a.combinedScore);

    return adjusted;
  }

  /**
   * 邻居扩展
   * 如果结果来自同一源文件，扩展到相邻的 chunks
   */
  async expandNeighbors(
    results: SearchResult[],
    getNeighbors: (uid: string, radius?: number) => Promise<SearchResult[]>,
    radius: number = 1
  ): Promise<SearchResult[]> {
    // 按源文件分组
    const bySource = new Map<string, SearchResult[]>();
    for (const r of results) {
      const source = r.metadata?.['source_file'] as string || r.uid;
      if (!bySource.has(source)) {
        bySource.set(source, []);
      }
      bySource.get(source)!.push(r);
    }

    // 对每个源的结果进行邻居扩展
    const expanded: SearchResult[] = [];
    for (const [source, sourceResults] of bySource) {
      if (sourceResults.length <= 1) {
        expanded.push(...sourceResults);
        continue;
      }

      // 取最佳结果进行邻居扩展
      const best = sourceResults[0];
      const neighbors = await getNeighbors(best.uid, radius);

      // 合并
      const seen = new Set<string>([best.uid]);
      expanded.push(best);

      for (const n of neighbors) {
        if (!seen.has(n.uid)) {
          expanded.push(n);
          seen.add(n.uid);
        }
      }
    }

    return expanded;
  }
}

// ============================================================
// 默认实例
// ============================================================

export const defaultHybridSearch = new HybridSearch();

/**
 * 快捷函数：BM25 重排序
 */
export function rerankWithBM25(
  results: Array<{
    uid: string;
    text: string;
    distance: number;
    metadata?: Record<string, unknown>;
  }>,
  query: string,
  config?: HybridSearchConfig
): SearchResult[] {
  const searcher = new HybridSearch(config);
  return searcher.rerankByBM25(results, query);
}