/* Canonical Firebase collection writes. A local echo is never a save receipt.
 * Existing records use atomic field updates guarded by server version rules.
 * Sheets, judgment and Drive copies are outside the user save acknowledgement. */
(function () {
  'use strict';
  const enabled = window.AISEL_COLLECTION_WRITES_ENABLED === true;
  const ROOT = 'aiselGallery/v1', VERSION = 214;
  const ENDPOINT = 'https://asia-southeast1-aisel-workorder.cloudfunctions.net/collectionsV214';
  const EDITABLE = new Set(['title','designer','date','category','categoryMode','contentType','sourceLinks','sourceUrl','photos','noteEntries','notes']);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const fail = (code, message) => Object.assign(Error(message || ({permission_denied:'이 자료의 저장 권한을 확인해주세요.',auth_changed:'로그인 계정이 변경되었습니다. 입력은 기기에 보관됩니다.',offline:'인터넷 연결 후 다시 저장해주세요. 입력은 기기에 보관됩니다.',conflict:'다른 곳에서 변경된 내용을 확인하고 있습니다.',connection_pending:'저장 연결을 확인하지 못했습니다. 입력은 기기에 보관됩니다.',network:'저장 확인이 지연되고 있습니다. 입력은 기기에 보관됩니다.',not_found:'자료를 찾을 수 없습니다.'}[code] || code)), {code});
  const current = () => window.AiselAuth?.currentUser?.();
  function stable(value) { if (Array.isArray(value)) return value.map(stable); if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])); return value; }
  const list = value => value == null ? [] : Array.isArray(value) ? value : Object.keys(value).sort((a,b)=>Number(a)-Number(b)).map(key=>value[key]);
  let configCache = null;
  // Only canonical reads and completed SDK writes enter this session-local cache.
  // The server version rule, not this cache, decides whether the next edit wins.
  const confirmed = new Map(), CONFIRMED_LIMIT = 64;
  const confirmedKey = (id,ctx) => [ctx.uid,ctx.email,ctx.generation,id].join('|');
  function remember(raw,id,ctx) {
    assert(ctx);const key=confirmedKey(id,ctx),prior=confirmed.get(key);
    if(prior&&prior.version>raw.version)return;
    confirmed.delete(key);confirmed.set(key,clone(raw));
    while(confirmed.size>CONFIRMED_LIMIT)confirmed.delete(confirmed.keys().next().value);
  }
  async function normalizeReference(raw,id,ctx) {
    const value=await verifiedRecord(raw,id,ctx);assert(ctx);remember(raw,id,ctx);return value;
  }
  function assert(ctx) {
    const user=current();
    if(!user?.emailVerified||user.uid!==ctx.uid||String(user.email||'').toLowerCase()!==ctx.email||window.AiselAuth?.generation!==ctx.generation)throw fail('auth_changed');
    if(window.navigator?.onLine===false)throw fail('offline');
  }
  async function context(kind) {
    if(!enabled)throw fail('connection_pending');
    if(!['references','meetings'].includes(kind))throw fail('invalid');
    const user=current(),generation=window.AiselAuth?.generation;
    if(!user?.uid||!user.emailVerified)throw fail('permission_denied');
    if(window.navigator?.onLine===false)throw fail('offline');
    const grant=await window.AiselGalleryIndex.authorize(kind);
    const app=(window.firebase?.apps||[]).find(candidate=>{
      try{return candidate.name!=='[DEFAULT]'&&candidate.auth().currentUser?.uid===user.uid&&candidate.options.projectId==='aisel-workorder';}catch(_){return false;}
    });
    if(!app||grant.uid!==user.uid)throw fail('auth_changed');
    const ctx={...grant,uid:user.uid,email:String(user.email||'').toLowerCase(),generation,app};assert(ctx);
    const key=ctx.uid+'|'+ctx.generation;
    let config=configCache?.key===key&&Date.now()-configCache.at<30000?configCache.value:null;
    if(!config){config=await read('writeConfig',ctx);assert(ctx);configCache={key,at:Date.now(),value:config};}
    if(config?.enabled!==true||config.referenceCanonicalReady!==VERSION||config.referenceWriteVersion!==VERSION||config.meetingWriteVersion!==VERSION)throw fail('connection_pending');
    return {...ctx,config};
  }
  async function authorize(kind) {const ctx=await context(kind);return {...ctx,app:undefined,config:undefined,permissions:{...ctx.permissions,referenceWriteVersion:VERSION,meetingWriteVersion:VERSION}};}
  async function read(path,ctx,query='') {
    assert(ctx);const token=await current().getIdToken();assert(ctx);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(ctx.app.options.databaseURL.replace(/\/$/,'')+'/'+ROOT+'/'+path+'.json?auth='+encodeURIComponent(token)+query,{cache:'no-store',credentials:'omit',signal:controller.signal,headers:{Accept:'application/json'}});
      assert(ctx);if([401,403].includes(response.status))throw fail('permission_denied');if(!response.ok)throw fail('network');const value=await response.json();assert(ctx);return value;
    }catch(error){if(error.code)throw error;throw fail('network');}finally{clearTimeout(timer);}
  }
  function record(raw,id,ctx) {
    if(!raw||raw.id!==id||raw.writeProtocolVersion!==VERSION||!Number.isSafeInteger(raw.version)||raw.version<1||!Number.isFinite(Date.parse(raw.updatedAt)))throw fail(raw?'invalid':'not_found');
    if(raw.archivedAt&&ctx.role!=='owner')throw fail('permission_denied');
    const value={...clone(raw),photos:list(raw.photos),sourceLinks:list(raw.sourceLinks),noteEntries:list(raw.noteEntries)};
    for(const key of ['title','designer','date','notes','sourceUrl','contentType','archivedAt','reviewedAt','analysisReceipt'])value[key]??='';
    value.analysis??=null;value.categoryMode||='auto';
    value.categoryIds=[...new Set(value.noteEntries.map(note=>note.categoryId).filter(Boolean))];value.noteCategoryIds=value.categoryIds;value.noteCategoryCoverage=true;
    value.thumbnail=value.photos[0]?.thumb||'';value.detailUrl='https://jisoo5000.github.io/aisel-web/work-order-5aa994e7.html#reference='+encodeURIComponent(id);
    value.permissions={canEdit:ctx.role==='owner'||String(value.creator||'').toLowerCase()===ctx.email,canArchive:ctx.role==='owner'};
    return value;
  }
  async function verifiedRecord(raw,id,ctx) {
    const value=record(raw,id,ctx),signature=await digest(source(value));
    assert(ctx);
    if(!(value.analysisState==='done'&&value.analysisReceipt&&value.reviewedAt&&value.analysis?.id===id&&value.analysis.inputHash===signature&&value.analysisSignature===signature))value.analysis=null;
    else if(value.categoryMode==='auto'&&['content','product'].includes(value.analysis.category))value.category=value.analysis.category;
    return value;
  }
  function idCheck(id) {if(!/^ref_[-\w]{8,96}$/.test(id||''))throw fail('invalid','레퍼런스 기록을 확인해주세요.');}
  async function getReference(id) {idCheck(id);const ctx=await context('references');return {ok:true,record:await normalizeReference(await read('referenceRecords/'+id,ctx),id,ctx)};}
  async function listReferences(options={}) {
    const ctx=await context('references');if(options.archived&&ctx.role!=='owner')throw fail('permission_denied');
    const query=options.archived?'':'&orderBy='+encodeURIComponent(JSON.stringify('archivedAt'))+'&equalTo='+encodeURIComponent(JSON.stringify(''));
    const values=await read('referenceRecords',ctx,query);assert(ctx);
    const items=(await Promise.all(Object.entries(values||{}).map(([id,value])=>normalizeReference(value,id,ctx)))).filter(value=>!!value.archivedAt===!!options.archived&&(!options.category||value.category===options.category)&&(!options.updatedSince||value.updatedAt>options.updatedSince)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||b.id.localeCompare(a.id));
    assert(ctx);
    return {ok:true,items,nextCursor:null,checkedAt:new Date().toISOString()};
  }
  async function digest(value) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function source(value) {const item={id:value.id,sourceUrl:value.sourceUrl||'',photos:list(value.photos).map(photo=>photo.hash)};if(list(value.sourceLinks).length>1)item.sourceLinks=list(value.sourceLinks);return JSON.stringify(item);}
  function checkedPatch(input,old) {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!EDITABLE.has(key)))throw fail('invalid','변경할 내용을 확인해주세요.');
    const patch=clone(input);
    if(patch.sourceLinks){if(!Array.isArray(patch.sourceLinks)||patch.sourceLinks.length>12)throw fail('invalid');patch.sourceUrl=patch.sourceLinks[0]||'';}
    if(patch.noteEntries){if(!Array.isArray(patch.noteEntries)||patch.noteEntries.length>30)throw fail('invalid');patch.notes=patch.noteEntries.map(note=>'['+note.date+'] '+note.text).join('\n\n');}
    if(patch.photos){if(!Array.isArray(patch.photos)||patch.photos.length>12)throw fail('invalid');patch.photos=patch.photos.map(photo=>Object.fromEntries(['hash','original','thumb','width','height','bytes','thumbBytes'].filter(key=>photo[key]!==undefined).map(key=>[key,photo[key]])));}
    if(patch.category==='product')patch.contentType='';
    if(patch.sourceUrl!==undefined&&!Object.prototype.hasOwnProperty.call(patch,'sourceLinks')&&old?.sourceLinks?.length&&patch.sourceUrl!==old.sourceUrl){patch.sourceLinks=patch.sourceUrl?[patch.sourceUrl,...old.sourceLinks.slice(1).filter(link=>link!==patch.sourceUrl)]:old.sourceLinks.slice(1);patch.sourceUrl=patch.sourceLinks[0]||'';}
    return patch;
  }
  async function writeReference({id,version,patch,archived},archive=false) {
    idCheck(id);if(!Number.isSafeInteger(version)||version<0)throw fail('invalid');
    const ctx=await context('references'),path='referenceRecords/'+id;
    if(archive&&ctx.role!=='owner')throw fail('permission_denied');
    const key=confirmedKey(id,ctx),known=confirmed.get(key);
    // Opening a record already fetched this exact base. Reusing it saves a REST
    // round trip; atomic version rules still reject remote edits or deletion.
    const initial=!archive&&known?.version===version?clone(known):!archive&&version===0?null:await read(path,ctx);assert(ctx);
    if(initial&&initial.writeProtocolVersion!==VERSION)throw fail('connection_pending');
    if(initial&&ctx.role!=='owner'&&String(initial.creator||'').toLowerCase()!==ctx.email)throw fail('permission_denied');
    if(archive&&(!initial||typeof archived!=='boolean'))throw fail('invalid');
    const clean=archive?null:checkedPatch(patch,initial);
    const mutationId='save_'+await digest(JSON.stringify(stable({id,version,change:archive?{archived}:clean})));assert(ctx);
    if(initial?.lastMutationId===mutationId&&initial.version>version)return {ok:true,record:await normalizeReference(initial,id,ctx)};
    if((initial?.version||0)!==version)throw fail('conflict');
    if(initial?.archivedAt&&!archive)throw fail('archived','보관함에서 자료를 복원한 뒤 수정해주세요.');
    if(archive&&!!initial.archivedAt===archived)return {ok:true,record:await normalizeReference(initial,id,ctx)};
    const at=new Date(Math.max(Date.now(),Date.parse(initial?.updatedAt||'')+1||0)).toISOString();
    const base=initial||{id,writeProtocolVersion:VERSION,creator:ctx.email,createdAt:at,archivedAt:'',title:'',designer:'',date:'',category:'product',categoryMode:'auto',contentType:'',sourceUrl:'',sourceLinks:[],photos:[],noteEntries:[],notes:'',analysisSignature:'',analysisState:'idle',reviewedAt:'',analysisReceipt:''};
    const changes=archive?{archivedAt:archived?at:''}:clean;
    const desired={...clone(base),...changes};
    const outgoing=initial?{...changes}:{...desired};
    if(!initial||source(base)!==source(desired))Object.assign(outgoing,{analysisSignature:await digest(source(desired)),analysisState:'queued',analysis:null,reviewedAt:'',analysisReceipt:''});
    assert(ctx);Object.assign(outgoing,{version:version+1,updatedAt:at,committedAt:window.firebase.database.ServerValue.TIMESTAMP,lastMutationId:mutationId});
    try{await ctx.app.database().ref(ROOT+'/'+path).update(outgoing);assert(ctx);}
    catch(error){
      assert(ctx);
      confirmed.delete(key);
      if(/permission[_-]denied/i.test(error.code||error.message||'')){
        const latestCtx=await context('references'),latest=await read(path,latestCtx);assert(ctx);
        if(latest?.lastMutationId===mutationId&&latest.version>version)return {ok:true,record:await normalizeReference(latest,id,latestCtx)};
        if((latest?.version||0)!==version)throw fail('conflict');
        throw fail('permission_denied');
      }
      throw fail('network');
    }
    // Firebase update() resolves only after the server commits the write. A
    // second download is not another commit receipt and must not delay save UI.
    // Do not invent the resolved ServerValue timestamp: the next canonical read
    // supplies committedAt; this response explicitly identifies its SDK ACK.
    const saved={...clone(base),...clone(outgoing)};delete saved.committedAt;
    const value=await verifiedRecord(saved,id,ctx);assert(ctx);remember(saved,id,ctx);
    return {ok:true,record:value,receipt:{kind:'firebase-sdk-ack',version:version+1,mutationId}};
  }
  const saveReference=options=>writeReference(options);
  const archiveReference=options=>writeReference(options,true);
  function meetingId(id) {if(typeof id!=='string'||!/^[-A-Za-z0-9_]{8,100}$/.test(id))throw fail('invalid','디자인회의 자료를 확인해주세요.');}
  async function meetingContext() {const ctx=await context('meetings');if(!['owner','designer'].includes(ctx.role))throw fail('permission_denied');return ctx;}
  function meetingRecord(value,id) {
    if(value!==null&&(!value||Array.isArray(value)||value.id!==id||value.designMeeting!==true))throw fail('invalid','디자인회의 자료를 확인해주세요.');
    return clone(value);
  }
  // REST detail reads do not warm the SDK transaction cache. Use the same
  // authenticated account for a server ETag and conditional write instead of
  // treating an initial SDK null as a missing record or seeding it from UI data.
  async function meetingRequest(id,ctx,method='GET',body,etag) {
    assert(ctx);const token=await current().getIdToken();assert(ctx);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(ctx.app.options.databaseURL.replace(/\/$/,'')+'/moodboardRefs/'+encodeURIComponent(id)+'.json?auth='+encodeURIComponent(token),{
        method,cache:'no-store',credentials:'omit',signal:controller.signal,
        headers:{Accept:'application/json',...(method==='GET'?{'X-Firebase-ETag':'true'}:{'Content-Type':'application/json','If-Match':etag})},
        ...(method==='GET'?{}:{body})
      });
      assert(ctx);if([401,403].includes(response.status))throw fail('permission_denied');
      if(response.status===412)return {conflict:true};
      if(!response.ok)throw fail('network');
      const value=await response.json();assert(ctx);
      const record=meetingRecord(value,id);if(method==='PUT'&&record===null)throw fail('network');
      return {value:record,etag:response.headers?.get('etag')||''};
    }catch(error){assert(ctx);if(['permission_denied','invalid','auth_changed','offline','network'].includes(error.code))throw error;throw fail('network');}finally{clearTimeout(timer);}
  }
  async function getMeeting(id) {meetingId(id);const ctx=await meetingContext();return (await meetingRequest(id,ctx)).value;}
  const meetingReceipt=(committed,value)=>{const saved=clone(value);return {committed,snapshot:{val:()=>clone(saved)}};};
  async function mutateMeeting(id,transform,options={}) {
    meetingId(id);if(typeof transform!=='function')throw fail('invalid');
    const ctx=await meetingContext();let observedExisting=false;
    for(let attempt=0;attempt<5;attempt++){
      const before=await meetingRequest(id,ctx);assert(ctx);
      if(before.value===null&&(options.allowCreate!==true||observedExisting))throw fail('not_found');
      observedExisting=observedExisting||before.value!==null;
      const proposed=transform(clone(before.value));assert(ctx);
      if(proposed===undefined)return meetingReceipt(false,before.value);
      // Deletion is an explicit tombstone handled by the caller, never a null
      // PUT. Existing server-owned fields must survive the caller's merge.
      if(!proposed||typeof proposed!=='object'||Array.isArray(proposed)||typeof proposed.then==='function')throw fail('invalid');
      const next=meetingRecord(proposed,id),body=JSON.stringify(next),signature=JSON.stringify(stable(next));
      if(signature===JSON.stringify(stable(before.value)))return meetingReceipt(true,before.value);
      if(!before.etag)throw fail('network');
      let result;
      try{result=await meetingRequest(id,ctx,'PUT',body,before.etag);}
      catch(error){
        assert(ctx);if(error.code!=='network')throw error;
        // A timeout may follow a committed PUT. Only an exact canonical
        // readback acknowledges it; an unknown outcome never starts a new PUT.
        const proof=await meetingRequest(id,ctx);assert(ctx);
        if(JSON.stringify(stable(proof.value))===signature)return meetingReceipt(true,proof.value);
        throw fail('network');
      }
      if(result.conflict)continue;
      return meetingReceipt(true,result.value);
    }
    throw fail('conflict','다른 곳에서 계속 수정 중입니다. 입력은 기기에 유지했습니다. 잠시 후 다시 저장해주세요.');
  }
  // Conversion uses the same verified Firebase identity as detail saves. The
  // default SDK app can be signed out even while AiselAuth is authenticated.
  // Every write remains subject to the deployed RTDB rules; no admin endpoint.
  async function conversionStore() {
    const ctx=await meetingContext();if(ctx.role!=='owner')throw fail('permission_denied');
    const codeCheck=code=>{if(!/^AS-[A-Za-z0-9]+-[A-Za-z0-9]+-[0-9]+$/.test(code||''))throw fail('invalid');};
    // RTDB removes null/empty objects and arrays. Compare the stored shape,
    // otherwise an empty selectedColors array makes a real ACK look like loss.
    const stored=value=>{
      if(value==null)return null;
      if(Array.isArray(value)){const out=value.map(stored);return out.some(item=>item!==null)?out:null;}
      if(typeof value==='object'){const out=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,stored(item)]).filter(([,item])=>item!==null));return Object.keys(out).length?out:null;}
      return value;
    };
    const signatureOf=value=>JSON.stringify(stable(stored(value)));
    const requestFailure=(code,status)=>Object.assign(fail(code,{
      invalid_request:'작업지시서 연결 요청에 오류가 있습니다. 입력은 유지됩니다.',
      request_failed:'작업지시서 연결 요청을 처리하지 못했습니다. 입력은 유지됩니다.',
      rate_limited:'요청이 많습니다. 잠시 후 같은 후보에서 다시 시도해주세요.',
      server_unavailable:'저장 서버가 응답하지 못했습니다. 잠시 후 같은 후보에서 다시 시도해주세요.',
      timeout:'저장 확인 시간이 초과됐습니다. 같은 후보에서 다시 시도해주세요.',
      invalid_response:'저장 응답을 확인하지 못했습니다. 같은 후보에서 다시 시도해주세요.',
      network:'연결이 끊겨 저장 결과를 확인하지 못했습니다. 같은 후보에서 다시 시도해주세요.'
    }[code]),Number.isInteger(status)?{httpStatus:status}:{});
    async function request(path,method='GET',value,etag,query='',withEtag=false) {
      assert(ctx);const token=await current().getIdToken();assert(ctx);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
      try {
        // Only transaction reads need ETags. RTDB does not support them on
        // shallow/filtered queries, including the existing-code lookup.
        const response=await fetch(ctx.app.options.databaseURL.replace(/\/$/,'')+'/'+path+'.json?auth='+encodeURIComponent(token)+query,{
          method,cache:'no-store',credentials:'omit',signal:controller.signal,
          headers:{Accept:'application/json',...(method==='GET'?(withEtag?{'X-Firebase-ETag':'true'}:{}):{'Content-Type':'application/json','If-Match':etag})},
          ...(method==='GET'?{}:{body:JSON.stringify(value)})
        });
        assert(ctx);if([401,403].includes(response.status))throw requestFailure('permission_denied',response.status);
        if(response.status===412&&method!=='GET')return {conflict:true};
        if(!response.ok)throw requestFailure(response.status===400?'invalid_request':response.status===404?'not_found':response.status===429?'rate_limited':response.status>=500?'server_unavailable':'request_failed',response.status);
        let result;try{result=await response.json();}catch(error){if(controller.signal.aborted)throw error;throw requestFailure('invalid_response',response.status);}
        assert(ctx);return {value:result,etag:response.headers?.get('etag')||''};
      } catch(error) {assert(ctx);if(controller.signal.aborted)throw requestFailure('timeout');if(error.code)throw error;throw requestFailure('network');} finally {clearTimeout(timer);}
    }
    async function transaction(path,transform) {
      for(let attempt=0;attempt<5;attempt++){
        const before=await request(path,'GET',undefined,undefined,'',true);assert(ctx);const next=transform(clone(before.value));
        if(next===undefined)return meetingReceipt(false,before.value);
        if(next===null||typeof next?.then==='function')throw fail('invalid');
        const signature=signatureOf(next);
        if(signature===signatureOf(before.value))return meetingReceipt(true,before.value);
        if(!before.etag)throw requestFailure('invalid_response');
        let result;
        try {result=await request(path,'PUT',next,before.etag);}
        catch(error){
          if(!['network','timeout','server_unavailable','invalid_response'].includes(error.code))throw error;
          // A lost response may hide a successful PUT. Never replay the write
          // until an exact canonical read proves the outcome.
          let proof;try{proof=await request(path);}catch(_){assert(ctx);throw error;}
          if(signatureOf(proof.value)===signature)return meetingReceipt(true,proof.value);
          throw error;
        }
        if(result.conflict)continue;return meetingReceipt(true,result.value);
      }
      throw fail('conflict');
    }
    async function ensureWorkorderActive(code){
      codeCheck(code);
      const query='&orderBy='+encodeURIComponent(JSON.stringify('code'))+'&equalTo='+encodeURIComponent(JSON.stringify(code))+'&limitToFirst=2';
      const archived=(await request('workorderTrashIndex','GET',undefined,undefined,query)).value||{};
      if(Object.values(archived).some(item=>item?.code===code&&item.phase!=='restored'))throw fail('archived','삭제한 작업지시서입니다. 작업지시서의 삭제 복원에서 원본을 복원한 뒤 다시 연결해주세요.');
    }
    return Object.freeze({
      ensureWorkorderActive,
      creator:Object.freeze({uid:ctx.uid,name:String(current().displayName||current().email||'')}),
      assert:()=>assert(ctx),
      getWorkorder:async code=>{codeCheck(code);return (await request('workorders/'+code)).value;},
      indexKeys:async()=>Object.keys((await request('workorderIndex','GET',undefined,undefined,'&shallow=true')).value||{}),
      listDeletedMeetings:async()=>{
        const query='&orderBy='+encodeURIComponent(JSON.stringify('designMeetingDeletedAt'))+'&startAt=1&limitToFirst=101';
        const raw=(await request('moodboardRefs','GET',undefined,undefined,query)).value||{};
        const entries=Object.entries(raw),records=entries.filter(([id,value])=>value?.id===id&&value.designMeeting===true&&Number(value.designMeetingDeletedAt)>0)
          .map(([,value])=>clone(value)).sort((a,b)=>Number(a.designMeetingDeletedAt)-Number(b.designMeetingDeletedAt)||a.id.localeCompare(b.id));
        return {records:records.slice(0,100),hasMore:entries.length>100};
      },
      reserveSequence:async(key,min)=>{
        if(!/^[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(key)||!Number.isSafeInteger(min)||min<0)throw fail('invalid');
        const out=await transaction('designMeetingCodeCounters/'+key,value=>Math.max(Number(value)||0,min)+1);
        return out.snapshot.val();
      },
      createWorkorder:async(code,value)=>{codeCheck(code);if(!value?.designMeetingCandidateId)throw fail('invalid');await ensureWorkorderActive(code);return transaction('workorders/'+code,old=>old===null?value:undefined);},
      syncIndex:async(code,entry)=>{
        codeCheck(code);if(!entry||typeof entry!=='object'||Array.isArray(entry))throw fail('invalid');
        const out=await transaction('workorderIndex/'+code,old=>Number(old?.updatedAt)>Number(entry.updatedAt)?undefined:{...old,...clone(entry)});
        const proof=(await request('workorderIndex/'+code)).value;
        if(!out.committed||!proof||Object.entries(entry).some(([key,value])=>signatureOf(proof[key])!==signatureOf(value)))throw fail('conflict','목록이 변경되었습니다. 같은 품번으로 다시 연결해주세요.');
        return proof;
      }
    });
  }
  async function listDeletedMeetings(){return (await conversionStore()).listDeletedMeetings();}
  async function functionRequest(ctx,body) {
    assert(ctx);if(ctx.config.mediaEndpoint!==ENDPOINT)throw fail('connection_pending');
    const token=await current().getIdToken();assert(ctx);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),150000);
    try{
      const form=typeof FormData!=='undefined'&&body instanceof FormData;
      const response=await fetch(ENDPOINT,{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(form?{}:{'Content-Type':'application/json'})},body:form?body:JSON.stringify(body)});
      assert(ctx);const data=await response.json().catch(()=>({}));assert(ctx);
      if(!response.ok||data.ok!==true){const code=data.code||(typeof data.error==='string'&&/^[a-z_]+$/.test(data.error)?data.error:null)||([401,403].includes(response.status)?'permission_denied':'network');const messages={category_deleted:'삭제된 항목입니다. 복원을 눌러 다시 추가할 수 있습니다.',designer_deleted:'삭제된 디자이너입니다. 복원을 눌러 다시 추가할 수 있습니다.',revision_conflict:'목록이 변경되었습니다. 목록을 다시 열어주세요.',not_ready:'목록 연결을 준비하고 있습니다.'};throw fail(code,messages[code]||data.message||(data.error!==code?data.error:undefined));}
      return data;
    }catch(error){if(error.code)throw error;throw fail('network');}finally{clearTimeout(timer);}
  }
  async function uploadPhotos(kind,{id,hash,original,thumb}) {
    const ctx=await context(kind);if(ctx.config.mediaWriteVersion!==VERSION)throw fail('connection_pending');
    if(!/^[0-9a-f]{64}$/.test(hash||'')||!original?.size||original.size>26214400||!thumb?.size||thumb.size>102400)throw fail('invalid','사진은 원본 25MB, 미리보기 100KB 이하로 등록해주세요.');
    const form=new FormData();for(const [key,value]of Object.entries({action:'uploadPhotos',kind,id,hash}))form.append(key,value);form.append('original',original,'original');form.append('thumb',thumb,'thumb.jpg');
    const data=await functionRequest(ctx,form);assert(ctx);
    if(![data.original,data.thumb].every(url=>typeof url==='string'&&url.startsWith('https://firebasestorage.googleapis.com/v0/b/aisel-workorder.firebasestorage.app/o/moodboardRefPhotos%2F')))throw fail('network','사진 저장 주소를 확인하지 못했습니다. 원본은 기기에 보관됩니다.');
    return {original:data.original,thumb:data.thumb};
  }
  async function catalogOrderRequest(kind,change) {
    if(!['designers','noteCategories','lookCategories'].includes(kind))throw fail('invalid');
    const ctx=await context('references'),path='catalogOrder/'+kind;
    if(!change)return read(path,ctx);
    if(ctx.role!=='owner')throw fail('permission_denied','순서 변경은 대표자 계정에서 할 수 있습니다.');
    const {ids,expectedRevision}=change;
    if(!Array.isArray(ids)||!ids.length||ids.length>500||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id||id.length>160)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw fail('invalid');
    const token=await current().getIdToken();assert(ctx);
    const patch={ids,revision:expectedRevision+1},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(ctx.app.options.databaseURL.replace(/\/$/,'')+'/'+ROOT+'/'+path+'.json?auth='+encodeURIComponent(token),{method:'PATCH',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
      assert(ctx);
      if(!response.ok){
        const latest=await read(path,ctx);assert(ctx);
        if((latest?.revision||0)!==expectedRevision)throw fail('revision_conflict','다른 기기에서 순서를 변경했습니다. 최신 순서를 확인하고 다시 이동해주세요.');
        throw fail([401,403].includes(response.status)?'permission_denied':'network');
      }
      const saved=await response.json();assert(ctx);return saved;
    } catch(error) {
      assert(ctx);
      if(error.code)throw error;
      // An interrupted response may follow a committed write. Reconcile once.
      try {const saved=await read(path,ctx);assert(ctx);if(saved?.revision===patch.revision&&JSON.stringify(saved.ids)===JSON.stringify(ids))return saved;}catch(_){}
      throw fail('network','순서를 저장하지 못했습니다. 확인된 순서로 되돌렸습니다. 다시 시도해주세요.');
    } finally {clearTimeout(timer);}
  }
  // Dedicated outfit catalog: tiny metadata only, isolated from reference types/notes.
  async function lookCategoryRequest(change) {
    const ctx=await context('meetings'),path='lookCategories';
    if(!change)return {entries:await read(path,ctx)||{},canManage:ctx.role==='owner'};
    if(ctx.role!=='owner')throw fail('permission_denied','룩 분류 편집은 대표자 계정에서 할 수 있습니다.');
    const {entry,expectedRevision}=change;
    if(!entry||!/^look_[0-9a-f]{64}$/.test(entry.id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||entry.revision!==expectedRevision+1)throw fail('invalid');
    const token=await current().getIdToken();assert(ctx);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(ctx.app.options.databaseURL.replace(/\/$/,'')+'/'+ROOT+'/'+path+'/'+entry.id+'.json?auth='+encodeURIComponent(token),{method:'PATCH',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(entry)});
      assert(ctx);
      if(!response.ok){const latest=await read(path+'/'+entry.id,ctx);assert(ctx);if((latest?.revision||0)!==expectedRevision)throw fail('revision_conflict','다른 기기에서 변경했습니다. 목록을 다시 열어 확인해주세요.');throw fail([401,403].includes(response.status)?'permission_denied':'network');}
      const saved=await response.json();assert(ctx);return saved;
    }catch(error){assert(ctx);if(error.code)throw error;try{const saved=await read(path+'/'+entry.id,ctx);assert(ctx);if(JSON.stringify(stable(saved))===JSON.stringify(stable(entry)))return saved;}catch(_){}throw fail('network','룩 분류 저장을 확인하지 못했습니다. 다시 시도해주세요.');}
    finally{clearTimeout(timer);}
  }
  async function categoryRequest(action,payload={}) {
    const ctx=await context('references');if(ctx.config.noteCategoryWriteVersion!==VERSION)throw fail('connection_pending');
    if(action==='noteCategories'){const values=await read('noteCategories',ctx);assert(ctx);return {ok:true,noteCategoriesVersion:203,canManage:ctx.role==='owner',categories:Object.values(values||{})};}
    if(action==='noteCategoryUpsert')return functionRequest(ctx,{action:'upsertCategory',name:payload.name,...(payload.restore===true?{restore:true,expectedRevision:payload.expectedRevision}:{})});
    if(action==='noteCategoryDelete'){if(ctx.role!=='owner')throw fail('permission_denied');return functionRequest(ctx,{action:'deleteCategory',id:payload.id,expectedRevision:payload.expectedRevision});}
    throw fail('invalid');
  }
  async function designerRequest(action,payload={}) {
    if(!['listDesigners','upsertDesigner','deleteDesigner'].includes(action))throw fail('invalid');
    const ctx=await context('references');
    if(action!=='listDesigners'&&ctx.role!=='owner')throw fail('permission_denied');
    const data=await functionRequest(ctx,{action,...(action==='listDesigners'?{}:{name:payload.name}),...(action==='deleteDesigner'||payload.restore===true?{expectedRevision:payload.expectedRevision}:{}),...(payload.restore===true?{restore:true}:{})});
    assert(ctx);return {...data,canManage:ctx.role==='owner'};
  }
  async function referenceCategoryRequest(action,payload={}) {
    if(!['listReferenceCategories','upsertReferenceCategory','deleteReferenceCategory'].includes(action))throw fail('invalid');
    const ctx=await context('references');
    if(ctx.config.referenceCategoryWriteVersion!==220)throw fail('connection_pending');
    if(action==='listReferenceCategories'){
      const values=await read('referenceCategories',ctx);assert(ctx);
      const entries=Object.values(values||{});
      return {ok:true,referenceCategoriesVersion:220,canManage:ctx.role==='owner',entries,categories:entries.filter(entry=>!entry.deletedAt)};
    }
    if(ctx.role!=='owner')throw fail('permission_denied');
    const data=await functionRequest(ctx,{action,...(action==='deleteReferenceCategory'?{id:payload.id,expectedRevision:payload.expectedRevision}:{name:payload.name,...(payload.restore===true?{restore:true,expectedRevision:payload.expectedRevision}:{})})});
    assert(ctx);return {...data,canManage:ctx.role==='owner'};
  }
  window.addEventListener('aisel-session-change',()=>{configCache=null;confirmed.clear();});
  window.AiselCollectionWrites=Object.freeze({enabled,authorize,normalizeReference,getReference,listReferences,saveReference,archiveReference,getMeeting,mutateMeeting,conversionStore,listDeletedMeetings,uploadPhotos,catalogOrderRequest,lookCategoryRequest,categoryRequest,designerRequest,referenceCategoryRequest});
})();
