/* node tools/check-sales-loading.cjs [path/to/sheet-sales-view.js]
 * Real sales renderer/loader with deterministic DOM, clock and authenticated API fixtures. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.argv[2]||path.resolve(__dirname,'../scripts/sheet-sales-view.js'),'utf8');
const item={rank:1,name:'검증 블라우스',designer:'담당자',factory:'공장',share:12,returns:5,code:'TEST-001'};
const snapshot=(extra={})=>({ok:true,source:'operations-sheet',readAt:'2026-10-29T13:00:00Z',periodLabel:'최근 30일',returnMetric:{key:'sales-cohort-return-request-rate-provisional'},items:[{...item}],...extra});
const owner={uid:'account-one',active:true,enabled:true,role:'owner',permissions:{views:['sales'],ownOnly:false}};
const memory=()=>{const data=new Map();return {data,getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.dataset={};this.value='';this.style={};this.events=new Map();this.hidden=false;this.disabled=false;this._text='';this.rebuilds=0;this.classList={toggle:()=>{}};}
 set id(value){this._id=value;this.ownerDocument.ids.set(value,this);}get id(){return this._id;}
 set textContent(value){this._text=String(value);this.children=[];this.rebuilds++;}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(x=>x!==node);node.parentElement=this;this.children.push(node);}}
 prepend(node){this.append(node);this.children.pop();this.children.unshift(node);}
 replaceChildren(...nodes){this._text='';this.children=[];this.rebuilds++;this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=String(value);}
 addEventListener(key,fn){if(!this.events.has(key))this.events.set(key,[]);this.events.get(key).push(fn);}
 dispatch(key,extra={}){for(const fn of this.events.get(key)||[])fn({target:this,stopImmediatePropagation(){},...extra});}
 closest(selector){return selector==='[data-group]'&&this.dataset.group?this:null;}
 querySelectorAll(selector){const all=this.children.flatMap(x=>[x,...x.querySelectorAll('*')]);return selector==='button'?all.filter(x=>x.tagName==='button'):selector==='[data-group="core"]'?all.filter(x=>x.dataset.group==='core'):all;}
 showModal(){this.open=true;}close(){this.open=false;this.dispatch('close');}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);}
}
function fixture({session=owner,storage=memory(),hidden=false,now=1793278800000}={}){
 const doc={ids:new Map(),hidden:false,readyState:'complete',events:new Map(),getElementById(id){return this.ids.get(id);},createElement(tag){return new Element(tag,this);},addEventListener(name,fn){this.events.set(name,fn);}};
 doc.body=doc.createElement('body');const nodes={};for(const id of ['salesTableBody','salesSearchInput','salesAuth','salesSourceNote','salesSort','salesUpdated','salesPeriod','salesScopeNote','salesView','salesGroupTabs']){const el=doc.createElement('div');el.id=id;nodes[id]=el;doc.body.append(el);}
 const meta=doc.createElement('div');meta.append(nodes.salesUpdated,nodes.salesPeriod);doc.body.append(meta);nodes.salesView.style.display=hidden?'none':'block';
 for(const group of ['core','new']){const button=doc.createElement('button');button.dataset.group=group;nodes.salesGroupTabs.append(button);}
 const pending=[],requests=[],subscribers=[],events=new Map();let currentSession=session,clock=now;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const access={get session(){return currentSession;},get ownOnly(){return !!currentSession?.permissions.ownOnly;},get isOwner(){return currentSession?.active&&currentSession.role==='owner';},allowed:view=>!!currentSession?.active&&currentSession.permissions.views.includes(view),subscribe(fn){subscribers.push(fn);fn(currentSession);},request(action,payload){requests.push({action,...payload});return new Promise((resolve,reject)=>pending.push({group:payload.group,resolve,reject}));}};
 const root={console,document:doc,Date:Clock,TextEncoder,queueMicrotask,Option:function(text,value){const el=doc.createElement('option');el.textContent=text;el.value=value;return el;},getComputedStyle:el=>({display:el.style.display||'block'}),localStorage:memory(),sessionStorage:storage,AiselAccess:access,AiselUnified:{view:hidden?'orders':'sales'},addEventListener:(name,fn)=>events.set(name,fn)};
 root.globalThis=root;vm.runInNewContext(source,root);root.AiselSheetSalesView.start();
 return {root,doc,nodes,storage,requests,session(value){currentSession=value;subscribers.forEach(fn=>fn(value));},advance(ms){clock+=ms;},open(){root.AiselUnified.view='sales';nodes.salesView.style.display='block';root.AiselSheetSalesSource.render();return root.AiselSheetSalesSource.refreshIfStale();},hide(){root.AiselUnified.view='orders';nodes.salesView.style.display='none';},select(group){nodes.salesGroupTabs.dispatch('click',{target:nodes.salesGroupTabs.children.find(x=>x.dataset.group===group)});},refresh(){doc.getElementById('sheetSalesRefresh').dispatch('click');},respond(value=snapshot(),group='new'){const index=pending.findIndex(x=>x.group===group);assert.notEqual(index,-1,'pending request '+group);pending.splice(index,1)[0].resolve(value);},reject(code='offline',group='new'){const index=pending.findIndex(x=>x.group===group);assert.notEqual(index,-1);pending.splice(index,1)[0].reject(Object.assign(Error(code),{code}));},assigned(codes){events.get('aisel-assigned-index-change')({detail:{codes}});},rows(){return nodes.salesTableBody.querySelectorAll('*').filter(x=>x.className==='sheet-sales-name-label').map(x=>x.textContent);}};
}
test('first load coalesces requests; selecting current group does not clear or refetch',async()=>{
 const f=fixture();f.select('new');f.refresh();await flush();assert.equal(f.requests.length,1);f.respond();await flush();const rebuilds=f.nodes.salesTableBody.rebuilds;
 f.select('new');f.root.AiselSheetSalesSource.render();await flush();assert.equal(f.requests.length,1);assert.deepEqual(f.rows(),[item.name]);assert.equal(f.nodes.salesTableBody.rebuilds,rebuilds);
});
test('new/core toggles reuse both snapshots, including empty results',async()=>{
 const f=fixture();await flush();f.respond();await flush();f.select('core');await flush();assert.equal(f.requests.length,2);f.respond(snapshot({items:[]}),'core');await flush();
 f.select('new');assert.deepEqual(f.rows(),[item.name]);f.select('core');await flush();assert.equal(f.requests.length,2);assert.match(f.nodes.salesTableBody.textContent,/핵심 SKU/);
});
test('switching during reads reuses flights and late group responses never overwrite current rows',async()=>{
 const f=fixture();await flush();f.select('core');await flush();f.select('new');await flush();assert.equal(f.requests.length,2);
 f.respond();await flush();f.respond(snapshot({items:[{...item,name:'핵심 상품'}]}),'core');await flush();assert.deepEqual(f.rows(),[item.name]);
 f.select('core');assert.deepEqual(f.rows(),['핵심 상품']);await flush();assert.equal(f.requests.length,2);
});
test('verified same-account reload restores immediately without a fresh request',async()=>{
 const storage=memory(),first=fixture({storage});await flush();first.respond();await flush();const next=fixture({storage});
 assert.deepEqual(next.rows(),[item.name]);await flush();assert.equal(next.requests.length,0);
});
test('cache remains invisible until current server session is verified',async()=>{
 const storage=memory(),first=fixture({storage});await flush();first.respond();await flush();const next=fixture({storage,session:null});
 assert.deepEqual(next.rows(),[]);await flush();assert.equal(next.requests.length,0);next.session(owner);assert.deepEqual(next.rows(),[item.name]);await flush();assert.equal(next.requests.length,0);
});
test('stale cached rows stay visible during refresh and unchanged rows are not rebuilt',async()=>{
 const storage=memory(),first=fixture({storage});await flush();first.respond();await flush();const next=fixture({storage,now:1793278800000+6*60000});
 assert.deepEqual(next.rows(),[item.name]);const rebuilds=next.nodes.salesTableBody.rebuilds;await flush();assert.equal(next.requests.length,1);assert.match(next.doc.getElementById('sheetSalesReadState').textContent,/확인 중/);
 next.respond(snapshot({readAt:'2026-10-29T13:06:00Z'}));await flush();assert.equal(next.nodes.salesTableBody.rebuilds,rebuilds);
});
test('hidden sales does not automatically query; opening restores and then refreshes only if stale',async()=>{
 const f=fixture({hidden:true});await flush();assert.equal(f.requests.length,0);f.open();await flush();f.respond();await flush();f.hide();f.advance(6*60000);f.root.AiselSheetSalesSource.refreshIfStale();await flush();assert.equal(f.requests.length,1);
 f.open();await flush();assert.equal(f.requests.length,2);assert.deepEqual(f.rows(),[item.name]);f.respond();await flush();
});
test('network failure retains prior rows and timestamp with an explicit warning, without polling',async()=>{
 const f=fixture();await flush();f.respond();await flush();const stamp=f.nodes.salesUpdated.textContent;f.refresh();await flush();f.reject();await flush();
 assert.deepEqual(f.rows(),[item.name]);assert.equal(f.nodes.salesUpdated.textContent,stamp);assert.match(f.doc.getElementById('sheetSalesReadState').textContent,/한 번 더/);assert.equal(f.requests.length,3);
 f.reject();await flush();assert.deepEqual(f.rows(),[item.name]);assert.match(f.doc.getElementById('sheetSalesReadState').textContent,/연결 실패/);f.root.AiselSheetSalesSource.refreshIfStale();await flush();assert.equal(f.requests.length,3);
});
test('manual refresh overrides freshness and changed rows replace the previous snapshot',async()=>{
 const f=fixture();await flush();f.respond();await flush();f.refresh();f.refresh();await flush();assert.equal(f.requests.length,2);f.respond(snapshot({items:[{...item,name:'변경 상품'}]}));await flush();assert.deepEqual(f.rows(),['변경 상품']);
});
test('a first transient failure retries once and recovers without another click',async()=>{
 for(const code of ['offline','timeout','service_unavailable','source_unavailable']){
  const f=fixture();await flush();f.reject(code);await flush();assert.equal(f.requests.length,2);assert.equal(f.doc.getElementById('sheetSalesRefresh').disabled,true);
  f.respond();await flush();assert.deepEqual(f.rows(),[item.name]);assert.equal(f.doc.getElementById('sheetSalesRefresh').disabled,false);assert.equal(f.doc.getElementById('sheetSalesReadState').hidden,true);
 }
});
test('two transient failures stop, preserve unknown values and allow a later manual retry',async()=>{
 const f=fixture();await flush();f.reject('timeout');await flush();f.reject('timeout');await flush();assert.equal(f.requests.length,2);assert.deepEqual(f.rows(),[]);assert.match(f.nodes.salesTableBody.textContent,/가져오지 못했습니다/);
 f.root.AiselSheetSalesSource.refreshIfStale();await flush();assert.equal(f.requests.length,2);f.refresh();await flush();assert.equal(f.requests.length,3);f.respond();await flush();assert.deepEqual(f.rows(),[item.name]);
});
test('invalid data and authorization failures are never retried',async()=>{
 for(const code of ['permission_denied','unauthenticated','session_changed','invalid_data','sales_source_not_ready']){
  const f=fixture();await flush();f.reject(code);await flush();assert.equal(f.requests.length,1);assert.deepEqual(f.rows(),[]);
 }
 const f=fixture();await flush();f.respond(snapshot({returnMetric:{key:'unknown'}}));await flush();assert.equal(f.requests.length,1);assert.deepEqual(f.rows(),[]);
});
test('logout, hidden screen and leaving the group suppress retry after a pending failure',async()=>{
 for(const action of [f=>f.session(null),f=>f.hide(),f=>f.select('core')]){
  const f=fixture();await flush();action(f);await flush();const count=f.requests.length;f.reject('timeout');await flush();assert.equal(f.requests.length,count);
 }
});
test('logout during retry discards its later result and cannot repopulate cache',async()=>{
 const f=fixture();await flush();f.reject('timeout');await flush();assert.equal(f.requests.length,2);f.session(null);f.respond();await flush();assert.deepEqual(f.rows(),[]);assert.equal(f.storage.data.size,0);
});
test('retry cooldown starts when the final request ends, not before a slow failure',async()=>{
 const f=fixture();await flush();f.advance(6*60000);f.reject('timeout');await flush();f.advance(6*60000);f.reject('timeout');await flush();f.root.AiselSheetSalesSource.refreshIfStale();await flush();assert.equal(f.requests.length,2);
});
test('logout, account change and role changes clear all previous snapshots and persisted rows',async()=>{
 for(const next of [null,{...owner,uid:'account-two'},{...owner,role:'md'}]){
  const f=fixture();await flush();f.respond();await flush();assert.equal(f.storage.data.size,1);f.session(next);assert.deepEqual(f.rows(),[]);assert.equal(f.storage.data.size,0);await flush();
 }
});
test('late account responses cannot populate a new session or storage',async()=>{
 const f=fixture();await flush();f.session(null);f.respond();await flush();assert.deepEqual(f.rows(),[]);assert.equal(f.storage.data.size,0);
});
test('permission rejection clears old data, and loss of sales view invalidates access scope',async()=>{
 const f=fixture();await flush();f.respond();await flush();f.refresh();await flush();f.reject('permission_denied');await flush();assert.deepEqual(f.rows(),[]);assert.equal(f.storage.data.size,0);
 f.session({...owner,permissions:{views:['orders'],ownOnly:false}});assert.deepEqual(f.rows(),[]);assert.match(f.nodes.salesTableBody.textContent,/로그인/);
});
test('assigned-only accounts never restore or persist sales data and react to assignment removal',async()=>{
 const storage=memory(),first=fixture({storage});await flush();first.respond();await flush();const scoped={...owner,role:'freelancer',permissions:{views:['sales'],ownOnly:true}},f=fixture({storage,session:scoped});
 assert.deepEqual(f.rows(),[]);await flush();f.respond();await flush();assert.deepEqual(f.rows(),[item.name]);f.assigned([]);assert.deepEqual(f.rows(),[]);assert.equal(storage.data.size,0);await flush();
 const fresh=fixture({session:scoped});await flush();fresh.respond();await flush();assert.equal(fresh.storage.data.size,0);
});
test('malformed, mismatched, expired, future and oversized cache fall back to authenticated reads',async()=>{
 const base=memory(),first=fixture({storage:base});await flush();first.respond();await flush();const [key,value]=[...base.data][0],good=JSON.parse(value);
 for(const raw of ['{',JSON.stringify({...good,scope:'other'}),JSON.stringify({...good,savedAt:good.savedAt-31*60000}),JSON.stringify({...good,savedAt:good.savedAt+60000}),JSON.stringify({...good,padding:'x'.repeat(270000)}),JSON.stringify({...good,snapshot:snapshot({returnMetric:{key:'unknown'}})}),JSON.stringify({...good,snapshot:snapshot({items:[{...item,share:'12'}]})})]){
  const storage=memory();storage.setItem(key,raw);const f=fixture({storage});assert.deepEqual(f.rows(),[]);await flush();assert.equal(f.requests.length,1);f.respond();await flush();
 }
});
test('storage failures do not block fresh data; cache strips unrelated fields and does not truncate rows',async()=>{
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}},f=fixture({storage:blocked});await flush();f.respond();await flush();assert.deepEqual(f.rows(),[item.name]);
 const normal=fixture();await flush();normal.respond(snapshot({secret:'OMIT',items:[{...item,photo:'OMIT'}]}));await flush();assert.equal([...normal.storage.data.values()][0].includes('OMIT'),false);
 normal.refresh();await flush();normal.respond(snapshot({items:Array.from({length:501},(_,i)=>({...item,rank:i+1,name:'상품 '+i}))}));await flush();assert.equal(normal.rows().length,501);assert.equal(normal.storage.data.size,0);
});
test('search keeps source ranks/metrics and return thresholds retain their existing meaning',async()=>{
 const f=fixture();await flush();f.respond(snapshot({items:[item,{...item,rank:2,name:'다른 상품',share:20,returns:19}]}));await flush();f.nodes.salesSearchInput.value='다른';f.nodes.salesSearchInput.dispatch('input');assert.deepEqual(f.rows(),['다른 상품']);
 f.nodes.salesSearchInput.value='CODE-002';f.nodes.salesSearchInput.dispatch('input');assert.deepEqual(f.rows(),[]);f.root.AiselWorkorderCodeForName=name=>name==='다른 상품'?'CODE-002':'';f.root.AiselSheetSalesSource.render();assert.deepEqual(f.rows(),['다른 상품']);
 const p=f.root.AiselSheetSalesView.performance;assert.equal(p({share:20,returns:19}).label,'리오더');assert.equal(p({share:20,returns:20}).label,'드랍');assert.equal(p({share:12,returns:5}).label,'보통');assert.equal(p({share:null,returns:null}),null);
});

