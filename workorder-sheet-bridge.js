/* AISEL Sheets bridge v1: product snapshots, no Google credentials in the browser. */
(function(root){
"use strict";
const steps=[59000,69000,79000,89000,98000];
const number=v=>Number(String(v==null?"":v).replace(/[^0-9.]/g,""))||0;
const filled=v=>v!==undefined&&v!==null&&String(v).trim()!=="";
function lineAmount(l){return Math.round(number(l.unit)*(filled(l.qty)?number(l.qty):1));}
function signature(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function safe(v){
 if(v===undefined||v===null||v==="")return "∅";
 return String(v).replace(/¦/g,"｜").replace(/,/g,"，").replace(/"/g,"″").replace(/\\/g,"＼").replace(/[\r\n]+/g," ↵ ").slice(0,18000);
}
function build(code,v,photo){
 const lines=Array.isArray(v.lines)?v.lines:[],main=lines.find(l=>(l.nm||"").includes("원단"))||lines[0]||{};
 const fc=lineAmount(main),other=lines.reduce((a,l)=>a+lineAmount(l),0)-fc;
 const cost=fc+other+number(v.gongim)+number(v.siyage),target=cost*4;
 const missing=[];
 if(!number(main.unit))missing.push("원단 단가 미입력");
 if(!filled(main.qty))missing.push("요척 미입력");
 if(!filled(v.gongim))missing.push("공임 미입력");
 if(!filled(v.siyage))missing.push("시야게 미입력");
 const ex=v.priceException,price=number(v.targetThreshold);
 const approved=!!v.priceConfirmed;
 const exc=ex&&ex.price===price&&ex.cost===cost&&String(ex.reason||"").trim();
 let review=!cost?"원가 미입력":missing.length?"원가 미완료":target>69000
 ?(exc?"예외 적용: "+ex.reason:"자동 확정 중지 · 장당 "+Math.ceil(cost-17250)+"원 절감 검토")
 :!approved?"판매가 미확정":price<target?"기존 판매가 재검토":"기준 충족";
 if(target>98000)review="98,000원 상한 초과 · 원가 조정";
 const size=(v.sizeSpec||[]).filter(r=>(r.values||[]).some(filled)).map(r=>r.part+": "+r.values.map((x,i)=>((v.sizeSpecCols||[])[i]||i+1)+" "+x).join(" / ")).join("\n");
 const p=photo||(/^https:\/\//.test(v.p1||"")?v.p1:"");
 const status={sampling:"샘플중",planned:"예정",order:"발주·생산",pdp:"상세페이지",sale:"판매중",drop:"드롭"}[v.status]||v.status||"";
 const fields=[p,code,v.pumMyeong,status,v.factory,(v.selectedColors||[]).join(" / "),
 v.fabricSupplierField||v.fabricSupplier,v.fabricNameField||v.fabricName,v.blend||v.fabricBlend,
 v.fabricWidth,v.fabricSwatchNo,number(main.unit)||"",filled(main.qty)?number(main.qty):"",
 filled(main.unit)?fc:"",lines.length?other:"",filled(v.gongim)?number(v.gongim):"",filled(v.siyage)?number(v.siyage):"",
 cost||"",target||"",!cost||missing.length?"":target<=59000?59000:target<=69000?69000:"검토",
 approved?price:"",review,missing.join(" · ")||"등록값 합산 · 실지급 원가 미검증",
 v.predExpectedQty,p?(v.photoStage==="sample"?"샘플사진":"참고사진"):(v.p1?"사진 연결 대기":"사진 없음"),
 "https://jisoo5000.github.io/aisel-web/work-order-5aa994e7.html",v.materials,size,v.meetingNotes,
 lines.map(l=>(l.nm||"")+": "+(l.unit||"")+" × "+(filled(l.qty)?l.qty:"1(빈칸 기본)")+" = "+lineAmount(l)).join("\n"),
 Number(v.updatedAt||v.createdAt)||0];
 return "SYNCROW¦"+fields.map(safe).join("¦")+"¦ENDROW";
}
const api={build,signature,lineAmount};root.AiselSheetBridge=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(typeof window==="undefined"||!root.firebase)return;
const db=firebase.database(),rows=db.ref("workorderSheetRows"),meta=db.ref("workorderSheetMeta");
const running=new Map();
function show(text){
 let el=document.getElementById("sheetBridgeStatus");
 if(!el){el=document.createElement("div");el.id="sheetBridgeStatus";el.className="noprint";el.style.cssText="padding:6px 12px;font-size:12px;color:#465469;background:#f0f5fa";document.body.appendChild(el);}
 el.textContent=text;
}
async function thumbnail(code,v){
 const src=v.p1Thumb||v.p1||"";
 if(!src)return "";
 const sig=signature(src);
 if(v.sheetThumb&&v.sheetThumb.signature===sig)return v.sheetThumb.url;
 if(!firebase.auth().currentUser)return /^https:\/\//.test(v.p1||"")?v.p1:"";
 try{
  const image=await new Promise((res,rej)=>{const im=new Image();im.crossOrigin="anonymous";im.onload=()=>res(im);im.onerror=rej;im.src=src;});
  const canvas=document.createElement("canvas"),scale=Math.min(1,160/image.height,120/image.width);
  canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(res=>canvas.toBlob(res,"image/jpeg",.75));
  const ref=firebase.storage().ref("workorderShareThumbs").child(code+"_sheet_"+sig+".jpg");
  await ref.put(blob,{contentType:"image/jpeg",cacheControl:"public,max-age=31536000"});
  const url=await ref.getDownloadURL();
  await db.ref("workorders").child(code).child("sheetThumb").set({url,signature:sig});
  return url;
 }catch(err){console.warn("Sheet thumbnail deferred",code,err.code||err.message);return /^https:\/\//.test(v.p1||"")?v.p1:"";}
}
async function perform(code){
 const snap=await db.ref("workorders").child(code).once("value"),v=snap.val();
 if(!v){await rows.child(code).remove();return;}
 const image=await thumbnail(code,v);
 // Re-read after asynchronous photo upload so a newer save is never replaced with the older snapshot.
 const latest=(await db.ref("workorders").child(code).once("value")).val();
 if(!latest){await rows.child(code).remove();return;}
 const src=latest.p1Thumb||latest.p1||"";
 const photo=latest.sheetThumb&&latest.sheetThumb.signature===signature(src)?latest.sheetThumb.url:
  signature(src)===signature(v.p1Thumb||v.p1||"")?image:"";
 await rows.child(code).set(build(code,latest,photo));
 await meta.update({version:1,updatedAt:firebase.database.ServerValue.TIMESTAMP});
 show("공용 시트용 데이터 저장됨 · 시트가 열려 있는 동안 약 1시간 주기로 갱신");
}
function sync(code){
 if(!code)return Promise.resolve();
 const prev=running.get(code)||Promise.resolve();
 const next=prev.catch(()=>{}).then(()=>perform(code)).catch(err=>{show("시트 연동 데이터 저장 실패 · 작지 원본은 저장되어 있습니다. 다시 저장하면 재시도합니다.");console.error(err);}).finally(()=>{if(running.get(code)===next)running.delete(code);});
 running.set(code,next);return next;
}
api.sync=sync;
async function reconcile(){
 const all=(await db.ref("workorderIndex").once("value")).val()||{};
 const existing=(await rows.once("value")).val()||{};
 const codes=Object.keys(all);
 for(let i=0;i<codes.length;i+=3)await Promise.all(codes.slice(i,i+3).map(sync));
 const cleanup={};Object.keys(existing).filter(k=>!all[k]).forEach(k=>cleanup[k]=null);
 if(Object.keys(cleanup).length)await rows.update(cleanup);
}
let reconciled=false;
firebase.auth().onAuthStateChanged(user=>{
 if(user&&!reconciled){reconciled=true;reconcile().catch(err=>{reconciled=false;show("시트 초기 연동 실패 · 작지를 다시 열면 재시도합니다.");console.error(err);});}
 if(!user)reconciled=false;
});
db.ref("workorderIndex").on("child_changed",snap=>sync(snap.key));
db.ref("workorderIndex").on("child_removed",snap=>sync(snap.key));
})(typeof globalThis!=="undefined"?globalThis:this);
