/**
 * AAAK Prescreen - AAAK 预筛选模块
 *
 * 在向量搜索之前使用 AAAK 格式进行快速预筛选
 * 通过解析记忆的 aaak: 标签来匹配查询条件
 *
 * 格式: aaak:ENTITY|TOPICS|"quote"|EMOTIONS|FLAGS
 * 示例: aaak:CHN|ai_memory+optimization|"we decided to use vector search"|determ|DECISION+TECHNICAL
 */

import type { ISQLiteMetaStore } from '../../../infrastructure/storage/core/types';
import {
  detectEntities,
  detectFlags,
  detectEmotions,
  extractTopics,
} from '../aaak';

/**
 * AAAK 预筛选结果
 */
export interface AAAKPrescreenResult {
  uid: string;
  score: number;
  matchDetails: {
    entityMatch: boolean;
    topicMatches: number;
    emotionMatches: number;
    flagMatches: number;
  };
}

/**
 * 从原始 AAAK 字符串解析出组件
 */
function parseAAAKEntry(aaakString: string): {
  entity: string;
  topics: string[];
  quote: string;
  emotions: string[];
  flags: string[];
} | null {
  // 移除 "aaak:" 前缀
  const encoded = aaakString.startsWith('aaak:') ? aaakString.slice(5) : aaakString;

  const parts = encoded.split('|');
  if (parts.length < 2) {
    return null;
  }

  return {
    entity: parts[0] || '',
    topics: parts[1] ? parts[1].split('_').filter(t => t.length > 0) : [],
    quote: parts[2] || '',
    emotions: parts[3] ? parts[3].split('+').filter(e => e.length > 0) : [],
    flags: parts[4] ? parts[4].split('+').filter(f => f.length > 0) : [],
  };
}

/**
 * 计算查询与 AAAK 条目的匹配分数
 */
function calculateMatchScore(
  queryEntry: { entities: string[]; topics: string[]; emotions: string[]; flags: string[] },
  memoryEntry: { entity: string; topics: string[]; emotions: string[]; flags: string[] }
): { score: number; entityMatch: boolean; topicMatches: number; emotionMatches: number; flagMatches: number } {
  let score = 0;
  let entityMatch = false;
  let topicMatches = 0;
  let emotionMatches = 0;
  let flagMatches = 0;

  // 实体匹配（高权重）
  if (queryEntry.entities.length > 0 && memoryEntry.entity) {
    const normalizedEntity = memoryEntry.entity.toLowerCase();
    for (const qEntity of queryEntry.entities) {
      if (normalizedEntity.includes(qEntity.toLowerCase()) || normalizedEntity === qEntity.toLowerCase()) {
        entityMatch = true;
        score += 3;
        break;
      }
    }
  }

  // 主题匹配（中权重，每个匹配 +1）
  if (queryEntry.topics.length > 0 && memoryEntry.topics.length > 0) {
    for (const qTopic of queryEntry.topics) {
      const normalizedTopic = qTopic.toLowerCase();
      for (const mTopic of memoryEntry.topics) {
        if (mTopic.toLowerCase().includes(normalizedTopic) || normalizedTopic.includes(mTopic.toLowerCase())) {
          topicMatches++;
          score += 1;
          break;
        }
      }
    }
  }

  // 情感匹配（中权重，每个匹配 +1）
  if (queryEntry.emotions.length > 0 && memoryEntry.emotions.length > 0) {
    for (const qEmotion of queryEntry.emotions) {
      for (const mEmotion of memoryEntry.emotions) {
        if (qEmotion.toLowerCase() === mEmotion.toLowerCase()) {
          emotionMatches++;
          score += 1;
          break;
        }
      }
    }
  }

  // 标记匹配（高权重，每个匹配 +2）
  if (queryEntry.flags.length > 0 && memoryEntry.flags.length > 0) {
    for (const qFlag of queryEntry.flags) {
      for (const mFlag of memoryEntry.flags) {
        if (qFlag.toLowerCase() === mFlag.toLowerCase()) {
          flagMatches++;
          score += 2;
          break;
        }
      }
    }
  }

  return { score, entityMatch, topicMatches, emotionMatches, flagMatches };
}

/**
 * 使用 AAAK 格式对候选记忆进行预筛选
 *
 * @param query - 查询文本
 * @param candidateUids - 候选记忆 UID 列表
 * @param metaStore - 元数据存储接口
 * @returns 按匹配分数排序的 UID 列表（降序）
 */
export async function prescreenByAAAK(
  query: string,
  candidateUids: string[],
  metaStore: ISQLiteMetaStore
): Promise<string[]> {
  if (candidateUids.length === 0) {
    return [];
  }

  // 1. 从查询中检测 entity/topic/emotion/flags
  const queryEntities = detectEntities(query);
  const queryTopics = extractTopics(query);
  const queryEmotions = detectEmotions(query);
  const queryFlags = detectFlags(query);

  // 如果查询中没有任何可检测的信息，返回原始顺序
  if (queryEntities.length === 0 && queryTopics.length === 0 && queryEmotions.length === 0 && queryFlags.length === 0) {
    return candidateUids;
  }

  const queryEntry = {
    entities: queryEntities,
    topics: queryTopics,
    emotions: queryEmotions,
    flags: queryFlags,
  };

  // 2. 批量获取候选记忆的元数据
  const metas = await metaStore.getByIds(candidateUids);

  // 3. 解析每个记忆的 AAAK 标签并计算匹配分数
  const scoredResults: AAAKPrescreenResult[] = [];

  for (const meta of metas) {
    // 查找 aaak: 开头的标签
    const aaakTag = meta.tags.find(tag => tag.startsWith('aaak:'));

    if (!aaakTag) {
      // 没有 AAAK 标签的记忆，给予最低分数
      scoredResults.push({
        uid: meta.uid,
        score: 0,
        matchDetails: { entityMatch: false, topicMatches: 0, emotionMatches: 0, flagMatches: 0 },
      });
      continue;
    }

    // 解析 AAAK 条目
    const memoryEntry = parseAAAKEntry(aaakTag);
    if (!memoryEntry) {
      scoredResults.push({
        uid: meta.uid,
        score: 0,
        matchDetails: { entityMatch: false, topicMatches: 0, emotionMatches: 0, flagMatches: 0 },
      });
      continue;
    }

    // 计算匹配分数
    const matchResult = calculateMatchScore(queryEntry, memoryEntry);

    scoredResults.push({
      uid: meta.uid,
      score: matchResult.score,
      matchDetails: {
        entityMatch: matchResult.entityMatch,
        topicMatches: matchResult.topicMatches,
        emotionMatches: matchResult.emotionMatches,
        flagMatches: matchResult.flagMatches,
      },
    });
  }

  // 4. 按分数降序排序
  scoredResults.sort((a, b) => b.score - a.score);

  // 5. 返回排序后的 UID 列表
  return scoredResults.map(r => r.uid);
}

/**
 * AAAK 预筛选器类（面向对象的封装）
 */
export class AAAKPrescreener {
  constructor(private metaStore: ISQLiteMetaStore) {}

  /**
   * 对候选记忆进行预筛选
   */
  async prescreen(query: string, candidateUids: string[]): Promise<string[]> {
    return prescreenByAAAK(query, candidateUids, this.metaStore);
  }

  /**
   * 获取预筛选结果的详细信息
   */
  async prescreenWithDetails(query: string, candidateUids: string[]): Promise<AAAKPrescreenResult[]> {
    if (candidateUids.length === 0) {
      return [];
    }

    const queryEntities = detectEntities(query);
    const queryTopics = extractTopics(query);
    const queryEmotions = detectEmotions(query);
    const queryFlags = detectFlags(query);

    const queryEntry = {
      entities: queryEntities,
      topics: queryTopics,
      emotions: queryEmotions,
      flags: queryFlags,
    };

    const metas = await this.metaStore.getByIds(candidateUids);
    const results: AAAKPrescreenResult[] = [];

    for (const meta of metas) {
      const aaakTag = meta.tags.find(tag => tag.startsWith('aaak:'));

      if (!aaakTag) {
        results.push({
          uid: meta.uid,
          score: 0,
          matchDetails: { entityMatch: false, topicMatches: 0, emotionMatches: 0, flagMatches: 0 },
        });
        continue;
      }

      const memoryEntry = parseAAAKEntry(aaakTag);
      if (!memoryEntry) {
        results.push({
          uid: meta.uid,
          score: 0,
          matchDetails: { entityMatch: false, topicMatches: 0, emotionMatches: 0, flagMatches: 0 },
        });
        continue;
      }

      const matchResult = calculateMatchScore(queryEntry, memoryEntry);

      results.push({
        uid: meta.uid,
        score: matchResult.score,
        matchDetails: {
          entityMatch: matchResult.entityMatch,
          topicMatches: matchResult.topicMatches,
          emotionMatches: matchResult.emotionMatches,
          flagMatches: matchResult.flagMatches,
        },
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }
}