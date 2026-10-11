import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import {AgentPermissionScope} from '../src/app/AgentPermissionScope';
const account=`0x${'1'.repeat(40)}`;
const policy={schemaVersion:1,policyId:'policy',revision:1,organizationId:'org',owner:account,account,agentId:'agent',agentAddress:`0x${'2'.repeat(40)}`,agentKeyVersion:1,chainId:10143,adapter:'evm-smart-account',target:account,selectors:['0xa9059cbb'],asset:account,recipients:[account],limits:{perAction:'10',cumulative:'100',windowSeconds:3600},validAfter:1,expiresAt:100,nonceEpoch:0};
it('reads canonical backend revisions and clears old tenant scope on failure',async()=>{
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const paths:string[]=[];vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input);paths.push(path);if(path.includes('/other/'))return Response.json({error:{code:'FORBIDDEN',message:'Unavailable'}},{status:403});return Response.json(path.endsWith('/revisions/1')?policy:{policies:[{id:'policy',accountId:'account',currentRevision:1,state:'ACTIVE',revisionHash:`0x${'a'.repeat(64)}`,createdAt:'2026-10-10T00:00:00.000Z'}]});}));
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>{root.render(<MemoryRouter><AgentPermissionScope agentId="agent" organizationId="org" token="fixture-session"/></MemoryRouter>);});
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(host.textContent).toContain('10143');expect(host.textContent).toContain('Per-action limit');expect(paths).toContain('/api/v1/orgs/org/policies/policy/revisions/1');
    await act(async()=>root.render(<MemoryRouter><AgentPermissionScope agentId="agent" organizationId="other" token="fixture-session"/></MemoryRouter>));
    await act(async()=>{await Promise.resolve();});expect(host.textContent).toContain('No permissions are inferred');expect(host.textContent).not.toContain(account);
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
