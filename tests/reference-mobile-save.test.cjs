const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const writerSource=fs.readFileSync(require.resolve('../aisel-collection-writes.js'),'utf8');
function setup(){
 const person={uid:'owner-test',email:'owner@example.test',emailVerified:true,getIdToken:async()=> 'test-token'};
 let rows={},mode='',writes=0,recordReads=0,sdkWrites=0;
 const app={name:'collections',options:{projectId:'aisel-workorder',databaseURL:'https://database.example.test'},auth:()=>({currentUser:person}),database:()=>({ref:()=>({update:()=>{sdkWrites++;throw Error('SDK must not queue writes');}})})};
 const window={addEventListener(){},AISEL_COLLECTION_WRITES_ENABLED:true,navigator:{onLine:true},AiselAuth:{currentUser:()=>person,generation:1},AiselGalleryIndex:{authorize:async()=>({uid:person.uid,role:'owner',email:person.email})},firebase:{apps:[app],database:{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}}};
 const response=(value,status=200)=>({status,ok:status===200,json:async()=>structuredClone(value)});
 const fetch=async(url,options)=>{
  if(url.includes('/writeConfig.json'))return response({enabled:true,referenceCanonicalReady:214,referenceWriteVersion:214,meetingWriteVersion:214});
  const id=url.match(/referenceRecords\/([^/.]+)\.json/)[1];
  if(options.method!=='PATCH'){recordReads++;return response(rows[id]||null);}
  writes++;
  if(mode==='hang')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))));
  if(mode==='denied')return response({},403);
  const patch=JSON.parse(options.body);
  if((rows[id]?.version||0)+1!==patch.version)return response({},403);
  rows[id]={...rows[id],...patch,committedAt:1234};
  if(mode==='lost-ack'){mode='';throw Error('response lost');}
  return response({...patch,committedAt:1234});
 };
 vm.runInNewContext(writerSource,{window,fetch,crypto:webcrypto,TextEncoder,AbortController,FormData,setTimeout:(fn,ms)=>setTimeout(fn,ms===12000?25:ms),clearTimeout});
 return {api:window.AiselCollectionWrites,rows,setMode:value=>mode=value,stats:()=>({writes,recordReads,sdkWrites})};
}
const id='ref_mobile_save_1234',initial={title:'모바일 저장',category:'product',categoryMode:'manual',sourceLinks:['https://example.test/reference'],photos:[],noteEntries:[]};
test('server PATCH acknowledges a create without a second record read or SDK queue',async()=>{
 const h=setup(),result=await h.api.saveReference({id,version:0,patch:initial});
 assert.equal(result.record.id,id);assert.equal(result.record.version,1);assert.equal(result.record.committedAt,1234);assert.equal(result.receipt.kind,'firebase-rest-ack');assert.deepEqual(h.stats(),{writes:1,recordReads:0,sdkWrites:0});
 h.rows[id].serverOwned='preserve';await h.api.saveReference({id,version:1,patch:{title:'제목 수정'}});assert.equal(h.rows[id].serverOwned,'preserve');assert.equal(h.rows[id].sourceUrl,initial.sourceLinks[0]);
});
test('lost acknowledgement confirms the same mutation without duplicate writes',async()=>{
 const h=setup();h.setMode('lost-ack');const result=await h.api.saveReference({id,version:0,patch:initial});assert.equal(result.record.version,1);assert.deepEqual(h.stats(),{writes:1,recordReads:1,sdkWrites:0});
 const retry=await h.api.saveReference({id,version:0,patch:initial});assert.equal(retry.record.version,1);assert.equal(Object.keys(h.rows).length,1);
});
test('stalled mobile write exits; retry saves the same ID',async()=>{
 const h=setup();h.setMode('hang');await assert.rejects(h.api.saveReference({id,version:0,patch:initial}),{code:'network'});assert.equal(Object.keys(h.rows).length,0);h.setMode('');assert.equal((await h.api.saveReference({id,version:0,patch:initial})).record.version,1);
});
test('stale edits and permission denial never report success',async()=>{
 const h=setup();await h.api.saveReference({id,version:0,patch:initial});h.rows[id].version=2;await assert.rejects(h.api.saveReference({id,version:1,patch:{title:'stale'}}),{code:'conflict'});assert.equal(h.rows[id].title,initial.title);
 const denied=setup();denied.setMode('denied');await assert.rejects(denied.api.saveReference({id,version:0,patch:initial}),{code:'permission_denied'});
});
const quickSource=fs.readFileSync(require.resolve('../reference-collection.js'),'utf8');
const localHelper=quickSource.slice(quickSource.indexOf('  async function quickLocal('),quickSource.indexOf('  async function quickPersist('));
test('stalled or failed device backup does not block server save flow',async()=>{
 const ctx={setTimeout:(fn)=>setTimeout(fn,10),clearTimeout};vm.createContext(ctx);vm.runInContext(localHelper+';this.quickLocal=quickLocal;',ctx);
 assert.equal(await ctx.quickLocal(Promise.resolve()),true);assert.equal(await ctx.quickLocal(Promise.reject(Error('storage unavailable'))),false);assert.equal(await ctx.quickLocal(new Promise(()=>{})),false);
});
