import axios from 'axios'

const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// ============================================================
// Types
// ============================================================

export type MemoryType =
  | 'fact' | 'event' | 'decision' | 'error'
  | 'learning' | 'relation' | 'identity' | 'preference' | 'persona'

export type MemoryScope = 'session' | 'agent' | 'global'
export type MemoryBlock = 'working' | 'session' | 'core' | 'archived' | 'deleted'

export interface VersionInfo {
  version: number
  palaceRef: string
  createdAt: number
  summary: string
  contentLength: number
}

export interface MemoryLifecycleEvent {
  type: 'created' | 'accessed' | 'updated' | 'reinforced' | 'upgraded' | 'downgraded' | 'archived' | 'deleted'
  timestamp: number
  details?: Record<string, unknown>
}

export interface Memory {
  uid: string
  version: number
  content: string
  summary: string
  type: MemoryType
  agentId: string
  importance: number
  scopeScore: number
  scope: MemoryScope
  block: MemoryBlock
  palace: {
    wingId: string
    hallId: string
    roomId: string
    palaceRef: string
  }
  versionChain: VersionInfo[]
  isLatestVersion: boolean
  accessCount: number
  recallCount: number
  lastAccessedAt: number
  usedByAgents: string[]
  createdAt: number
  updatedAt: number
  metadata: Record<string, any>
  tags: string[]
  lifecycle: {
    createdAt: number
    events: MemoryLifecycleEvent[]
  }
}

export interface RecallResult {
  memories: Memory[]
  totalFound: number
  scopeDistribution: Record<string, number>
  meetsMinimum: boolean
}

export interface SystemStats {
  totalMemories: number
  memoriesByType: Record<string, number>
  memoriesByScope: Record<string, number>
  avgImportanceScore: number
  avgScopeScore: number
  dreamingRuns: number
  lastDreamingRun: number | null
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy'
  checks: {
    memoryService: boolean
    dreamingManager: boolean
    timestamp: number
  }
  uptime: number
  timestamp: number
}

export interface LogFile {
  name: string
  path: string
  size: number
  modifiedAt: number
  isMain: boolean
}

export interface LogFilesResult {
  files: LogFile[]
  rotationConfig: {
    maxSize: number
    maxFiles: number
  }
  logDir: string
}

export interface LogContentResult {
  file: string
  lines: string[]
  totalLines: number
  offset: number
  limit: number
  hasMore: boolean
}

export interface FragmentationMetrics {
  palaceFragmentation: number
  graphEdgeDensity: number
  orphanedMemories: number
  staleMemories: number
  lastDefragmentationAt?: number
}

export interface OrganizationPhase {
  scannedCount: number
  candidateCount: number
  analyzedCount: number
  foundIssues: number
  duration: number
}

export interface OrganizationReport {
  id: string
  type: string
  status: 'running' | 'completed' | 'failed'
  phases: {
    scan: OrganizationPhase
    analyze: OrganizationPhase
    execute: OrganizationPhase
  }
  memoriesMerged: number
  memoriesArchived: number
  memoriesDeleted: number
  relationsRebuilt: number
  storageFreed: number
  executedAt: number
  totalDuration: number
}

export interface DreamingStats {
  totalReports: number
  lastReportAt?: number
  avgDuration: number
}

export interface DreamingSchedulerConfig {
  autoOrganize: boolean
  organizeInterval: number
  memoryThreshold: number
  fragmentationThreshold: number
  stalenessDays: number
  maxMemoriesPerCycle: number
  maxRelationsPerCycle: number
}

export interface DreamingConsolidationConfig {
  similarityThreshold: number
  maxGroupSize: number
  preserveNewest: boolean
  createNewVersion: boolean
}

export interface DreamingReorganizationConfig {
  minEdgeWeight: number
  densityTarget: number
  orphanThreshold: number
  maxNewRelationsPerCycle: number
}

export interface DreamingArchivalConfig {
  importanceThreshold: number
  stalenessDays: number
  archiveBlock: string
  retentionDays: number
}

export interface DreamingConfig {
  scheduler: DreamingSchedulerConfig
  consolidation: DreamingConsolidationConfig
  reorganization: DreamingReorganizationConfig
  archival: DreamingArchivalConfig
}

export interface Persona {
  id?: string
  name: string
  description: string
  traits: string[]
  communicationStyle?: string
  version?: number
  updatedAt?: number
}

export interface UserPreferences {
  communicationStyle?: string
  topics?: string[]
  format?: string
  [key: string]: unknown
}

export interface UserTag {
  id: string
  name: string
  category: string
  source?: string
  confidence?: number
  weight?: number
  createdAt?: number
}

export interface UserInteraction {
  id?: string
  type: string
  input?: string
  output?: string
  metadata?: Record<string, unknown>
  sessionId?: string
  agentId?: string
  memoryIds?: string[]
  timestamp: number
}

export interface UserStats {
  totalInteractions: number
  avgResponseLength?: number
  mostActiveHour?: number
  interactionsByType?: Record<string, number>
}

export interface UserProfile {
  userId: string
  persona?: Persona
  preferences?: UserPreferences
  tags?: UserTag[]
  stats?: UserStats
}

export interface GraphNode {
  id: string
  entity: string
  type: string
  memoryIds: string[]
  properties: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  relation: string
  weight: number
  memoryIds: string[]
  properties: Record<string, unknown>
  createdAt: number
}

// ============================================================
// Memory API
// ============================================================
export const memoryApi = {
  getAll: async (params?: { limit?: number; offset?: number }) => {
    const res = await apiClient.get('/memories', { params })
    return res.data
  },

  getById: async (uid: string) => {
    const res = await apiClient.get(`/memories/${uid}`)
    return res.data
  },

  capture: async (
    content: string,
    options?: {
      agentId?: string
      sessionId?: string
      type?: MemoryType
      scores?: { importance: number; scopeScore?: number }
    }
  ) => {
    const res = await apiClient.post('/memories/capture', { content, ...options })
    return res.data
  },

  recall: async (query: string, options?: { types?: MemoryType[]; limit?: number }) => {
    const res = await apiClient.post('/memories/recall', { query, ...options })
    return res.data as { success: boolean; data: RecallResult }
  },

  update: async (
    uid: string,
    data: { content?: string; importance?: number; scopeScore?: number; scope?: MemoryScope; tags?: string[] }
  ) => {
    const res = await apiClient.put(`/memories/${uid}`, data)
    return res.data
  },

  delete: async (uid: string) => {
    const res = await apiClient.delete(`/memories/${uid}`)
    return res.data
  },

  getVersions: async (uid: string) => {
    const res = await apiClient.get(`/memories/${uid}/versions`)
    return res.data
  },

  reinforce: async (uid: string, boostAmount?: number) => {
    const res = await apiClient.post(`/memories/reinforce/${uid}`, { boostAmount })
    return res.data
  },

  reinforceBatch: async (memoryIds: string[]) => {
    const res = await apiClient.post('/memories/reinforce-batch', { memoryIds })
    return res.data
  },

  archive: async (uid: string) => {
    const res = await apiClient.post(`/memories/archive/${uid}`)
    return res.data
  },

  restore: async (uid: string) => {
    const res = await apiClient.post(`/memories/restore/${uid}`)
    return res.data
  },

  upgradeScope: async (uid: string) => {
    const res = await apiClient.post(`/memories/upgrade-scope/${uid}`)
    return res.data as { success: boolean; data: { upgraded: boolean } }
  },

  getDegradationStats: async () => {
    const res = await apiClient.get('/memories/degradation-stats')
    return res.data
  },

  runForgettingCycle: async () => {
    const res = await apiClient.post('/memories/forgetting-cycle')
    return res.data
  },

  runScopeDegradationCycle: async () => {
    const res = await apiClient.post('/memories/scope-degradation-cycle')
    return res.data
  },
}

// ============================================================
// Dreaming API
// ============================================================
export const dreamingApi = {
  getStatus: async () => {
    const res = await apiClient.get('/dreaming/status')
    return res.data as { success: boolean; data: FragmentationMetrics }
  },

  getStats: async () => {
    const res = await apiClient.get('/dreaming/stats')
    return res.data as { success: boolean; data: DreamingStats }
  },

  start: async () => {
    const res = await apiClient.post('/dreaming/start')
    return res.data
  },

  organize: async (type?: 'all' | 'consolidation' | 'reorganization' | 'archival', limit?: number) => {
    const res = await apiClient.post('/dreaming/organize', { type: type ?? 'all', limit })
    return res.data as { success: boolean; data: OrganizationReport }
  },

  getHistory: async () => {
    const res = await apiClient.get('/dreaming/history')
    return res.data as { success: boolean; data: OrganizationReport[] }
  },

  getConfig: async () => {
    const res = await apiClient.get('/dreaming/config')
    return res.data as { success: boolean; data: DreamingConfig }
  },

  updateConfig: async (config: {
    consolidation?: { similarityThreshold?: number; maxGroupSize?: number; preserveNewest?: boolean; createNewVersion?: boolean }
    reorganization?: { minEdgeWeight?: number; densityTarget?: number }
    archival?: { importanceThreshold?: number; stalenessDays?: number; retentionDays?: number }
    scheduler?: { autoOrganize?: boolean; organizeInterval?: number; fragmentationThreshold?: number }
  }) => {
    const res = await apiClient.put('/dreaming/config', config)
    return res.data
  },
}

// ============================================================
// Profile API
// ============================================================
export const profileApi = {
  get: async () => {
    const res = await apiClient.get('/profile')
    return res.data
  },

  getById: async (userId: string) => {
    const res = await apiClient.get(`/profile/${userId}`)
    return res.data
  },

  getContext: async (userId: string) => {
    const res = await apiClient.get(`/profile/${userId}/context`)
    return res.data
  },

  getPersona: async (userId: string) => {
    const res = await apiClient.get(`/profile/${userId}/persona`)
    return res.data
  },

  updatePersona: async (userId: string, data: Partial<Persona>) => {
    const res = await apiClient.put(`/profile/${userId}/persona`, data)
    return res.data
  },

  buildPersona: async (userId: string, turns: Array<{ role: string; content: string }>) => {
    const res = await apiClient.post(`/profile/${userId}/persona/build`, { turns })
    return res.data
  },

  getPreferences: async (userId: string) => {
    const res = await apiClient.get(`/profile/${userId}/preferences`)
    return res.data
  },

  setPreference: async (userId: string, key: string, value: unknown) => {
    const res = await apiClient.put(`/profile/${userId}/preferences`, { key, value })
    return res.data
  },

  inferPreferences: async (userId: string, behaviors: Array<Record<string, unknown>>) => {
    const res = await apiClient.post(`/profile/${userId}/preferences/infer`, { behaviors })
    return res.data
  },

  getInteractions: async (
    userId: string,
    options?: { types?: string[]; limit?: number; startDate?: number; endDate?: number }
  ) => {
    const params: Record<string, string> = {}
    if (options?.types) params.types = options.types.join(',')
    if (options?.limit) params.limit = String(options.limit)
    if (options?.startDate) params.startDate = String(options.startDate)
    if (options?.endDate) params.endDate = String(options.endDate)
    const res = await apiClient.get(`/profile/${userId}/interactions`, { params })
    return res.data
  },

  recordInteraction: async (userId: string, data: Omit<UserInteraction, 'timestamp'>) => {
    const res = await apiClient.post(`/profile/${userId}/interactions`, data)
    return res.data
  },

  getStats: async (userId: string) => {
    const res = await apiClient.get(`/profile/${userId}/stats`)
    return res.data
  },

  getTags: async (userId: string, category?: string) => {
    const res = await apiClient.get(`/profile/${userId}/tags`, { params: category ? { category } : {} })
    return res.data
  },

  addTag: async (
    userId: string,
    data: { name: string; category: string; source?: string; confidence?: number; weight?: number }
  ) => {
    const res = await apiClient.post(`/profile/${userId}/tags`, data)
    return res.data
  },

  removeTag: async (userId: string, tagId: string) => {
    const res = await apiClient.delete(`/profile/${userId}/tags/${tagId}`)
    return res.data
  },

  generateReport: async (
    userId: string,
    options?: {
      includePersona?: boolean
      includePreferences?: boolean
      includeInteractions?: boolean
      includeTags?: boolean
      includeStats?: boolean
    }
  ) => {
    const res = await apiClient.post(`/profile/${userId}/report`, options ?? {
      includePersona: true,
      includePreferences: true,
      includeInteractions: true,
      includeTags: true,
      includeStats: true,
    })
    return res.data
  },

  exportData: async (userId: string, format: 'json' | 'csv' | 'markdown' = 'json') => {
    const res = await apiClient.post(`/profile/${userId}/export`, { format })
    return res.data
  },
}

// ============================================================
// System API
// ============================================================
export const systemApi = {
  getStats: async (): Promise<{ success: boolean; data: SystemStats }> => {
    const res = await apiClient.get('/system/stats')
    return res.data
  },

  getHealth: async (): Promise<{ success: boolean; data: HealthStatus }> => {
    const res = await apiClient.get('/system/health')
    return res.data
  },

  getLogFiles: async (): Promise<{ success: boolean; data: LogFilesResult }> => {
    const res = await apiClient.get('/system/logs')
    return res.data
  },

  getLogContent: async (options?: {
    file?: string
    offset?: number
    limit?: number
  }): Promise<{ success: boolean; data: LogContentResult }> => {
    const res = await apiClient.get('/system/logs/content', { params: options })
    return res.data
  },

  // ========== Config Management ==========
  getConfig: async (path?: string): Promise<{ success: boolean; data: unknown; path: string }> => {
    const params = path ? { path } : {};
    const res = await apiClient.get('/system/config', { params })
    return res.data
  },

  updateConfig: async (path: string, value: unknown, persist = true): Promise<{ success: boolean; data: { path: string; value: unknown }; message: string }> => {
    const res = await apiClient.put('/system/config', { path, value, persist })
    return res.data
  },

  resetConfig: async (path?: string): Promise<{ success: boolean; message: string }> => {
    const res = await apiClient.post('/system/config/reset', { path })
    return res.data
  },

  // ========== Module Status ==========
  getModules: async (): Promise<{ success: boolean; data: { modules: ModuleStatus[]; totalModules: number; runningModules: number; timestamp: number } }> => {
    const res = await apiClient.get('/system/modules')
    return res.data
  },

  getConfigSchema: async (): Promise<{ success: boolean; data: Record<string, unknown> }> => {
    const res = await apiClient.get('/system/config-schema')
    return res.data
  },
}

export interface ModuleStatus {
  id: string
  name: string
  description: string
  status: 'running' | 'idle' | 'stopped' | 'error'
  stats?: Record<string, unknown>
  subModules?: Array<{ id: string; name: string; status: string }>
  error?: string
}

export default apiClient
