import { describe, expect, it } from 'vitest';
import { DEMO_OUTCOMES, lifecycleEvidence } from '../src/app/lifecycleEvidenceModel';
describe('truthful lifecycle evidence', () => {
  it('does not manufacture earlier or later stages from SUBMITTED', () => {
    const stages = lifecycleEvidence({ state:'SUBMITTED',events:[] });
    expect(stages[4]?.status).toBe('CURRENT'); expect(stages.filter((stage)=>stage.status==='UNAVAILABLE')).toHaveLength(6);
  });
  it('uses only explicit backend audit events for historical evidence', () => {
    const stages = lifecycleEvidence({state:'RECONCILED',events:[{eventType:'ACTION_AUTHORIZED'},{eventType:'ACTION_SUBMITTED'}]});
    expect(stages[3]?.status).toBe('RECORDED'); expect(stages[4]?.status).toBe('RECORDED'); expect(stages[5]?.status).toBe('UNAVAILABLE'); expect(stages[6]?.status).toBe('CURRENT');
  });
  it.each(['BLOCKED','HELD','DENIED','EXPIRED'])('places %s at the decision, not execution', (state)=>{
    const stages=lifecycleEvidence({state,events:[]});expect(stages[1]?.status).toBe('CURRENT');expect(stages[4]?.status).toBe('UNAVAILABLE');
  });
  it('does not interpret malformed or unknown evidence as verification',()=>{
    expect(lifecycleEvidence({state:'UNKNOWN',events:[{eventType:42},{eventType:'FAKE_SUCCESS'}]}).every((item)=>item.status==='UNAVAILABLE')).toBe(true);
  });
  it('keeps demo blocked and held outcomes before signing/submission',()=>{expect(DEMO_OUTCOMES.BLOCK.limit).toBe(1);expect(DEMO_OUTCOMES.HOLD.limit).toBe(1);});
});
