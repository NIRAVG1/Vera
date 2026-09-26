import { useState, useEffect } from 'react';
import { Activity, Zap, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import { healthz, metadata, teardown } from '../api/client';

export default function Dashboard() {
  const [health, setHealth] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tearing, setTearing] = useState(false);
  const [tearMsg, setTearMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [h, m] = await Promise.all([healthz(), metadata()]);
      setHealth(h);
      setMeta(m);
    } catch {
      setError('Cannot reach bot at http://localhost:8080 — is it running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleTeardown = async () => {
    setTearing(true);
    setTearMsg('');
    try {
      await teardown();
      setTearMsg('State cleared — all contexts and conversations reset.');
      load();
    } catch {
      setTearMsg('Teardown failed.');
    } finally {
      setTearing(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Overview</h1>
            <p className="page-sub">Live bot health and session status</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              Refresh
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleTeardown} disabled={tearing}>
              <Trash2 size={13} />
              {tearing ? 'Clearing…' : 'Teardown'}
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {tearMsg && <div className="alert alert-info">{tearMsg}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div className="spinner" />
          </div>
        ) : health ? (
          <>
            <div className="stats-grid">
              <div className="stat-card purple">
                <div className="stat-icon purple"><Activity size={16} /></div>
                <div className="stat-value" style={{ color: '#10b981' }}>Online</div>
                <div className="stat-label">Bot Status</div>
              </div>
              <div className="stat-card blue">
                <div className="stat-icon blue"><Zap size={16} /></div>
                <div className="stat-value">{health.uptime_seconds}s</div>
                <div className="stat-label">Uptime</div>
              </div>
              <div className="stat-card green">
                <div className="stat-icon green"><MessageSquare size={16} /></div>
                <div className="stat-value">{Object.values(health.contexts_loaded || {}).reduce((a, b) => a + b, 0)}</div>
                <div className="stat-label">Contexts Loaded</div>
              </div>
              <div className="stat-card amber">
                <div className="stat-icon amber">🧠</div>
                <div className="stat-value" style={{ fontSize: 14, marginTop: 6, fontWeight: 700 }}>
                  {meta?.model?.split('-').slice(0, 3).join('-') || '—'}
                </div>
                <div className="stat-label">Active Model</div>
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: 20 }}>
              <div className="card">
                <div className="card-title">Context Store</div>
                {health.contexts_loaded && Object.entries(health.contexts_loaded).map(([scope, count]) => (
                  <div key={scope} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 13, textTransform: 'capitalize' }}>{scope}</span>
                    <span className={`badge badge-${count > 0 ? 'blue' : 'gray'}`}>{count} loaded</span>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-title">Bot Metadata</div>
                {meta && Object.entries({
                  Team: meta.team_name,
                  Version: meta.version,
                  Model: meta.model,
                  Contact: meta.contact_email,
                }).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {meta?.approach && (
              <div className="card">
                <div className="card-title">Approach</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{meta.approach}</p>
              </div>
            )}
          </>
        ) : null}
      </div>

      <style>{`.spin-icon { animation: spin 0.7s linear infinite; }`}</style>
    </>
  );
}
