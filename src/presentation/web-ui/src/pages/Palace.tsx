import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Crown, Search, ChevronRight, ChevronDown,
  Box, Building2, Grid3X3, List,
  BookOpen, Calendar, Lightbulb, AlertCircle,
  GraduationCap, Network, Fingerprint, Heart, User,
  Clock, Star, X, Maximize2, RefreshCw
} from 'lucide-react'
import { memoryApi, type Memory, type MemoryScope } from '../api/client'
import MemoryDrawer from '../components/MemoryDrawer'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PalaceStats {
  totalWings: number
  totalHalls: number
  totalRooms: number
  totalMemories: number
  byScope: Record<string, number>
  byType: Record<string, number>
}

interface WingData {
  wingId: string
  label: string
  color: string
  bg: string
  memoryCount: number
  hallCount: number
  halls: HallData[]
}

interface HallData {
  hallId: string
  label: string
  color: string
  memoryCount: number
  rooms: RoomData[]
}

interface RoomData {
  roomId: string
  label: string
  memories: Memory[]
}

type ViewMode = 'map' | 'list'
type FilterScope = 'all' | MemoryScope

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; color: string; Icon: any }> = {
  fact:      { label: '事实',    color: '#3b82f6', Icon: BookOpen },
  event:     { label: '事件',    color: '#10b981', Icon: Calendar },
  decision:  { label: '决策',    color: '#f59e0b', Icon: Lightbulb },
  error:     { label: '错误',    color: '#ef4444', Icon: AlertCircle },
  learning:  { label: '学习',    color: '#8b5cf6', Icon: GraduationCap },
  relation:  { label: '关系',    color: '#06b6d4', Icon: Network },
  identity:  { label: '身份',    color: '#ec4899', Icon: Fingerprint },
  preference:{ label: '偏好',    color: '#f97316', Icon: Heart },
  persona:   { label: '人格',    color: '#84cc16', Icon: User },
}

const SCOPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  session: { label: '会话', color: '#6366f1', bg: '#eef2ff' },
  agent:   { label: 'Agent', color: '#8b5cf6', bg: '#f5f3ff' },
  global:  { label: '全局', color: '#10b981', bg: '#ecfdf5' },
}

// ── Helper Functions ───────────────────────────────────────────────────────────

function normalizeType(t: string): string {
  return (t || 'fact').toLowerCase()
}

function normalizeScope(s: string): string {
  return (s || 'global').toLowerCase()
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天`
  const months = Math.floor(days / 30)
  return `${months}月前`
}

// ── Palace Builder ─────────────────────────────────────────────────────────────

function buildPalace(memories: Memory[]) {
  const byWing: Record<string, Memory[]> = {}
  const byHall: Record<string, Record<string, Memory[]>> = {}
  const byRoom: Record<string, Record<string, Record<string, Memory[]>>> = {}

  for (const m of memories) {
    const wingId = m.palace?.wingId || normalizeScope(m.scope || 'global')
    const hallId = m.palace?.hallId || normalizeType(m.type)
    const roomId = m.palace?.roomId || (m.tags?.[0] || 'default')

    if (!byWing[wingId]) byWing[wingId] = []
    if (!byHall[wingId]) byHall[wingId] = {}
    if (!byHall[wingId][hallId]) byHall[wingId][hallId] = []
    if (!byRoom[wingId]) byRoom[wingId] = {}
    if (!byRoom[wingId][hallId]) byRoom[wingId][hallId] = {}
    if (!byRoom[wingId][hallId][roomId]) byRoom[wingId][hallId][roomId] = []

    byWing[wingId].push(m)
    byHall[wingId][hallId].push(m)
    byRoom[wingId][hallId][roomId].push(m)
  }

  const wings: WingData[] = Object.keys(byWing).map(wingId => {
    const wingMemories = byWing[wingId]
    const scopeInfo = SCOPE_CONFIG[wingId] || SCOPE_CONFIG.global

    const halls: HallData[] = Object.keys(byHall[wingId] || {}).map(hallId => {
      const hallMemories = byHall[wingId][hallId]
      const typeConfig = TYPE_CONFIG[hallId] || { label: hallId, color: '#8b5cf6' }

      const rooms: RoomData[] = Object.keys(byRoom[wingId]?.[hallId] || {}).map(roomId => ({
        roomId,
        label: roomId === 'default' ? '默认房间' : roomId,
        memories: byRoom[wingId][hallId][roomId],
      }))

      return {
        hallId,
        label: typeConfig.label,
        color: typeConfig.color,
        memoryCount: hallMemories.length,
        rooms,
      }
    })

    return {
      wingId,
      label: scopeInfo.label + '宫殿',
      color: scopeInfo.color,
      bg: scopeInfo.bg,
      memoryCount: wingMemories.length,
      hallCount: halls.length,
      halls,
    }
  })

  const stats: PalaceStats = {
    totalWings: wings.length,
    totalHalls: wings.reduce((s, w) => s + w.hallCount, 0),
    totalRooms: wings.reduce((s, w) => s + w.halls.reduce((h, hall) => h + hall.rooms.length, 0), 0),
    totalMemories: memories.length,
    byScope: {},
    byType: {},
  }

  for (const m of memories) {
    const scope = normalizeScope(m.scope || 'global')
    const type = normalizeType(m.type)
    stats.byScope[scope] = (stats.byScope[scope] || 0) + 1
    stats.byType[type] = (stats.byType[type] || 0) + 1
  }

  return { wings, stats }
}

// ── Memory Card Component ───────────────────────────────────────────────────────

function MemoryCard({
  memory,
  onClick,
  isSelected,
}: {
  memory: Memory
  onClick: () => void
  isSelected: boolean
}) {
  const typeConfig = TYPE_CONFIG[memory.type] || TYPE_CONFIG.fact
  const scopeInfo = SCOPE_CONFIG[memory.scope] || SCOPE_CONFIG.global
  const Icon = typeConfig.Icon

  return (
    <div
      onClick={onClick}
      className="memory-card"
      data-type={memory.type}
      style={{
        padding: '12px 14px',
        marginBottom: 6,
        cursor: 'pointer',
        background: isSelected ? 'var(--color-primary-light)' : 'var(--color-surface)',
        borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--color-primary)'
          e.currentTarget.style.transform = 'translateX(2px)'
        }
      }}
      onMouseLeave={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.transform = 'translateX(0)'
        }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: typeConfig.color + '15',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={16} style={{ color: typeConfig.color }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.82rem',
            fontWeight: 500,
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {memory.summary || memory.content?.slice(0, 40) || '无内容'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.68rem',
              padding: '2px 6px',
              borderRadius: 4,
              background: typeConfig.color + '15',
              color: typeConfig.color,
              fontWeight: 500,
            }}>
              {typeConfig.label}
            </span>
            <span style={{
              fontSize: '0.68rem',
              padding: '2px 6px',
              borderRadius: 4,
              background: scopeInfo.bg,
              color: scopeInfo.color,
            }}>
              {scopeInfo.label}
            </span>
            {memory.tags[0] && (
              <span style={{
                fontSize: '0.62rem',
                padding: '1px 5px',
                borderRadius: 3,
                background: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
              }}>
                #{memory.tags[0]}
              </span>
            )}
            <span style={{
              fontSize: '0.62rem',
              color: 'var(--color-text-muted)',
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}>
              <Star size={10} />
              {memory.importance.toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Wing Card Component ────────────────────────────────────────────────────────

function WingCard({
  wing,
  isExpanded,
  onToggle,
  expandedHall,
  onHallToggle,
  selectedMemory,
  onSelectMemory,
}: {
  wing: WingData
  isExpanded: boolean
  onToggle: () => void
  expandedHall: string | null
  onHallToggle: (hallId: string) => void
  selectedMemory: Memory | null
  onSelectMemory: (m: Memory) => void
}) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      {/* Wing Header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          cursor: 'pointer',
          background: isExpanded ? wing.bg : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--color-surface-hover)' }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: wing.color + '15',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Building2 size={20} style={{ color: wing.color }} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{wing.label}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              {wing.memoryCount} 条记忆 · {wing.hallCount} 大厅
            </div>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown size={18} style={{ color: wing.color }} />
        ) : (
          <ChevronRight size={18} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </div>

      {/* Halls */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--color-border-light)' }}>
          {wing.halls.map(hall => (
            <div
              key={hall.hallId}
              style={{
                borderBottom: '1px solid var(--color-border-light)',
              }}
            >
              {/* Hall Header */}
              <div
                onClick={() => onHallToggle(hall.hallId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px 10px 32px',
                  cursor: 'pointer',
                  background: expandedHall === hall.hallId ? hall.color + '08' : 'transparent',
                }}
                onMouseEnter={e => { if (expandedHall !== hall.hallId) e.currentTarget.style.background = 'var(--color-surface-hover)' }}
                onMouseLeave={e => { if (expandedHall !== hall.hallId) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: hall.color,
                  }} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{hall.label}大厅</span>
                  <span style={{
                    fontSize: '0.68rem',
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: hall.color + '15',
                    color: hall.color,
                  }}>
                    {hall.memoryCount}
                  </span>
                </div>
                {expandedHall === hall.hallId ? (
                  <ChevronDown size={14} style={{ color: hall.color }} />
                ) : (
                  <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
                )}
              </div>

              {/* Memories */}
              {expandedHall === hall.hallId && (
                <div style={{
                  padding: '8px 12px 12px 40px',
                  background: hall.color + '05',
                }}>
                  {hall.rooms.map(room => (
                    <div key={room.roomId} style={{ marginBottom: 8 }}>
                      <div style={{
                        fontSize: '0.7rem',
                        color: 'var(--color-text-muted)',
                        padding: '4px 0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}>
                        <Box size={10} />
                        {room.label}
                        <span style={{ opacity: 0.5 }}>({room.memories.length})</span>
                      </div>
                      {room.memories.slice(0, 3).map(m => (
                        <MemoryCard
                          key={m.uid}
                          memory={m}
                          isSelected={selectedMemory?.uid === m.uid}
                          onClick={() => onSelectMemory(m)}
                        />
                      ))}
                      {room.memories.length > 3 && (
                        <div style={{
                          fontSize: '0.72rem',
                          color: 'var(--color-text-muted)',
                          textAlign: 'center',
                          padding: '6px',
                        }}>
                          + 还有 {room.memories.length - 3} 条
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────────

export default function Palace() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('map')
  const [filterScope, setFilterScope] = useState<FilterScope>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null)
  const [drawerMemory, setDrawerMemory] = useState<Memory | null>(null)
  const [expandedWings, setExpandedWings] = useState<Set<string>>(new Set())
  const [expandedHall, setExpandedHall] = useState<string | null>(null)
  const [searchParams] = useSearchParams()

  const load = useCallback(() => {
    setLoading(true)
    memoryApi.getAll({ limit: 500 }).then(res => {
      if (res.success) setMemories(res.data.memories ?? [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Handle highlight parameter - auto-select memory and expand its location
  useEffect(() => {
    const highlightUid = searchParams.get('highlight')
    if (!highlightUid || memories.length === 0) return

    const targetMemory = memories.find(m => m.uid === highlightUid)
    if (!targetMemory) return

    // Select the memory
    setSelectedMemory(targetMemory)

    // Expand the wing and hall where this memory is located
    const wingId = targetMemory.palace?.wingId || normalizeScope(targetMemory.scope || 'global')
    const hallId = targetMemory.palace?.hallId || normalizeType(targetMemory.type)

    setExpandedWings(new Set([wingId]))
    setExpandedHall(hallId)

    // Switch to map view to show the location
    setViewMode('map')
  }, [searchParams, memories])

  // Filter memories
  const filteredMemories = useMemo(() => {
    return memories.filter(m => {
      if (filterScope !== 'all' && m.scope !== filterScope) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          m.content.toLowerCase().includes(q) ||
          m.summary.toLowerCase().includes(q) ||
          m.tags.some(t => t.toLowerCase().includes(q))
        )
      }
      return true
    })
  }, [memories, filterScope, searchQuery])

  const { wings, stats } = useMemo(() => buildPalace(filteredMemories), [filteredMemories])

  const toggleWing = (wingId: string) => {
    setExpandedWings(prev => {
      const next = new Set(prev)
      if (next.has(wingId)) next.delete(wingId)
      else next.add(wingId)
      return next
    })
  }

  const toggleHall = (hallId: string) => {
    setExpandedHall(prev => prev === hallId ? null : hallId)
  }

  // All halls for type filter view
  const allHalls = useMemo(() => {
    const hallMap = new Map<string, { hallId: string; label: string; color: string; count: number; wingId: string }>()
    for (const wing of wings) {
      for (const hall of wing.halls) {
        const existing = hallMap.get(hall.hallId)
        if (existing) {
          existing.count += hall.memoryCount
        } else {
          hallMap.set(hall.hallId, { hallId: hall.hallId, label: hall.label, color: hall.color, count: hall.memoryCount, wingId: wing.wingId })
        }
      }
    }
    return Array.from(hallMap.values())
  }, [wings])

  if (loading) return (
    <div className="loading-wrap">
      <div className="spinner" />
      <span>加载记忆宫殿...</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Crown size={20} style={{ color: '#fff' }} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>记忆宫殿</h1>
              <p style={{ fontSize: '0.75rem', margin: 0, color: 'var(--color-text-muted)' }}>
                {stats.totalMemories} 条记忆 · {stats.totalWings} 宫殿
              </p>
            </div>
          </div>

          {/* View Toggle */}
          <div style={{
            display: 'flex',
            gap: 4,
            background: 'var(--color-bg)',
            padding: 4,
            borderRadius: 10,
          }}>
            {[
              { mode: 'map' as ViewMode, Icon: Grid3X3, label: '宫殿图' },
              { mode: 'list' as ViewMode, Icon: List, label: '列表' },
            ].map(({ mode, Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  background: viewMode === mode ? 'var(--color-surface)' : 'transparent',
                  color: viewMode === mode ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  boxShadow: viewMode === mode ? 'var(--shadow-sm)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          <button className="btn btn-ghost btn-sm" onClick={load}>
            <RefreshCw size={13} />
            刷新
          </button>
        </div>

        {/* Search & Filter */}
        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          {/* Search */}
          <div className="search-wrap" style={{ flex: 1, minWidth: 200 }}>
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="搜索记忆..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 34 }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  padding: 4,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Scope Filter */}
          <div className="filter-group">
            <span className="filter-label">范围:</span>
            {[
              { value: 'all' as FilterScope, label: '全部' },
              { value: 'session' as FilterScope, label: '会话' },
              { value: 'agent' as FilterScope, label: 'Agent' },
              { value: 'global' as FilterScope, label: '全局' },
            ].map(f => (
              <button
                key={f.value}
                onClick={() => setFilterScope(f.value)}
                className={`filter-chip ${filterScope === f.value ? 'active' : ''}`}
              >
                {f.label}
                {f.value !== 'all' && (
                  <span style={{ opacity: 0.6, marginLeft: 2 }}>
                    ({stats.byScope[f.value] || 0})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 'var(--space-4)', overflow: 'hidden' }}>

        {/* Palace View */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 4 }}>

          {filteredMemories.length === 0 ? (
            <div className="empty-state" style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              padding: '60px 20px'
            }}>
              <Building2 size={48} className="empty-state-icon" />
              <h3>宫殿空空如也</h3>
              <p>开始存储记忆，构建你的记忆宫殿</p>
            </div>
          ) : viewMode === 'map' ? (
            <>
              {/* Type Legend */}
              <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(TYPE_CONFIG).map(([type, config]) => (
                    <div
                      key={type}
                      onClick={() => {
                        const hall = allHalls.find(h => h.hallId === type)
                        if (hall) {
                          setExpandedWings(new Set([hall.wingId]))
                          setExpandedHall(type)
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: config.color + '12',
                        border: `1px solid ${config.color}25`,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = config.color + '20'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = config.color + '12'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }}
                    >
                      <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: config.color,
                      }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 500, color: config.color }}>
                        {config.label}
                      </span>
                      <span style={{
                        fontSize: '0.65rem',
                        color: config.color,
                        opacity: 0.7,
                      }}>
                        ({stats.byType[type] || 0})
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Wings */}
              {wings.map(wing => (
                <WingCard
                  key={wing.wingId}
                  wing={wing}
                  isExpanded={expandedWings.has(wing.wingId)}
                  onToggle={() => toggleWing(wing.wingId)}
                  expandedHall={expandedHall}
                  onHallToggle={toggleHall}
                  selectedMemory={selectedMemory}
                  onSelectMemory={setSelectedMemory}
                />
              ))}
            </>
          ) : (
            /* List View */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredMemories.slice(0, 50).map(m => (
                <MemoryCard
                  key={m.uid}
                  memory={m}
                  isSelected={selectedMemory?.uid === m.uid}
                  onClick={() => setSelectedMemory(m)}
                />
              ))}
              {filteredMemories.length > 50 && (
                <div style={{
                  textAlign: 'center',
                  padding: 16,
                  color: 'var(--color-text-muted)',
                  fontSize: '0.82rem',
                }}>
                  还有 {filteredMemories.length - 50} 条记忆...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div style={{
          width: 320,
          flexShrink: 0,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {selectedMemory ? (
            <div style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1 }}>
              {/* Type Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: (TYPE_CONFIG[selectedMemory.type]?.color || '#8b5cf6') + '15',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {(() => {
                    const IconComponent = TYPE_CONFIG[selectedMemory.type]?.Icon || BookOpen
                    return <IconComponent size={20} style={{ color: TYPE_CONFIG[selectedMemory.type]?.color || '#8b5cf6' }} />
                  })()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    {TYPE_CONFIG[selectedMemory.type]?.label || selectedMemory.type} 记忆
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={10} />
                    {timeAgo(selectedMemory.createdAt)}
                  </div>
                </div>
              </div>

              {/* Content */}
              <div style={{
                padding: 12,
                background: 'var(--color-bg)',
                borderRadius: 8,
                marginBottom: 16,
                fontSize: '0.85rem',
                lineHeight: 1.7,
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedMemory.content}</ReactMarkdown>
              </div>

              {/* Stats Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                <div style={{ padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                    {selectedMemory.importance.toFixed(1)}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>重要性</div>
                </div>
                <div style={{ padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                    {selectedMemory.accessCount}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>访问</div>
                </div>
                <div style={{ padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                    v{selectedMemory.version}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>版本</div>
                </div>
              </div>

              {/* Scope & Tags */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>作用域</div>
                <span style={{
                  fontSize: '0.75rem',
                  padding: '3px 10px',
                  borderRadius: 6,
                  background: SCOPE_CONFIG[selectedMemory.scope]?.bg || SCOPE_CONFIG.global.bg,
                  color: SCOPE_CONFIG[selectedMemory.scope]?.color || SCOPE_CONFIG.global.color,
                  fontWeight: 500,
                }}>
                  {SCOPE_CONFIG[selectedMemory.scope]?.label || '全局'}
                </span>
              </div>

              {selectedMemory.tags.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>标签</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {selectedMemory.tags.map(tag => (
                      <span key={tag} style={{
                        fontSize: '0.72rem',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'var(--color-primary-light)',
                        color: 'var(--color-primary)',
                      }}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Palace Location */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>宫殿位置</div>
                <code style={{
                  fontSize: '0.75rem',
                  padding: '8px 10px',
                  background: 'var(--color-bg)',
                  borderRadius: 6,
                  display: 'block',
                  color: 'var(--color-primary)',
                  fontFamily: 'monospace',
                }}>
                  {selectedMemory.palace?.wingId}/{selectedMemory.palace?.hallId}/{selectedMemory.palace?.roomId}
                </code>
              </div>

              {/* View Full Button */}
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}
                onClick={() => setDrawerMemory(selectedMemory)}
              >
                <Maximize2 size={14} />
                查看完整详情
              </button>
            </div>
          ) : (
            <div className="empty-state" style={{ flex: 1 }}>
              <Box size={40} className="empty-state-icon" />
              <h3>选择记忆</h3>
              <p>点击记忆卡片查看详情</p>
            </div>
          )}
        </div>
      </div>

      {/* Drawer */}
      <MemoryDrawer memory={drawerMemory} onClose={() => setDrawerMemory(null)} />
    </div>
  )
}
