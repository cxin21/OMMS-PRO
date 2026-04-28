/**
 * Profile Types - 用户画像类型
 *
 * @module types/profile
 */

// ============================================================================
// Persona & Identity
// ============================================================================

export interface Persona {
  id: string;
  userId: string;
  version: number;
  createdAt: number;
  updatedAt: number;
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
  tags: string[];
  previousVersionId?: string;
  changeSummary?: string;
}

export interface Identity {
  id: string;
  userId: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  name?: string;
  age?: string;
  gender?: string;
  occupation?: string;
  location?: string;
  timezone?: string;
  language?: string;
  email?: string;
  preferredContact?: string;
  organization?: string;
  role?: string;
  confidence: number;
  sources: string[];
  tags: string[];
  previousVersionId?: string;
  changeSummary?: string;
}

// ============================================================================
// Traits & Interests
// ============================================================================

export interface PersonalityTrait {
  trait: string;
  description: string;
  confidence: number;
  evidence: string[];
  category: PersonalityCategory;
}

export type PersonalityCategory =
  | 'openness'
  | 'conscientiousness'
  | 'extraversion'
  | 'agreeableness'
  | 'neuroticism';

export interface Interest {
  name: string;
  category: string;
  level: InterestLevel;
  confidence: number;
  firstObserved: number;
  lastObserved: number;
  frequency: number;
}

export type InterestLevel = 'casual' | 'interested' | 'passionate' | 'expert';

export interface CommunicationStyle {
  formality: FormalityLevel;
  directness: DirectnessLevel;
  detailPreference: DetailLevel;
  tone: string[];
  preferredLanguage?: string;
  emojiUsage?: EmojiUsageLevel;
}

export type FormalityLevel = 'very-informal' | 'informal' | 'neutral' | 'formal' | 'very-formal';
export type DirectnessLevel = 'very-indirect' | 'indirect' | 'neutral' | 'direct' | 'very-direct';
export type DetailLevel = 'minimal' | 'summary' | 'moderate' | 'detailed' | 'comprehensive';
export type EmojiUsageLevel = 'never' | 'rarely' | 'sometimes' | 'often' | 'always';

// ============================================================================
// Preferences
// ============================================================================

export interface UserPreferences {
  userId: string;
  updatedAt: number;
  interaction: InteractionPreferences;
  content: ContentPreferences;
  technical: TechnicalPreferences;
  personalization: PersonalizationPreferences;
  confidence: number;
  sources: PreferenceSource[];
}

export interface InteractionPreferences {
  responseLength: ResponseLengthPreference;
  responseSpeed: ResponseSpeedPreference;
  interactionFrequency: FrequencyPreference;
  notificationPreference: NotificationPreference;
  activeHours?: TimeRange[];
}

export type ResponseLengthPreference = 'very-brief' | 'brief' | 'moderate' | 'detailed' | 'comprehensive';
export type ResponseSpeedPreference = 'fast' | 'balanced' | 'thorough';
export type FrequencyPreference = 'minimal' | 'moderate' | 'frequent' | 'always';

export interface NotificationPreference {
  enabled: boolean;
  types: NotificationType[];
  quietHours?: TimeRange[];
}

export type NotificationType = 'reminder' | 'update' | 'suggestion' | 'alert';

export interface TimeRange {
  start: string;
  end: string;
  timezone?: string;
}

export interface ContentPreferences {
  topics: TopicPreference[];
  formats: ContentFormatPreference[];
  languages: string[];
  complexityLevel: ComplexityLevel;
  examplesPreference: boolean;
  visualAidsPreference: boolean;
}

export interface TopicPreference {
  topic: string;
  interest: number;
  expertise: number;
  lastInteracted?: number;
}

export interface ContentFormatPreference {
  format: ContentFormat;
  preference: number;
}

export type ContentFormat = 'text' | 'list' | 'table' | 'code' | 'diagram' | 'example';
export type ComplexityLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface TechnicalPreferences {
  preferredTools: string[];
  programmingLanguages: string[];
  frameworks: string[];
  platforms: string[];
  accessibilityNeeds: AccessibilityNeed[];
}

export interface AccessibilityNeed {
  type: AccessibilityType;
  description: string;
  enabled: boolean;
}

export type AccessibilityType =
  | 'screen-reader'
  | 'high-contrast'
  | 'large-text'
  | 'reduced-motion'
  | 'keyboard-navigation';

export interface PersonalizationPreferences {
  useName: boolean;
  rememberContext: boolean;
  adaptTone: boolean;
  suggestRelated: boolean;
  learnFromFeedback: boolean;
  customInstructions?: string[];
}

export interface PreferenceSource {
  type: 'explicit' | 'inferred' | 'imported';
  timestamp: number;
  confidence: number;
  evidence?: string;
}

// ============================================================================
// Interactions & Analysis
// ============================================================================

export interface UserInteraction {
  id: string;
  userId: string;
  timestamp: number;
  type: InteractionType;
  input?: string;
  output?: string;
  metadata: InteractionMetadata;
  sessionId?: string;
  agentId?: string;
  memoryIds?: string[];
  feedback?: InteractionFeedback;
  sentiment?: SentimentAnalysis;
  tags?: string[];
}

export type InteractionType =
  | 'conversation'
  | 'query'
  | 'command'
  | 'feedback'
  | 'system'
  | 'error';

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

export interface InteractionFeedback {
  rating: number;
  comment?: string;
  categories: string[];
  isResolved?: boolean;
}

export interface SentimentAnalysis {
  score: number;
  label: SentimentLabel;
  confidence: number;
  emotions: EmotionScore[];
}

export type SentimentLabel = 'positive' | 'neutral' | 'negative';
export interface EmotionScore {
  emotion: EmotionType;
  score: number;
}
export type EmotionType = 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise' | 'disgust' | 'trust' | 'anticipation';