import { useState, useEffect, useRef } from 'react';
import { Send, Zap, Play, ChevronRight } from 'lucide-react';
import { pushContext, tick, reply, teardown } from '../api/client';

// Pre-load dataset files via glob import
const merchantFiles = import.meta.glob('/src/data/merchants/*.json', { eager: true });
const triggerFiles = import.meta.glob('/src/data/triggers/*.json', { eager: true });
const categoryFiles = import.meta.glob('/src/data/categories/*.json', { eager: true });
const customerFiles = import.meta.glob('/src/data/customers/*.json', { eager: true });

function getAll(files) {
  return Object.values(files).map(m => m.default || m);
}

function UrgencyBar({ level }) {
  return (
    <div className="urgency-bar">
      {[1,2,3,4,5].map(i => (
        <div key={i} className={`urgency-pip ${i <= level ? 'filled' : ''}`} />
      ))}
    </div>
  );
}

export default function Compose() {
  const merchants = getAll(merchantFiles);
  const triggers = getAll(triggerFiles);
  const categories = getAll(categoryFiles);
  const customers = getAll(customerFiles);

  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [selectedTrigger, setSelectedTrigger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [filterKind, setFilterKind] = useState('');

  // Conversation state
  const [convId, setConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [turnNumber, setTurnNumber] = useState(1);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const allKinds = [...new Set(triggers.map(t => t.kind))].sort();
  const filteredTriggers = filterKind
    ? triggers.filter(t => selectedMerchant ? t.merchant_id === selectedMerchant.merchant_id && t.kind === filterKind : t.kind === filterKind)
    : (selectedMerchant ? triggers.filter(t => t.merchant_id === selectedMerchant.merchant_id) : triggers);

  const handleCompose = async () => {
    if (!selectedMerchant || !selectedTrigger) {
      setError('Select a merchant and a trigger first.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setMessages([]);
    setConvId(null);

    try {
      // Clear all suppression + stale context so this compose always runs fresh
      await teardown();

      // Use a timestamp-based version so re-pushes are never stale-rejected
      const ver = Math.floor(Date.now() / 1000);

      const cat = categories.find(c => c.slug === selectedMerchant.category_slug);
      const cust = selectedTrigger.customer_id
        ? customers.find(c => c.customer_id === selectedTrigger.customer_id)
        : null;

      await pushContext('merchant', selectedMerchant.merchant_id, ver, selectedMerchant);
      if (cat) await pushContext('category', cat.slug, ver, cat);
      if (cust) await pushContext('customer', cust.customer_id, ver, cust);
      await pushContext('trigger', selectedTrigger.id, ver, selectedTrigger);

      // Fire tick
      const tickResult = await tick([selectedTrigger.id]);
      const action = tickResult.actions?.[0];

      if (action) {
        setResult(action);
        setConvId(action.conversation_id);
        setTurnNumber(2);
        setMessages([{ role: 'vera', body: action.body, cta: action.cta, rationale: action.rationale }]);
      } else {
        setError('No action returned — bot returned no actions. Check bot logs.');
      }
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Failed to compose.');
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !convId) return;
    const msg = replyText.trim();
    setReplyText('');
    setReplying(true);

    setMessages(prev => [...prev, { role: 'merchant', body: msg }]);

    try {
      const r = await reply(
        convId,
        selectedMerchant?.merchant_id,
        selectedTrigger?.customer_id || null,
        'merchant',
        msg,
        turnNumber,
      );
      setTurnNumber(t => t + 1);

      if (r.action === 'send' && r.body) {
        setMessages(prev => [...prev, { role: 'vera', body: r.body, cta: r.cta, rationale: r.rationale }]);
      } else if (r.action === 'end') {
        setMessages(prev => [...prev, { role: 'system', body: `Conversation ended — ${r.rationale || 'graceful exit'}` }]);
      } else if (r.action === 'wait') {
        setMessages(prev => [...prev, { role: 'system', body: `Vera is waiting ${r.wait_seconds}s before following up.` }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'system', body: `Error: ${e.message}` }]);
    } finally {
      setReplying(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Compose & Simulate</h1>
        <p className="page-sub">Pick a merchant + trigger → compose a message → simulate the conversation</p>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-error">{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {/* Merchant picker */}
          <div className="card">
            <div className="card-title">1. Select Merchant</div>
            <div className="form-group">
              <input
                className="form-control"
                placeholder="Search merchants…"
                onChange={e => {/* just for visual; filter handled below */}}
                id="merchant-search"
              />
            </div>
            <div className="scroll-list">
              {merchants.map(m => (
                <div
                  key={m.merchant_id}
                  className={`merchant-card ${selectedMerchant?.merchant_id === m.merchant_id ? 'selected' : ''}`}
                  onClick={() => { setSelectedMerchant(m); setSelectedTrigger(null); setResult(null); setMessages([]); }}
                >
                  <div className="merchant-name">{m.identity?.name}</div>
                  <div className="merchant-meta">
                    <span className="badge badge-purple">{m.category_slug}</span>
                    <span>📍 {m.identity?.locality}, {m.identity?.city}</span>
                    <span className={`badge badge-${m.subscription?.status === 'active' ? 'green' : 'amber'}`}>
                      {m.subscription?.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trigger picker */}
          <div className="card">
            <div className="card-title">2. Select Trigger</div>
            <div className="form-group">
              <select
                className="form-control"
                value={filterKind}
                onChange={e => setFilterKind(e.target.value)}
              >
                <option value="">All trigger kinds</option>
                {allKinds.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="scroll-list">
              {filteredTriggers.map(t => (
                <div
                  key={t.id}
                  className={`trigger-row ${selectedTrigger?.id === t.id ? 'selected' : ''}`}
                  onClick={() => { setSelectedTrigger(t); setResult(null); setMessages([]); }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      <span className="tag">{t.kind}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {t.id}
                    </div>
                  </div>
                  <UrgencyBar level={t.urgency} />
                  <span className={`badge badge-${t.scope === 'customer' ? 'pink' : 'blue'}`} style={{ color: t.scope === 'customer' ? 'var(--vera-pink)' : undefined }}>
                    {t.scope}
                  </span>
                </div>
              ))}
              {filteredTriggers.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 12, textAlign: 'center' }}>
                  No triggers match. Select a merchant or remove kind filter.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <button
            className="btn btn-primary"
            onClick={handleCompose}
            disabled={loading || !selectedMerchant || !selectedTrigger}
            style={{ padding: '12px 32px', fontSize: 15 }}
          >
            {loading ? <><div className="spinner spinner-sm" /> Composing via Groq…</> : <><Play size={16} /> Compose Message</>}
          </button>
        </div>

        {/* Output */}
        {(result || messages.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Result metadata */}
            <div className="card">
              <div className="card-title">Composed Output</div>
              {result && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>TEMPLATE</div>
                    <span className="tag">{result.template_name}</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>CTA</div>
                    <span className="badge badge-blue">{result.cta}</span>
                    <span className="badge badge-gray" style={{ marginLeft: 6 }}>{result.send_as}</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>TRIGGER ID</div>
                    <div style={{ fontSize: 12, color: 'var(--vera-cyan)' }}>{result.trigger_id}</div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>CONVERSATION ID</div>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{result.conversation_id}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>RATIONALE</div>
                    <div className="rationale-box">{result.rationale || 'No rationale provided.'}</div>
                  </div>
                </>
              )}
            </div>

            {/* Conversation */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div className="card-title" style={{ marginBottom: 0 }}>Live Conversation</div>
              </div>
              <div className="chat-messages" ref={chatRef}>
                {messages.length === 0 && (
                  <div className="chat-empty">Compose a message to start the conversation</div>
                )}
                {messages.map((msg, i) => (
                  <div key={i}>
                    {msg.role !== 'system' && (
                      <div className={`chat-sender`} style={{ textAlign: msg.role === 'vera' ? 'left' : 'right', marginBottom: 3 }}>
                        {msg.role === 'vera' ? '🤖 Vera' : '🏪 Merchant'}
                      </div>
                    )}
                    <div className={`chat-bubble ${msg.role}`}>{msg.body}</div>
                    {msg.rationale && msg.role === 'vera' && (
                      <div className="rationale-box" style={{ marginLeft: 8, maxWidth: '80%' }}>{msg.rationale}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="chat-input-bar">
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder={convId ? "Type merchant reply…" : "Start a conversation first"}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  disabled={!convId || replying}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                  style={{ minHeight: 'unset', resize: 'none' }}
                />
                <button
                  className="btn btn-primary btn-icon"
                  onClick={handleReply}
                  disabled={!convId || replying || !replyText.trim()}
                >
                  {replying ? <div className="spinner spinner-sm" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
