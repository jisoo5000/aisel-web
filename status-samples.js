/* 사무실 보유 샘플 조회. 위치·수량 변경은 원본 시트에서 처리합니다. */
(function(){
  "use strict";
  var fields = ["name","color","size","quantity","operation","location","owner","receivedDate","returnedDate","returnDueDate","flowState","flowTotal","officeSent","officeReceived","returnSent","warehouseReceived","cafe24Reflected","sellmateReflected","flowUpdatedAt","flowUpdatedBy"];
  var records = [], state = {status:"disconnected",records:[]};
  var provider = null, started = false, settled = false, localError = "", el = {};
  ["sampleSearch","sampleReset","sampleList","sampleEmpty","sampleResultCount","sampleError","sampleSyncWarning","sampleColumns"].forEach(function(id){el[id] = document.getElementById(id);});
  function text(value){return value == null ? "" : String(value).trim();}
  function missing(value){return !text(value) || /^[—–-]+$/.test(text(value));}
  function display(value){return missing(value) ? "미입력" : text(value);}
  function normalized(value){return text(value).toLowerCase().replace(/\s+/g,"");}
  function node(tag,className,value){var result = document.createElement(tag);if(className) result.className = className;if(value !== undefined) result.textContent = value;return result;}
  function responsiveValue(value,compact){
    var result = node("span","sample-responsive-value");result.title = value;
    result.appendChild(node("span","sample-full-value",value));
    var shortValue = node("span","sample-compact-value",compact);shortValue.setAttribute("aria-hidden","true");result.appendChild(shortValue);return result;
  }
  function shortDate(value){
    var date = provider && typeof provider.normalizeDate === "function" ? provider.normalizeDate(value) : "";
    var year = new Intl.DateTimeFormat("en",{timeZone:"Asia/Seoul",year:"numeric"}).format(new Date());
    return date ? (date.slice(0,4) === year ? date.slice(5) : date).replace(/-/g,"/") : missing(value) ? "—" : text(value);
  }
  function returnInfo(row){return provider && typeof provider.getReturnInfo === "function" ? provider.getReturnInfo(row) : {dueDate:"",completed:row.returnCompleted === true};}
  function recordedReturn(row){return row.returnCompleted === true || !missing(row.returnedDate) || ["샘플반납","반납","반납완료"].indexOf(text(row.operation).replace(/\s+/g,"")) >= 0 || returnInfo(row).completed;}
  function positiveQuantity(value){
    var raw = text(value);
    if(/^\d{1,3}(,\d{3})+$/.test(raw)) raw = raw.replace(/,/g,"");
    if(!/^\d+$/.test(raw)) return null;
    var quantity = Number(raw);return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
  }
  function officeRecord(row){
    var info = window.AiselSampleFlow && typeof window.AiselSampleFlow.inspect === "function" ? window.AiselSampleFlow.inspect(row) : {valid:false,error:"진행 정보를 확인해 주세요."};
    if(!info.valid){
      if(row.location !== "사무실" || recordedReturn(row)) return null;
      return {row:row,quantity:null,review:true,notice:info.error || "진행 기록을 확인해 주세요."};
    }
    if(info.state === "unverified"){
      if(row.location !== "사무실" || recordedReturn(row)) return null;
      return {row:row,quantity:positiveQuantity(row.quantity),review:false,notice:""};
    }
    var balance = info.counts.officeReceived - info.counts.returnSent;
    return balance > 0 ? {row:row,quantity:balance,review:false,notice:""} : null;
  }
  function currentRows(){var needle = normalized(sampleFilters.query);return records.filter(function(item){return !needle || normalized(item.row.name).indexOf(needle) !== -1;});}
  function cell(label,value,className){var result = node("span","sample-cell " + (className || ""));result.appendChild(node("span","sample-mobile-label",label));result.appendChild(node("span","",value));return result;}
  function recordElement(item){
    var row = item.row, record = node("article","sample-record" + (item.review ? " sample-office-review" : ""));record.dataset.recordId = row.id;
    var line = node("div","sample-row"), primary = node("div","sample-primary-line"), secondary = node("div","sample-secondary-line");
    var product = node("span","sample-product");product.appendChild(node("span","sample-product-name",row.name));primary.appendChild(product);
    var quantity = item.quantity === null ? "미확인" : String(item.quantity), compactOptions = "사이즈 " + display(row.size) + " · 수량 " + quantity;
    var fullOptions = "사이즈 " + display(row.size) + " · 사무실 보유 수량 " + quantity;
    if(!missing(row.quantity) && text(row.quantity) !== quantity) fullOptions += " · 원본 수량 " + row.quantity;
    var options = node("span","sample-options");options.appendChild(node("span","sample-option-main",display(row.color)));
    var optionSub = node("span","sample-option-sub");optionSub.appendChild(responsiveValue(fullOptions,compactOptions));options.appendChild(optionSub);primary.appendChild(options);line.appendChild(primary);
    var location = node("span","sample-cell sample-location-cell");location.appendChild(node("span","sample-mobile-label","샘플 위치"));location.appendChild(node("span","sample-location-badge office","사무실"));secondary.appendChild(location);
    secondary.appendChild(cell("담당자","최연경","sample-owner"));
    var operation = text(row.operation).replace(/\s+/g,""), dateLabel = ["샘플출고","출고"].indexOf(operation) >= 0 ? "출고" : "기록일";
    var date = node("span","sample-cell sample-date");date.appendChild(node("span","sample-date-label",dateLabel + " "));date.appendChild(responsiveValue(display(row.receivedDate),shortDate(row.receivedDate)));secondary.appendChild(date);
    var info = returnInfo(row), due = node("span","sample-cell sample-return"), dueDate = node("span","sample-return-date");
    var dueLabel = node("span","sample-compact-value sample-due-label","반납 ");dueLabel.setAttribute("aria-hidden","true");dueDate.appendChild(dueLabel);dueDate.appendChild(responsiveValue("반납 예정일 " + (info.dueDate || "확인 필요"),info.dueDate ? shortDate(info.dueDate) : "확인 필요"));due.appendChild(dueDate);secondary.appendChild(due);
    line.appendChild(secondary);record.appendChild(line);
    if(item.review){var review = node("p","sample-office-review-note","진행 수량 확인 필요 · " + item.notice);record.appendChild(review);}
    return record;
  }
  function render(){
    if(document.activeElement !== el.sampleSearch) el.sampleSearch.value = sampleFilters.query;
    el.sampleSearch.placeholder = "품명, 품목으로 검색";
    var busy = state.status === "loading", message = localError || (state.status === "error" ? text(state.message) : "");
    el.sampleError.hidden = !message;el.sampleError.textContent = message;el.sampleList.setAttribute("aria-busy",String(busy));
    el.sampleSyncWarning.hidden = !state.publicSyncWarning;el.sampleSyncWarning.textContent = typeof state.publicSyncWarning === "string" ? state.publicSyncWarning : state.publicSyncWarning ? "목록 반영이 지연되고 있습니다. 잠시 후 다시 확인해 주세요." : "";
    var rows = currentRows(), known = 0n, unknown = 0, reviews = 0;
    rows.forEach(function(item){if(item.quantity === null) unknown++;else known += BigInt(item.quantity);if(item.review) reviews++;});
    var count = known.toLocaleString("ko-KR") + "개";
    if(unknown) count = (known > 0n ? count + " · " : "") + "수량 미확인 " + unknown + "건";
    el.sampleResultCount.textContent = !rows.length && (message || busy) ? "" : rows.length || settled ? count : "";el.sampleResultCount.title = "표시된 기록 " + rows.length + "건의 사무실 보유 수량";
    el.sampleReset.hidden = !sampleFilters.query && sampleFilters.field === "name";
    el.sampleList.textContent = "";var fragment = document.createDocumentFragment();
    rows.filter(function(item){return !item.review;}).forEach(function(item){fragment.appendChild(recordElement(item));});
    if(reviews){var reviewSection = node("section","sample-office-review-group");reviewSection.appendChild(node("h4","sample-office-review-heading","진행 기록 확인 필요"));rows.filter(function(item){return item.review;}).forEach(function(item){reviewSection.appendChild(recordElement(item));});fragment.appendChild(reviewSection);}
    el.sampleList.appendChild(fragment);el.sampleEmpty.hidden = rows.length > 0;el.sampleColumns.hidden = rows.length === 0;
    el.sampleEmpty.textContent = (busy || !settled) && !rows.length ? "사무실 샘플을 불러오고 있습니다." : message && !rows.length ? "샘플 기록을 불러오지 못했습니다. 위 안내를 확인해 주세요." : sampleFilters.query ? "사무실 보유 샘플 중 검색 결과가 없습니다." : "사무실에 보유 중인 샘플이 없습니다.";
    if(typeof applyPendingScroll_ === "function") applyPendingScroll_();
  }
  function receive(next){
    if(!next || typeof next !== "object"){localError = "샘플 기록을 확인하지 못했습니다. 잠시 후 다시 열어 주세요.";settled = true;render();return;}
    var nextRows = [];
    if(Array.isArray(next.records)) next.records.forEach(function(value,index){
      if(!value || typeof value !== "object" || missing(value.name)) return;
      var row = {};fields.forEach(function(field){row[field] = text(value[field]);});row.id = text(value.id) || "unavailable-" + index;row.returnCompleted = value.returnCompleted === true;row.canEdit = false;
      var item = officeRecord(row);if(item) nextRows.push(item);
    });
    records = nextRows;state = next;settled = next.status !== "loading" || nextRows.length > 0;localError = "";render();
  }
  function start(){
    if(started){render();return;}
    started = true;provider = window.AiselSampleData || null;if(!provider){localError = "샘플 기록을 불러오지 못했습니다. 페이지를 다시 열어 주세요.";settled = true;render();return;}
    try{
      if(typeof provider.subscribe === "function") provider.subscribe(receive);else if(typeof provider.getState === "function") receive(provider.getState());
      if(typeof provider.load === "function") Promise.resolve(provider.load()).then(function(next){if(next) receive(next);}).catch(function(error){localError = error && error.message || "샘플 기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.";settled = true;render();});
    }catch(error){localError = error && error.message || "샘플 기록을 불러오지 못했습니다.";settled = true;render();}
  }
  function change(key,value,replace){var next = {query:sampleFilters.query,field:sampleFilters.field};next[key] = value;navigateSamples_(next,!!replace);}
  el.sampleSearch.addEventListener("input",function(event){var next = text(event.target.value);if(next !== sampleFilters.query) change("query",next,!!sampleFilters.query && !!next);});
  el.sampleReset.addEventListener("click",function(){navigateSamples_({query:"",field:"name"},false);});
  window.AiselSamples = {render:render,onShow:start,isReady:function(){return settled;}};
  render();restoreView_(window.history.state);
})();
