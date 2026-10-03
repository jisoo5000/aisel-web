/* AISEL status catalog v1. Internal work-order page only.
 * Reads original fields; writes only the whitelisted public catalog.
 * Raw manufacturing costs, images, notes and supplier information never enter it.
 */
(function(root){
  'use strict';
  const rules = typeof module === 'object' && module.exports
    ? require('./status-pricing-rules.js') : root.AiselStatusPricing;
  const PATH = 'workorderStatusCatalog';
  const FIELDS = ['status','updatedAt','createdAt','pumMyeong','factory','blend','selectedColors',
    'cat','lines','gongim','siyage','targetThreshold','priceConfirmed','priceSource','arrivedAt'];
  const ACTIVE = ['planned','order','pdp'];
  const DAY = 86400000;
  const text = (v,max=500)=>String(v==null?'':v).trim().slice(0,max);
  const number = v=>Number(v)||0;
  function comparable(value){
    if(value==null)return null;
    if(Array.isArray(value))return value.length?value.map(comparable):null;
    if(typeof value==='object'){
      const out={};Object.keys(value).sort().forEach(k=>{const v=comparable(value[k]);if(v!==null)out[k]=v;});
      return Object.keys(out).length?out:null;
    }
    return value;
  }
  function eligible(source,now=Date.now()){
    return !!source && (ACTIVE.includes(source.status) || source.status==='sale' &&
      number(source.updatedAt || source.createdAt)>0 && now-number(source.updatedAt||source.createdAt)<30*DAY);
  }
  function colorsFor(source,previousColors,lookup){
    const previous = new Map((Array.isArray(previousColors)?previousColors:[]).filter(c=>c&&typeof c.n==='string').map(c=>[c.n,c]));
    const names = (Array.isArray(source.selectedColors)?source.selectedColors:[])
      .map(c=>typeof c==='string'?text(c,80):c&&typeof c.n==='string'?text(c.n,80):'').filter(Boolean);
    return [...new Set(names)].slice(0,30).map(n=>{
      const info = typeof lookup==='function' ? lookup(n) : null;
      const old = previous.get(n), result={n};
      const h = info && info.hex || old && old.h;
      const t = info && info.text || old && old.t;
      if(/^#[a-f\d]{3,8}$/i.test(h||''))result.h=h;
      if(/^#[a-f\d]{3,8}$/i.test(t||''))result.t=t;
      return result;
    });
  }
  function buildEntry(code,source,previous,sharedColors,lookup,now=Date.now()){
    if(!eligible(source,now))return null;
    let decision=rules.derivePrice(code,source);
    if(source.status==='sale'){
      const prior=previous && ['ready','frozen'].includes(previous.priceState) && previous.salePrice;
      const saved=source.priceConfirmed && rules.parseNumber(source.targetThreshold);
      const price=prior || saved || null;
      // Completed products keep a valid established price, never acquire a new one here.
      decision=price && rules.isPriceAllowed(code,source,price)
        ? {salePrice:price,priceState:'frozen',ruleVersion:rules.RULE_VERSION}
        : {salePrice:null,priceState:decision.priceState==='cost_missing'?'cost_missing':'review',ruleVersion:rules.RULE_VERSION};
    }
    return {
      schemaVersion:1,status:text(source.status,20),pumMyeong:text(source.pumMyeong),
      factory:text(source.factory,160),blend:text(source.blend),
      colors:colorsFor(source,sharedColors || previous && previous.colors,lookup),
      salePrice:decision.salePrice,priceState:decision.priceState,ruleVersion:decision.ruleVersion,
      sourceUpdatedAt:number(source.updatedAt),createdAt:typeof source.createdAt==='number'?source.createdAt:text(source.createdAt,40),arrivedAt:text(source.arrivedAt,30)
    };
  }
  async function readSource(db,code){
    const base=db.ref('workorders').child(code);
    const first=await base.child('updatedAt').once('value');
    const values=await Promise.all(FIELDS.map(k=>base.child(k).once('value')));
    const source=Object.fromEntries(FIELDS.map((k,i)=>[k,values[i].val()]));
    const last=await base.child('updatedAt').once('value');
    if(number(first.val())!==number(last.val()) || number(source.updatedAt)!==number(last.val()))return {retry:true};
    return {source};
  }
  function start(db,options={}){
    if(!rules)throw new Error('Status pricing rules are unavailable');
    const watched=new Map();
    const queue=[];let busy=0,stopped=false;
    const warn=options.onError || ((code)=>console.warn('제품 진행 현황 연동 재시도 필요',code));
    const lookup=options.colorLookup;
    function enqueue(code){
      const item=watched.get(code);
      if(!item || stopped)return;
      item.dirty=true;
      if(item.queued || item.running)return;
      item.queued=true;queue.push([code,item]);pump();
    }
    function pump(){
      while(busy<3 && queue.length && !stopped){
        const [code,item]=queue.shift();item.queued=false;
        if(watched.get(code)!==item)continue;
        busy++;item.running=true;item.dirty=false;
        synchronize(code,item).catch(()=>{
          warn(code);
          clearTimeout(item.retryTimer);
          item.retryTimer=setTimeout(()=>enqueue(code),15000);
        }).finally(()=>{
          busy--;item.running=false;
          if(item.dirty)enqueue(code);
          pump();
        });
      }
    }
    async function synchronize(code,item){
      const result=await readSource(db,code);
      if(stopped || watched.get(code)!==item)return;
      if(result.retry){item.dirty=true;return;}
      const source=result.source;
      if(!source.status){
        // A deleted original may briefly leave its old index entry behind.
        const stillMissing=await db.ref('workorders').child(code).child('status').once('value');
        if(!stillMissing.val() && !stopped && watched.get(code)===item){
          await db.ref(PATH).child(code).transaction(current=>{
            if(stopped || watched.get(code)!==item || item.dirty)return;
            return current===null?undefined:null;
          },undefined,false);
        }
        return;
      }
      const shared=(await db.ref('workorderShare').child(code).child('colors').once('value')).val();
      // Recheck after the last asynchronous lookup. Save versions fence concurrent editors.
      const fresh=await db.ref('workorders').child(code).child('updatedAt').once('value');
      if(number(fresh.val())!==number(source.updatedAt)){item.dirty=true;return;}
      if(stopped || watched.get(code)!==item)return;
      await db.ref(PATH).child(code).transaction(current=>{
        if(stopped || watched.get(code)!==item)return;
        if(current && number(current.sourceUpdatedAt)>number(source.updatedAt))return;
        const next=buildEntry(code,source,current,shared,lookup);
        if(JSON.stringify(comparable(current))===JSON.stringify(comparable(next)))return;
        return next;
      },undefined,false);
    }
    function watch(snapshot){
      if(stopped)return;
      const code=snapshot.key,index=snapshot.val();
      if(!code)return;
      if(!index || !eligible(index)){unwatch(code,true);return;}
      if(watched.has(code)){enqueue(code);return;}
      const item={refs:[],dirty:false,queued:false,running:false,retryTimer:null};
      watched.set(code,item);
      // Index updates can omit cost-only edits: original save version is authoritative.
      ['updatedAt','status'].forEach(k=>{
        const ref=db.ref('workorders').child(code).child(k),fn=()=>enqueue(code);
        ref.on('value',fn,()=>warn(code));item.refs.push([ref,fn]);
      });
      enqueue(code);
    }
    function unwatch(code,remove){
      const item=watched.get(code);
      if(item){item.refs.forEach(([ref,fn])=>ref.off('value',fn));clearTimeout(item.retryTimer);watched.delete(code);}
      if(remove && !stopped){
        db.ref(PATH).child(code).transaction(current=>{
          if(stopped || watched.has(code))return;
          return current===null?undefined:null;
        },undefined,false).catch(()=>warn(code));
      }
    }
    const index=db.ref('workorderIndex');
    const removed=snap=>unwatch(snap.key,true);
    index.on('child_added',watch,()=>warn('목록'));
    index.on('child_changed',watch,()=>warn('목록'));
    index.on('child_removed',removed,()=>warn('목록'));
    async function reconcile(){
      const snapshot=await index.once('value');
      if(stopped)return;
      snapshot.forEach(watch);
      const current=(await db.ref(PATH).once('value')).val()||{};
      for(const code of Object.keys(current)){
        if(stopped)return;
        if(watched.has(code))continue;
        const fresh=await index.child(code).once('value');
        if(fresh.val() && eligible(fresh.val())){watch(fresh);continue;}
        if(!watched.has(code))unwatch(code,true);
      }
    }
    reconcile().catch(()=>warn('초기 목록'));
    const cleanupTimer=setInterval(()=>{
      // Re-evaluate 30-day retention without reading original pictures.
      reconcile().catch(()=>warn('목록'));
    },60*60*1000);
    return {stop(){stopped=true;clearInterval(cleanupTimer);index.off('child_added',watch);index.off('child_changed',watch);index.off('child_removed',removed);[...watched.keys()].forEach(c=>unwatch(c,false));}};
  }
  const api={PATH,FIELDS,eligible,colorsFor,buildEntry,readSource,start};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.AiselStatusCatalog=api;
  if(typeof window!=='undefined' && root.firebase && rules){
    root.aiselStatusCatalogBridge=api.start(root.firebase.database(),{colorLookup:n=>root.colorHex_?root.colorHex_(n):null});
  }
})(typeof globalThis!=='undefined'?globalThis:this);

