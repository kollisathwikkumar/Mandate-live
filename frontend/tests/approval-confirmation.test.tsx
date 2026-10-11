import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
vi.mock('../src/auth/AuthProvider',()=>({useAuth:()=>({accessToken:'fixture-session',user:{access_token:'fixture-session',profile:{}},loading:false})}));
import {App} from '../src/app/App';
it('requires exact-hash confirmation before recording the human decision',async()=>{
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const hash=`0x${'a'.repeat(64)}`;const writes:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(input);
    if(init?.method==='POST'){writes.push(String(init.body));return Response.json({approval:{outcome:'APPROVED'}});}
    if(path==='/api/v1/me')return Response.json({principal:{type:'HUMAN',subject:'owner'},organizations:[{organizationId:'tenant',role:'OWNER'}]});
    if(path==='/ops/readiness')return Response.json({status:'ready'});
    return Response.json({actions:[{actionId:'action',policyId:'policy',policyRevision:1,actionHash:hash,state:'HELD',verdict:'HOLD',reason:'APPROVAL_REQUIRED',action:{agentId:'agent',recipient:'recipient',amount:'10'},createdAt:'2026-10-10T00:00:00.000Z',updatedAt:'2026-10-10T00:00:00.000Z'}]});
  }));
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<MemoryRouter initialEntries={['/app/approvals']}><App/></MemoryRouter>));await act(async()=>{await Promise.resolve();await Promise.resolve();});
    const approve=[...host.querySelectorAll('button')].find((node)=>node.textContent?.includes('Approve exact hash'));expect(approve).toBeDefined();await act(async()=>approve?.click());
    expect(writes).toHaveLength(0);expect(host.querySelector('[role="dialog"]')?.textContent).toContain(hash);
    const confirm=[...host.querySelectorAll('button')].find((node)=>node.textContent==='Confirm decision');await act(async()=>confirm?.click());
    expect(writes).toEqual([JSON.stringify({outcome:'APPROVED',actionHash:hash})]);expect(host.textContent).toContain('No transaction was submitted by this control');
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
