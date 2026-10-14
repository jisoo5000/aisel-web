'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto').webcrypto;
const T=require('../aisel-note-categories.js');
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),data};};
function fixture({disk=storage(),request}={}){
 let user={uid:'ownerA'},generation=1;const server=new Map();
 const send=request||(async(action,payload)=>{
  if(action==='noteCategories')return {noteCategoriesVersion:203,categories:[...server.values()]};
  assert.equal(action,'noteCategoryUpsert');const id=await T.idForName(payload.name,crypto);
  if(!server.has(id))server.set(id,{id,name:T.cleanName(payload.name),normalized:T.normalizeName(payload.name),createdAt:1});
  return {noteCategoriesVersion:203,category:server.get(id)};
 });
 const store=T.createStore({workspace:'aisel',getUser:()=>user,getGeneration:()=>generation,storage:disk,crypto,request:send});
 return {store,disk,server,switchUser(uid){user=uid?{uid}:null;generation++;store.refreshSession();}};
}
test('normalization provides deterministic duplicate identity across case, compatibility and whitespace',async()=>{
 assert.equal(T.normalizeName('  ＦＩＴ\n  디테일 '),'fit 디테일');
 assert.equal(await T.idForName('  ＦＩＴ\n  디테일 ',crypto),await T.idForName('fit 디테일',crypto));
 assert.throws(()=>T.cleanName(' '),{code:'category_name'});assert.throws(()=>T.cleanName('가'.repeat(41)),{code:'category_name'});
});
test('concurrent duplicate additions converge to one shared ID and preserve canonical spelling',async()=>{
 const f=fixture(),a=await f.store.add('소재'),b=await f.store.add('  소재  ');assert.equal(a.id,b.id);assert.equal(f.store.state().pending,1);
 await Promise.all([f.store.ensure(a.id),f.store.ensure(b.id)]);assert.equal(f.server.size,1);assert.equal(f.store.state().pending,0);
 await f.store.load();assert.equal(f.store.list().length,1);assert.equal(f.store.list()[0].pending,false);
 const other=T.createStore({workspace:'aisel',getUser:()=>({uid:'designerB'}),crypto,storage:storage(),request:async()=>({noteCategoriesVersion:203,categories:[...f.server.values()]})});
 await other.load();assert.deepEqual(other.list(),f.store.list());
});
test('offline additions survive reload, remain account/workspace scoped and reconcile without changing note IDs',async()=>{
 const disk=storage(),offline=async()=>{throw Error('offline');},f=fixture({disk,request:offline});const category=await f.store.add('핏');
 await assert.rejects(f.store.ensure(category.id),/offline/);assert.equal(f.store.state().pending,1);
 f.switchUser('ownerB');assert.equal(f.store.list().length,0);f.switchUser('ownerA');assert.equal(f.store.list()[0].id,category.id);
 const other=T.createStore({workspace:'another-workspace',getUser:()=>({uid:'ownerA'}),crypto,storage:disk,request:offline});assert.equal(other.list().length,0);
 const reloaded=fixture({disk});assert.equal(reloaded.store.list()[0].pending,true);await reloaded.store.flush();assert.equal(reloaded.store.list()[0].id,category.id);assert.equal(reloaded.store.state().pending,0);
 assert.equal(JSON.parse([...disk.data.values()][0]).pending.length,0);
});
test('old server capability or mismatched acknowledgment cannot clear pending classification',async()=>{
 const old=fixture({request:async()=>({categories:[]})}),category=await old.store.add('디테일');
 await assert.rejects(old.store.ensure(category.id),{code:'category_server_version'});assert.equal(old.store.state().pending,1);
 await assert.rejects(old.store.load(),{code:'category_server_version'});assert.equal(old.store.state().ready,false);
 const f=fixture({request:async()=>({noteCategoriesVersion:203,category:{id:'cat_'+'f'.repeat(64),name:'컬러',normalized:'컬러'}})}),value=await f.store.add('컬러');
 await assert.rejects(f.store.ensure(value.id),{code:'category_response'});assert.equal(f.store.state().pending,1);
});
test('switching accounts during network save leaves original pending draft and cannot leak response into new account',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=fixture({request:async()=>gate}),item=await f.store.add('촬영');const saving=f.store.ensure(item.id);
 f.switchUser('ownerB');release({noteCategoriesVersion:203,category:{...item,pending:false}});await assert.rejects(saving,{code:'auth_changed'});
 assert.equal(f.store.list().length,0);f.switchUser('ownerA');assert.equal(f.store.list()[0].id,item.id);assert.equal(f.store.list()[0].pending,true);
});
test('same-account session generation change invalidates catalog and rejects an older response',async()=>{
 let generation=1,release;const gate=new Promise(resolve=>release=resolve),disk=storage();
 const store=T.createStore({workspace:'aisel',getUser:()=>({uid:'ownerA'}),getGeneration:()=>generation,crypto,storage:disk,request:async()=>gate});
 const category=await store.add('소재'),loading=store.load();generation++;store.refreshSession();
 release({noteCategoriesVersion:203,categories:[category]});await assert.rejects(loading,{code:'auth_changed'});assert.equal(store.state().ready,false);assert.equal(store.list()[0].pending,true);
 const f=fixture();await f.store.add('핏');await f.store.flush();await f.store.load();assert.equal(f.store.state().ready,true);f.switchUser('ownerA');assert.equal(f.store.state().ready,false);assert.equal(f.store.list().length,0);
});
test('two browser tabs do not erase each other\'s unsent additions',async()=>{
 const disk=storage(),a=fixture({disk}),b=fixture({disk}),first=await a.store.add('소재'),second=await b.store.add('핏');
 a.store.refreshSession();assert.deepEqual(a.store.list().map(x=>x.id).sort(),[first.id,second.id].sort());
 await a.store.ensure(first.id);const saved=JSON.parse([...disk.data.values()][0]);assert.deepEqual(saved.pending.map(x=>x.id),[second.id]);
});
test('note classification filters use only category IDs and preserve old unclassified notes',async()=>{
 const id=await T.idForName('핏',crypto),notes={a:{text:'미분류'},b:{text:'핏 참고',categoryId:id},c:{categoryId:id}};
 assert.deepEqual(T.idsFromNotes(notes),[id]);assert.equal(T.matches(notes,id),true);assert.equal(T.matches(notes,''),true);assert.equal(T.matches([{text:'핏'}],id),false);
});
test('failure to persist a new category never claims it as available',async()=>{
 const f=fixture({disk:{getItem:()=>null,setItem:()=>{throw Error('full');}}});
 await assert.rejects(f.store.add('소재'),{code:'category_storage'});assert.equal(f.store.list().length,0);
});
