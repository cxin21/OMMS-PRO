import { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'

const pageTitles: Record<string, string> = {
  '/': '仪表盘',
  '/memories': '记忆管理',
  '/recall': '记忆召回',
  '/palace': '记忆宫殿',
  '/dreaming': '梦境引擎',
  '/graph': '知识图谱',
  '/profile': '用户画像',
  '/settings': '系统设置',
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const title = pageTitles[location.pathname] ?? 'OMMS-PRO'

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <header className="page-header">
          <h1 className="page-header-title">{title}</h1>
        </header>
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  )
}