import { useState, useCallback } from 'react'
import { Search, Zap, Clock, TrendingUp, Target } from 'lucide-react'
import { memoryApi, type RecallResult } from '../api/client'

export default function Recall() {
  const [query, setQuery]         = useState('')
  const [results, setResults]   = useState<RecallResult | null>(null)
  const [loading, setLoading]    = useState(false)
  const [searchType, setSearchType] = useState<'semantic' | 'keyword'>('semantic')

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await memoryApi.recall(query, { limit: 20 })
      if (res.success) setResults(res.data)
    } catch (e) {
      console.error('Failed to recall:', e)
    } finally {
      setLoading(false)
    }
  }, [query])

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      fact: 'var(--color-fact)',
      event: 'var(--color-event)',
      decision: 'var(--color-decision)',
      error: 'var(--color-error)',
      learning: 'var(--color-learning)',
      relation: 'var(--color-relation)',
      identity: 'var(--color-identity)',
      preference: 'var(--color-preference)',
      persona: 'var(--color-persona)',
    }
    return colors[type] || 'var(--color-primary)'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

      {/* Page Header */}
      <div>
        <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>记忆召回</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
          通过语义搜索或关键词匹配召回相关记忆
        </p>
      </div>

      {/* Search Box */}
      <div className="card">
        <div style={{ display: 'flex', gap: 12, marginBottom: 'var(--space-4)' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="输入搜索内容..."
              className="form-input"
              style={{ paddingLeft: 36, fontSize: '0.9rem' }}
            />
          </div>
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading}>
            <Search size={14} /> {loading ? '搜索中...' : '搜索'}
          </button>
        </div>

        {/* Search Type */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`filter-chip ${searchType === 'semantic' ? 'active' : ''}`}
            onClick={() => setSearchType('semantic')}
          >
            <Target size={12} /> 语义搜索
          </button>
          <button
            className={`filter-chip ${searchType === 'keyword' ? 'active' : ''}`}
            onClick={() => setSearchType('keyword')}
          >
            <Search size={12} /> 关键词搜索
          </button>
        </div>
      </div>

      {/* Results */}
      {results && (
        <>
          {/* Stats */}
          <div className="grid grid-4">
            <div className="stat-card">
              <div className="stat-label">找到记忆</div>
              <div className="stat-value">{results.totalFound}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">本次召回</div>
              <div className="stat-value">{results.memories.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">满足最低</div>
              <div className="stat-value" style={{ fontSize: '1rem' }}>
                {results.meetsMinimum ? '是' : '否'}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">召回率</div>
              <div className="stat-value" style={{ fontSize: '1rem' }}>
                {results.scopeDistribution ? Object.values(results.scopeDistribution).reduce((a, b) => a + b, 0) : 0}
              </div>
            </div>
          </div>

          {/* Scope Distribution */}
          {results.scopeDistribution && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><TrendingUp size={15} /> 作用域分布</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {Object.entries(results.scopeDistribution).map(([scope, count]) => (
                  <span key={scope} className={`badge badge-${scope}`}>{scope}: {count}</span>
                ))}
              </div>
            </div>
          )}

          {/* Memory List */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><Zap size={15} /> 召回的记忆</div>
            </div>
            {results.memories.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {results.memories.map(memory => (
                  <div key={memory.uid} style={{
                    padding: 'var(--space-4)',
                    background: 'var(--color-bg)',
                    borderRadius: 'var(--radius)',
                    borderLeft: `3px solid ${getTypeColor(memory.type)}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`badge badge-${memory.type}`}>{memory.type}</span>
                        <span className={`badge badge-${memory.scope}`}>{memory.scope}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        <Clock size={12} /> {new Date(memory.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.9rem', marginBottom: 8, lineHeight: 1.6 }}>
                      {memory.content.substring(0, 200)}{memory.content.length > 200 ? '...' : ''}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      重要性: <strong>{memory.importance.toFixed(1)}</strong> ·
                      作用域得分: <strong>{memory.scopeScore.toFixed(1)}</strong> ·
                      召回次数: <strong>{memory.recallCount}</strong>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Search size={32} className="empty-state-icon" />
                <h3>未找到相关记忆</h3>
                <p>尝试不同的搜索词</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Info */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Search size={15} /> 召回算法说明</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg)', borderRadius: 'var(--radius)' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>语义搜索 (Semantic Search)</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              使用向量嵌入技术，找到与查询语义最相似的记忆。适合模糊查询和自然语言搜索。
            </div>
          </div>
          <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg)', borderRadius: 'var(--radius)' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>关键词搜索 (Keyword Search)</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              基于关键词匹配进行搜索，适合精确查找特定内容。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}