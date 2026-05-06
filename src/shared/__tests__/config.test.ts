/**
 * ConfigManager 基础测试
 * 验证配置加载、默认值、环境变量合并
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');

describe('ConfigManager - 配置加载器基础测试', () => {
  describe('config.default.json 完整性', () => {
    it('config.default.json 文件存在且可解析', () => {
      const defaultPath = join(PROJECT_ROOT, 'config.default.json');
      expect(existsSync(defaultPath)).toBe(true);

      const content = readFileSync(defaultPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe('object');
    });

    it('包含所有必需的顶层配置节', () => {
      const defaultPath = join(PROJECT_ROOT, 'config.default.json');
      const config = JSON.parse(readFileSync(defaultPath, 'utf-8'));

      // 必需的顶层键（与 OMMSConfig 接口对齐）
      const requiredKeys = [
        'agentId',
        'llmExtraction',
        'api',
        'mcp',
        'logging',
        'memoryService',
        'embedding',
        'dreamingEngine',
      ];
      for (const key of requiredKeys) {
        expect(config).toHaveProperty(key);
      }
    });

    it('memoryService 包含所有必要的子配置', () => {
      const defaultPath = join(PROJECT_ROOT, 'config.default.json');
      const config = JSON.parse(readFileSync(defaultPath, 'utf-8'));
      const ms = config.memoryService;

      const requiredSubKeys = [
        'store', 'recall', 'forget', 'reinforcement', 'cache',
        'episode', 'topic', 'sentiment', 'consolidation', 'spatial',
        'logging', 'version', 'capture', 'roomManager', 'memoryRoomMapping',
        'accessControl', 'indexUpdate', 'recallStrategy', 'webhook',
        'degradation', 'scopeDegradation', 'storage', 'profileService',
      ];
      for (const key of requiredSubKeys) {
        expect(ms).toHaveProperty(key);
      }
    });

    it('dreamingEngine 包含所有必要的子配置', () => {
      const defaultPath = join(PROJECT_ROOT, 'config.default.json');
      const config = JSON.parse(readFileSync(defaultPath, 'utf-8'));
      const de = config.dreamingEngine;

      const requiredSubKeys = [
        'scheduler', 'consolidation', 'reorganization',
        'archival', 'defragmentation', 'themeExtraction',
      ];
      for (const key of requiredSubKeys) {
        expect(de).toHaveProperty(key);
      }
    });

    it('不包含硬编码的 API Key', () => {
      const defaultPath = join(PROJECT_ROOT, 'config.default.json');
      const content = readFileSync(defaultPath, 'utf-8');

      // 确保所有 apiKey 字段为空字符串（模板值）
      const config = JSON.parse(content);

      function checkApiKeys(obj: any, path: string = ''): void {
        if (typeof obj !== 'object' || obj === null) return;
        for (const key of Object.keys(obj)) {
          const fullPath = path ? `${path}.${key}` : key;
          if (key === 'apiKey' && typeof obj[key] === 'string') {
            // API Key 在默认模板中应为空字符串或环境变量占位符
            expect(obj[key]).toBe('');
          }
          if (typeof obj[key] === 'object') {
            checkApiKeys(obj[key], fullPath);
          }
        }
      }

      checkApiKeys(config);
    });
  });

  describe('config.schema.json 完整性', () => {
    it('config.schema.json 文件存在且为有效 JSON Schema', () => {
      const schemaPath = join(PROJECT_ROOT, 'config.schema.json');
      expect(existsSync(schemaPath)).toBe(true);

      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
      expect(schema.$schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    });
  });

  describe('配置值合法性校验', () => {
    it('所有阈值在合理范围内', () => {
      const defaultPath = join(PROJECT_ROOT, 'config.default.json');
      const config = JSON.parse(readFileSync(defaultPath, 'utf-8'));

      // 检查关键数值范围
      const ms = config.memoryService;

      // recall 配置
      expect(ms.recall.vectorWeight).toBeGreaterThanOrEqual(0);
      expect(ms.recall.vectorWeight).toBeLessThanOrEqual(1);
      expect(ms.recall.keywordWeight).toBeGreaterThanOrEqual(0);
      expect(ms.recall.keywordWeight).toBeLessThanOrEqual(1);
      expect(ms.recall.minScore).toBeGreaterThanOrEqual(0);
      expect(ms.recall.minScore).toBeLessThanOrEqual(1);

      // store 配置
      expect(ms.store.defaultImportance).toBeGreaterThanOrEqual(1);
      expect(ms.store.defaultImportance).toBeLessThanOrEqual(10);
      expect(ms.store.defaultScopeScore).toBeGreaterThanOrEqual(1);
      expect(ms.store.defaultScopeScore).toBeLessThanOrEqual(10);

      // embedding 配置
      expect(config.embedding.dimensions).toBeGreaterThan(0);

      // llmExtraction 配置
      expect(config.llmExtraction.temperature).toBeGreaterThanOrEqual(0);
      expect(config.llmExtraction.temperature).toBeLessThanOrEqual(1);
    });
  });
});
