import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Plus, Search, RefreshCw, X, ArrowLeft, GitFork } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { memoryApi, type Memory, type MemoryType, type MemoryScope, type MemoryBlock } from '../api/client'
import MemoryCard from '../components/MemoryCard'
import MemoryDrawer from '../components/MemoryDrawer'
import MemoryModal from '../components/MemoryModal'

const TYPE_OPTIONS:  MemoryType[]  = ['fact','event','decision','error','learning','relation','identity','preference','persona']
const SCOPE_OPTIONS: MemoryScope[] = ['session','agent','global']
const BLOCK_OPTIONS: MemoryBlock[] = ['working','session','core','archived']

const LABEL: Record<string, string> = {
  fact:'事实', event:'事件', decision:'决策', error:'错误',
  learning:'学习', relation:'关系', identity:'身份', preference:'偏好', persona:'人格',
  session:'会话', agent:'Agent', global:'全局',
  working:'工作区', core:'核心区', archived:'归档', deleted:'已删除',
}

const PAGE_SIZE = 20

function getPaginationPages(page: number, totalPages: number): number[] {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i)
  if (page < 2)               return [0, 1, 2, 3, 4]
  if (page >= totalPages - 2) return Array.from({ length: 5 }, (_, i) => totalPages - 5 + i)
  return [page - 2, page - 1, page, page + 1, page + 2]
}

export default function Memories() {
  const [searchParams, setSearchParams] = useSearchParams()

  // ?highlight=<uid>  — 高亮滚动到某条（来自旧跳转）
  // ?focus=<uid>      — 仅显示某一条（来自知识图谱）
  const highlightId = searchParams.get('highlight')
  const focusId     = searchParams.get('focus')
  const highlightRef = useRef<HTMLDivElement | null>(null)

  const [memories,  setMemories]  = useState<Memory[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const [searchQuery,    setSearchQuery]    = useState('')
  const [searching,      setSearching]      = useState(false)
  const [selectedTypes,  setSelectedTypes]  = useState<MemoryType[]>([])
  const [selectedScopes, setSelectedScopes] = useState<MemoryScope[]>([])
  const [selectedBlocks, setSelectedBlocks] = useState<MemoryBlock[]>([])

  const [drawerMemory, setDrawerMemory] = useState<Memory | null>(null)
  const [editMemory,   setEditMemory]   = useState<Memory | null>(null)
  const [showModal,    setShowModal]    = useState(false)
  const [page, setPage] = useState(0)

  // ── Load ──────────────────────────────────────────────────────
  const loadMemories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await memoryApi.getAll({ limit: 200 })
      if (res.success) setMemories(res.data.memories ?? [])
    } catch {
      setError('加载记忆列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMemories() }, [loadMemories])

  // ── focus 模式：直接用 API 加载单条，同时自动打开 Drawer ───────
  const [focusMemory, setFocusMemory] = useState<Memory | null>(null)
  const [focusLoading, setFocusLoading] = useState(false)

  useEffect(() => {
    if (!focusId) { setFocusMemory(null); return }
    setFocusLoading(true)
    memoryApi.getById(focusId)
      .then(res => {
        if (res.success) {
          setFocusMemory(res.data)
          setDrawerMemory(res.data)   // 自动展开详情侧栏
        }
      })
      .catch(() => setFocusMemory(null))
      .finally(() => setFocusLoading(false))
  }, [focusId])

  // ── Scroll to highlighted memory ──────────────────────────────
  useEffect(() => {
    if (!highlightId || loading) return
    const timer = setTimeout(
      () => highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      300
    )
    return () => clearTimeout(timer)
  }, [highlightId, loading])

  // ── Client-side filter（focus 模式下跳过）────────────────────
  const filtered = useMemo(() => {
    if (focusId) return []            // focus 模式不使用普通列表
    let list = memories
    if (selectedTypes.length)  list = list.filter(m => selectedTypes.includes(m.type))
    if (selectedScopes.length) list = list.filter(m => selectedScopes.includes(m.scope))
    if (selectedBlocks.length) list = list.filter(m => selectedBlocks.includes(m.block))
    return list
  }, [memories, selectedTypes, selectedScopes, selectedBlocks, focusId])

  // reset page when filter changes
  const prevFiltered = useRef(filtered)
  useEffect(() => {
    if (prevFiltered.current !== filtered) {
      setPage(0)
      prevFiltered.current = filtered
    }
  }, [filtered])

  // ── Semantic search ───────────────────────────────────────────
  const [searchResults, setSearchResults] = useState<Memory[] | null>(null)

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return }
    setSearching(true)
    setError(null)
    try {
      const res = await memoryApi.recall(searchQuery, {
        types: selectedTypes.length ? selectedTypes : undefined,
        limit: 50,
      })
      if (res.success) { setSearchResults(res.data.memories ?? []); setPage(0) }
    } catch {
      setError('搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const clearSearch = () => { setSearchQuery(''); setSearchResults(null) }

  const handleDelete = async (uid: string) => {
    try {
      await memoryApi.delete(uid)
      await loadMemories()
      if (drawerMemory?.uid === uid) setDrawerMemory(null)
      if (focusId === uid) exitFocusMode()
    } catch {
      setError('删除失败')
    }
  }

  const toggleFilter = <T extends string>(arr: T[], item: T, setter: (v: T[]) => void) =>
    setter(arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item])

  const clearAllFilters = () => {
    setSelectedTypes([])
    setSelectedScopes([])
    setSelectedBlocks([])
    clearSearch()
  }

  // ── Focus mode helpers ────────────────────────────────────────
  const exitFocusMode = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    setSearchParams(next)
    setFocusMemory(null)
    setDrawerMemory(null)
  }

  // ── Display list ──────────────────────────────────────────────
  const displayList  = searchResults ?? filtered
  const displayed    = displayList.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages   = Math.ceil(displayList.length / PAGE_SIZE)
  const paginationPages = getPaginationPages(page, totalPages)

  const hasActiveFilters = selectedTypes.length > 0 || selectedScopes.length > 0 || selectedBlocks.length > 0 || !!searchQuery

  // ═══════════════════════════════════════════════════════════════
  // ── FOCUS MODE VIEW ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════
  if (focusId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

        {/* Focus banner */}
        <div className="card" style={{
          padding: 'var(--space-3) var(--space-5)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--color-primary-light)',
          border: '1px solid #c7d2fe',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <GitFork size={15} style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-primary)' }}>
              来自知识图谱 — 正在查看关联记忆
            </span>
            <code style={{
              fontSize: '0.72rem', color: 'var(--color-primary)',
              background: 'rgba(99,102,241,0.1)',
              padding: '1px 6px', borderRadius: 4,
              fontFamily: 'monospace',
            }}>
              {focusId.slice(0, 24)}…
            </code>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={exitFocusMode}
            style={{ gap: 'var(--space-2)' }}
          >
            <ArrowLeft size={13} /> 返回全部记忆
          </button>
        </div>

        {/* Single memory */}
        {focusLoading ? (
          <div className="loading-wrap"><div className="spinner" /><span>加载记忆...</span></div>
        ) : focusMemory ? (
          <MemoryCard
            memory={focusMemory}
            onView={setDrawerMemory}
            onEdit={mem => { setEditMemory(mem); setShowModal(true) }}
            onDelete={handleDelete}
          />
        ) : (
          <div className="card">
            <div className="empty-state">
              <Search className="empty-state-icon" />
              <h3>记忆不存在</h3>
              <p>UID: {focusId}</p>
              <button className="btn btn-secondary btn-sm" onClick={exitFocusMode}>
                <ArrowLeft size={13} /> 返回全部记忆
              </button>
            </div>
          </div>
        )}

        <MemoryDrawer memory={drawerMemory} onClose={() => setDrawerMemory(null)} onUpdate={loadMemories} />

        {showModal && (
          <MemoryModal
            memory={editMemory}
            onClose={() => { setShowModal(false); setEditMemory(null) }}
            onSuccess={() => {
              loadMemories()
              // 刷新 focus 记忆
              if (focusId) {
                memoryApi.getById(focusId).then(r => { if (r.success) setFocusMemory(r.data) }).catch(() => {})
              }
            }}
          />
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════
  // ── NORMAL LIST VIEW ──────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

      {/* Search + filters */}
      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', alignItems: 'center' }}>
          <div className="search-wrap" style={{ flex: 1 }}>
            <Search className="search-icon" />
            <input
              className="search-input"
              placeholder="语义搜索记忆（回车触发）..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            {searchQuery && (
              <button className="search-clear-btn" onClick={clearSearch} aria-label="清除搜索">
                <X size={13} />
              </button>
            )}
          </div>
          <button className="btn btn-secondary" onClick={handleSearch} disabled={searching}>
            {searching
              ? <span className="spinner" style={{ width: 14, height: 14 }} />
              : <Search size={14} />}
            搜索
          </button>
          <button className="btn btn-secondary" onClick={loadMemories} title="刷新">
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={14} /> 新建记忆
          </button>
        </div>

        <div className="filter-bar">
          {([
            { label: '类型',   options: TYPE_OPTIONS,  selected: selectedTypes,  setter: setSelectedTypes  },
            { label: '作用域', options: SCOPE_OPTIONS, selected: selectedScopes, setter: setSelectedScopes },
            { label: '区块',   options: BLOCK_OPTIONS, selected: selectedBlocks, setter: setSelectedBlocks },
          ] as const).map(({ label, options, selected, setter }) => (
            <div key={label} className="filter-group">
              <span className="filter-label">{label}：</span>
              {(options as readonly string[]).map(opt => (
                <button
                  key={opt}
                  className={`filter-chip${(selected as readonly string[]).includes(opt) ? ' active' : ''}`}
                  onClick={() => toggleFilter(selected as string[], opt, setter as (v: string[]) => void)}
                >
                  {LABEL[opt] ?? opt}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Result count + clear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '0 var(--space-1)' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          共 {displayList.length} 条记忆
          {searchResults ? ' (搜索结果)' : hasActiveFilters ? ' (已过滤)' : ''}
        </span>
        {(hasActiveFilters || searchResults) && (
          <button className="btn btn-ghost btn-sm" onClick={clearAllFilters}>清除过滤</button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="loading-wrap"><div className="spinner" /><span>加载中...</span></div>
      ) : displayed.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Search className="empty-state-icon" />
            <h3>暂无记忆</h3>
            <p>开始添加或调整过滤条件</p>
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
              <Plus size={13} /> 新建第一条记忆
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {displayed.map(m => (
            <div
              key={m.uid}
              ref={m.uid === highlightId ? highlightRef : undefined}
              style={m.uid === highlightId ? {
                borderRadius: 'var(--radius-lg)',
                outline: '2px solid var(--color-primary)',
                outlineOffset: 2,
                animation: 'pulse-highlight 1.5s ease-out',
              } : undefined}
            >
              <MemoryCard
                memory={m}
                onView={setDrawerMemory}
                onEdit={mem => { setEditMemory(mem); setShowModal(true) }}
                onDelete={handleDelete}
              />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            上一页
          </button>
          <div className="pagination-pages">
            {paginationPages.map(pageNum => (
              <button
                key={pageNum}
                className={`pagination-page${pageNum === page ? ' active' : ''}`}
                onClick={() => setPage(pageNum)}
              >
                {pageNum + 1}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            下一页
          </button>
        </div>
      )}

      <MemoryDrawer memory={drawerMemory} onClose={() => setDrawerMemory(null)} onUpdate={loadMemories} />

      {showModal && (
        <MemoryModal
          memory={editMemory}
          onClose={() => { setShowModal(false); setEditMemory(null) }}
          onSuccess={loadMemories}
        />
      )}
    </div>
  )
}
