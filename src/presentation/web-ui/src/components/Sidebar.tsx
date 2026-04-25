import { NavLink } from 'react-router-dom'
import {
  Brain, LayoutDashboard, Database, Building2,
  Moon, GitFork, User, Settings, Search
} from 'lucide-react'

const navItems = [
  // 核心
  { to: '/',          icon: LayoutDashboard, label: '仪表盘'    },
  { to: '/memories',  icon: Database,        label: '记忆管理'  },
  { to: '/recall',    icon: Search,          label: '记忆召回'  },
  // 存储层
  { to: '/palace',    icon: Building2,        label: '记忆宫殿'  },
  { to: '/dreaming',  icon: Moon,            label: '梦境引擎'  },
  { to: '/graph',     icon: GitFork,          label: '知识图谱'  },
  // 管理
  { to: '/profile',   icon: User,            label: '用户画像'  },
  { to: '/settings',  icon: Settings,        label: '系统设置'  },
]

const sections = [
  { label: '核心', items: ['/', '/memories', '/recall'] },
  { label: '存储', items: ['/palace', '/dreaming', '/graph'] },
  { label: '管理', items: ['/profile', '/settings'] },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Brain size={18} />
        </div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-title">OMMS-PRO</span>
          <span className="sidebar-logo-sub">记忆管理系统</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            {section.items.map((path) => {
              const item = navItems.find(n => n.to === path)
              if (!item) return null
              const { to, icon: Icon, label } = item
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-status">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          <Brain size={12} />
          <span>v0.1.0 · MIT</span>
        </div>
      </div>
    </aside>
  )
}