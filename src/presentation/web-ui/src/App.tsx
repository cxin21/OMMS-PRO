import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Memories from './pages/Memories'
import Recall from './pages/Recall'
import Palace from './pages/Palace'
import Dreaming from './pages/Dreaming'
import Graph from './pages/Graph'
import Profile from './pages/Profile'
import Settings from './pages/Settings'

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/memories" element={<Memories />} />
          <Route path="/recall" element={<Recall />} />
          <Route path="/palace" element={<Palace />} />
          <Route path="/dreaming" element={<Dreaming />} />
          <Route path="/graph" element={<Graph />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App