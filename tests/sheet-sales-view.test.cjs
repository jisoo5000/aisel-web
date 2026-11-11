const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(){const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only',url:'https://example.test/'});dom.window.AiselListPagination ||= {clear(){},take(_key,rows){return rows;}};dom.window.eval(fs.readFileSync(require.resolve('../scripts/sheet-sales-view.js'),'utf8'));return {dom,api:dom.window.AiselSheetSalesView,host:dom.window.document.getElementById('host')};}
const fixture={ok:true,source:'operations-sheet',periodLabel:'2026.09.10~10.09',returnMetric:{key:'estimated-receipt-return-request-rate'},items:[{rank:1,name:'예시 가디건',designer:'담당',factory:'공장',share:1,returns:null},{rank:2,name:'예시 스커트',designer:'담당',factory:'공장',share:20,returns:0}]};
test('actual embedded HTML starts its read-only feed and renders the returned rows',async()=>{
 const path=require('node:path'),root=path.resolve(__dirname,'..');const publicFile=path.join(root,'work-order-5aa994e7.html');const html=fs.readFileSync(fs.existsSync(publicFile)?publicFile:path.join(root,'work-order.html'),'utf8');
 const script=html.match(/<script id="aisel-sheet-sales-view-script">([\s\S]*?)<\/script>/)[1];
 const dom=new JSDOM('<div id="salesView"></div><div id="salesGroupTabs"><button data-group="new">신상품</button><button data-group="core">핵심</button></div><div id="salesAuth"></div><div id="salesSourceNote"></div><input id="salesSearchInput"><select id="salesSort"></select><div><span id="salesPeriod"></span><span id="salesUpdated"></span></div><div id="salesTableBody"></div>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.test/'});let calls=0;dom.window.AbortController=AbortController;dom.window.TextEncoder=TextEncoder;dom.window.fetch=async()=>{calls++;return {ok:true,json:async()=>({...fixture,readAt:'2026-10-10T10:32:00Z',returnMetric:{key:'sales-cohort-return-request-rate-provisional'}})};};
 dom.window.AiselListPagination={clear(){},take(_key,rows){return rows;}};dom.window.AiselAccess={session:{uid:'owner',role:'owner'},isOwner:true,ownOnly:false,allowed:()=>true,subscribe(fn){fn(this.session);},request:async()=>{calls++;return {...fixture,readAt:new Date().toISOString(),returnMetric:{key:'sales-cohort-return-request-rate-provisional'}};}};dom.window.AiselListPagination ||= {clear(){},take(_key,rows){return rows;}};dom.window.eval(script);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,1);assert.equal(dom.window.document.querySelectorAll('#salesTableBody .sheet-sales-grid').length,3);assert.equal(dom.window.document.querySelector('.sheet-sales-head').lastChild.textContent,'반품%');assert.equal(dom.window.document.getElementById('sheetSalesRefresh').disabled,false);dom.window.close();
});
test('the compact return header preserves the actual sales-cohort meaning in full details',()=>{const {dom,api,host}=setup();dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};api.render(host,{...fixture,returnMetric:{key:'sales-cohort-return-request-rate-provisional'}},'');assert.equal(host.querySelector('.sheet-sales-head').lastChild.textContent,'반품%');host.querySelector('button').click();const text=dom.window.document.querySelector('dialog').textContent;assert.match(text,/판매 대비 반품 접수율\(잠정\)/);assert.match(text,/추가 반품으로 바뀔 수/);assert.match(text,/교환은 제외/);dom.window.close();});
test('client keeps unknown and zero distinct, labels current metric and preserves existing ratings/search/details',()=>{const {dom,api,host}=setup();dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};api.render(host,fixture,'');assert.equal(host.querySelector('.sheet-sales-head').lastChild.textContent,'반품%');const rows=host.querySelectorAll('.sheet-sales-grid');assert.equal(rows[1].lastChild.textContent,'—');assert.equal(rows[2].lastChild.textContent,'0.0%');assert.equal(rows[1].querySelector('.sheet-sales-badge').textContent,'드랍');assert.equal(rows[2].querySelector('.sheet-sales-badge').textContent,'리오더');rows[1].querySelector('button').click();assert.match(dom.window.document.querySelector('dialog').textContent,/추정 수령 기준 반품 신청률 · —/);assert.match(dom.window.document.querySelector('dialog').textContent,/최종 반품 완료율을 뜻하지 않습니다/);dom.window.AiselWorkorderCodeForName=name=>name.includes('스커트')?'AS-TEST-2':'';api.render(host,fixture,'as-test-2');assert.equal(host.querySelectorAll('.sheet-sales-grid').length,2);assert.equal(host.querySelector('button .sheet-sales-name-label').textContent,'예시 스커트');const before=host.innerHTML;assert.throws(()=>api.render(host,{...fixture,returnMetric:{key:'unverified'}},''));assert.equal(host.innerHTML,before);api.render(host,{...fixture,returnMetric:undefined},'');assert.equal(host.querySelector('.sheet-sales-head').lastChild.textContent,'반품%');dom.window.close();});
test('sales reader uses account-scoped authority and rejects failed or unknown metrics',async()=>{const {dom,api}=setup();const calls=[];let response=fixture;dom.window.AiselAccess={allowed:()=>true,request:async(action,p)=>{calls.push({action,p});return response;}};assert.equal((await api.read('unused')).items.length,2);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{action:'sales',p:{group:'new'}}]);response={ok:false,error:'source_unavailable'};await assert.rejects(api.read('unused'));response={...fixture,returnMetric:{key:'unknown'}};await assert.rejects(api.read('unused'));dom.window.AiselAccess.allowed=()=>false;await assert.rejects(api.read('unused'));assert.equal(calls.length,3);dom.window.close();});
test('rankless rows preserve source order and reserve a separate badge cell, with full names in details',()=>{
 const {dom,api,host}=setup();dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const longName='렌 보트넥 드레이프 블라우스 긴 상품명 전체 표시 확인';
 const items=[{rank:9,name:longName,designer:'노승희',factory:'태경',share:null,returns:null},{...fixture.items[0],rank:1}];
 api.render(host,{...fixture,items},'');
 assert.deepEqual([...host.querySelector('.sheet-sales-head').children].map(cell=>cell.textContent),['상품명 (판매순)','','디자이너','공장','판매%','반품%']);
 const rows=[...host.querySelectorAll('.sheet-sales-grid:not(.sheet-sales-head)')];
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.children.length===6));
 assert.deepEqual(rows.map(row=>row.firstElementChild.title),items.map(item=>item.name));
 assert.equal(rows[0].children[1].className,'sheet-sales-rating');assert.equal(rows[0].children[1].textContent,'');
 assert.equal(rows[1].children[1].textContent,'드랍');assert.equal(rows[1].firstElementChild.querySelector('.sheet-sales-badge'),null);
 rows[0].firstElementChild.click();assert.equal(dom.window.document.querySelector('dialog h3').textContent,longName);
 assert.equal(rows[0].firstElementChild.getAttribute('aria-label'),longName);dom.window.close();
});
test('a fresh bounded cache renders immediately without an extra read and unchanged refresh keeps the existing rows',async()=>{
 const dom=new JSDOM('<div id="salesView"><div id="salesGroupTabs"><button data-group="new">신상품</button><button data-group="core">핵심</button></div><div id="salesAuth"></div><div id="salesSourceNote"></div><input id="salesSearchInput"><select id="salesSort"></select><p id="salesScopeNote">최근 출시 상품 기준</p><div><span id="salesPeriod"></span><span id="salesUpdated"></span></div><div id="salesTableBody"></div></div>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.test/'});
 const endpoint='https://script.google.com/macros/s/fixture/exec',snapshot={...fixture,readAt:new Date().toISOString()};let calls=0;
 dom.window.AbortController=AbortController;dom.window.TextEncoder=TextEncoder;
 const session={uid:'owner',role:'owner',active:true,enabled:true,permissions:{views:['sales'],ownOnly:false}};
 dom.window.AiselAccess={session,isOwner:true,ownOnly:false,allowed:()=>true,subscribe(fn){fn(session);},request:async()=>{calls++;return snapshot;}};
 const scope=JSON.stringify([session.uid,session.enabled,session.active,session.role,session.permissions]);
 dom.window.sessionStorage.setItem('aisel.sales-sheet.account.v281:owner:new',JSON.stringify({scope,savedAt:Date.now(),snapshot}));
 dom.window.fetch=async()=>{calls++;return {ok:true,json:async()=>snapshot};};
 dom.window.AiselListPagination ||= {clear(){},take(_key,rows){return rows;}};dom.window.eval(fs.readFileSync(require.resolve('../scripts/sheet-sales-view.js'),'utf8'));dom.window.AiselSheetSalesView.start(endpoint);
 const first=dom.window.document.querySelector('.sheet-sales-grid:not(.sheet-sales-head)');assert.ok(first);
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,0);
 assert.equal(dom.window.document.getElementById('salesScopeNote').parentElement.className,'sheet-sales-meta-info');
 assert.equal(dom.window.document.getElementById('salesPeriod').hidden,false);
 dom.window.document.getElementById('sheetSalesRefresh').click();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(calls,1);assert.equal(dom.window.document.querySelector('.sheet-sales-grid:not(.sheet-sales-head)'),first);
 assert.equal(dom.window.document.getElementById('sheetSalesRefresh').disabled,false);dom.window.close();
});

test('source period, not read time, determines freshness across KST midnight and year boundaries',()=>{
 const {dom,api}=setup(),now=new Date('2026-11-11T10:00:00Z');
 assert.equal(api.periodStatus({periodLabel:'2026.10.12 – 2026.11.10'},now),'집계 2026.10.12 – 2026.11.10');
 assert.match(api.periodStatus({periodLabel:'2026.09.20~10.19',readAt:now.toISOString()},now),/^갱신 지연/);
 assert.equal(api.periodStatus({periodLabel:'',readAt:now.toISOString()},now),'집계기간 확인 필요');
 assert.match(api.periodStatus({periodLabel:'2026.10.13~11.11'},now),/^집계기간 확인 필요/);
 assert.equal(api.periodStatus({periodLabel:'2026.11.01~11.31'},now),'집계기간 확인 필요');
 assert.equal(api.periodStatus({periodLabel:'2026.12.03~2027.01.01'},new Date('2027-01-01T15:00:00Z')),'집계 2026.12.03~2027.01.01');
 dom.window.close();
});
