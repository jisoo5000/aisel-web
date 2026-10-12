'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../design-meeting-core.js');

const candidate={id:'dm_current_123',inputVersion:2,title:'검토 후보',reviewState:'queued'};
const completed={id:candidate.id,version:2,state:'done',receipt:'saved-and-reread',reviewedAt:'2026-10-12T02:00:00.000Z',evidence:JSON.stringify({judgmentBasis:{demand:'수요 근거를 실제 확인했습니다.',supply:'소재 공급은 미확인입니다.',differentiation:'밑단 조절안을 제안합니다.'}})};

test('matching verified sheet results do not depend on candidate request markers',()=>{
  assert.equal(candidate.reviewRequestedVersion,undefined);
  assert.equal(C.confirmedResult(candidate,[completed]),completed);
  assert.equal(C.status(candidate,[completed]),'done');
  assert.deepEqual(C.reviewSummary(completed),{demand:'수요 근거를 실제 확인했습니다.',supply:'소재 공급은 미확인입니다.',differentiation:'밑단 조절안을 제안합니다.',additional:''});
});

test('another candidate or another input version cannot supply current evidence',()=>{
  const rows=[{...completed,id:'dm_other_123'},{...completed,version:1}];
  assert.equal(C.reviewRow(candidate,rows),undefined);
  assert.equal(C.confirmedResult(candidate,rows),undefined);
  assert.equal(C.status({...candidate,reviewRequestedVersion:1},rows),'stale');
});

test('done requires both saved receipt and review time, including cached candidate state',()=>{
  for(const missing of ['receipt','reviewedAt']){
    const row={...completed,[missing]:''};
    assert.equal(C.confirmedResult(candidate,[row]),undefined);
    assert.equal(C.status({...candidate,reviewState:'done'},[row]),'blocked');
  }
  assert.equal(C.status({...candidate,reviewState:'done'},[]),'blocked');
});

test('pending and failed sheet states remain distinguishable',()=>{
  for(const state of ['queued','running','blocked','error']){
    const row={...completed,state};
    assert.equal(C.confirmedResult(candidate,[row]),undefined);
    assert.equal(C.status(candidate,[row]),state);
  }
});

test('legacy candidates without inputVersion match version one only',()=>{
  const legacy={id:candidate.id,reviewState:'idle'};
  assert.equal(C.confirmedResult(legacy,[completed]),undefined);
  assert.equal(C.confirmedResult(legacy,[{...completed,version:'1'}]).version,'1');
});

test('reference notes are metadata and keep the current review valid',()=>{
  const original={...candidate,reviewRequestedVersion:2,reviewState:'done'};
  const next=C.edit(original,{referenceNotes:{note_123:{date:'2026-10-12',text:'회의 참고 내용',updatedAt:123}}},123);
  assert.equal(next.inputVersion,2);
  assert.equal(next.reviewState,'done');
  assert.equal(C.signature(next),C.signature(original));
  assert.equal(C.confirmedResult(next,[completed]),completed);
  const changed=C.edit(next,{title:'사진과 함께 다시 검토할 제목'},124);
  assert.equal(changed.inputVersion,3);
  assert.equal(changed.reviewState,'stale');
  assert.equal(C.confirmedResult(changed,[completed]),undefined);
});

test('missing or malformed evidence does not invent judgment data',()=>{
  assert.deepEqual(C.reviewSummary({...completed,evidence:'invalid JSON'}),{demand:'미확인',supply:'미확인',differentiation:'미정',additional:''});
  assert.deepEqual(C.reviewSummary({...completed,evidence:'[]',reason:'수요: 실제 확인한 수요\n공급: 확인 필요\n차별성: 세부 조정안',unknowns:'원가 확인 필요'}),{demand:'실제 확인한 수요',supply:'확인 필요',differentiation:'세부 조정안',additional:'원가 확인 필요'});
});
