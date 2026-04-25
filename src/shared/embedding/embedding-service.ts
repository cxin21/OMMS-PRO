/**
 * Embedding Service - 嵌入向量服务
 * 支持本地模型和远程 API
 *
 * @module embedding/embedding-service
 */

import { createLogger, type ILogger } from '../logging';
import { config } from '../config';
import type { EmbeddingConfig } from '@core/types/config';

/** @deprecated 使用 ../types/config 中的 EmbeddingConfig */
export type LocalEmbeddingConfig = EmbeddingConfig;

/**
 * 获取 Embedding 配置
 * 必须从 ConfigManager 读取
 */
function getEmbeddingConfig(): EmbeddingConfig {
  return config.getConfigOrThrow<EmbeddingConfig>('embedding');
}

/**
 * Embedding Service
 * 提供文本嵌入向量生成
 */
export class EmbeddingService {
  private logger: ILogger;
  private config: EmbeddingConfig;
  private apiBase: string;

  constructor(userConfig?: Partial<EmbeddingConfig>) {
    this.logger = createLogger('EmbeddingService');

    // 从 ConfigManager 读取配置，合并用户配置
    const baseConfig = getEmbeddingConfig();
    this.config = userConfig && Object.keys(userConfig).length > 0
      ? { ...baseConfig, ...userConfig }
      : baseConfig;
    this.apiBase = this.config.baseURL ? `${this.config.baseURL}/embeddings` : '';
  }

  /**
   * 生成单个文本的嵌入向量
   */
  async embed(text: string): Promise<number[]> {
    this.logger.info('embed 方法调用', {
      method: 'embed',
      textLength: text.length,
      model: this.config.model,
      dimensions: this.config.dimensions,
    });

    try {
      if (!this.apiBase || !this.config.apiKey) {
        throw new Error('Embedding API not configured - baseURL and apiKey are required');
      }

      const response = await fetch(this.apiBase, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { data?: { embedding: number[] }[] };

      if (!result.data || !result.data[0] || !result.data[0].embedding) {
        throw new Error('Invalid embedding response');
      }

      this.logger.info('embed 方法返回', {
        method: 'embed',
        embeddingLength: result.data[0].embedding.length,
      });

      return result.data[0].embedding;
    } catch (error) {
      this.logger.error('embed 方法失败', { method: 'embed', error: String(error), text: text.substring(0, 50) });
      throw error;
    }
  }

  /**
   * 批量生成嵌入向量
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    this.logger.info('embedBatch 方法调用', {
      method: 'embedBatch',
      count: texts.length,
      model: this.config.model,
      dimensions: this.config.dimensions,
    });

    if (texts.length === 0) {
      this.logger.info('embedBatch 方法返回（空输入）', { method: 'embedBatch' });
      return [];
    }

    try {
      if (!this.apiBase || !this.config.apiKey) {
        throw new Error('Embedding API not configured - baseURL and apiKey are required');
      }

      const response = await fetch(this.apiBase, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { data?: { embedding: number[] }[] };

      if (!result.data) {
        throw new Error('Invalid embedding response');
      }

      const embeddings = result.data.map((item) => item.embedding);

      this.logger.info('embedBatch 方法返回', {
        method: 'embedBatch',
        count: embeddings.length,
        embeddingDimensions: embeddings[0]?.length ?? 0,
      });

      return embeddings;
    } catch (error) {
      this.logger.error('embedBatch 方法失败', { method: 'embedBatch', error: String(error), count: texts.length });
      throw error;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): EmbeddingConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<EmbeddingConfig>): void {
    this.logger.info('updateConfig 方法调用', { method: 'updateConfig', newConfig });

    // If called with empty object, re-read from ConfigManager using the already-imported singleton
    if (Object.keys(newConfig).length === 0) {
      try {
        if (config.isInitialized()) {
          const fresh = config.getConfig<EmbeddingConfig>('embedding');
          this.config = {
            model: fresh.model ?? this.config.model,
            dimensions: fresh.dimensions ?? this.config.dimensions,
            baseURL: fresh.baseURL ?? this.config.baseURL,
            apiKey: fresh.apiKey ?? this.config.apiKey,
            batchSize: fresh.batchSize ?? this.config.batchSize,
            timeout: fresh.timeout ?? this.config.timeout,
          };
        }
      } catch {
        // ConfigManager not ready, keep existing config
      }
    } else {
      this.config = { ...this.config, ...newConfig };
    }
    this.apiBase = this.config.baseURL ? `${this.config.baseURL}/embeddings` : '';

    this.logger.info('updateConfig 方法返回', { method: 'updateConfig', model: this.config.model, dimensions: this.config.dimensions });
  }
}

export default EmbeddingService;
