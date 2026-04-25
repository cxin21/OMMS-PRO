/**
 * 配置验证器模块
 * 提供配置验证功能
 * 
 * @module config/validator
 */

import type { OMMSConfig, LogLevel, LLMProvider } from '@core/types/config';
import type { ValidationRule, ValidationResult } from './types';
import { PathUtils } from './path-utils';

/**
 * ConfigValidator - 配置验证器
 * 
 * 负责验证配置的有效性
 */
export class ConfigValidator {
  private rules: Map<string, ValidationRule[]>;
  
  constructor() {
    this.rules = new Map();
    this.registerBuiltinRules();
  }
  
  /**
   * 注册内置验证规则
   */
  private registerBuiltinRules(): void {
    // 日志级别验证
    this.registerRule('logging.level', {
      name: 'LogLevel',
      validate: (value) => {
        const validLevels = ['debug', 'info', 'warn', 'error'];
        return validLevels.includes(value as string);
      },
      message: 'logging.level must be one of: debug, info, warn, error',
      required: true,
    });
    
    // 日志输出验证
    this.registerRule('logging.output', {
      name: 'LogOutput',
      validate: (value) => {
        const validOutputs = ['console', 'file', 'both'];
        return validOutputs.includes(value as string);
      },
      message: 'logging.output must be one of: console, file, both',
      required: true,
    });
    
    // Embedding 向量维度验证（原 vector.dimensions，已迁移至 embedding.dimensions）
    this.registerRule('embedding.dimensions', {
      name: 'PositiveNumber',
      validate: (value) => {
        return typeof value === 'number' && value > 0 && Number.isInteger(value);
      },
      message: 'embedding.dimensions must be a positive integer',
      required: true,
    });

    // LLM Provider 验证（原 llm.provider，已迁移至 llmExtraction.provider）
    this.registerRule('llmExtraction.provider', {
      name: 'LLMProvider',
      validate: (value) => {
        const validProviders = ['openai', 'anthropic', 'ollama', 'mock', 'openai-compatible'];
        return validProviders.includes(value as string);
      },
      message: 'llmExtraction.provider must be one of: openai, anthropic, ollama, mock, openai-compatible',
      required: true,
    });

    // 捕获置信度阈值验证（原 scoring.importance.confidenceWeight，已迁移至 capture.confidenceThreshold）
    this.registerRule('capture.confidenceThreshold', {
      name: 'ScoreRange',
      validate: (value) => {
        return typeof value === 'number' && value >= 0 && value <= 1;
      },
      message: 'capture.confidenceThreshold must be between 0 and 1',
      required: true,
    });
  }
  
  /**
   * 注册验证规则
   * 
   * @param path - 配置路径
   * @param rule - 验证规则
   */
  registerRule(path: string, rule: ValidationRule): void {
    const existing = this.rules.get(path) || [];
    existing.push(rule);
    this.rules.set(path, existing);
  }
  
  /**
   * 移除验证规则
   * 
   * @param path - 配置路径
   * @param ruleName - 规则名称
   */
  removeRule(path: string, ruleName: string): void {
    const existing = this.rules.get(path);
    if (!existing) {
      return;
    }
    
    const filtered = existing.filter(r => r.name !== ruleName);
    if (filtered.length > 0) {
      this.rules.set(path, filtered);
    } else {
      this.rules.delete(path);
    }
  }
  
  /**
   * 验证配置
   * 
   * @param config - 配置对象
   * @returns 验证结果
   */
  validate(config: OMMSConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 验证所有注册的规则
    for (const [path, rules] of this.rules.entries()) {
      const value = PathUtils.getByPath(config, path);
      
      for (const rule of rules) {
        // 检查必填项
        if (rule.required && (value === undefined || value === null)) {
          errors.push(`${path} is required: ${rule.message}`);
          continue;
        }
        
        // 如果值不存在且不是必填，跳过
        if (value === undefined || value === null) {
          continue;
        }
        
        // 执行验证
        try {
          if (!rule.validate(value, config)) {
            errors.push(`${path}: ${rule.message}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`${path}: Validation error - ${errorMessage}`);
        }
      }
    }
    
    // 额外验证：检查依赖关系
    this.validateDependencies(config, errors, warnings);
    
    // 额外验证：检查范围
    this.validateRanges(config, errors, warnings);
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * 验证特定路径的配置
   * 
   * @param path - 配置路径
   * @param value - 配置值
   * @returns 验证结果
   */
  validatePath(path: string, value: unknown): ValidationResult {
    const rules = this.rules.get(path) || [];
    const errors: string[] = [];
    const warnings: string[] = [];
    
    for (const rule of rules) {
      if (rule.required && (value === undefined || value === null)) {
        errors.push(`${path} is required: ${rule.message}`);
        continue;
      }
      
      if (value === undefined || value === null) {
        continue;
      }
      
      try {
        if (!rule.validate(value, {})) {
          errors.push(`${path}: ${rule.message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${path}: Validation error - ${errorMessage}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * 验证依赖关系
   */
  private validateDependencies(config: OMMSConfig, errors: string[], warnings: string[]): void {
    // 如果启用文件日志，必须有 filePath
    if (
      config.logging.output === 'file' ||
      config.logging.output === 'both'
    ) {
      if (!config.logging.filePath || config.logging.filePath.trim() === '') {
        warnings.push('logging.filePath is recommended when logging.output includes file');
      }
    }
    
    // 如果 LLM provider 是 openai，必须有 apiKey
    if (
      config.llmExtraction.provider === 'openai' &&
      !config.llmExtraction.apiKey
    ) {
      warnings.push('llmExtraction.apiKey is recommended for openai provider');
    }

    // 如果启用 dreaming，必须有合理的阈值
    if (config.dreamingEngine.scheduler.autoOrganize) {
      const interval = config.dreamingEngine.scheduler.organizeInterval;
      if (interval < 0) {
        errors.push(`dreamingEngine.scheduler.organizeInterval must be positive, got ${interval}`);
      }
    }
  }
  
  /**
   * 验证范围
   */
  private validateRanges(config: OMMSConfig, errors: string[], warnings: string[]): void {
    // 验证所有权重在 0-1 范围内
    const weightPaths = [
      'memoryService.recall.vectorWeight',
      'memoryService.recall.keywordWeight',
    ];

    for (const path of weightPaths) {
      const value = PathUtils.getByPath(config, path);
      if (value !== undefined && typeof value === 'number') {
        if (value < 0 || value > 1) {
          errors.push(`${path} must be between 0 and 1, got ${value}`);
        }
      }
    }

    // 验证 vectorWeight + keywordWeight = 1
    const vectorWeight = config.memoryService.recall.vectorWeight;
    const keywordWeight = config.memoryService.recall.keywordWeight;
    if (vectorWeight !== undefined && keywordWeight !== undefined) {
      const sum = vectorWeight + keywordWeight;
      if (Math.abs(sum - 1.0) > 0.001) {
        warnings.push(`memoryService.recall weights should sum to 1.0, got ${sum}`);
      }
    }
    
    // 验证数量配置
    const countPaths = [
      'logging.maxFiles',
      'memoryService.cache.maxSize',
      'memoryService.forget.maxInactiveDays',
    ];

    for (const path of countPaths) {
      const value = PathUtils.getByPath(config, path);
      if (value !== undefined && typeof value === 'number') {
        if (value <= 0) {
          errors.push(`${path} must be positive, got ${value}`);
        }
      }
    }
  }
  
  /**
   * 获取所有注册的规则
   */
  getRules(): Map<string, ValidationRule[]> {
    return new Map(this.rules);
  }
  
  /**
   * 清除所有规则
   */
  clearRules(): void {
    this.rules.clear();
    this.registerBuiltinRules();
  }
}
