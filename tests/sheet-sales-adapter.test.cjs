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
