/**
 * LLM Factory - LLM 实例工厂
 * 统一创建 LLM Extractor 实例
 */

import { config, ConfigPaths } from '../config';
import { AnthropicExtractor } from './anthropic';
import { OpenAIExtractor } from './openai';
import { CustomExtractor } from './custom';
import type { ILLMExtractor, LLMProvider, PromptFileMapping } from './types';

export type { LLMProvider };
export { DEFAULT_PROMPT_FILES } from './types';

/**
 * LLM Extractor 配置
 */
export interface LLMExtractorConfig {
  llmApiKey?: string;
  llmEndpoint?: string;
  llmModel?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * 创建 LLM Extractor 实例
 */
export function createLLMExtractor(
  providerOrConfig?: LLMProvider | LLMExtractorConfig | Record<string, any>,
  promptFiles?: PromptFileMapping
): ILLMExtractor {
  let provider: LLMProvider;
  let llmConfig: LLMExtractorConfig;

  if (typeof providerOrConfig === 'string') {
    provider = providerOrConfig;
    llmConfig = loadLLMConfig();
  } else if (providerOrConfig) {
    // 兼容 MemoryCaptureConfig 格式或 LLMExtractorConfig 格式
    const cfg = providerOrConfig as Record<string, any>;
    provider = cfg['llmProvider'] ?? detectProvider();
    llmConfig = {
      llmApiKey: cfg['llmApiKey'],
      llmEndpoint: cfg['llmEndpoint'],
      llmModel: cfg['llmModel'],
      temperature: cfg['temperature'],
      maxTokens: cfg['maxTokens'],
    };
  } else {
    provider = detectProvider();
    llmConfig = loadLLMConfig();
  }

  switch (provider) {
    case 'anthropic':
      return new AnthropicExtractor(llmConfig, promptFiles);
    case 'openai':
      return new OpenAIExtractor(llmConfig, promptFiles);
    case 'custom':
    default:
      return new CustomExtractor(llmConfig, promptFiles);
  }
}

/**
 * 检测 LLM 提供商（从配置读取）
 */
function detectProvider(): LLMProvider {
  try {
    const llmConfig = config.getConfig<{ provider?: string }>(ConfigPaths.llm.extraction);
    const provider = llmConfig?.provider as LLMProvider | undefined;
    if (provider && ['anthropic', 'openai', 'custom'].includes(provider)) {
      return provider;
    }
  } catch {
    // 使用默认
  }
  return 'custom';
}

/**
 * 加载 LLM 配置
 */
function loadLLMConfig(): LLMExtractorConfig {
  try {
    const llmConfig = config.getConfigOrThrow<Record<string, any>>(ConfigPaths.llm.extraction);
    return {
      llmApiKey: llmConfig['apiKey'] as string | undefined,
      llmEndpoint: llmConfig['baseURL'] as string | undefined,
      llmModel: llmConfig['model'] as string | undefined,
      temperature: llmConfig['temperature'] as number | undefined,
      maxTokens: llmConfig['maxTokens'] as number | undefined,
    };
  } catch {
    return {
      llmApiKey: '',
      llmEndpoint: '',
      llmModel: 'gpt-4',
    };
  }
}

/**
 * 获取 LLM 配置（供外部使用）
 */
export function getLLMConfig() {
  return loadLLMConfig();
}
