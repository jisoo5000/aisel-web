/* Sample custody board. Google Sheets remains the source of every transfer. */
(function(){
"use strict";
var el={},records=[],state={},provider=null,started=false,view="office",expanded=new Set();
["sampleSearch","sampleReset","sampleList","sampleEmpty","sampleResultCount","sampleError","sampleSyncWarning","sampleColumns","sampleUpdated","sampleViews","sampleHeading"].forEach(function(id){el[id]=document.getElementById(id);});
function text(v){return v==null?"":String(v).trim();}
function node(tag,cls,value){var e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;}
function norm(v){return text(v).toLowerCase().replace(/\s/g,"");}
function present(v){return !!text(v)&&!/^[-—–]+$/.test(text(v));}
function qty(v){var s=text(v).replace(/,/g,"");return /^\d+$/.test(s)&&Number.isSafeInteger(+s)&&+s>0?+s:null;}
function today(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul"}).format(new Date());}
function date(v){return provider&&provider.normalizeDate(v)||"";}
function short(v){return date(v)?date(v).slice(5).replace("-","/"):"미입력";}
function done(r){return r.returnCompleted===true||present(r.returnedDate)||["반납","반납완료","샘플반납"].includes(norm(r.operation));}
function classify(r){
 var complete=done(r),info=window.AiselSampleFlow.inspect(r),quantity=qty(r.quantity),kind="",review="";
 if(complete){kind="history";if(r.location==="사무실")review="반납 기록 있음 · 위치 정정 필요";}
 else if(!info.valid){kind=r.location==="사무실"?"office":"";review="진행 수량 확인 필요";quantity=null;}
 else if(info.state!=="unverified"){
  var balance=info.counts.officeReceived-info.counts.returnSent;
  if(balance>0){kind="office";quantity=balance;}else if(info.pending.warehouseReceipt>0){kind="transit";quantity=info.pending.warehouseReceipt;}
 }else if(r.returnDispatched==="TRUE"||norm(r.operation)==="반납발송"||r.location==="이동중"){kind="transit";}
 else if(r.location==="사무실"){kind="office";}
 else if(r.location==="물류"){kind="warehouse";}
 if(!kind)return null;
 var due=date(r.returnDueDate),overdue=kind==="office"&&due&&due<today()?Math.round((Date.parse(today())-Date.parse(due))/86400000):0;
 if(kind==="office"&&!date(r.receivedDate))review=review||"사무실 수령일 확인 필요";
 if(quantity===null)review=review||"수량 확인 필요";
 return {row:r,kind:kind,quantity:quantity,due:due,overdue:overdue,review:review};
}
function sum(items){var n=0,unknown=0;items.forEach(function(x){if(x.quantity===null)unknown++;else n+=x.quantity;});return (n?n.toLocaleString("ko-KR")+"장":"")+(unknown?(n?" · ":"")+"수량 미확인 "+unknown+"건":"")||"0장";}
function filtered(){
 var q=norm(sampleFilters.query);
 return records.filter(function(x){
  if(x.kind!==view)return false;if(!q)return true;
  if(norm([x.row.name,x.row.color,x.row.size,x.row.owner].join(" ")).includes(q))return true;
  var codes=Object.keys(all).filter(function(c){return norm(all[c].pumMyeong)===norm(x.row.name);});
  return codes.length===1&&norm(codes[0]).includes(q);
 }).sort(function(a,b){return (a.row.order||0)-(b.row.order||0);});
}
function render(){
 if(document.activeElement!==el.sampleSearch)el.sampleSearch.value=sampleFilters.query;
 var busy=state.status==="loading"||state.status==="connecting",error=state.status==="error"||(!state.connected&&state.message)?text(state.message):"";
 el.sampleError.hidden=!error;el.sampleError.textContent=error;el.sampleList.setAttribute("aria-busy",String(busy));
 el.sampleColumns.hidden=true;el.sampleReset.hidden=!sampleFilters.query;
 var stamp=state.source&&state.source.syncedAt;
 el.sampleUpdated.replaceChildren();
 var stale=!!stamp&&Date.now()-Date.parse(stamp)>36*3600000;
 el.sampleSyncWarning.hidden=true;el.sampleSyncWarning.textContent="";
 if(!state.connected){var connect=node("button","sample-refresh","구글시트 연결");connect.type="button";connect.disabled=busy;connect.onclick=function(){provider.connect().catch(function(){});};el.sampleUpdated.append(connect);}
 else {var refresh=node("button","sample-refresh","시트 새로고침");refresh.type="button";refresh.disabled=busy;refresh.onclick=function(){provider.load(true).catch(function(){});};el.sampleUpdated.append(refresh);}
 el.sampleUpdated.append(node("span","","물류입고일 최신순"));
 el.sampleUpdated.hidden=false;
 var defs=[["office","사무실 보유"],["warehouse","물류 보유"],["transit","물류 확인"],["history","반납 이력"]];
 el.sampleViews.replaceChildren();
 defs.forEach(function(d){var n=records.filter(function(x){return x.kind===d[0];}).length,b=node("button",view===d[0]?"on":"",d[1]+" "+n);b.type="button";b.setAttribute("aria-pressed",String(view===d[0]));b.onclick=function(){view=d[0];expanded.clear();render();};el.sampleViews.append(b);});
 var items=filtered(),groups=new Map();
 items.forEach(function(x){var key=x.row.name;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);});
 el.sampleHeading.textContent=view==="office"?(stale?"마지막 확인한 사무실 샘플":"사무실 보유 샘플"):view==="transit"?"반납 보냄 · 물류 수령 대기":view==="warehouse"?"물류 보유 샘플":"반납 기록";
 var late=items.filter(function(x){return x.overdue>0;}).length;
 el.sampleResultCount.textContent=groups.size+"품목 · "+sum(items)+(late?" · 기한 경과 "+late+"건":"");
 el.sampleList.replaceChildren();
 groups.forEach(function(list,name){
  var box=node("details","sample-product-group");box.open=expanded.has(view+name);
  box.ontoggle=function(){if(box.open)expanded.add(view+name);else expanded.delete(view+name);};
  var summary=node("summary","sample-group-summary"),identity=node("span","sample-group-identity"),metrics=node("span","sample-group-metrics");
  identity.append(node("strong","",name),node("span","sample-group-options",list.length+"옵션 · "+sum(list)));
  var worst=Math.max.apply(null,list.map(function(x){return x.overdue;})),due=list.find(function(x){return x.due;});
  metrics.append(node("span",worst?"sample-overdue":"",view==="warehouse"?"사무실 수령 전":view==="history"?"반납 기록 있음":view==="transit"?"물류 수령 대기":worst?"예정일 "+worst+"일 경과":due?"반납 예정 "+short(due.due):"반납 예정일 미입력"));
  summary.append(identity,metrics);box.append(summary);
  list.forEach(function(x){
   var line=node("div","sample-option-row"),main=node("div","sample-option-title");
   main.append(node("span","",text(x.row.color)||"컬러 미입력"),node("span","",text(x.row.size)?"사이즈 "+x.row.size:"사이즈 미입력"),node("strong","",x.quantity===null?"수량 미확인":x.quantity+"장"));line.append(main);
   var detail=[text(x.row.owner)||"담당 미입력"];
   if(view==="office"){detail.push("수령 "+short(x.row.receivedDate));detail.push("반납 예정 "+short(x.row.returnDueDate));}
   if(x.row.warehouseDate)detail.push("물류 입고 "+short(x.row.warehouseDate));
   if(x.review)detail.push(x.review);
   line.append(node("div","sample-option-detail",detail.join(" · ")));
   var options=provider&&provider.transferOptions?provider.transferOptions(x.row):[];
   if(state.connected&&options.length){var actions=node("div","sample-transfer-actions");options.forEach(function(option){var button=node("button","sample-refresh",option.label);button.type="button";button.disabled=busy;button.onclick=function(){openTransfer(x.row,option);};actions.append(button);});line.append(actions);}
   box.append(line);
  });
  el.sampleList.append(box);
 });
 el.sampleEmpty.hidden=items.length>0;el.sampleEmpty.textContent=busy?"샘플 기록을 확인하고 있습니다.":error?"최신 자료를 확인하지 못했습니다.":sampleFilters.query?"검색 결과가 없습니다.":view==="office"?"장부상 사무실 보유 샘플이 없습니다.":view==="transit"?"물류 수령을 기다리는 반납 기록이 없습니다.":view==="warehouse"?"장부상 물류 보유 샘플이 없습니다.":"반납 기록이 없습니다.";
 if(typeof applyPendingScroll_==="function")applyPendingScroll_();
}
function openTransfer(row,option){
 var dialog=node("dialog","sample-transfer-dialog"),form=node("form",""),title=node("h3","",option.label),description=node("p","",[row.name,row.color,row.size,"전량 "+row.quantity+"장"].join(" · "));
 form.append(title,description);var input=null;
 if(option.dateLabel){var label=node("label","",option.dateLabel);input=node("input","");input.type="date";input.value=today();input.max=today();input.required=true;label.append(input);form.append(label);}
 else form.append(node("p","sample-option-detail","실제로 물류로 보낸 뒤 기록해 주세요. 물류 수령 확인 전까지 이동 중으로 표시됩니다."));
 var issue=node("p","sample-transfer-error",""),buttons=node("div","sample-transfer-actions"),cancel=node("button","sample-refresh","취소"),save=node("button","sample-refresh","저장");cancel.type="button";save.type="submit";buttons.append(cancel,save);form.append(issue,buttons);dialog.append(form);document.body.append(dialog);
 var busy=false;cancel.onclick=function(){dialog.close();};dialog.oncancel=function(e){if(busy)e.preventDefault();};dialog.onclose=function(){dialog.remove();};
 form.onsubmit=async function(e){e.preventDefault();if(busy)return;busy=true;save.disabled=cancel.disabled=true;save.textContent="저장 중";issue.textContent="";
 try{var transfer={type:option.type};if(input)transfer.date=input.value;await provider.save({id:row.id,expectedVersion:row.version,transfer:transfer});dialog.close();}
 catch(err){issue.textContent=err.message||"저장 결과를 확인해 주세요.";save.disabled=false;save.textContent="저장";}
 finally{busy=false;cancel.disabled=false;}
 };dialog.showModal();
}
function receive(next){state=next||{};records=(state.records||[]).map(classify).filter(Boolean);render();}
function start(){if(started){render();return;}started=true;provider=window.AiselSampleData;provider.subscribe(receive);provider.load().catch(function(){});}
el.sampleSearch.addEventListener("input",function(e){navigateSamples_({query:text(e.target.value),field:"name"},true);});
el.sampleReset.addEventListener("click",function(){navigateSamples_({query:"",field:"name"},false);});
window.AiselSamples={render:render,onProductsChanged:render,onShow:start,isReady:function(){return state.status==="ready"||state.status==="error";}};
render();restoreView_(window.history.state);
})();
