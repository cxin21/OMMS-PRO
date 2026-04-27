/**
 * Persona Builder - Persona 构建器
 *
 * 使用 LLM 从对话历史中构建和更新用户 Persona
 *
 * 注意：必须使用 LLM 进行特征提取，不接受其他方式
 */

import { createServiceLogger, type ILogger } from '../../../shared/logging';
import type { ILLMExtractor } from '../../memory/llm/llm-extractor';
import { PromptLoader } from '../../../shared/prompts';
import type {
  Persona,
  PersonalityTrait,
  Interest,
  CommunicationStyle,
  PersonalityCategory,
  InterestLevel,
  FormalityLevel,
  DirectnessLevel,
  DetailLevel,
} from '../types';

export interface PersonaBuilderOptions {
  minConversationTurns?: number;
  updateThreshold?: number;
  maxVersions?: number;
}

interface ExtractionResult {
  name?: string;
  age?: string;
  gender?: string;
  occupation?: string;
  location?: string;
  personalityTraits: PersonalityTrait[];
  interests: Interest[];
  communicationStyle?: CommunicationStyle;
  values: string[];
  goals: string[];
  background?: string;
  confidence: number;
  sources: string[];
}

/**
 * Persona 构建器类
 *
 * 注意：必须使用 LLM 进行特征提取
 */
export class PersonaBuilder {
  private logger: ILogger;
  private options: Required<PersonaBuilderOptions>;
  private llmExtractor?: ILLMExtractor;
  private promptLoader = PromptLoader.getInstance();

  constructor(options?: PersonaBuilderOptions, llmExtractor?: ILLMExtractor) {
    this.logger = createServiceLogger('PersonaBuilder');
    this.options = {
      minConversationTurns: options?.minConversationTurns ?? 5,
      updateThreshold: options?.updateThreshold ?? 0.3,
      maxVersions: options?.maxVersions ?? 10,
    };

    if (!llmExtractor) {
      this.logger.warn('PersonaBuilder created without LLM Extractor - persona building will fail if no LLM available');
    }
    this.llmExtractor = llmExtractor;
  }

  /**
   * 从对话历史构建 Persona
   */
  async buildFromConversation(
    userId: string,
    turns: ConversationTurn[],
    existingPersona?: Persona
  ): Promise<Persona> {
    this.logger.info(`Building persona for user ${userId} from ${turns.length} conversation turns`);

    if (turns.length < this.options.minConversationTurns) {
      this.logger.warn(
        `Insufficient conversation turns (${turns.length}) for persona building, minimum required: ${this.options.minConversationTurns}`
      );
    }

    // 提取用户特征
    const extraction = await this.extractUserFeatures(turns, existingPersona);
    
    // 创建新版本 Persona
    const version = existingPersona ? existingPersona.version + 1 : 1;
    const now = Date.now();

    const persona: Persona = {
      id: this.generatePersonaId(userId, version),
      userId,
      version,
      createdAt: existingPersona?.createdAt ?? now,
      updatedAt: now,
      name: extraction.name || existingPersona?.name,
      age: extraction.age || existingPersona?.age,
      gender: extraction.gender || existingPersona?.gender,
      occupation: extraction.occupation || existingPersona?.occupation,
      location: extraction.location || existingPersona?.location,
      personalityTraits: this.mergePersonalityTraits(
        existingPersona?.personalityTraits ?? [],
        extraction.personalityTraits
      ),
      interests: this.mergeInterests(
        existingPersona?.interests ?? [],
        extraction.interests
      ),
      communicationStyle: extraction.communicationStyle || existingPersona?.communicationStyle,
      values: this.mergeValues(
        existingPersona?.values ?? [],
        extraction.values
      ),
      goals: this.mergeGoals(
        existingPersona?.goals ?? [],
        extraction.goals
      ),
      background: extraction.background || existingPersona?.background,
      confidence: extraction.confidence,
      sources: this.mergeSources(
        existingPersona?.sources ?? [],
        extraction.sources,
        'conversation'
      ),
      tags: existingPersona?.tags ?? [],
      previousVersionId: existingPersona?.id,
      changeSummary: this.generateChangeSummary(existingPersona, extraction),
    };

    this.logger.info(
      `Built persona v${version} for user ${userId} with confidence ${persona.confidence}`
    );

    return persona;
  }

  /**
   * 从对话中提取用户特征
   * 必须使用 LLM 进行分析
   */
  private async extractUserFeatures(
    turns: ConversationTurn[],
    existingPersona?: Persona
  ): Promise<ExtractionResult> {
    const conversationText = this.formatConversation(turns);

    if (!this.llmExtractor) {
      throw new Error('LLM Extractor is required for persona building. Cannot extract features without LLM analysis.');
    }

    try {
      this.logger.debug('Extracting user features via LLM', { turnCount: turns.length });
      const extraction = await this.llmExtractor.extractPersonaFeatures(conversationText, existingPersona);
      this.logger.info('LLM persona extraction completed', {
        turnCount: turns.length,
        traitsCount: extraction.personalityTraits.length,
        interestsCount: extraction.interests.length,
      });

      // Transform LLM response to match ExtractionResult types
      return this.transformLLMExtraction(extraction);
    } catch (error) {
      const errorMsg = `LLM persona extraction failed: ${error instanceof Error ? error.message : error}. Persona building cannot proceed without LLM analysis.`;
      this.logger.error('extractUserFeatures failed', { error: errorMsg });
      throw new Error(errorMsg);
    }
  }

  /**
   * Transform LLM extraction response to ExtractionResult with proper types
   */
  private transformLLMExtraction(extraction: Awaited<ReturnType<ILLMExtractor['extractPersonaFeatures']>>): ExtractionResult {
    return {
      name: extraction.name,
      age: extraction.age,
      gender: extraction.gender,
      occupation: extraction.occupation,
      location: extraction.location,
      personalityTraits: extraction.personalityTraits.map(t => ({
        trait: t.trait,
        description: t.description ?? '',
        confidence: t.confidence ?? 0.5,
        evidence: t.evidence ?? [],
        category: (t.category as PersonalityCategory) ?? 'openness',
      })),
      interests: extraction.interests.map(i => ({
        name: i.name,
        category: i.category ?? 'general',
        level: (i.level as InterestLevel) ?? 'interested',
        confidence: i.confidence ?? 0.5,
        firstObserved: i.firstObserved ?? Date.now(),
        lastObserved: i.lastObserved ?? Date.now(),
        frequency: i.frequency ?? 1,
      })),
      communicationStyle: extraction.communicationStyle ? {
        formality: (extraction.communicationStyle.formality as FormalityLevel) ?? 'neutral',
        directness: (extraction.communicationStyle.directness as DirectnessLevel) ?? 'neutral',
        detailPreference: (extraction.communicationStyle.detailPreference as DetailLevel) ?? 'moderate',
        tone: extraction.communicationStyle.tone ?? [],
      } : undefined,
      values: extraction.values,
      goals: extraction.goals,
      background: extraction.background,
      confidence: extraction.confidence,
      sources: extraction.sources,
    };
  }

  /**
   * 基础特征提取（不使用 LLM）
   */
  private basicExtraction(turns: ConversationTurn[]): ExtractionResult {
    const result: ExtractionResult = {
      personalityTraits: [],
      interests: [],
      values: [],
      goals: [],
      confidence: 0.5,
      sources: ['basic-extraction'],
    };

    // 简单的关键词匹配
    const text = turns.map(t => t.userMessage).join(' ').toLowerCase();

    // 提取兴趣
    const interestKeywords = ['喜欢', '爱好', '兴趣', '经常', '擅长'];
    for (const keyword of interestKeywords) {
      const index = text.indexOf(keyword);
      if (index !== -1) {
        const segment = text.substring(index, Math.min(index + 50, text.length));
        result.interests.push({
          name: segment,
          category: 'general',
          level: 'interested',
          confidence: 0.5,
          firstObserved: Date.now(),
          lastObserved: Date.now(),
          frequency: 1,
        });
      }
    }

    return result;
  }

  /**
   * 构建特征提取提示词
   */
  private buildExtractionPrompt(
    conversationText: string,
    existingPersona?: Persona
  ): string {
    let prompt = this.promptLoader.render('prompts/persona-builder-extraction.md', {
      conversationText,
    });

    if (existingPersona) {
      prompt += `\n\n现有 Persona 信息（版本 ${existingPersona.version}）：
- 性格特征：${existingPersona.personalityTraits.length} 个
- 兴趣：${existingPersona.interests.length} 个
- 价值观：${existingPersona.values.length} 个

请在现有 Persona 基础上进行更新，标注出变化。`;
    }

    return prompt;
  }

  /**
   * 解析 LLM 响应
   */
  private parseExtractionResponse(
    response: string,
    turns: ConversationTurn[]
  ): ExtractionResult {
    try {
      // 尝试解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const now = Date.now();

      // 验证和转换数据
      const result: ExtractionResult = {
        name: parsed.name,
        age: parsed.age,
        gender: parsed.gender,
        occupation: parsed.occupation,
        location: parsed.location,
        personalityTraits: Array.isArray(parsed.personalityTraits)
          ? parsed.personalityTraits.map((t: any) => ({
              trait: t.trait ?? 'unknown',
              description: t.description ?? '',
              confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
              evidence: Array.isArray(t.evidence) ? t.evidence : [],
              category: this.validatePersonalityCategory(t.category),
            }))
          : [],
        interests: Array.isArray(parsed.interests)
          ? parsed.interests.map((i: any) => ({
              name: i.name ?? 'unknown',
              category: i.category ?? 'general',
              level: this.validateInterestLevel(i.level),
              confidence: typeof i.confidence === 'number' ? i.confidence : 0.5,
              firstObserved: typeof i.firstObserved === 'number' ? i.firstObserved : now,
              lastObserved: typeof i.lastObserved === 'number' ? i.lastObserved : now,
              frequency: typeof i.frequency === 'number' ? i.frequency : 1,
            }))
          : [],
        communicationStyle: parsed.communicationStyle ? {
          formality: this.validateFormalityLevel(parsed.communicationStyle.formality),
          directness: this.validateDirectnessLevel(parsed.communicationStyle.directness),
          detailPreference: this.validateDetailLevel(parsed.communicationStyle.detailPreference),
          tone: Array.isArray(parsed.communicationStyle.tone) ? parsed.communicationStyle.tone : [],
        } : undefined,
        values: Array.isArray(parsed.values) ? parsed.values : [],
        goals: Array.isArray(parsed.goals) ? parsed.goals : [],
        background: parsed.background,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        sources: Array.isArray(parsed.sources) ? parsed.sources : ['conversation'],
      };

      return result;
    } catch (error) {
      this.logger.error('Failed to parse LLM response, using basic extraction', error instanceof Error ? error : new Error(String(error)));
      return this.basicExtraction(turns);
    }
  }

  /**
   * 格式化对话
   */
  private formatConversation(turns: ConversationTurn[]): string {
    return turns
      .map((turn, index) => {
        const { user, assistant } = normalizeTurn(turn);
        const assistantMsg = assistant ? `\nAssistant: ${assistant}` : '';
        return `[Turn ${index + 1}]\nUser: ${user}${assistantMsg}`;
      })
      .join('\n\n');
  }

  /**
   * 合并性格特征
   */
  private mergePersonalityTraits(
    existing: PersonalityTrait[],
    extracted: PersonalityTrait[]
  ): PersonalityTrait[] {
    const traitMap = new Map<string, PersonalityTrait>();

    // 添加现有特征
    for (const trait of existing) {
      traitMap.set(trait.trait, trait);
    }

    // 更新或添加新特征
    for (const trait of extracted) {
      const existingTrait = traitMap.get(trait.trait);
      if (existingTrait) {
        // 更新现有特征
        existingTrait.description = trait.description;
        existingTrait.confidence = this.updateConfidence(
          existingTrait.confidence,
          trait.confidence
        );
        existingTrait.evidence = [
          ...existingTrait.evidence.slice(0, 5),
          ...trait.evidence.slice(0, 3),
        ].slice(0, 5);
      } else {
        // 添加新特征
        traitMap.set(trait.trait, trait);
      }
    }

    return Array.from(traitMap.values());
  }

  /**
   * 合并兴趣
   */
  private mergeInterests(
    existing: Interest[],
    extracted: Interest[]
  ): Interest[] {
    const interestMap = new Map<string, Interest>();

    // 添加现有兴趣
    for (const interest of existing) {
      interestMap.set(interest.name, interest);
    }

    // 更新或添加新兴趣
    for (const interest of extracted) {
      const existingInterest = interestMap.get(interest.name);
      if (existingInterest) {
        // 更新现有兴趣
        existingInterest.level = this.updateInterestLevel(
          existingInterest.level,
          interest.level
        );
        existingInterest.confidence = this.updateConfidence(
          existingInterest.confidence,
          interest.confidence
        );
        existingInterest.lastObserved = Date.now();
        existingInterest.frequency += 1;
      } else {
        // 添加新兴趣
        interestMap.set(interest.name, interest);
      }
    }

    return Array.from(interestMap.values());
  }

  /**
   * 合并价值观
   */
  private mergeValues(existing: string[], extracted: string[]): string[] {
    const valueSet = new Set(existing);
    for (const value of extracted) {
      valueSet.add(value);
    }
    return Array.from(valueSet).slice(0, 10);
  }

  /**
   * 合并目标
   */
  private mergeGoals(existing: string[], extracted: string[]): string[] {
    const goalSet = new Set(existing);
    for (const goal of extracted) {
      goalSet.add(goal);
    }
    return Array.from(goalSet).slice(0, 10);
  }

  /**
   * 合并来源
   */
  private mergeSources(
    existing: string[],
    newSources: string[],
    sourceType: string
  ): string[] {
    const sourceSet = new Set(existing);
    const timestampedSource = `${sourceType}-${Date.now()}`;
    sourceSet.add(timestampedSource);
    return Array.from(sourceSet).slice(-20);
  }

  /**
   * 更新置信度
   */
  private updateConfidence(existing: number, newConfidence: number): number {
    // 使用加权平均，更重视最近的证据
    return existing * 0.6 + newConfidence * 0.4;
  }

  /**
   * 更新兴趣级别
   */
  private updateInterestLevel(
    existing: InterestLevel,
    newLevel: InterestLevel
  ): InterestLevel {
    const levelOrder: InterestLevel[] = ['casual', 'interested', 'passionate', 'expert'];
    const existingIndex = levelOrder.indexOf(existing);
    const newIndex = levelOrder.indexOf(newLevel);
    
    // 取较高水平
    return levelOrder[Math.max(existingIndex, newIndex)];
  }

  /**
   * 生成变更摘要
   */
  private generateChangeSummary(
    existingPersona?: Persona,
    extraction?: ExtractionResult
  ): string {
    if (!existingPersona) {
      return 'Initial persona creation';
    }

    const changes: string[] = [];

    if (extraction) {
      if (extraction.personalityTraits.length > existingPersona.personalityTraits.length) {
        changes.push(`Added ${extraction.personalityTraits.length - existingPersona.personalityTraits.length} new personality traits`);
      }

      if (extraction.interests.length > existingPersona.interests.length) {
        changes.push(`Added ${extraction.interests.length - existingPersona.interests.length} new interests`);
      }

      if (extraction.values.length > existingPersona.values.length) {
        changes.push(`Added ${extraction.values.length - existingPersona.values.length} new values`);
      }
    }

    return changes.length > 0 ? changes.join('; ') : 'Updated existing attributes';
  }

  /**
   * 生成 Persona ID
   */
  private generatePersonaId(userId: string, version: number): string {
    return `persona-${userId}-v${version}`;
  }

  /**
   * 验证性格特征分类
   */
  private validatePersonalityCategory(category: string): PersonalityCategory {
    const validCategories: PersonalityCategory[] = [
      'openness',
      'conscientiousness',
      'extraversion',
      'agreeableness',
      'neuroticism',
    ];
    return validCategories.includes(category as PersonalityCategory)
      ? (category as PersonalityCategory)
      : 'openness';
  }

  /**
   * 验证兴趣级别
   */
  private validateInterestLevel(level: string): InterestLevel {
    const validLevels: InterestLevel[] = ['casual', 'interested', 'passionate', 'expert'];
    return validLevels.includes(level as InterestLevel)
      ? (level as InterestLevel)
      : 'interested';
  }

  /**
   * 验证正式程度
   */
  private validateFormalityLevel(level: string): FormalityLevel {
    const validLevels: FormalityLevel[] = [
      'very-informal',
      'informal',
      'neutral',
      'formal',
      'very-formal',
    ];
    return validLevels.includes(level as FormalityLevel)
      ? (level as FormalityLevel)
      : 'neutral';
  }

  /**
   * 验证直接程度
   */
  private validateDirectnessLevel(level: string): DirectnessLevel {
    const validLevels: DirectnessLevel[] = [
      'very-indirect',
      'indirect',
      'neutral',
      'direct',
      'very-direct',
    ];
    return validLevels.includes(level as DirectnessLevel)
      ? (level as DirectnessLevel)
      : 'neutral';
  }

  /**
   * 验证细节偏好
   */
  private validateDetailLevel(level: string): DetailLevel {
    const validLevels: DetailLevel[] = [
      'minimal',
      'summary',
      'moderate',
      'detailed',
      'comprehensive',
    ];
    return validLevels.includes(level as DetailLevel)
      ? (level as DetailLevel)
      : 'moderate';
  }
}

/**
 * 对话轮次接口
 * 支持两种格式：
 * - role/content 格式 (来自 memory/core/types/memory.ts)
 * - userMessage/assistantResponse 格式 (legacy format)
 */
export interface ConversationTurn {
  // role/content 格式
  role?: 'user' | 'assistant';
  content?: string;
  // userMessage/assistantResponse 格式
  userMessage?: string;
  assistantResponse?: string;
  // 通用字段
  timestamp?: number;
  metadata?: Record<string, any>;
}

/**
 * 规范化对话轮次，确保有 userMessage 和 assistantResponse
 */
function normalizeTurn(turn: ConversationTurn): { user: string; assistant: string } {
  // 处理 role/content 格式
  if (turn.role === 'user') {
    return { user: turn.content || turn.userMessage || '', assistant: turn.assistantResponse || '' };
  }
  if (turn.role === 'assistant') {
    // assistant 的 role 表示这是 assistant 的回复
    // 需要找到对应的 user 消息（通常在上一轮）
    return { user: turn.userMessage || '', assistant: turn.content || turn.assistantResponse || '' };
  }
  // 兼容 userMessage/assistantResponse 格式
  return { user: turn.userMessage || '', assistant: turn.assistantResponse || '' };
}
