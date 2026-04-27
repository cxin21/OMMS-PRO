/**
 * Profile Manager 类型定义
 * 
 * 定义用户画像管理相关的所有类型
 */

/**
 * 用户画像（Persona）
 * 描述用户的核心特征和身份
 */
export interface Persona {
  id: string;
  userId: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  
  // 基本信息
  name?: string;
  age?: string;
  gender?: string;
  occupation?: string;
  location?: string;
  
  // 性格特征
  personalityTraits: PersonalityTrait[];
  
  // 兴趣和爱好
  interests: Interest[];
  
  // 沟通风格
  communicationStyle?: CommunicationStyle;
  
  // 价值观和目标
  values: string[];
  goals: string[];
  
  // 背景故事
  background?: string;
  
  // 元数据
  confidence: number;
  sources: string[];
  tags: string[];
  
  // 版本历史
  previousVersionId?: string;
  changeSummary?: string;
}

/**
 * 用户身份信息（Identity）
 * v2.0.0: 描述用户的基本身份信息，与 Persona 不同，Identity 是更客观的基础信息
 */
export interface Identity {
  id: string;
  userId: string;
  version: number;
  createdAt: number;
  updatedAt: number;

  // 基本身份信息
  name?: string;           // 姓名/昵称
  age?: string;            // 年龄
  gender?: string;         // 性别
  occupation?: string;     // 职业
  location?: string;       // 位置/地区
  timezone?: string;       // 时区
  language?: string;       // 主要语言

  // 联系信息
  email?: string;          // 邮箱（如果已验证）
  preferredContact?: string; // 首选联系方式

  // 组织信息
  organization?: string;    // 所属组织/公司
  role?: string;           // 角色/职位

  // 元数据
  confidence: number;      // 信息置信度
  sources: string[];        // 信息来源
  tags: string[];           // 标签

  // 版本历史
  previousVersionId?: string;
  changeSummary?: string;
}

/**
 * 性格特征
 */
export interface PersonalityTrait {
  trait: string;
  description: string;
  confidence: number;
  evidence: string[];
  category: PersonalityCategory;
}

/**
 * 性格特征分类
 */
export type PersonalityCategory = 
  | 'openness'       // 开放性
  | 'conscientiousness' // 尽责性
  | 'extraversion'   // 外向性
  | 'agreeableness'  // 宜人性
  | 'neuroticism';   // 神经质

/**
 * 兴趣
 */
export interface Interest {
  name: string;
  category: string;
  level: InterestLevel;
  confidence: number;
  firstObserved: number;
  lastObserved: number;
  frequency: number;
}

/**
 * 兴趣级别
 */
export type InterestLevel = 'casual' | 'interested' | 'passionate' | 'expert';

/**
 * 沟通风格
 */
export interface CommunicationStyle {
  formality: FormalityLevel;
  directness: DirectnessLevel;
  detailPreference: DetailLevel;
  tone: string[];
  preferredLanguage?: string;
  emojiUsage?: EmojiUsageLevel;
}

/**
 * 正式程度
 */
export type FormalityLevel = 'very-informal' | 'informal' | 'neutral' | 'formal' | 'very-formal';

/**
 * 直接程度
 */
export type DirectnessLevel = 'very-indirect' | 'indirect' | 'neutral' | 'direct' | 'very-direct';

/**
 * 细节偏好
 */
export type DetailLevel = 'minimal' | 'summary' | 'moderate' | 'detailed' | 'comprehensive';

/**
 * Emoji 使用程度
 */
export type EmojiUsageLevel = 'never' | 'rarely' | 'sometimes' | 'often' | 'always';

/**
 * 用户偏好
 */
export interface UserPreferences {
  userId: string;
  updatedAt: number;
  
  // 交互偏好
  interaction: InteractionPreferences;
  
  // 内容偏好
  content: ContentPreferences;
  
  // 技术偏好
  technical: TechnicalPreferences;
  
  // 个性化偏好
  personalization: PersonalizationPreferences;
  
  // 元数据
  confidence: number;
  sources: PreferenceSource[];
}

/**
 * 交互偏好
 */
export interface InteractionPreferences {
  responseLength: ResponseLengthPreference;
  responseSpeed: ResponseSpeedPreference;
  interactionFrequency: FrequencyPreference;
  notificationPreference: NotificationPreference;
  activeHours?: TimeRange[];
}

/**
 * 响应长度偏好
 */
export type ResponseLengthPreference = 'very-brief' | 'brief' | 'moderate' | 'detailed' | 'comprehensive';

/**
 * 响应速度偏好
 */
export type ResponseSpeedPreference = 'fast' | 'balanced' | 'thorough';

/**
 * 频率偏好
 */
export type FrequencyPreference = 'minimal' | 'moderate' | 'frequent' | 'always';

/**
 * 通知偏好
 */
export interface NotificationPreference {
  enabled: boolean;
  types: NotificationType[];
  quietHours?: TimeRange[];
}

/**
 * 通知类型
 */
export type NotificationType = 'reminder' | 'update' | 'suggestion' | 'alert';

/**
 * 时间范围
 */
export interface TimeRange {
  start: string;
  end: string;
  timezone?: string;
}

/**
 * 内容偏好
 */
export interface ContentPreferences {
  topics: TopicPreference[];
  formats: ContentFormatPreference[];
  languages: string[];
  complexityLevel: ComplexityLevel;
  examplesPreference: boolean;
  visualAidsPreference: boolean;
}

/**
 * 主题偏好
 */
export interface TopicPreference {
  topic: string;
  interest: number;
  expertise: number;
  lastInteracted?: number;
}

/**
 * 内容格式偏好
 */
export interface ContentFormatPreference {
  format: ContentFormat;
  preference: number;
}

/**
 * 内容格式
 */
export type ContentFormat = 'text' | 'list' | 'table' | 'code' | 'diagram' | 'example';

/**
 * 复杂度级别
 */
export type ComplexityLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/**
 * 技术偏好
 */
export interface TechnicalPreferences {
  preferredTools: string[];
  programmingLanguages: string[];
  frameworks: string[];
  platforms: string[];
  accessibilityNeeds: AccessibilityNeed[];
}

/**
 * 辅助功能需求
 */
export interface AccessibilityNeed {
  type: AccessibilityType;
  description: string;
  enabled: boolean;
}

/**
 * 辅助功能类型
 */
export type AccessibilityType = 
  | 'screen-reader'
  | 'high-contrast'
  | 'large-text'
  | 'reduced-motion'
  | 'keyboard-navigation';

/**
 * 个性化偏好
 */
export interface PersonalizationPreferences {
  useName: boolean;
  rememberContext: boolean;
  adaptTone: boolean;
  suggestRelated: boolean;
  learnFromFeedback: boolean;
  customInstructions?: string[];
}

/**
 * 偏好来源
 */
export interface PreferenceSource {
  type: 'explicit' | 'inferred' | 'imported';
  timestamp: number;
  confidence: number;
  evidence?: string;
}

/**
 * 用户交互记录
 */
export interface UserInteraction {
  id: string;
  userId: string;
  timestamp: number;
  type: InteractionType;
  
  // 交互内容
  input?: string;
  output?: string;
  metadata: InteractionMetadata;
  
  // 上下文
  sessionId?: string;
  agentId?: string;
  memoryIds?: string[];
  
  // 反馈
  feedback?: InteractionFeedback;
  
  // 分析
  sentiment?: SentimentAnalysis;
  tags?: string[];
}

/**
 * 交互类型
 */
export type InteractionType = 
  | 'conversation'
  | 'query'
  | 'command'
  | 'feedback'
  | 'system'
  | 'error';

/**
 * 交互元数据
 */
export interface InteractionMetadata {
  duration?: number;
  tokensUsed?: number;
  model?: string;
  source?: string;
  platform?: string;
  location?: string;
  device?: string;
  custom?: Record<string, any>;
}

/**
 * 交互反馈
 */
export interface InteractionFeedback {
  rating: number;
  comment?: string;
  categories: string[];
  isResolved?: boolean;
}

/**
 * 情感分析
 */
export interface SentimentAnalysis {
  score: number;
  label: SentimentLabel;
  confidence: number;
  emotions: EmotionScore[];
}

/**
 * 情感标签
 */
export type SentimentLabel = 'very-negative' | 'negative' | 'neutral' | 'positive' | 'very-positive';

/**
 * 情感分数
 */
export interface EmotionScore {
  emotion: EmotionType;
  score: number;
}

/**
 * 情感类型
 */
export type EmotionType = 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise' | 'disgust' | 'neutral';

/**
 * 用户标签
 */
export interface UserTag {
  id: string;
  userId: string;
  name: string;
  category: TagCategory;
  source: TagSource;
  confidence: number;
  weight: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  metadata: TagMetadata;
}

/**
 * 标签分类
 */
export type TagCategory = 
  | 'demographic'
  | 'behavioral'
  | 'interest'
  | 'skill'
  | 'preference'
  | 'status'
  | 'custom';

/**
 * 标签来源
 */
export type TagSource = 'system' | 'inferred' | 'manual' | 'imported';

/**
 * 标签元数据
 */
export interface TagMetadata {
  evidence?: string[];
  relatedTags?: string[];
  custom?: Record<string, any>;
}

/**
 * 用户统计
 */
export interface UserStats {
  userId: string;
  totalInteractions: number;
  totalSessions: number;
  averageSessionDuration: number;
  firstInteraction: number;
  lastInteraction: number;
  mostActiveHours: number[];
  mostActiveDays: number[];
  favoriteTopics: string[];
  frequentlyUsedFeatures: string[];
  engagementScore: number;
}

/**
 * 用户数据导出
 */
export interface UserDataExport {
  userId: string;
  exportedAt: number;
  format: ExportFormat;
  data: {
    persona?: Persona[];
    preferences?: UserPreferences;
    interactions?: UserInteraction[];
    tags?: UserTag[];
    memories?: string[];
    metadata?: Record<string, any>;
  };
  metadata: ExportMetadata;
}

/**
 * 导出格式
 */
export type ExportFormat = 'json' | 'csv' | 'xml' | 'markdown';

/**
 * 导出元数据
 */
export interface ExportMetadata {
  version: string;
  recordCount: number;
  dateRange: {
    start: number;
    end: number;
  };
  checksum?: string;
}

/**
 * 敏感数据标记
 */
export interface SensitiveDataMark {
  id: string;
  userId: string;
  dataType: SensitiveDataType;
  dataId: string;
  reason: string;
  markedAt: number;
  markedBy: 'user' | 'system' | 'auto';
  expiresAt?: number;
  metadata?: Record<string, any>;
}

/**
 * 敏感数据类型
 */
export type SensitiveDataType = 
  | 'personal-info'
  | 'financial'
  | 'health'
  | 'location'
  | 'credential'
  | 'conversation'
  | 'biometric'
  | 'other';

/**
 * Persona 更新
 */
export interface PersonaUpdate {
  name?: string;
  age?: string;
  gender?: string;
  occupation?: string;
  location?: string;
  personalityTraits?: PersonalityTrait[];
  interests?: Interest[];
  communicationStyle?: CommunicationStyle;
  values?: string[];
  goals?: string[];
  background?: string;
  tags?: string[];
  changeSummary?: string;
}

/**
 * 历史记录选项
 */
export interface HistoryOptions {
  limit?: number;
  offset?: number;
  startDate?: number;
  endDate?: number;
  types?: InteractionType[];
  sessionIds?: string[];
  agentIds?: string[];
  includeFeedback?: boolean;
  includeAnalysis?: boolean;
}

/**
 * 报告选项
 */
export interface ReportOptions {
  includePersona?: boolean;
  includePreferences?: boolean;
  includeInteractions?: boolean;
  includeTags?: boolean;
  includeStats?: boolean;
  dateRange?: {
    start: number;
    end: number;
  };
  format?: ExportFormat;
}

/**
 * 用户报告
 */
export interface UserReport {
  userId: string;
  generatedAt: number;
  summary: UserSummary;
  persona?: Persona;
  preferences?: UserPreferences;
  stats?: UserStats;
  tags?: UserTag[];
  insights: Insight[];
  recommendations: Recommendation[];
}

/**
 * 用户摘要
 */
export interface UserSummary {
  totalInteractions: number;
  memberSince: number;
  lastActive: number;
  engagementLevel: EngagementLevel;
  topInterests: string[];
  keyCharacteristics: string[];
}

/**
 * 参与度级别
 */
export type EngagementLevel = 'inactive' | 'low' | 'moderate' | 'high' | 'very-high';

/**
 * 洞察
 */
export interface Insight {
  id: string;
  category: InsightCategory;
  title: string;
  description: string;
  confidence: number;
  evidence: string[];
  createdAt: number;
}

/**
 * 洞察分类
 */
export type InsightCategory = 
  | 'behavior-pattern'
  | 'preference-change'
  | 'interest-evolution'
  | 'engagement-trend'
  | 'skill-development'
  | 'other';

/**
 * 推荐
 */
export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  title: string;
  description: string;
  priority: Priority;
  action?: string;
  metadata?: Record<string, any>;
}

/**
 * 推荐分类
 */
export type RecommendationCategory = 
  | 'feature'
  | 'content'
  | 'improvement'
  | 'engagement'
  | 'privacy'
  | 'other';

/**
 * 优先级
 */
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Profile Manager 配置
 */
export interface ProfileManagerConfig {
  storage: {
    dbPath: string;
    enableCache: boolean;
    cacheSize: number;
    cacheTtl: number;
  };
  persona: {
    autoBuild: boolean;
    minConversationTurns: number;
    updateThreshold: number;
    maxVersions: number;
  };
  preferences: {
    autoInfer: boolean;
    minInteractions: number;
    confidenceThreshold: number;
  };
  privacy: {
    enableSensitiveMarking: boolean;
    autoExpireDays: number;
    requireExportApproval: boolean;
  };
  logging: {
    level: LogLevel;
    enableFileLogging: boolean;
  };
  defaultScores: {
    personaImportance: number;
    personaScopeScore: number;
    identityImportance: number;
    identityScopeScore: number;
    preferenceImportance: number;
    preferenceScopeScore: number;
  };
}

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 缓存统计
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
}
