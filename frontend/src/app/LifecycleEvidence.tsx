import { useState } from 'react';
import type { ActionDetail } from '../api/schemas';
import { lifecycleEvidence } from './lifecycleEvidenceModel';
import { receiptExplorerUrl } from './receiptExplorer';
export function LifecycleEvidence({ action }: { action: ActionDetail }) {
  const stages = lifecycleEvidence(action); const [selected, setSelected] = useState(0);
  const chainId = typeof action.action.chainId === 'number' ? action.action.chainId : null;
  const hashes = [...new Set(action.events.flatMap((event) => { const payload = event.payload; return typeof payload === 'object' && payload !== null && !Array.isArray(payload) && typeof payload.transactionHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(payload.transactionHash) ? [payload.transactionHash] : []; }))];
  return <section className="panel evidence-control"><div className="panel-heading"><div><p className="eyebrow">Backend evidence / no inferred transitions</p><h2>Execution record</h2></div><span className="data-origin">LIVE API RECORD</span></div>
    <div className="evidence-rail" aria-label="Action evidence stages">{stages.map((stage, index) => <button type="button" key={stage.title} aria-pressed={selected === index} className={`evidence-node evidence-${stage.status.toLowerCase()}`} onClick={() => setSelected(index)}><small>0{index + 1} / {stage.status}</small><strong>{stage.title}</strong></button>)}</div>
    <div className="evidence-inspector" aria-live="polite"><strong>{stages[selected]?.title}</strong><p>{stages[selected]?.status === 'UNAVAILABLE' ? 'No explicit evidence for this stage was returned. Later states do not fabricate missing historical events.' : stages[selected]?.status === 'CURRENT' ? `The backend reports ${action.state}. This label is not inferred from an animation.` : 'An explicit audit event for this stage is present in the API record.'}</p><small>{stages[selected]?.recordedEvents.join(' · ')}</small><small>Submission ≠ confirmation ≠ reconciliation. Reconciliation alone does not establish a successful transaction outcome.</small></div>
    <div className="returned-evidence"><span className="eyebrow">Returned transaction evidence</span>{hashes.length===0?<p>No transaction hash was returned in this action’s audit payloads.</p>:hashes.map((hash)=>{const url=chainId===null?null:receiptExplorerUrl(chainId,hash);return url?<a key={hash} href={url} target="_blank" rel="noreferrer"><code>{hash}</code> ↗</a>:<code key={hash}>{hash}</code>;})}</div>
  </section>;
}
