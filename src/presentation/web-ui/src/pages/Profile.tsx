import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import { User, Tag, Settings, Download, RefreshCw, Plus, X, Edit2, Save } from 'lucide-react'
import {
  profileApi,
  type Persona,
  type UserPreferences,
  type UserTag,
  type UserInteraction,
  type UserStats,
} from '../api/client'

const USER_ID = 'default-user'

export default function Profile() {
  const [persona, setPersona] = useState<Persona | null>(null)
  const [prefs, setPrefs] = useState<UserPreferences | null>(null)
  const [tags, setTags] = useState<UserTag[]>([])
  const [interactions, setInteractions] = useState<UserInteraction[]>([])
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'tags' | 'interactions' | 'prefs'>('overview')
  // Editing
  const [editingPersona, setEditingPersona] = useState(false)
  const [personaDraft, setPersonaDraft] = useState<Partial<Persona>>({})
  const [newTagName, setNewTagName] = useState('')
  const [newTagCat, setNewTagCat] = useState('interest')
  const [saving, setSaving] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.allSettled([
      profileApi.getPersona(USER_ID).then(r => r.success && setPersona(r.data)),
      profileApi.getPreferences(USER_ID).then(r => r.success && setPrefs(r.data)),
      profileApi.getTags(USER_ID).then(r => r.success && setTags(r.data ?? [])),
      profileApi.getInteractions(USER_ID, { limit: 30 }).then(r => r.success && setInteractions(r.data ?? [])),
      profileApi.getStats(USER_ID).then(r => r.success && setStats(r.data)),
    ])
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleSavePersona = useCallback(async () => {
    setSaving(true)
    try {
      const res = await profileApi.updatePersona(USER_ID, personaDraft)
      if (res.success) { setPersona(res.data); setEditingPersona(false) }
    } finally { setSaving(false) }
  }, [personaDraft])

  const handleAddTag = useCallback(async () => {
    if (!newTagName.trim()) return
    const res = await profileApi.addTag(USER_ID, { name: newTagName.trim(), category: newTagCat })
    if (res.success) { setTags(prev => [...prev, res.data]); setNewTagName('') }
  }, [newTagName, newTagCat])

  const handleRemoveTag = useCallback(async (tagId: string) => {
    await profileApi.removeTag(USER_ID, tagId)
    setTags(prev => prev.filter(t => t.id !== tagId))
  }, [])

  const handleExport = useCallback(async (fmt: 'json' | 'csv' | 'markdown') => {
    const res = await profileApi.exportData(USER_ID, fmt)
    if (res.success) {
      const blob = new Blob([
        typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2)
      ], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `profile-${USER_ID}.${fmt}`; a.click()
      URL.revokeObjectURL(url)
    }
  }, [])

  const interactionChart = useMemo(() =>
    stats?.interactionsByType
      ? Object.entries(stats.interactionsByType).map(([name, value]) => ({ name, value }))
      : [],
    [stats]
  )

  if (loading) return <div className="loading-wrap"><div className="spinner" /><span>加载用户画像...</span></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Header actions */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={loadAll}>
          <RefreshCw size={13} /> 刷新
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => handleExport('json')}>
          <Download size={13} /> 导出 JSON
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => handleExport('markdown')}>
          <Download size={13} /> 导出 MD
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 0 }}>
        {[
          { key: 'overview' as const, label: '概览' },
          { key: 'tags' as const, label: `标签 (${tags.length})` },
          { key: 'interactions' as const, label: `交互历史 (${interactions.length})` },
          { key: 'prefs' as const, label: '偏好设置' },
        ].map(tab => (
          <div
            key={tab.key}
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Persona card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title"><User size={15} /> 用户人格 (Persona)</span>
              {!editingPersona ? (
                <button className="btn btn-secondary btn-sm" onClick={() => {
                  setPersonaDraft({ name: persona?.name, background: persona?.background, personalityTraits: persona?.personalityTraits ?? [] })
                  setEditingPersona(true)
                }}>
                  <Edit2 size={13} /> 编辑
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingPersona(false)}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={handleSavePersona} disabled={saving}>
                    <Save size={13} /> 保存
                  </button>
                </div>
              )}
            </div>

            {editingPersona ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="form-group">
                  <label className="form-label">名称</label>
                  <input className="form-input" value={personaDraft.name ?? ''} onChange={e => setPersonaDraft(d => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">背景描述</label>
                  <textarea className="form-textarea" rows={3} value={personaDraft.background ?? ''} onChange={e => setPersonaDraft(d => ({ ...d, background: e.target.value }))} />
                </div>
              </div>
            ) : persona ? (
              <div>
                <div className="grid grid-2" style={{ marginBottom: 'var(--space-4)' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>名称</div>
                    <div style={{ fontWeight: 600 }}>{persona.name || '未设置'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>版本</div>
                    <div style={{ fontWeight: 600 }}>v{persona.version ?? 1}</div>
                  </div>
                </div>
                {persona.background && (
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>背景描述</div>
                    <p style={{ fontSize: '0.875rem' }}>{persona.background}</p>
                  </div>
                )}
                {persona.personalityTraits && persona.personalityTraits.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>特质标签</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {persona.personalityTraits.map((t, idx: number) => (
                        <span key={idx} className="badge badge-purple">{t.trait}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: 20 }}>
                <p>暂无人格数据</p>
              </div>
            )}
          </div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-3">
              <div className="stat-card">
                <div className="stat-value">{stats.totalInteractions ?? 0}</div>
                <div className="stat-label">总交互次数</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{tags.length}</div>
                <div className="stat-label">用户标签</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.mostActiveHour !== undefined ? `${stats.mostActiveHour}:00` : '-'}</div>
                <div className="stat-label">最活跃时段</div>
              </div>
            </div>
          )}

          {/* Interaction type chart */}
          {interactionChart.length > 0 && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>交互类型分布</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={interactionChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="value" name="次数" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      {activeTab === 'tags' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Add tag */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
              <Plus size={14} /> 添加标签
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <input
                className="form-input" style={{ flex: 1 }}
                placeholder="标签名称"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddTag()}
              />
              <select className="form-select" style={{ width: 120 }} value={newTagCat} onChange={e => setNewTagCat(e.target.value)}>
                <option value="interest">兴趣</option>
                <option value="skill">技能</option>
                <option value="trait">特质</option>
                <option value="context">上下文</option>
                <option value="other">其他</option>
              </select>
              <button className="btn btn-primary" onClick={handleAddTag} disabled={!newTagName.trim()}>
                添加
              </button>
            </div>
          </div>

          {/* Tag groups */}
          {Object.entries(
            tags.reduce<Record<string, UserTag[]>>((acc, t) => {
              acc[t.category] = acc[t.category] ?? []
              acc[t.category].push(t)
              return acc
            }, {})
          ).map(([cat, catTags]) => (
            <div key={cat} className="card">
              <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
                <Tag size={14} /> {cat} ({catTags.length})
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {catTags.map(tag => (
                  <div key={tag.id} className="tag-chip" style={{ fontSize: '0.8rem', padding: '4px 10px' }}>
                    {tag.name}
                    {tag.confidence !== undefined && (
                      <span style={{ opacity: 0.6, fontSize: '0.7rem' }}> {(tag.confidence * 100).toFixed(0)}%</span>
                    )}
                    <button onClick={() => handleRemoveTag(tag.id)}><X size={11} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {tags.length === 0 && (
            <div className="card">
              <div className="empty-state">
                <Tag className="empty-state-icon" />
                <h3>暂无标签</h3>
                <p>添加标签来描述用户特征</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Interactions */}
      {activeTab === 'interactions' && (
        <div className="card">
          {interactions.length === 0 ? (
            <div className="empty-state">
              <User className="empty-state-icon" />
              <h3>暂无交互记录</h3>
            </div>
          ) : (
            <div className="timeline">
              {interactions.slice(0, 30).map((inter, i) => (
                <div key={i} className="timeline-item">
                  <div className="timeline-dot">
                    <User size={10} />
                  </div>
                  <div className="timeline-content">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-blue">{inter.type}</span>
                      {inter.sessionId && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>session: {inter.sessionId.slice(0, 8)}</span>}
                    </div>
                    {inter.input && (
                      <div className="timeline-title" style={{ marginTop: 4 }}>
                        {String(inter.input).slice(0, 80)}
                      </div>
                    )}
                    <div className="timeline-time">{new Date(inter.timestamp).toLocaleString('zh-CN')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preferences */}
      {activeTab === 'prefs' && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
            <Settings size={15} /> 用户偏好
          </div>
          {prefs ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {Object.entries(prefs).map(([key, value]) => (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--space-3)', background: 'var(--color-bg)',
                  borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
                }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)' }}>{key}</span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                    {Array.isArray(value) ? value.join(', ') : String(value ?? '-')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 20 }}><p>暂无偏好数据</p></div>
          )}
        </div>
      )}
    </div>
  )
}
