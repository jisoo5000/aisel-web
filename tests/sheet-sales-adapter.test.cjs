const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../scripts/sheet-sales-adapter');
const header=['상품명','디자이너','공장명','제품 등록일','판매수량','전체 판매비중','신상 내 판매비중','반품률'];
const rows=[['제목'],['최근 30일 예시'],['반품 기준'],[],header,['예시 A','담당A','공장A','',5,'1.0%','50.0%','20.0%'],['예시 B','담당B','공장B','',10,'2.0%','50.0%','21.0%'],['예시 C','','','',5,'1.0%','50.0%','—'],['합계'],[],['디자이너 비교']];
test('reads whole-store share, ranks sales, excludes totals and designer block',()=>{
 const x=parse(rows);assert.equal(x.items.length,3);assert.equal(x.items[0].name,'예시 B');assert.equal(x.items[0].share,2);assert.deepEqual(x.items.map(r=>r.rank),[1,2,2]);assert.equal(x.items[2].returns,null);assert.equal(x.items[2].designer,'미확인');
 assert.deepEqual(Object.keys(x.items[0]).sort(),['designer','factory','name','rank','returns','share']);
});
test('incomplete counts do not invent final rankings or turn absent rates into zero',()=>{const x=structuredClone(rows);x[5][4]='';x[5][5]='';const result=parse(x);assert.ok(result.items.every(r=>r.rank===null));assert.equal(result.items.find(r=>r.name==='예시 A').share,null);});
test('rejects missing headers, duplicate names and invalid percentages',()=>{
 assert.throws(()=>parse([]));const x=structuredClone(rows);x[6][0]='예시 A';assert.throws(()=>parse(x));const y=structuredClone(rows);y[6][7]='101%';assert.throws(()=>parse(y));
});
test('accepts the renamed receipt-based request rate and identifies its meaning',()=>{
 const input=structuredClone(rows);input[4][7]='추정 수령 기준\n반품 신청률';input[4][5]='전체\n판매비중';
 const result=parse(input);assert.equal(result.items.length,3);assert.equal(result.returnMetric.key,'estimated-receipt-return-request-rate');assert.equal(result.returnMetric.shortLabel,'반품 신청%');assert.ok(result.returnMetric.note.includes('최종 반품 완료율'));assert.deepEqual(result.items.map(item=>item.rank),[1,2,2]);assert.equal(result.items[2].returns,null);
 assert.deepEqual(Object.keys(result.items[0]).sort(),['designer','factory','name','rank','returns','share']);
});
test('retains explicit legacy semantics without silently selecting competing rate columns',()=>{
 assert.equal(parse(rows).returnMetric.key,'legacy-sheet-return-rate');
 const input=structuredClone(rows);input[4].push('추정 수령 기준 반품 신청률');assert.throws(()=>parse(input),/반품 지표 열/);
 const duplicate=structuredClone(rows);duplicate[4].push('반품률');assert.throws(()=>parse(duplicate),/필수 열/);
});
test('does not reinterpret maturity gaps as zero and rejects unverified metrics',()=>{
 const input=structuredClone(rows);input[4][7]='추정 수령 기준 반품 신청률';input[5][7]='—';input[6][7]='0.0%';
 const result=parse(input);assert.equal(result.items.find(item=>item.name==='예시 A').returns,null);assert.equal(result.items.find(item=>item.name==='예시 B').returns,0);
 input[4][7]='최종 반품 완료율';assert.throws(()=>parse(input),/머리글/);
});
test('accepts provisional sales-cohort returns, never the nearby mature sample column',()=>{
 const input=structuredClone(rows);input[4][7]='판매 대비\n반품 접수율(잠정)';input[4].push('사유','피드백','기한 종료 표본 반품률');input[5].push('비공개 사유','비공개 평가','99.0%');input[5][7]='0.0%';input[6][7]='—';
 const result=parse(input);assert.equal(result.returnMetric.key,'sales-cohort-return-request-rate-provisional');assert.equal(result.returnMetric.shortLabel,'반품 접수%');assert.equal(result.items.find(item=>item.name==='예시 A').returns,0);assert.equal(result.items.find(item=>item.name==='예시 B').returns,null);assert.ok(!JSON.stringify(result).includes('비공개'));assert.deepEqual(Object.keys(result.items[0]).sort(),['designer','factory','name','rank','returns','share']);
 input[4].push('반품률');assert.throws(()=>parse(input),/반품 지표 열/);
});
