import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api/client';
import { PolicyListSchema, PolicyRevisionSchema, type PolicyRevision } from '../api/schemas';
export function AgentPermissionScope({ agentId, organizationId, token }: { agentId:string; organizationId:string|null; token:string|null }) {
  const [policies,setPolicies] = useState<PolicyRevision[]>([]); const [selected,setSelected] = useState(0); const [status,setStatus] = useState<'loading'|'ready'|'unavailable'>('loading');
  useEffect(()=>{
    const controller = new AbortController(); setPolicies([]); setSelected(0); setStatus('loading');
    if (!organizationId || !token) { setStatus('unavailable'); return; }
    const base=`/api/v1/orgs/${encodeURIComponent(organizationId)}/policies`;
    void request(base,PolicyListSchema,{token,signal:controller.signal}).then(async (list)=>{
      const bodies=await Promise.all(list.policies.map((policy)=>request(`${base}/${encodeURIComponent(policy.id)}/revisions/${policy.currentRevision}`,PolicyRevisionSchema,{token,signal:controller.signal})));
      if (bodies.some((policy,index)=>policy.organizationId!==organizationId || policy.policyId!==list.policies[index]?.id || policy.revision!==list.policies[index]?.currentRevision)) throw new Error('Policy response mismatch');
      if (!controller.signal.aborted) { setPolicies(bodies.filter((policy)=>policy.agentId===agentId));setStatus('ready'); }
    }).catch(()=>{if (!controller.signal.aborted) setStatus('unavailable');});
    return()=>controller.abort();
  },[agentId,organizationId,token]);
  const policy=policies[selected];
  return <section className="panel permission-scope"><div className="panel-heading"><div><p className="eyebrow">Backend policy revisions</p><h2>Permission surface</h2></div><span className="data-origin">API DATA</span></div>
    {status==='loading'?<p role="status">Loading this agent’s policy scope…</p>:status==='unavailable'?<p role="alert">Policy scope unavailable. No permissions are inferred.</p>:!policy?<p>No matching current policy revisions were returned. This is not an authorization grant.</p>:<><div className="scope-tabs" aria-label="Agent policy selection">{policies.map((item,index)=><button type="button" key={item.policyId} aria-pressed={selected===index} onClick={()=>setSelected(index)}>{item.policyId} / r{item.revision}</button>)}</div><dl><dt>Bound account</dt><dd><code>{policy.account}</code></dd><dt>Policy chain / not wallet connection</dt><dd>{policy.chainId}</dd><dt>Policy-bound key version</dt><dd>{policy.agentKeyVersion}</dd><dt>Allowed target</dt><dd><code>{policy.target}</code></dd><dt>Selectors</dt><dd>{policy.selectors.join(', ')}</dd><dt>Recipients</dt><dd>{policy.recipients.map((value)=><code key={value}>{value}<br /></code>)}</dd><dt>Per-action limit / base units</dt><dd>{policy.limits.perAction}</dd></dl><Link className="text-link" to={`/app/policies/${encodeURIComponent(policy.policyId)}`}>Inspect activation and full policy →</Link><p className="source-note">A policy body describes scope, not current chain enrollment or authorization. Activation and action eligibility remain separate backend checks.</p></>}
  </section>;
}
