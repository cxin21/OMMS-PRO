/**
 * Topic Detector - 话题切换检测
 * @module memory-service/topic-detector
 *
 * 版本: v1.1.0
 * - 使用语义相似度 + LLM 判断话题是否切换
 * - 配置通过 ConfigManager 注入
 */

import { createLogger, type ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import type { MemoryTopicConfig } from '../../../core/types/config';

export interface TopicDetectorConfig {
  /** 低于此值直接判定切换 */
  directSwitchThreshold: number;
  /** 高于此值不切换 */
  noSwitchThreshold: number;
  /** 使用 LLM 精细判断 */
  useLLM: boolean;
}

interface TopicHistory {
  lastTopic: string;
  lastTopicVector?: number[];
  updatedAt: number;
}

/**
 * 获取默认话题检测配置
 */
function getDefaultConfig(): TopicDetectorConfig {
  try {
    if (config.isInitialized()) {
      const topicConfig = config.getConfig('memoryService.topic') as MemoryTopicConfig;
      return {
        directSwitchThreshold: topicConfig?.directSwitchThreshold ?? 0.5,
        noSwitchThreshold: topicConfig?.noSwitchThreshold ?? 0.3,
        useLLM: topicConfig?.useLLM ?? true,
      };
    }
  } catch {
    // ConfigManager not initialized, use defaults
  }
  return {
    directSwitchThreshold: 0.5,
    noSwitchThreshold: 0.3,
    useLLM: true,
  };
}

/**
 * TopicDetector
 *
 * 检测话题是否发生切换
 * 使用语义相似度作为初步筛选，模糊区间使用 LLM 判断
 */
export class TopicDetector {
  private logger: ILogger;
  private config: TopicDetectorConfig;
  private topicHistory: Map<string, TopicHistory>;  // sessionId -> last topic

  constructor(config?: Partial<TopicDetectorConfig>) {
    this.logger = createLogger('TopicDetector');
    const defaultConfig = getDefaultConfig();
    this.config = config ? { ...defaultConfig, ...config } : defaultConfig;
    this.topicHistory = new Map();
    this.logger.info('TopicDetector initialized', { config: this.config });
  }

  /**
   * 判断话题是否应该切换
   *
   * @param sessionId 会话 ID
   * @param currentMessage 当前消息
   * @param embedder 向量化函数
   * @param llmCaller 可选的 LLM 调用函数（用于精细判断）
   * @returns true 表示应该切换话题，false 表示保持当前话题
   */
  async shouldSwitchTopic(
    sessionId: string,
    currentMessage: string,
    embedder: (text: string) => Promise<number[]>,
    llmCaller?: (prompt: string) => Promise<string>
  ): Promise<{ shouldSwitch: boolean; confidence: number; reason: string }> {
    const history = this.topicHistory.get(sessionId);

    if (!history || !history.lastTopic) {
      // 首次对话，设置初始话题
      this.setTopic(sessionId, currentMessage);
      return {
        shouldSwitch: false,
        confidence: 1.0,
        reason: 'first_topic',
      };
    }

    // 计算语义相似度
    let similarity = 0.5; // 默认中间值

    try {
      if (history.lastTopicVector) {
        const currentVector = await embedder(currentMessage);
        similarity = this.cosineSimilarity(history.lastTopicVector, currentVector);
      } else {
        // 如果没有缓存的向量，重新计算
        const [lastVec, currentVec] = await Promise.all([
          embedder(history.lastTopic),
          embedder(currentMessage),
        ]);
        similarity = this.cosineSimilarity(lastVec, currentVec);
        history.lastTopicVector = lastVec;
      }
    } catch (error) {
      this.logger.warn('Failed to compute similarity, assuming no switch', { error });
      return {
        shouldSwitch: false,
        confidence: 0.5,
        reason: 'embedding_error',
      };
    }

    // 低于直接切换阈值
    if (similarity < this.config.directSwitchThreshold) {
      // 但需要检查是否在 LLM 判断区间
      if (this.config.useLLM && llmCaller && similarity >= this.config.noSwitchThreshold) {
        return this.judgeWithLLM(sessionId, currentMessage, history.lastTopic, llmCaller);
      }

      // 直接判定切换
      this.setTopic(sessionId, currentMessage);
      return {
        shouldSwitch: true,
        confidence: 1 - similarity,
        reason: `low_similarity_${similarity.toFixed(2)}`,
      };
    }

    // 高于不切换阈值
    if (similarity >= this.config.directSwitchThreshold) {
      // 更新话题记录（轻微更新，保持话题连续性）
      this.updateTopic(sessionId, currentMessage);
      return {
        shouldSwitch: false,
        confidence: similarity,
        reason: `high_similarity_${similarity.toFixed(2)}`,
      };
    }

    // 在模糊区间，使用 LLM 或保持
    if (this.config.useLLM && llmCaller) {
      return this.judgeWithLLM(sessionId, currentMessage, history.lastTopic, llmCaller);
    }

    // 默认保持话题
    return {
      shouldSwitch: false,
      confidence: similarity,
      reason: 'ambiguous_range_no_llm',
    };
  }

  /**
   * 使用 LLM 进行精细判断
   */
  private async judgeWithLLM(
    sessionId: string,
    currentMessage: string,
    lastTopic: string,
    llmCaller: (prompt: string) => Promise<string>
  ): Promise<{ shouldSwitch: boolean; confidence: number; reason: string }> {
    const prompt = this.buildLLMPrompt(lastTopic, currentMessage);

    try {
      const response = await llmCaller(prompt);
      const result = this.parseLLMResponse(response);

      if (result.shouldSwitch) {
        this.setTopic(sessionId, currentMessage);
      } else {
        this.updateTopic(sessionId, currentMessage);
      }

      return {
        shouldSwitch: result.shouldSwitch,
        confidence: result.confidence,
        reason: 'llm_judgment',
      };
    } catch (error) {
      this.logger.warn('LLM judgment failed, defaulting to no switch', { error });
      this.updateTopic(sessionId, currentMessage);
      return {
        shouldSwitch: false,
        confidence: 0.5,
        reason: 'llm_error_default',
      };
    }
  }

  /**
   * 构建 LLM 判断提示词
   */
  private buildLLMPrompt(lastTopic: string, currentMessage: string): string {
    return `## 任务
判断用户的下一条消息是否表示话题已切换。

## 上一轮话题
"${lastTopic.slice(0, 200)}"

## 当前用户消息
"${currentMessage.slice(0, 200)}"

## 判断标准
1. **话题继续**：当前消息是否在延续、深入、或回应上一轮话题？
   - 示例：追问细节、表示同意、提供更多信息、情绪反应

2. **话题切换**：当前消息是否提出了全新的、不相关的话题？
   - 示例：完全改变主题、引入无关内容、跳跃到新问题

## 注意事项
- 如果不确定，倾向于"话题继续"
- 简短的问候语（如"谢谢"、"好的"）不算话题切换
- 技术问题中小的分支讨论不算话题切换
- 明显的感谢+新话题 = 切换

## 输出格式
必须严格遵循以下 JSON 格式，不要包含任何其他内容：
{
  "shouldSwitch": true或false,
  "confidence": 0.0到1.0之间的数字,
  "reason": "一句话解释判断理由"
}

直接输出 JSON，不要有前缀或后缀文字。`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseLLMResponse(response: string): { shouldSwitch: boolean; confidence: number } {
    try {
      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          shouldSwitch: Boolean(parsed.shouldSwitch),
          confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        };
      }
    } catch {
      // 解析失败
    }

    // 备用：简单解析
    const isSwitch = response.toLowerCase().includes('"shouldSwitch": true');
    return {
      shouldSwitch: isSwitch,
      confidence: 0.5,
    };
  }

  /**
   * 设置新话题（完全替换）
   */
  private setTopic(sessionId: string, topic: string): void {
    this.topicHistory.set(sessionId, {
      lastTopic: topic,
      lastTopicVector: undefined,
      updatedAt: Date.now(),
    });
  }

  /**
   * 更新话题（保持上下文）
   */
  private updateTopic(sessionId: string, newTopic: string): void {
    const history = this.topicHistory.get(sessionId);
    if (history) {
      // 合并话题内容，保持上下文
      history.lastTopic = newTopic;
      history.lastTopicVector = undefined; // 需要重新计算
      history.updatedAt = Date.now();
    } else {
      this.setTopic(sessionId, newTopic);
    }
  }

  /**
   * 获取当前话题
   */
  getCurrentTopic(sessionId: string): string | undefined {
    return this.topicHistory.get(sessionId)?.lastTopic;
  }

  /**
   * 清除话题历史
   */
  clearTopic(sessionId: string): void {
    this.topicHistory.delete(sessionId);
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TopicDetectorConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('TopicDetector config updated', this.config as unknown as Record<string, unknown>);
  }
}
