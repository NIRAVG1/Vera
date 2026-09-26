import { useState } from 'react';
import { pushContext } from '../api/client';
import { Upload, Check, X, RefreshCw } from 'lucide-react';

const merchantFiles = import.meta.glob('/src/data/merchants/*.json', { eager: true });
const triggerFiles = import.meta.glob('/src/data/triggers/*.json', { eager: true });
const categoryFiles = import.meta.glob('/src/data/categories/*.json', { eager: true });
const customerFiles = import.meta.glob('/src/data/customers/*.json', { eager: true });

function getAll(files) {
  return Object.values(files).map(m => m.default || m);
}

export default function ContextManager() {
  const [status, setStatus] = useState([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(1);

  const pushAll = async () => {
    setLoading(true);
    setStatus([]);
    const results = [];

    const merchants = getAll(merchantFiles);
    const triggers = getAll(triggerFiles);
    const categories = getAll(categoryFiles);
    const customers = getAll(customerFiles);

    const push = async (scope, id, payload) => {
      try {
        const r = await pushContext(scope, id, version, payload);
        results.push({ scope, id, ok: r.accepted, reason: r.reason });
      } catch (e) {
        results.push({ scope, id, ok: false, reason: e.message });
      }
    };

    for (const c of categories) await push('category', c.slug, c);
    for (const m of merchants) await push('merchant', m.merchant_id, m);
    for (const c of customers) await push('customer', c.customer_id, c);
    for (const t of triggers) await push('trigger', t.id, t);

    setStatus(results);
    setLoading(false);
  };

  const successCount = status.filter(s => s.ok).length;
  const failCount = status.filter(s => !s.ok).length;

  const scopeColor = {
    category: 'badge-purple',
    merchant: 'badge-blue',
    customer: 'badge-green',
    trigger: 'badge-amber',
  };

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Context Manager</h1>
            <p className="page-sub">Push all dataset contexts to the running bot</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="form-label" style={{ margin: 0 }}>Version</label>
              <input
                type="number"
                className="form-control"
                value={version}
                onChange={e => setVersion(Number(e.target.value))}
                style={{ width: 80 }}
                min={1}
              />
            </div>
            <button className="btn btn-primary" onClick={pushAll} disabled={loading}>
              {loading ? <><div className="spinner spinner-sm" /> Pushing…</> : <><Upload size={14} /> Push All Contexts</>}
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {status.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            <div className="badge badge-green" style={{ padding: '6px 14px', fontSize: 13 }}>
              <Check size={13} /> {successCount} accepted
            </div>
            <div className={`badge ${failCount > 0 ? 'badge-amber' : 'badge-gray'}`} style={{ padding: '6px 14px', fontSize: 13 }}>
              <X size={13} /> {failCount} stale/rejected
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
          {['category', 'merchant', 'customer', 'trigger'].map(scope => {
            const scopeStatus = status.filter(s => s.scope === scope);
            const all = {
              category: getAll(categoryFiles),
              merchant: getAll(merchantFiles),
              customer: getAll(customerFiles),
              trigger: getAll(triggerFiles),
            }[scope];
            return (
              <div key={scope} className="card">
                <div className="card-title">{scope}s</div>
                <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>{all.length}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>in dataset</div>
                {scopeStatus.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                    <span className="badge badge-green">{scopeStatus.filter(s => s.ok).length} ok</span>
                    {scopeStatus.filter(s => !s.ok).length > 0 && (
                      <span className="badge badge-amber">{scopeStatus.filter(s => !s.ok).length} stale</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {status.length > 0 && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Push Results</span>
            </div>
            <div style={{ maxHeight: 440, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {status.map((s, i) => (
                    <tr key={i}>
                      <td><span className={`badge ${scopeColor[s.scope]}`}>{s.scope}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.id}</td>
                      <td>
                        {s.ok
                          ? <span className="badge badge-green"><Check size={9} /> accepted</span>
                          : <span className="badge badge-amber"><RefreshCw size={9} /> stale</span>
                        }
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
