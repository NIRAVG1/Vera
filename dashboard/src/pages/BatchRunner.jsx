import { useState } from 'react';
import { Terminal, Play, DownloadCloud, CheckCircle, XCircle, Loader } from 'lucide-react';
import { pushContext, tick } from '../api/client';

const merchantFiles = import.meta.glob('/src/data/merchants/*.json', { eager: true });
const triggerFiles = import.meta.glob('/src/data/triggers/*.json', { eager: true });
const categoryFiles = import.meta.glob('/src/data/categories/*.json', { eager: true });
const customerFiles = import.meta.glob('/src/data/customers/*.json', { eager: true });
const testPairsFile = import.meta.glob('/src/data/test_pairs.json', { eager: true });

function getAll(files) {
  return Object.values(files).map(m => m.default || m);
}

export default function BatchRunner() {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [results, setResults] = useState([]);
  const [done, setDone] = useState(false);

  const appendLog = (msg, type = 'info') => {
    setLog(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }]);
  };

  const downloadResults = () => {
    const jsonl = results.map(r => JSON.stringify(r)).join('\n');
    const blob = new Blob([jsonl], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'submission.jsonl';
    a.click();
  };

  const runBatch = async () => {
    setRunning(true);
    setLog([]);
    setResults([]);
    setDone(false);

    const merchants = getAll(merchantFiles);
    const triggers = getAll(triggerFiles);
    const categories = getAll(categoryFiles);
    const customers = getAll(customerFiles);

    const testPairsRaw = Object.values(testPairsFile)[0];
    const testPairsData = testPairsRaw?.default || testPairsRaw;
    const pairs = testPairsData?.pairs || [];

    appendLog(`Loaded ${merchants.length} merchants, ${triggers.length} triggers, ${categories.length} categories, ${customers.length} customers`, 'info');
    appendLog(`Running ${pairs.length} test pairs from test_pairs.json…`, 'info');

    const output = [];

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const { merchant_id, trigger_id } = pair;
      appendLog(`[${i + 1}/${pairs.length}] ${merchant_id} × ${trigger_id}`, 'step');

      try {
        const merchant = merchants.find(m => m.merchant_id === merchant_id);
        const trigger = triggers.find(t => t.id === trigger_id);
        const category = categories.find(c => c.slug === merchant?.category_slug);
        const customer = trigger?.customer_id ? customers.find(c => c.customer_id === trigger.customer_id) : null;

        if (!merchant) throw new Error(`Merchant not found: ${merchant_id}`);
        if (!trigger) throw new Error(`Trigger not found: ${trigger_id}`);
        if (!category) throw new Error(`Category not found for slug: ${merchant?.category_slug}`);

        await pushContext('merchant', merchant.merchant_id, Date.now(), merchant);
        await pushContext('category', category.slug, Date.now(), category);
        if (customer) await pushContext('customer', customer.customer_id, Date.now(), customer);
        await pushContext('trigger', trigger.id, Date.now(), trigger);

        const tickResult = await tick([trigger.id]);
        const action = tickResult.actions?.[0];

        if (action) {
          appendLog(`  ✓ ${action.cta} — ${action.body.slice(0, 60)}…`, 'success');
          output.push({
            merchant_id,
            trigger_id,
            conversation_id: action.conversation_id,
            send_as: action.send_as,
            template_name: action.template_name,
            body: action.body,
            cta: action.cta,
            rationale: action.rationale,
          });
        } else {
          appendLog(`  ⚠ No action — suppressed or missing data`, 'warn');
          output.push({ merchant_id, trigger_id, error: 'no_action' });
        }
      } catch (e) {
        appendLog(`  ✗ ${e.message}`, 'error');
        output.push({ merchant_id, trigger_id, error: e.message });
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    setResults(output);
    const successCount = output.filter(r => !r.error).length;
    appendLog(`Done! ${successCount}/${pairs.length} successful.`, successCount === pairs.length ? 'success' : 'warn');
    setDone(true);
    setRunning(false);
  };

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Batch Runner</h1>
            <p className="page-sub">Run all 30 test pairs and generate submission.jsonl</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {done && (
              <button className="btn btn-secondary" onClick={downloadResults}>
                <DownloadCloud size={14} /> Download submission.jsonl
              </button>
            )}
            <button className="btn btn-primary" onClick={runBatch} disabled={running}>
              {running ? <><div className="spinner spinner-sm" /> Running…</> : <><Play size={14} /> Run All Test Pairs</>}
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Log */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Terminal size={15} style={{ color: 'var(--vera-cyan)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Run Log</span>
              {running && <div className="spinner spinner-sm" style={{ marginLeft: 'auto' }} />}
            </div>
            <div style={{
              height: 520,
              overflowY: 'auto',
              padding: 16,
              fontFamily: 'Courier New, monospace',
              fontSize: 12,
              lineHeight: 1.7,
              background: 'var(--bg-900)',
            }}>
              {log.length === 0 && (
                <span style={{ color: 'var(--text-muted)' }}>Waiting for run…</span>
              )}
              {log.map((entry, i) => (
                <div key={i} style={{
                  color: entry.type === 'success' ? 'var(--vera-green)' :
                    entry.type === 'error' ? 'var(--vera-red)' :
                    entry.type === 'warn' ? 'var(--vera-amber)' :
                    entry.type === 'step' ? 'var(--vera-purple-light)' :
                    'var(--text-secondary)',
                  marginBottom: 2,
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>[{entry.ts}] </span>{entry.msg}
                </div>
              ))}
            </div>
          </div>

          {/* Results table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Results</span>
              {results.length > 0 && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span className="badge badge-green"><CheckCircle size={10} /> {results.filter(r => !r.error).length}</span>
                  <span className="badge badge-red"><XCircle size={10} /> {results.filter(r => r.error).length}</span>
                </div>
              )}
            </div>
            <div style={{ height: 520, overflowY: 'auto' }}>
              {results.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>
                  Run the batch to see results
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Merchant</th>
                      <th>Kind</th>
                      <th>CTA</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const triggerKind = r.template_name?.replace('vera_', '').replace('_v1', '') || '—';
                      return (
                        <tr key={i} title={r.body || r.error}>
                          <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.merchant_id?.replace('m_', '').split('_').slice(1, 3).join('_')}
                          </td>
                          <td><span className="tag" style={{ fontSize: 10 }}>{triggerKind}</span></td>
                          <td>{r.cta ? <span className="badge badge-blue">{r.cta}</span> : '—'}</td>
                          <td>
                            {r.error
                              ? <span className="badge badge-red"><XCircle size={9} /> {r.error === 'no_action' ? 'suppressed' : 'error'}</span>
                              : <span className="badge badge-green"><CheckCircle size={9} /> ok</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
