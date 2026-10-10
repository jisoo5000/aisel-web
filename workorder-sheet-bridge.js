/* AISEL Sheets bridge v2: compact previews and append-only transport fields. */
(function(root){
"use strict";
const steps=[59000,64000,69000,74000,79000,84000,89000,94000,98000];
const number=v=>Number(String(v==null?"":v).replace(/[^0-9.]/g,""))||0;
const filled=v=>v!==undefined&&v!==null&&String(v).trim()!=="";
function lineAmount(l){return root.WorkOrderNegotiation?root.WorkOrderNegotiation.evaluate(l.unit,l.negotiation,l.qty).amount||0:Math.round(number(l.unit)*(filled(l.qty)?number(l.qty):1));}
function appliedUnit(l){if(root.WorkOrderNegotiation){const r=root.WorkOrderNegotiation.evaluate(l.unit,l.negotiation,l.qty);return r.included?0:r.applied;}return filled(l.unit)?number(l.unit):null;}
function fixedCosts(v){
 let meta={};try{meta=JSON.parse(v.costNegotiationData||"{}");}catch(_){}
 return Object.fromEntries(["gongim","siyage"].map(key=>[key,root.WorkOrderNegotiation?root.WorkOrderNegotiation.evaluate(v[key],meta[key],1,true).amount:(filled(v[key])?number(v[key]):null)]));
}
function signature(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
const PREVIEW_VERSION=2,PREVIEW_MAX=480,PREVIEW_BYTES=100*1024;
const previewSignature=src=>"v"+PREVIEW_VERSION+"-"+signature(src);
const previewSourceKey=v=>previewSignature(JSON.stringify([v.p1Thumb||"",v.p1||""]));
function cachedPreview(v,src){
 const cache=v.sheetThumb;
 return src&&cache&&cache.version===PREVIEW_VERSION&&cache.signature===previewSourceKey(v)&&
  cache.width>0&&cache.height>0&&Math.max(cache.width,cache.height)<=PREVIEW_MAX&&
  cache.bytes>0&&cache.bytes<=PREVIEW_BYTES&&/^https:\/\//.test(cache.url||"")?cache.url:"";
}
async function previewBlob(src){
 const response=await fetch(src);
 if(!response.ok)throw new Error("사진 읽기 실패 "+response.status);
 const original=await response.blob();
 let image,objectUrl;
 try{
  if(typeof root.createImageBitmap==="function")image=await root.createImageBitmap(original);
  else{
   objectUrl=URL.createObjectURL(original);
   image=await new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("사진 해석 실패"));img.src=objectUrl;
   });
  }
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  if(!width||!height)throw new Error("사진 크기 확인 실패");
  const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
  if(!ctx)throw new Error("사진 미리보기 생성 실패");
  let scale=Math.min(1,PREVIEW_MAX/Math.max(width,height));
  for(let pass=0;pass<10;pass++){
   canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
   ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [0.82,0.72,0.6,0.48,0.36]){
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
    if(!blob||blob.type!=="image/jpeg")throw new Error("JPEG 미리보기 생성 실패");
    if(blob.size<=PREVIEW_BYTES)return {blob,width:canvas.width,height:canvas.height};
   }
   scale*=0.8;
  }
  throw new Error("사진 미리보기 용량 초과");
 }finally{
  if(image&&typeof image.close==="function")image.close();
  if(objectUrl)URL.revokeObjectURL(objectUrl);
 }
}
function colorNames(list){
 if(typeof root.colorNames_==="function")return root.colorNames_(list);
 const aliases={"멜란지그레이":"멜란지 그레이","라이트그레이":"라이트 그레이"};
 return [...new Set((Array.isArray(list)?list:[]).filter(v=>typeof v==="string").map(v=>{
  const name=v.trim().replace(/\s+/g," "),key=name.replace(/\s+/g,"");
  return Object.prototype.hasOwnProperty.call(aliases,key)?aliases[key]:name;
 }).filter(Boolean))];
}
function safe(v){
 if(v===undefined||v===null||v==="")return "∅";
 return String(v).replace(/¦/g,"｜").replace(/,/g,"，").replace(/"/g,"″").replace(/\\/g,"＼").replace(/[\r\n]+/g," ↵ ").slice(0,18000);
}
function build(code,v,photo){
 const resolved=root.WorkOrderNegotiation?root.WorkOrderNegotiation.resolveMaterials(v.lines||[],v.costNegotiationLinesData):{lines:v.lines||[],orphans:[]};
 const lines=resolved.lines.filter(l=>!root.WorkOrderNegotiation?.isFixedLossLine(l)),main=lines.find(l=>(l.nm||"").includes("원단"))||lines[0]||{};
 const fc=lineAmount(main),other=lines.reduce((a,l)=>a+lineAmount(l),0)-fc+(root.WorkOrderNegotiation?.FIXED_LOSS||1000);
 const fixed=fixedCosts(v),cost=fc+other+(fixed.gongim||0)+(fixed.siyage||0),target=cost*4;
 const history=Array.isArray(v.resampleHistory)?v.resampleHistory:[],recent=history[history.length-1]||{};
 let costComplete=false;
 const missing=[];
 if(resolved.orphans.length)missing.push("미연결 협상 기록 확인 필요");
 if(appliedUnit(main)===null)missing.push("원단 단가 미입력");
 if(!filled(main.qty))missing.push("요척 미입력");
 if(fixed.gongim===null)missing.push("공임 미입력");
 if(fixed.siyage===null)missing.push("시야게 미입력");
 if(root.WorkOrderNegotiation&&(v.costNegotiationData||lines.some(l=>l.negotiation))){
  let metadata={};try{metadata=JSON.parse(v.costNegotiationData||"{}");}catch(_){}
  costComplete=root.WorkOrderNegotiation.assessment(lines,v,metadata).complete;
  if(!costComplete)missing.push("추정 원가 · 견적/단위/VAT 확인 필요");
 }
 const price=number(v.targetThreshold),suggested=steps.find(p=>p>=target)||null;
 const approved=!resolved.orphans.length&&!!v.priceConfirmed && price>=target;
 const hasCost=cost!==0||costComplete;
 let review=!hasCost?"원가 미입력":missing.length?"원가 미완료":price && price<target?"기존 판매가 재검토":
 !approved?(suggested?"판매가 미확정":"98,000원 초과 · 직접 입력"):"기준 충족";
 const size=(v.sizeSpec||[]).filter(r=>(r.values||[]).some(filled)).map(r=>r.part+": "+r.values.map((x,i)=>((v.sizeSpecCols||[])[i]||i+1)+" "+x).join(" / ")).join("\n");
 const p=photo||""; // Never send an uncompressed original as a failed-preview fallback.
 const status={sampling:"샘플중",samplemgmt:"샘플중",planned:"샘플중",order:"발주·생산",pdp:"상세페이지",sale:"판매중",drop:"드롭"}[v.status]||v.status||"";
 const fields=[p,code,v.pumMyeong,status,v.factory,colorNames(v.selectedColors).join(" / "),
 v.fabricSupplierField||v.fabricSupplier,v.fabricNameField||v.fabricName,v.blend||v.fabricBlend,
 v.fabricWidth,v.fabricSwatchNo,appliedUnit(main)??"",filled(main.qty)?number(main.qty):"",
 appliedUnit(main)!==null?fc:"",other,fixed.gongim??"",fixed.siyage??"",
 hasCost?cost:"",hasCost?target:"",!hasCost||missing.length?"":suggested||"직접 입력",
 approved?price:"",review,missing.join(" · ")||"등록값 합산 · 실지급 원가 미검증",
 v.predExpectedQty,p?(v.photoStage==="sample"?"샘플사진":"참고사진"):(v.p1?"사진 연결 대기":"사진 없음"),
 "https://jisoo5000.github.io/aisel-web/work-order-5aa994e7.html?code="+encodeURIComponent(code),v.materials,size,v.meetingNotes,
 [...lines.map(l=>(l.nm||"")+": "+(appliedUnit(l)??"")+" × "+(filled(l.qty)?l.qty:"1(빈칸 기본)")+" = "+lineAmount(l)),"로스: 1,000원 고정"].join("\n"),
 Number(v.createdAt)||0,[v.yy,v.mm,v.dd].every(filled)?[v.yy,String(v.mm).padStart(2,"0"),String(v.dd).padStart(2,"0")].join("-"):"",recent.round||"",recent.date||"",recent.changes||"",v.designer];
 return "SYNCROW¦"+fields.map(safe).join("¦")+"¦ENDROW";
}
const api={build,signature,lineAmount,previewSignature,cachedPreview,previewBlob};root.AiselSheetBridge=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(typeof window==="undefined"||!root.firebase)return;
// Named apps keep separate Auth sessions. Reuse an existing signed-in app for
// this same project/database; each operation keeps that app's DB and Storage.
const defaultApp=typeof firebase.app==="function"?firebase.app():{
 name:"[DEFAULT]",options:{},auth:()=>firebase.auth(),database:()=>firebase.database(),storage:()=>firebase.storage()
};
const sameProjectApps=[defaultApp,...(firebase.apps||[]).filter(app=>app!==defaultApp&&
 defaultApp.options.projectId&&app.options.projectId===defaultApp.options.projectId&&
 app.options.databaseURL===defaultApp.options.databaseURL)];
function authenticatedApp(){return sameProjectApps.find(app=>app.auth().currentUser)||null;}
function connection(){
 const app=authenticatedApp()||defaultApp;
 const db=app.database();return {app,db,uid:app.auth().currentUser?.uid||null,rows:db.ref("workorderSheetRows"),meta:db.ref("workorderSheetMeta")};
}
function signedIn(ctx){return (ctx.app.auth().currentUser?.uid||null)===ctx.uid;}
const running=new Map();
function show(text){
 let el=document.getElementById("sheetBridgeStatus");
 if(!el){el=document.createElement("div");el.id="sheetBridgeStatus";el.className="noprint";el.style.cssText="padding:6px 12px;font-size:12px;color:#465469;background:#f0f5fa";document.body.appendChild(el);}
 el.textContent=text;
}
async function thumbnail(code,v,ctx){
 const src=v.p1Thumb||v.p1||"";
 if(!src)return "";
 const sig=previewSourceKey(v),cached=cachedPreview(v,src);
 if(cached)return cached;
 // Anonymous viewers reuse cached previews; uploads retain their owner authorization.
 if(!ctx.uid||!signedIn(ctx))return "";
 try{
  const sources=[...new Set([v.p1Thumb,v.p1].filter(Boolean))];
  let preview;
  for(let i=0;i<sources.length;i++){
   try{preview=await previewBlob(sources[i]);break;}
   catch(err){if(i===sources.length-1)throw err;}
  }
  const blob=preview.blob;
  if(!signedIn(ctx))return "";
  const ref=ctx.app.storage().ref("workorderShareThumbs").child(code+"_sheet_"+sig+".jpg");
  await ref.put(blob,{contentType:"image/jpeg",cacheControl:"public,max-age=31536000,immutable"});
  const url=await ref.getDownloadURL();
  // An upload may finish after the work order was deleted or its photo changed.
  // Update only the existing matching original; never recreate a deleted record.
  if(!signedIn(ctx))return "";
  const original=ctx.db.ref("workorders").child(code);
  // Keep the server snapshot subscribed until the transaction finishes. A lone
  // once() listener detaches before the transaction, allowing a cold null cache.
  const keepSnapshot=()=>{};
  original.on("value",keepSnapshot);
  try{
   await original.once("value");
   const result=await original.transaction(current=>{
     if(!signedIn(ctx)||!current || previewSourceKey(current)!==sig)return;
     return {...current,sheetThumb:{url,signature:sig,version:PREVIEW_VERSION,width:preview.width,height:preview.height,bytes:blob.size}};
   },undefined,false);
   return result.committed?url:"";
  }finally{original.off("value",keepSnapshot);}
 }catch(err){console.warn("Sheet thumbnail deferred",code,err.code||err.message);return "";}
}
// A successful row and its source receipt are published in one atomic update.
// Comparing this small metadata avoids downloading photo-bearing originals on startup.
const SYNC_VERSION=1;
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
function fingerprint(value){const text=typeof value==="string"?value:JSON.stringify(stable(value));return text.length+"-"+signature(text);}
function currentReceipt(ctx,index,row,receipt,hint){
 return !!(index&&typeof row==="string"&&receipt&&receipt.version===SYNC_VERSION&&
  receipt.indexSignature===fingerprint(index)&&receipt.rowSignature===fingerprint(row)&&
  (hint==null||receipt.sourceUpdatedAt===String(hint)||String(index.updatedAt)===String(hint))&&(!ctx.uid||!receipt.previewPending));
}
async function publish(ctx,code,row,receipt,existing,previous){
 if(!signedIn(ctx))return false;
 const patch={};
 if(existing!==row)patch["workorderSheetRows/"+code]=row;
 if(JSON.stringify(previous)!==JSON.stringify(receipt))patch["workorderSheetMeta/sources/"+code]=receipt;
 if(Object.keys(patch).length){
  patch["workorderSheetMeta/version"]=2;patch["workorderSheetMeta/fields"]=36;
  patch["workorderSheetMeta/updatedAt"]=firebase.database.ServerValue.TIMESTAMP;
  await ctx.db.ref().update(patch);
 }
 return true;
}
async function perform(code,hint,force){
 const ctx=connection(),{db,rows,meta}=ctx,indexRef=db.ref("workorderIndex").child(code);
 const [indexSnap,rowSnap,receiptSnap]=await Promise.all([indexRef.once("value"),rows.child(code).once("value"),meta.child("sources").child(code).once("value")]);
 const index=indexSnap.val(),existing=rowSnap.val(),previous=receiptSnap.val();
 if(!signedIn(ctx))return false;
 // Explicit sync without a revision remains a repair path for imports/legacy writers.
 if(!force&&currentReceipt(ctx,index,existing,previous,hint))return true;
 if(!index&&!force)return publish(ctx,code,null,null,existing,previous);
 const v=(await db.ref("workorders").child(code).once("value")).val();
 if(!signedIn(ctx))return false;
 if(!v)return publish(ctx,code,null,null,existing,previous);
 const source=v.p1Thumb||v.p1||"",uploaded=!!(ctx.uid&&source&&!cachedPreview(v,source));
 const image=await thumbnail(code,v,ctx);
 // Preserve the latest saved data and guarded preview transaction after an upload.
 const latest=uploaded?(await db.ref("workorders").child(code).once("value")).val():v;
 if(!signedIn(ctx))return false;
 if(!latest)return publish(ctx,code,null,null,existing,previous);
 const latestIndex=(await indexRef.once("value")).val();
 // Never acknowledge a changed index using an older original snapshot.
 if(fingerprint(latestIndex)!==fingerprint(index))return "retry";
 const src=latest.p1Thumb||latest.p1||"",photo=cachedPreview(latest,src)||
  (previewSourceKey(latest)===previewSourceKey(v)?image:"");
 const row=build(code,latest,photo),receipt={version:SYNC_VERSION,indexSignature:fingerprint(latestIndex),
  sourceUpdatedAt:String(latest.updatedAt||0),rowSignature:fingerprint(row),previewPending:!!(src&&!cachedPreview(latest,src))};
 const result=await publish(ctx,code,row,receipt,existing,previous);
 if(result)document.getElementById("sheetBridgeStatus")?.remove();
 return result;
}
function sync(code,revision,options={}){
 if(!code)return Promise.resolve();
 const hint=revision==null?null:String(revision),force=!options.incremental&&hint===null;
 const key=options.indexSignature||hint,existing=running.get(code);
 if(existing){
  if(existing.started&&(force||key!==existing.key))existing.again=true;
  existing.force=existing.force||force;existing.hint=hint;existing.key=key;
  return existing.promise;
 }
 const job={started:false,again:false,hint,key,force,promise:null};
 job.promise=Promise.resolve().then(async()=>{
  let result;
  do{
   job.again=false;job.started=true;const forceNow=job.force;job.force=false;
   result=await perform(code,job.hint,forceNow);
   if(result==="retry")job.again=true;
  }while(job.again);
  return result;
 }).catch(err=>{show("시트 연동 데이터 저장 실패 · 작지 원본은 저장되어 있습니다. 다시 저장하면 재시도합니다.");console.error(err);return false;}).finally(()=>{if(running.get(code)===job)running.delete(code);});
 running.set(code,job);return job.promise;
}
api.sync=sync;
async function reconcile(){
 const ctx=connection(),{db,rows,meta}=ctx;
 const [indexSnap,rowSnap,receiptSnap]=await Promise.all([db.ref("workorderIndex").once("value"),rows.once("value"),meta.child("sources").once("value")]);
 if(!signedIn(ctx))return;
 const all=indexSnap.val()||{},existing=rowSnap.val()||{},receipts=receiptSnap.val()||{};
 const codes=Object.keys(all).filter(code=>!currentReceipt(ctx,all[code],existing[code],receipts[code],all[code]?.updatedAt));
 for(let i=0;i<codes.length;i+=3)await Promise.all(codes.slice(i,i+3).map(code=>sync(code,all[code]?.updatedAt,{incremental:true,indexSignature:fingerprint(all[code])})));
 // Recheck each orphan's current index so a concurrent restore is preserved.
 const orphans=[...new Set([...Object.keys(existing),...Object.keys(receipts)])].filter(code=>!all[code]);
 for(let i=0;i<orphans.length;i+=3)await Promise.all(orphans.slice(i,i+3).map(code=>sync(code,undefined,{incremental:true,indexSignature:"removed"})));
}
let reconciledApp=null,reconciledUid;
function onAuthChange(){
 const app=authenticatedApp()||defaultApp,uid=app.auth().currentUser?.uid||null;
 if(reconciledApp===app&&reconciledUid===uid)return;
 reconciledApp=app;reconciledUid=uid;
 return reconcile().catch(err=>{
  if(reconciledApp===app&&reconciledUid===uid)reconciledApp=null;
  show("시트 초기 연동 실패 · 작지를 다시 열면 재시도합니다.");console.error(err);
 });
}
sameProjectApps.forEach(app=>app.auth().onAuthStateChanged(onAuthChange));
function onIndexChange(snap){return sync(snap.key,snap.val()?.updatedAt,{incremental:true,indexSignature:snap.val()==null?"removed":fingerprint(snap.val())});}
defaultApp.database().ref("workorderIndex").on("child_added",onIndexChange);
defaultApp.database().ref("workorderIndex").on("child_changed",onIndexChange);
defaultApp.database().ref("workorderIndex").on("child_removed",onIndexChange);
})(typeof globalThis!=="undefined"?globalThis:this);
