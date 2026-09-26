import { useState } from 'react';
import { Activity, MessageSquare, Database, Upload, Play } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Compose from './pages/Compose';
import Dataset from './pages/Dataset';
import ContextManager from './pages/ContextManager';
import BatchRunner from './pages/BatchRunner';
import './index.css';

const NAV = [
  { id: 'dashboard', label: 'Overview', icon: Activity, section: 'main' },
  { id: 'compose', label: 'Compose & Simulate', icon: MessageSquare, section: 'main' },
  { id: 'context', label: 'Context Manager', icon: Upload, section: 'tools' },
  { id: 'batch', label: 'Batch Runner', icon: Play, section: 'tools' },
  { id: 'dataset', label: 'Dataset Explorer', icon: Database, section: 'tools' },
];

const SECTIONS = {
  main: 'Navigation',
  tools: 'Tools',
};

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [botOnline, setBotOnline] = useState(null);

  // Check bot status on mount
  useState(() => {
    fetch('http://localhost:8080/v1/healthz')
      .then(() => setBotOnline(true))
      .catch(() => setBotOnline(false));
  }, []);

  const grouped = Object.entries(SECTIONS).map(([key, label]) => ({
    key,
    label,
    items: NAV.filter(n => n.section === key),
  }));

  const PageComponent = {
    dashboard: Dashboard,
    compose: Compose,
    dataset: Dataset,
    context: ContextManager,
    batch: BatchRunner,
  }[page];

  return (
    <div className="app-shell">
      {/* Hero glow */}
      <div className="hero-bg" />

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark">
            <div className="logo-icon">✨</div>
            <div>
              <div className="logo-text">Vera</div>
              <div className="logo-sub">magicpin AI</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {grouped.map(group => (
            <div key={group.key} className="nav-section">
              <div className="nav-label">{group.label}</div>
              {group.items.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${page === item.id ? 'active' : ''}`}
                    onClick={() => setPage(item.id)}
                  >
                    <Icon className="icon" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-status">
          <div className="status-pill">
            <div className={`status-dot ${botOnline === null ? '' : botOnline ? 'online' : 'offline'}`} />
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              {botOnline === null ? 'Checking…' : botOnline ? 'Bot online :8080' : 'Bot offline'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content" style={{ position: 'relative', zIndex: 1 }}>
        {PageComponent && <PageComponent />}
      </main>
    </div>
  );
}
