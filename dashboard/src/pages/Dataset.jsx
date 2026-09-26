import { useState } from 'react';
import { Database, ChevronDown, ChevronRight } from 'lucide-react';

const merchantFiles = import.meta.glob('/src/data/merchants/*.json', { eager: true });
const triggerFiles = import.meta.glob('/src/data/triggers/*.json', { eager: true });
const categoryFiles = import.meta.glob('/src/data/categories/*.json', { eager: true });
const customerFiles = import.meta.glob('/src/data/customers/*.json', { eager: true });

function getAll(files) {
  return Object.values(files).map(m => m.default || m);
}

function JsonTree({ data, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  if (data === null) return <span style={{ color: 'var(--text-muted)' }}>null</span>;
  if (typeof data !== 'object') {
    const color = typeof data === 'number' ? 'var(--vera-amber)' :
      typeof data === 'boolean' ? 'var(--vera-green)' : 'var(--vera-cyan)';
    return <span style={{ color, fontSize: 12 }}>{JSON.stringify(data)}</span>;
  }
  const entries = Array.isArray(data) ? data.map((v, i) => [i, v]) : Object.entries(data);
  if (entries.length === 0) return <span style={{ color: 'var(--text-muted)' }}>{Array.isArray(data) ? '[]' : '{}'}</span>;

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {Array.isArray(data) ? `[${entries.length}]` : `{${entries.length}}`}
      </button>
      {open && entries.map(([k, v]) => (
        <div key={k} style={{ marginLeft: 12, fontSize: 12, lineHeight: 1.8 }}>
          <span style={{ color: 'var(--vera-purple-light)' }}>{k}</span>
          <span style={{ color: 'var(--text-muted)' }}>: </span>
          <JsonTree data={v} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function DataExplorer({ title, items, idKey, labelFn, badgeFn }) {
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');

  const filtered = items.filter(item => {
    const label = labelFn(item).toLowerCase();
    return label.includes(search.toLowerCase());
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, height: '70vh' }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
          <div className="card-title" style={{ marginBottom: 10 }}>{title} <span className="badge badge-gray">{items.length}</span></div>
          <input
            className="form-control"
            placeholder={`Search ${title.toLowerCase()}…`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(item => (
            <div
              key={item[idKey]}
              className={`trigger-row ${selected?.[idKey] === item[idKey] ? 'selected' : ''}`}
              onClick={() => setSelected(item)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labelFn(item)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item[idKey]}</div>
              </div>
              {badgeFn && badgeFn(item)}
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflow: 'auto' }}>
        {selected ? (
          <>
            <div className="card-title">{labelFn(selected)}</div>
            <JsonTree data={selected} />
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>
            ← Select an item to inspect
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dataset() {
  const merchants = getAll(merchantFiles);
  const triggers = getAll(triggerFiles);
  const categories = getAll(categoryFiles);
  const customers = getAll(customerFiles);

  const [tab, setTab] = useState('merchants');
  const tabs = [
    { id: 'merchants', label: 'Merchants', count: merchants.length },
    { id: 'triggers', label: 'Triggers', count: triggers.length },
    { id: 'categories', label: 'Categories', count: categories.length },
    { id: 'customers', label: 'Customers', count: customers.length },
  ];

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Dataset Explorer</h1>
        <p className="page-sub">Browse and inspect all merchants, triggers, categories, and customers</p>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              className={`btn ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(t.id)}
            >
              <Database size={13} />
              {t.label}
              <span className="badge badge-gray" style={{ background: 'rgba(0,0,0,0.2)' }}>{t.count}</span>
            </button>
          ))}
        </div>

        {tab === 'merchants' && (
          <DataExplorer
            title="Merchants"
            items={merchants}
            idKey="merchant_id"
            labelFn={m => m.identity?.name || m.merchant_id}
            badgeFn={m => <span className={`badge badge-${m.subscription?.status === 'active' ? 'green' : 'amber'}`}>{m.category_slug}</span>}
          />
        )}
        {tab === 'triggers' && (
          <DataExplorer
            title="Triggers"
            items={triggers}
            idKey="id"
            labelFn={t => t.kind}
            badgeFn={t => (
              <div style={{ display: 'flex', gap: 4 }}>
                <span className="badge badge-blue">{t.scope}</span>
              </div>
            )}
          />
        )}
        {tab === 'categories' && (
          <DataExplorer
            title="Categories"
            items={categories}
            idKey="slug"
            labelFn={c => c.slug}
            badgeFn={null}
          />
        )}
        {tab === 'customers' && (
          <DataExplorer
            title="Customers"
            items={customers}
            idKey="customer_id"
            labelFn={c => c.identity?.name || c.customer_id}
            badgeFn={c => <span className="badge badge-purple">{c.state}</span>}
          />
        )}
      </div>
    </>
  );
}
