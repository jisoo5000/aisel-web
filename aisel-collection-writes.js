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
  const same = (a,b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  function stable(value) { if (Array.isArray(value)) return value.map(stable); if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])); return value; }
  const list = value => value == null ? [] : Array.isArray(value) ? value : Object.keys(value).sort((a,b)=>Number(a)-Number(b)).map(key=>value[key]);
  let configCache = null;
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
  async function getReference(id) {idCheck(id);const ctx=await context('references');return {ok:true,record:await verifiedRecord(await read('referenceRecords/'+id,ctx),id,ctx)};}
  async function listReferences(options={}) {
    const ctx=await context('references');if(options.archived&&ctx.role!=='owner')throw fail('permission_denied');
    const query=options.archived?'':'&orderBy='+encodeURIComponent(JSON.stringify('archivedAt'))+'&equalTo='+encodeURIComponent(JSON.stringify(''));
    const values=await read('referenceRecords',ctx,query);assert(ctx);
    const items=(await Promise.all(Object.entries(values||{}).map(([id,value])=>verifiedRecord(value,id,ctx)))).filter(value=>!!value.archivedAt===!!options.archived&&(!options.category||value.category===options.category)&&(!options.updatedSince||value.updatedAt>options.updatedSince)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||b.id.localeCompare(a.id));
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
  function patchMatches(raw,patch) {
    if(!raw)return false;
    return Object.entries(patch).every(([key,value])=>same(['photos','sourceLinks','noteEntries'].includes(key)?list(raw[key]):raw[key]??'',value));
  }
  async function writeReference({id,version,patch,archived},archive=false) {
    idCheck(id);if(!Number.isSafeInteger(version)||version<0)throw fail('invalid');
    const ctx=await context('references'),path='referenceRecords/'+id;
    if(archive&&ctx.role!=='owner')throw fail('permission_denied');
    const initial=await read(path,ctx);assert(ctx);
    if(initial&&initial.writeProtocolVersion!==VERSION)throw fail('connection_pending');
    if(initial&&ctx.role!=='owner'&&String(initial.creator||'').toLowerCase()!==ctx.email)throw fail('permission_denied');
    if(archive&&(!initial||typeof archived!=='boolean'))throw fail('invalid');
    const clean=archive?null:checkedPatch(patch,initial);
    const mutationId='save_'+await digest(JSON.stringify(stable({id,version,change:archive?{archived}:clean})));assert(ctx);
    if(initial?.lastMutationId===mutationId&&initial.version>version)return {ok:true,record:await verifiedRecord(initial,id,ctx)};
    if((initial?.version||0)!==version)throw fail('conflict');
    if(initial?.archivedAt&&!archive)throw fail('archived','보관함에서 자료를 복원한 뒤 수정해주세요.');
    if(archive&&!!initial.archivedAt===archived)return {ok:true,record:await verifiedRecord(initial,id,ctx)};
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
      if(/permission[_-]denied/i.test(error.code||error.message||'')){
        const latestCtx=await context('references'),latest=await read(path,latestCtx);assert(ctx);
        if(latest?.lastMutationId===mutationId&&latest.version>version)return {ok:true,record:await verifiedRecord(latest,id,latestCtx)};
        if((latest?.version||0)!==version)throw fail('conflict');
        throw fail('permission_denied');
      }
      throw fail('network');
    }
    const saved=await read(path,ctx);assert(ctx);
    if(!saved||saved.version<version+1||!Number.isFinite(saved.committedAt)||saved.lastMutationId!==mutationId&&!(archive?!!saved.archivedAt===archived:patchMatches(saved,clean)))throw fail('conflict');
    return {ok:true,record:await verifiedRecord(saved,id,ctx)};
  }
  const saveReference=options=>writeReference(options);
  const archiveReference=options=>writeReference(options,true);
  async function functionRequest(ctx,body) {
    assert(ctx);if(ctx.config.mediaEndpoint!==ENDPOINT)throw fail('connection_pending');
    const token=await current().getIdToken();assert(ctx);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),150000);
    try{
      const form=typeof FormData!=='undefined'&&body instanceof FormData;
      const response=await fetch(ENDPOINT,{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(form?{}:{'Content-Type':'application/json'})},body:form?body:JSON.stringify(body)});
      assert(ctx);const data=await response.json().catch(()=>({}));assert(ctx);
      if(!response.ok||data.ok!==true){const code=data.code||(typeof data.error==='string'&&/^[a-z_]+$/.test(data.error)?data.error:null)||([401,403].includes(response.status)?'permission_denied':'network');const messages={category_deleted:'삭제된 분류입니다. 복원을 눌러 다시 추가할 수 있습니다.',designer_deleted:'삭제된 디자이너입니다. 복원을 눌러 다시 추가할 수 있습니다.',revision_conflict:'목록이 변경되었습니다. 관리 화면을 다시 열어주세요.',not_ready:'관리 기능 연결을 준비하고 있습니다.'};throw fail(code,messages[code]||data.message||(data.error!==code?data.error:undefined));}
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
  window.addEventListener('aisel-session-change',()=>{configCache=null;});
  window.AiselCollectionWrites=Object.freeze({enabled,authorize,normalizeReference:verifiedRecord,getReference,listReferences,saveReference,archiveReference,uploadPhotos,categoryRequest,designerRequest});
})();
