/**
 * Profile Manager - 用户画像管理模块
 *
 * 提供完整的用户画像管理功能，包括：
 * - Persona 管理：构建和维护用户人物画像
 * - 偏好管理：推断和存储用户偏好
 * - 交互历史：记录和分析用户交互
 * - 用户标签：管理用户标签体系
 * - 隐私管理：管理用户数据隐私
 */

export { ProfileManager } from './profile-manager';
export type { ProfileManagerOptions } from './profile-manager';

export { PersonaBuilder } from './persona/persona-builder';
export type { PersonaBuilderOptions, ConversationTurn } from './persona/persona-builder';

export { PreferenceInferer } from './preference/preference-inferer';
export type { PreferenceInfererOptions, UserBehavior } from './preference/preference-inferer';

export { InteractionRecorder } from './interaction/interaction-recorder';

export { TagManager } from './interaction/tag-manager';
export type { TagManagerOptions } from './interaction/tag-manager';

export { PrivacyManager } from './privacy-manager';
export type { PrivacyManagerOptions } from './privacy-manager';

export { ProfileCache } from './profile-cache';
export type { ProfileCacheOptions } from './profile-cache';

// 类型导出
export type {
  // 核心类型
  Persona,
  PersonaUpdate,
  UserPreferences,
  UserInteraction,
  UserTag,
  UserStats,
  UserReport,
  UserDataExport,

  // Persona 相关
  PersonalityTrait,
  PersonalityCategory,
  Interest,
  InterestLevel,
  CommunicationStyle,
  FormalityLevel,
  DirectnessLevel,
  DetailLevel,
  EmojiUsageLevel,

  // 偏好相关
  InteractionPreferences,
  ContentPreferences,
  TechnicalPreferences,
  PersonalizationPreferences,
  PreferenceSource,
  TopicPreference,
  ContentFormatPreference,
  ContentFormat,
  ComplexityLevel,
  ResponseLengthPreference,
  ResponseSpeedPreference,
  FrequencyPreference,
  NotificationPreference,
  NotificationType,
  TimeRange,
  AccessibilityNeed,
  AccessibilityType,

  // 交互相关
  InteractionType,
  InteractionMetadata,
  InteractionFeedback,
  SentimentAnalysis,
  SentimentLabel,
  EmotionScore,
  EmotionType,
  HistoryOptions,

  // 标签相关
  TagCategory,
  TagSource,
  TagMetadata,

  // 隐私相关
  SensitiveDataMark,
  SensitiveDataType,
  ExportFormat,
  ExportMetadata,
  ReportOptions,

  // 其他
  Insight,
  InsightCategory,
  Recommendation,
  RecommendationCategory,
  Priority,
  EngagementLevel,
  UserSummary,
  CacheStats,
  ProfileManagerConfig,
  LogLevel,
} from './types';