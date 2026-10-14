'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),crypto=require('node:crypto').webcrypto;
const T=require('../aisel-note-categories.js');
let sequence=0;
function pickerFixture({cryptoObject=crypto,storage,context}={}){
 const dom=new JSDOM('<div id="host"></div>'),document=dom.window.document,host=document.getElementById('host'),pending=new Map(),changes=[],errors=[];
 const account=context||{uid:'owner',generation:1};
 T.configure({workspace:'picker-test-'+(++sequence),getUser:()=>({uid:account.uid}),getGeneration:()=>account.generation,crypto:cryptoObject,
  storage:storage||{getItem:key=>pending.get(key)||null,setItem:(key,value)=>pending.set(key,value)},
  request:async action=>action==='noteCategories'?{noteCategoriesVersion:203,categories:[]}:new Promise(()=>{})});
 const picker=T.mountPicker(host,{onChange:id=>changes.push(id),onError:error=>errors.push(error)}),select=host.querySelector('select'),input=host.querySelector('input');
 select.value='__add_note_category__';select.dispatchEvent(new dom.window.Event('change'));
 return {dom,host,picker,select,input,changes,errors,account};
}
function delayedCrypto(){let release,started;const gate=new Promise(resolve=>release=resolve),begin=new Promise(resolve=>started=resolve);return {release,begin,crypto:{subtle:{digest:async(...args)=>{started();await gate;return crypto.subtle.digest(...args);}}}};}
test('navigation flush waits for an already-started blur commit but not the server acknowledgment',async()=>{
 const delay=delayedCrypto(),f=pickerFixture({cryptoObject:delay.crypto});f.input.value='소재';f.input.blur();await delay.begin;
 let finished=false;const flush=f.picker.flush().then(result=>{finished=true;return result;});await Promise.resolve();assert.equal(finished,false);assert.equal(f.changes.length,0);assert.equal(f.picker.hasDraft(),true);
 delay.release();assert.equal(await flush,true);assert.equal(f.changes.length,1);assert.equal(f.picker.hasDraft(),false);assert.equal(f.picker.isComposing(),false);assert.equal(f.input.hidden,true);f.picker.destroy();
});
test('navigation is held while composing Korean and commits only the completed name',async()=>{
 const f=pickerFixture();f.input.value='소';f.input.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart'));
 assert.equal(await f.picker.flush(),false);assert.equal(f.changes.length,0);assert.equal(f.picker.isComposing(),true);
 f.input.value='소재';f.input.dispatchEvent(new f.dom.window.CompositionEvent('compositionend'));assert.equal(await f.picker.flush(),true);assert.equal(f.changes.length,1);f.picker.destroy();
});
test('failed local persistence keeps the inline name and blocks navigation',async()=>{
 const f=pickerFixture({storage:{getItem:()=>null,setItem:()=>{throw Error('full');}}});f.input.value='소재';
 assert.equal(await f.picker.flush(),false);assert.equal(f.input.value,'소재');assert.equal(f.input.hidden,false);assert.equal(f.changes.length,0);assert.equal(f.picker.hasDraft(),true);assert.equal(f.errors.at(-1).code,'category_storage');f.picker.destroy();
});
test('new input during hash completion is not cleared or applied as an obsolete selection',async()=>{
 const delay=delayedCrypto(),f=pickerFixture({cryptoObject:delay.crypto});f.input.value='소';const first=f.picker.flush();await delay.begin;
 f.input.value='소재';f.input.dispatchEvent(new f.dom.window.Event('input'));delay.release();assert.equal(await first,false);assert.equal(f.input.value,'소재');assert.equal(f.changes.length,0);
 assert.equal(await f.picker.flush(),true);assert.equal(f.changes[0],await T.idForName('소재',crypto));f.picker.destroy();
});
test('destroyed or changed-account picker cannot apply a late category commit to another note',async()=>{
 const delay=delayedCrypto(),f=pickerFixture({cryptoObject:delay.crypto});f.input.value='소재';const saving=f.picker.flush();await delay.begin;f.picker.destroy();delay.release();assert.equal(await saving,false);assert.equal(f.changes.length,0);
 const nextDelay=delayedCrypto(),account={uid:'owner',generation:1},g=pickerFixture({cryptoObject:nextDelay.crypto,context:account});g.input.value='핏';const next=g.picker.flush();await nextDelay.begin;account.generation++;nextDelay.release();assert.equal(await next,false);assert.equal(g.changes.length,0);assert.equal(g.input.value,'핏');g.picker.destroy();
});
