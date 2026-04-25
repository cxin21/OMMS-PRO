/**
 * Agent Utils - Agent.md 解析工具
 * @module agents/utils
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentDefinition, AgentRuntimeContext, AgentType } from './types';
import { AGENT_TYPE_MAP, AGENT_TO_DIR } from './types';

/**
 * 解析 Agent.md 文件内容
 */
export function parseAgentMarkdown(
  content: string,
  agentType: AgentType
): AgentDefinition {
  const lines = content.split('\n');
  let currentSection = '';
  const sections: Record<string, string[]> = {};

  // 按 section 收集内容
  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!sections[currentSection]) {
        sections[currentSection] = [];
      }
    } else if (currentSection && line.trim()) {
      sections[currentSection].push(line.trim());
    }
  }

  // 提取 Role
  const roleSection = sections['Role'] || sections['Role '] || [];
  const role = roleSection.join(' ').replace(/^["']|["']$/g, '');

  // 提取 Responsibilities
  const respSection = sections['Responsibilities'] || [];
  const responsibilities = respSection
    .filter(l => l.startsWith('- '))
    .map(l => l.replace(/^-\s*/, ''));

  // 提取 Guidelines
  const guidelinesSection = sections['Guidelines'] || sections['Guidelines '] || [];
  const guidelines = guidelinesSection
    .filter(l => l.startsWith('- ') || l.match(/^\d+\./))
    .map(l => l.replace(/^-\s*/, '').replace(/^\d+\.\s*/, ''));

  // 提取 Output Format
  const outputSection = sections['Output Format'] || sections['Output Format '] || [];
  const outputFormat = outputSection
    .filter(l => l.startsWith('- ') || l.match(/^\d+\./))
    .map(l => l.replace(/^-\s*/, '').replace(/^\d+\.\s*/, ''));

  // 提取 Dynamic Context
  const contextSection = sections['Dynamic Context'] || sections['Dynamic Context '] || [];
  const contextVariables = contextSection
    .filter(l => l.includes('{{context.'))
    .map(l => {
      const match = l.match(/\{\{context\.(\w+)\}\}/);
      return match ? match[1] : '';
    })
    .filter(Boolean);

  return {
    type: agentType,
    name: AGENT_TO_DIR[agentType],
    role: role || `Agent for ${agentType}`,
    responsibilities,
    guidelines,
    outputFormat,
    contextVariables,
  };
}

/**
 * 从 Agent.md 内容构建系统提示词
 */
export function buildSystemPrompt(
  definition: AgentDefinition,
  runtimeContext?: AgentRuntimeContext
): string {
  const parts: string[] = [];

  // Role
  parts.push(`# ${definition.name}`);
  parts.push('');
  parts.push(`## Role`);
  parts.push(definition.role);
  parts.push('');

  // Responsibilities
  if (definition.responsibilities.length > 0) {
    parts.push('## Responsibilities');
    for (const resp of definition.responsibilities) {
      parts.push(`- ${resp}`);
    }
    parts.push('');
  }

  // Guidelines
  if (definition.guidelines.length > 0) {
    parts.push('## Guidelines');
    for (const guideline of definition.guidelines) {
      parts.push(`- ${guideline}`);
    }
    parts.push('');
  }

  // Output Format
  if (definition.outputFormat.length > 0) {
    parts.push('## Output Format');
    for (const format of definition.outputFormat) {
      parts.push(`- ${format}`);
    }
    parts.push('');
  }

  // Dynamic Context
  if (runtimeContext) {
    parts.push('## Runtime Context');
    if (runtimeContext.userId) {
      parts.push(`- userId: ${runtimeContext.userId}`);
    }
    if (runtimeContext.sessionId) {
      parts.push(`- sessionId: ${runtimeContext.sessionId}`);
    }
    if (runtimeContext.agentId) {
      parts.push(`- agentId: ${runtimeContext.agentId}`);
    }
    if (runtimeContext.metadata) {
      for (const [key, value] of Object.entries(runtimeContext.metadata)) {
        parts.push(`- ${key}: ${JSON.stringify(value)}`);
      }
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * 加载 Agent.md 文件
 */
export function loadAgentFile(
  agentsDir: string,
  agentType: AgentType
): string | null {
  const agentDir = AGENT_TO_DIR[agentType];
  const agentPath = path.join(agentsDir, agentDir, 'Agent.md');

  try {
    if (fs.existsSync(agentPath)) {
      return fs.readFileSync(agentPath, 'utf-8');
    }
  } catch (error) {
    console.warn(`Failed to load agent file: ${agentPath}`, error);
  }

  return null;
}

/**
 * 替换模板变量
 */
export function replaceTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{context\\.${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * 从目录名推断 Agent 类型
 */
export function inferAgentType(dirName: string): AgentType | undefined {
  return AGENT_TYPE_MAP[dirName];
}

/**
 * 获取所有 Agent 目录
 */
export function getAllAgentDirs(agentsDir: string): string[] {
  try {
    if (!fs.existsSync(agentsDir)) {
      return [];
    }
    return fs.readdirSync(agentsDir)
      .filter(name => {
        const stat = fs.statSync(path.join(agentsDir, name));
        return stat.isDirectory() && !name.startsWith('_');
      });
  } catch {
    return [];
  }
}

/**
 * 检查 Agent 定义是否有效
 */
export function isValidAgentDefinition(def: Partial<AgentDefinition>): def is AgentDefinition {
  return (
    def.type !== undefined &&
    def.name !== undefined &&
    def.role !== undefined
  );
}
