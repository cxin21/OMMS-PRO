/**
 * Sentiment Analyzer - 情感分析
 * @module memory-service/sentiment-analyzer
 *
 * 版本: v1.1.0
 * - 使用规则 + LLM 推断进行情感分析
 * - 配置通过 ConfigManager 注入
 */

import { createServiceLogger, type ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import type { MemorySentimentConfig } from '../../../core/types/config';
import { PromptLoader } from '../../../shared/prompts';
import { MemoryDefaults } from '../../../config';

export interface SentimentResult {
  /** 主要情感 */
  primary: 'positive' | 'negative' | 'neutral';
  /** 情感强度 (0-1) */
  intensity: number;
  /** 细粒度情感标签 */
  emotions: string[];
  /** 置信度 */
  confidence: number;
}

export interface SentimentAnalyzerConfig {
  /** 最小内容长度才进行情感分析 */
  minContentLength: number;
  /** LLM 推断阈值：强度低于此值时调用 LLM 精调 */
  llmRefineThreshold: number;
}

// 情感词典 - 规则匹配用
const POSITIVE_WORDS = [
  '好', '很好', '棒', '优秀', '赞', '不错', '感谢', '谢谢', '感激',
  '喜欢', '爱', '开心', '高兴', '快乐', '满意', '成功', '达成',
  '对的', '正确', '厉害', '牛', '强', '有用', '有效', '解决',
  '完美', '出色', '精彩', '优秀', '最佳', '最优', '顶', '爆',
  'great', 'good', 'excellent', 'amazing', 'wonderful', 'fantastic',
  'thanks', 'thank', 'love', 'like', 'happy', 'glad', 'perfect',
];

const NEGATIVE_WORDS = [
  '坏', '差', '烂', '糟糕', '问题', '错误', '失败', '失败',
  '讨厌', '恨', '难过', '失望', '沮丧', '生气', '愤怒', '烦躁',
  '不对', '错误', 'bug', '崩溃', '卡', '慢', '难用', '无效',
  '不对', '失败', '坏', '烂', '差', '垃圾', '废物', '屁',
  'bad', 'wrong', 'error', 'fail', 'failed', 'failure', 'terrible',
  'awful', 'horrible', 'hate', 'dislike', 'sad', 'angry', 'frustrated',
];

const INTENSITY_MODIFIERS = {
  very: 1.5,
  extremely: 1.8,
  super: 1.5,
  非常: 1.5,
  特别: 1.5,
  极其: 1.8,
  十分: 1.3,
  比较: 1.1,
  有点: 0.7,
  稍微: 0.7,
  slightly: 0.7,
  kindof: 0.8,
  kind_of: 0.8,
};

// 细粒度情感映射
const EMOTION_KEYWORDS: Record<string, string[]> = {
  joy: ['开心', '高兴', '快乐', 'happy', 'glad', 'joyful', 'pleased'],
  gratitude: ['感谢', '谢谢', '感激', 'appreciate', 'grateful', 'thankful'],
  frustration: ['烦躁', '挫败', 'frustrated', 'annoyed', 'irritated', '头疼'],
  anger: ['生气', '愤怒', 'angry', 'mad', 'furious', 'rage'],
  sadness: ['难过', '伤心', 'sad', 'upset', 'disappointed', 'depressed'],
  anxiety: ['焦虑', '担心', 'anxious', 'worried', 'nervous', 'concern'],
  surprise: ['惊讶', '吃惊', 'surprised', 'amazed', 'astonished', 'shocked'],
  confusion: ['困惑', '迷糊', 'confused', 'puzzled', 'bewildered', '懵'],
  satisfaction: ['满意', '满足', 'satisfied', 'content', 'pleased'],
  excitement: ['兴奋', '激动', 'excited', 'thrilled', 'enthusiastic'],
  fear: ['害怕', '恐惧', 'fear', 'afraid', 'scared', 'terrified'],
  disgust: ['厌恶', '恶心', 'disgusted', 'repulsed', 'dislike'],
};

/**
 * 获取默认情感分析配置
 */
function getDefaultConfig(): SentimentAnalyzerConfig {
  try {
    if (config.isInitialized()) {
      const sentimentConfig = config.getConfig('memoryService.sentiment') as MemorySentimentConfig;
      return {
        minContentLength: 10,  // 规则基础配置，不在 MemorySentimentConfig 中
        llmRefineThreshold: sentimentConfig?.llmRefineThreshold ?? MemoryDefaults.llmRefineThreshold,
      };
    }
  } catch {
    // ConfigManager not initialized, use defaults
  }
  return {
    minContentLength: 10,
    llmRefineThreshold: MemoryDefaults.llmRefineThreshold,
  };
}

/**
 * SentimentAnalyzer
 *
 * 使用规则 + LLM 推断进行情感分析
 * 流程：
 * 1. 规则匹配（快速）
 * 2. 如果强度低于阈值，使用 LLM 精调
 */
export class SentimentAnalyzer {
  private logger: ILogger;
  private config: SentimentAnalyzerConfig;
  private promptLoader = PromptLoader.getInstance();

  constructor(config?: Partial<SentimentAnalyzerConfig>) {
    this.logger = createServiceLogger('SentimentAnalyzer');
    const defaultConfig = getDefaultConfig();
    this.config = config ? { ...defaultConfig, ...config } : defaultConfig;
    this.logger.info('SentimentAnalyzer initialized', { config: this.config });
  }

  /**
   * 分析情感
   *
   * @param content 要分析的内容
   * @param llmCaller 可选的 LLM 调用函数（用于精调）
   * @returns 情感分析结果
   */
  async analyze(
    content: string,
    llmCaller?: (prompt: string) => Promise<string>
  ): Promise<SentimentResult> {
    // 长度检查
    if (content.length < this.config.minContentLength) {
      return {
        primary: 'neutral',
        intensity: 0,
        emotions: [],
        confidence: 1.0,
      };
    }

    // Step 1: 规则匹配
    const ruleResult = this.analyzeByRules(content);

    this.logger.debug('Rule-based sentiment', {
      content: content.slice(0, 50),
      result: ruleResult,
    });

    // Step 2: 如果需要 LLM 精调
    if (llmCaller && ruleResult.intensity < this.config.llmRefineThreshold) {
      return this.refineWithLLM(content, ruleResult, llmCaller);
    }

    return ruleResult;
  }

  /**
   * 使用规则分析情感
   */
  private analyzeByRules(content: string): SentimentResult {
    const lowerContent = content.toLowerCase();
    const normalizedContent = content.toLowerCase();

    let positiveScore = 0;
    let negativeScore = 0;
    const matchedWords: string[] = [];
    const matchedEmotions: string[] = [];

    // 统计情感词
    for (const word of POSITIVE_WORDS) {
      if (normalizedContent.includes(word.toLowerCase())) {
        positiveScore += 1;
        matchedWords.push(word);
      }
    }

    for (const word of NEGATIVE_WORDS) {
      if (normalizedContent.includes(word.toLowerCase())) {
        negativeScore += 1;
        matchedWords.push(word);
      }
    }

    // 检测强度修饰词
    let intensityMultiplier = 1.0;
    for (const [modifier, multiplier] of Object.entries(INTENSITY_MODIFIERS)) {
      if (normalizedContent.includes(modifier)) {
        intensityMultiplier = Math.max(intensityMultiplier, multiplier);
      }
    }

    // 检测细粒度情感
    for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
      for (const keyword of keywords) {
        if (normalizedContent.includes(keyword)) {
          if (!matchedEmotions.includes(emotion)) {
            matchedEmotions.push(emotion);
          }
        }
      }
    }

    // 计算最终情感
    const adjustedPositive = positiveScore * intensityMultiplier;
    const adjustedNegative = negativeScore * intensityMultiplier;

    let primary: 'positive' | 'negative' | 'neutral';
    let intensity: number;

    if (adjustedPositive > adjustedNegative && adjustedPositive > 0) {
      primary = 'positive';
      intensity = Math.min(1.0, adjustedPositive / 5); // 归一化
    } else if (adjustedNegative > adjustedPositive && adjustedNegative > 0) {
      primary = 'negative';
      intensity = Math.min(1.0, adjustedNegative / 5);
    } else {
      primary = 'neutral';
      intensity = 0;
    }

    // 计算置信度
    const totalMatches = positiveScore + negativeScore;
    const confidence = totalMatches > 0
      ? Math.min(1.0, totalMatches / 3)
      : 0.5;

    return {
      primary,
      intensity,
      emotions: matchedEmotions.length > 0 ? matchedEmotions : [primary],
      confidence,
    };
  }

  /**
   * 使用 LLM 精调
   */
  private async refineWithLLM(
    content: string,
    ruleResult: SentimentResult,
    llmCaller: (prompt: string) => Promise<string>
  ): Promise<SentimentResult> {
    const prompt = this.buildLLMPrompt(content, ruleResult);

    try {
      const response = await llmCaller(prompt);
      const llmResult = this.parseLLMResponse(response, ruleResult);

      this.logger.debug('LLM refined sentiment', {
        content: content.slice(0, 50),
        ruleResult,
        llmResult,
      });

      return llmResult;
    } catch (error) {
      this.logger.warn('LLM refinement failed, using rule result', { error });
      return ruleResult;
    }
  }

  /**
   * 构建 LLM 提示词
   */
  private buildLLMPrompt(content: string, ruleResult: SentimentResult): string {
    return this.promptLoader.render('prompts/sentiment-refinement.md', {
      content: content.slice(0, 500),
      primary: ruleResult.primary,
      intensity: ruleResult.intensity.toFixed(2),
      emotions: ruleResult.emotions.join(', ') || '无',
    });
  }

  /**
   * 解析 LLM 响应
   */
  private parseLLMResponse(
    response: string,
    fallback: SentimentResult
  ): SentimentResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // 验证和修正
        const primary = ['positive', 'negative', 'neutral'].includes(parsed.primary)
          ? parsed.primary
          : fallback.primary;

        return {
          primary: primary as 'positive' | 'negative' | 'neutral',
          intensity: Math.max(0, Math.min(1, Number(parsed.intensity) || fallback.intensity)),
          emotions: Array.isArray(parsed.emotions)
            ? parsed.emotions.slice(0, 3)
            : fallback.emotions,
          confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || fallback.confidence)),
        };
      }
    } catch {
      // 解析失败
    }

    return fallback;
  }

  /**
   * 批量分析（简单版本）
   */
  async analyzeBatch(
    contents: string[],
    llmCaller?: (prompt: string) => Promise<string>
  ): Promise<SentimentResult[]> {
    return Promise.all(
      contents.map(content => this.analyze(content, llmCaller))
    );
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SentimentAnalyzerConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('SentimentAnalyzer config updated', this.config as unknown as Record<string, unknown>);
  }
}
