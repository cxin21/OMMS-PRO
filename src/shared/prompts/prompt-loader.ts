/**
 * PromptLoader - 从 agents/ 目录加载 LLM prompt 模板
 *
 * 读取项目根目录下的 agents/ 文件夹中的 .md 文件
 * 支持 {{variable}} 模板变量替换
 *
 * @module shared/prompts
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger, type ILogger } from '../logging';

export class PromptLoader {
  private static instance: PromptLoader;
  private cache: Map<string, string> = new Map();
  private promptsDir: string;
  private logger: ILogger;

  private constructor(promptsDir?: string) {
    this.promptsDir = promptsDir ?? join(process.cwd(), 'agents');
    this.logger = createLogger('prompt-loader');
  }

  static getInstance(promptsDir?: string): PromptLoader {
    if (!PromptLoader.instance) {
      PromptLoader.instance = new PromptLoader(promptsDir);
    }
    return PromptLoader.instance;
  }

  /**
   * 从 .md 文件加载 prompt 模板
   * @param filename - 相对于 agents/ 的路径，如 'prompts/memory-extraction.md'
   * @returns 文件内容
   */
  load(filename: string): string {
    if (this.cache.has(filename)) {
      return this.cache.get(filename)!;
    }
    const filePath = join(this.promptsDir, filename);
    if (!existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    const content = readFileSync(filePath, 'utf-8').trim();
    this.cache.set(filename, content);
    this.logger.debug(`Loaded prompt: ${filename}`);
    return content;
  }

  /**
   * 加载并渲染 prompt 模板（替换 {{variable}} 变量）
   * @param filename - .md 文件路径（相对于 agents/）
   * @param variables - 键值对，用于替换 {{key}} 占位符
   */
  render(filename: string, variables: Record<string, string>): string {
    let template = this.load(filename);
    for (const [key, value] of Object.entries(variables)) {
      template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return template;
  }

  /**
   * 清除缓存
   * @param filename - 指定文件名，不传则清除全部
   */
  invalidateCache(filename?: string): void {
    if (filename) {
      this.cache.delete(filename);
    } else {
      this.cache.clear();
    }
  }
}
