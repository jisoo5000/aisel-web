/* 샘플 위치 선택을 저장합니다. 담당자는 연결 공급자가 위치에 맞게 반영합니다. */
(function(){
  "use strict";
  var fields = ["name","color","size","quantity","operation","location","owner","receivedDate"];
  var labels = {name:"품명",color:"컬러"};
  var records = [], changes = Object.create(null);
  var state = {status:"disconnected",connected:false,canEdit:false,records:[]};
  var provider = null, started = false, settled = false, localError = "", unsubscribe = null;
  var el = {};
  ["sampleSearch","sampleField","sampleReset","sampleList","sampleEmpty","sampleResultCount","sampleError","sampleColumns","sampleReadOnly","sampleConnect","sampleDisconnect","sampleAccount"].forEach(function(id){el[id] = document.getElementById(id);});
  function text(value){return value === null || value === undefined ? "" : String(value).trim();}
  function missing(value){return !text(value) || /^[—–-]+$/.test(text(value));}
  function display(value){return missing(value) ? "미입력" : text(value);}
  function normalized(value){return text(value).toLowerCase().replace(/\s+/g,"");}
  function versionKey(value){return JSON.stringify(value === undefined ? null : value);}
  function copyVersion(value){return value === undefined ? null : JSON.parse(JSON.stringify(value));}
  function node(tag,className,value){var result = document.createElement(tag);if(className) result.className = className;if(value !== undefined) result.textContent = value;return result;}
  function valueNode(tag,className,value){return node(tag,className + (missing(value) ? " sample-missing" : ""),display(value));}
  function cell(label,value,className){var result = node("span","sample-cell " + (className || ""));result.appendChild(node("span","sample-mobile-label",label));result.appendChild(valueNode("span","",value));return result;}
  function canEdit(row){return !!(state.connected && state.canEdit && row.canEdit !== false && row.id && !row.invalidId && row.version !== undefined && row.version !== null);}
  function findRow(id){return records.filter(function(row){return row.id === id && !row.invalidId;})[0] || null;}
  function currentRows(){var needle = normalized(sampleFilters.query);return records.filter(function(row){return !needle || normalized(row[sampleFilters.field]).indexOf(needle) !== -1;});}
  function errorMessage(error,fallback){return error && typeof error.message === "string" && text(error.message) ? text(error.message) : fallback;}
  function saveLocation(rowId,location,expectedVersion){
    var row = findRow(rowId), previous = changes[rowId];
    if(!row || previous && previous.saving || ["물류","사무실"].indexOf(location) === -1) return;
    if(!canEdit(row) || !provider || typeof provider.save !== "function") {changes[rowId] = {saving:false,error:"위치를 변경할 권한을 확인해 주세요."};render();return;}
    if(versionKey(row.version) !== versionKey(expectedVersion)){changes[rowId] = {saving:false,error:"다른 변경이 있어 저장하지 않았습니다. 최신 위치를 확인한 뒤 다시 선택해 주세요."};render();return;}
    if(row.location === location){render();return;}
    var change = {saving:true,location:location,sourceOwner:row.owner,expectedVersion:copyVersion(expectedVersion),error:"",saved:false};
    changes[rowId] = change;render();
    Promise.resolve().then(function(){return provider.save({id:rowId,expectedVersion:copyVersion(change.expectedVersion),patch:{location:location}});}).then(function(next){
      if(changes[rowId] !== change) return;
      change.saving = false;change.saved = true;
      if(next) receive(next);else render();
    }).catch(function(error){
      if(changes[rowId] !== change) return;
      change.saving = false;change.saved = false;
      var conflict = error && /conflict/i.test(String(error.code || ""));
      change.error = conflict ? "다른 변경이 있어 저장하지 않았습니다. 최신 위치를 확인한 뒤 다시 선택해 주세요." : errorMessage(error,"위치를 저장하지 못했습니다. 기존 위치로 되돌렸습니다. 다시 선택해 주세요.");
      render();
    });
  }
  function locationCell(row,change,statusId){
    var result = node("span","sample-cell sample-location-cell");result.appendChild(node("span","sample-mobile-label","샘플 위치"));
    var select = node("select","sample-location-input");select.setAttribute("aria-label",row.name + " " + display(row.color) + " 샘플 위치");
    if(change && (change.saving || change.saved || change.error)) select.setAttribute("aria-describedby",statusId);
    var current = change && change.saving ? change.location : row.location;
    if(["물류","사무실"].indexOf(current) === -1){var original = node("option","",missing(current) ? "미입력" : current);original.value = current;original.disabled = true;select.appendChild(original);}
    ["물류","사무실"].forEach(function(value){var option = node("option","",value);option.value = value;select.appendChild(option);});
    select.value = current;select.disabled = !!(change && change.saving) || !canEdit(row);
    if(!canEdit(row)) select.title = row.editReason || "읽기 전용";
    select.addEventListener("change",function(){saveLocation(row.id,select.value,row.version);});result.appendChild(select);return result;
  }
  function recordElement(row){
    var change = row.invalidId ? null : changes[row.id];
    var record = node("article","sample-record" + (change && change.saving ? " saving" : ""));record.dataset.recordId = row.id;record.dataset.displayId = row.displayId;
    record.setAttribute("aria-busy",String(!!(change && change.saving)));
    var line = node("div","sample-row"), product = node("span","sample-product");product.appendChild(node("span","sample-product-name",row.name));
    var statusId = "sample-location-status-" + encodeURIComponent(row.displayId).replace(/%/g,"_");
    if(change && (change.saving || change.saved || change.error)){
      var status = node("span",change.error ? "sample-row-error" : change.saving ? "sample-saving" : "sample-saved",change.error || (change.saving ? "저장 중…" : "저장됨"));
      status.id = statusId;status.setAttribute("role",change.error ? "alert" : "status");product.appendChild(status);
    }
    line.appendChild(product);
    var options = node("span","sample-options");options.appendChild(node("span","sample-option-main",display(row.color)));options.appendChild(node("span","sample-option-sub","사이즈 " + display(row.size) + " · 수량 " + display(row.quantity)));line.appendChild(options);
    line.appendChild(cell("작업구분",row.operation));line.appendChild(locationCell(row,change,statusId));
    line.appendChild(cell("담당자",change && change.saving ? change.sourceOwner : row.owner,"sample-owner"));line.appendChild(cell("입출고일자",row.receivedDate,"sample-date"));
    record.appendChild(line);return record;
  }
  function render(){
    if(document.activeElement !== el.sampleSearch) el.sampleSearch.value = sampleFilters.query;
    el.sampleField.value = sampleFilters.field;el.sampleSearch.placeholder = labels[sampleFilters.field] + (sampleFilters.field === "name" ? "으로 검색" : "로 검색");
    var busy = state.status === "connecting" || state.status === "loading";
    var message = localError || (state.status === "error" ? text(state.message) : "");
    el.sampleError.hidden = !message;el.sampleError.textContent = message;el.sampleList.setAttribute("aria-busy",String(busy));
    el.sampleConnect.hidden = !!state.connected || !provider || typeof provider.connect !== "function";el.sampleConnect.disabled = busy;el.sampleConnect.textContent = state.status === "connecting" ? "연결 중…" : "Google 계정으로 연결";
    el.sampleDisconnect.hidden = !state.connected || !provider || typeof provider.disconnect !== "function";el.sampleDisconnect.disabled = Object.keys(changes).some(function(id){return changes[id].saving;});
    el.sampleAccount.hidden = !state.connected || !text(state.userLabel);el.sampleAccount.textContent = text(state.userLabel);el.sampleAccount.title = text(state.userLabel);el.sampleReadOnly.hidden = !state.connected || state.canEdit;
    var rows = currentRows();el.sampleResultCount.textContent = state.connected ? rows.length + "건" + (sampleFilters.query ? " / 전체 " + records.length + "건" : "") : "";el.sampleReset.hidden = !sampleFilters.query && sampleFilters.field === "name";
    var active = document.activeElement, focusedId = null;
    if(active && active.classList && active.classList.contains("sample-location-input")){var focusedRow = active.closest(".sample-record");if(focusedRow) focusedId = focusedRow.dataset.displayId;}
    el.sampleList.textContent = "";var fragment = document.createDocumentFragment();rows.forEach(function(row){fragment.appendChild(recordElement(row));});el.sampleList.appendChild(fragment);
    if(focusedId) Array.prototype.some.call(el.sampleList.querySelectorAll(".sample-record"),function(record){if(record.dataset.displayId !== focusedId) return false;var control = record.querySelector(".sample-location-input");if(control && !control.disabled) control.focus({preventScroll:true});return true;});
    el.sampleEmpty.hidden = rows.length > 0;el.sampleColumns.hidden = rows.length === 0;
    el.sampleEmpty.textContent = !state.connected ? (state.status === "connecting" ? "계정에 연결하고 있습니다." : "팀원 계정으로 연결하면 샘플 기록을 확인할 수 있습니다.")
      : busy && !records.length ? "샘플 기록을 불러오고 있습니다."
      : state.status === "error" && !records.length ? "샘플 기록을 불러오지 못했습니다. 위 안내를 확인해 주세요."
      : !records.length ? "등록된 샘플 기록이 없습니다." : "검색 결과가 없습니다. 검색 항목이나 검색어를 확인해 주세요.";
    if(typeof applyPendingScroll_ === "function") applyPendingScroll_();
  }
  function receive(next){
    if(!next || typeof next !== "object") {localError = "샘플 기록을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.";settled = true;render();return;}
    if(!next.connected && next.status !== "connecting") changes = Object.create(null);
    var nextRows = [], ids = Object.create(null);
    if(next.connected && Array.isArray(next.records)) next.records.forEach(function(value,index){
      if(!value || typeof value !== "object" || missing(value.name)) return;
      var row = {};fields.forEach(function(field){row[field] = text(value[field]);});row.id = text(value.id);row.version = value.version;row.canEdit = value.canEdit;row.editReason = text(value.editReason);row.sourceRow = Number(value.sourceRow) || 0;row.displayId = row.id || "unavailable-" + index;row.invalidId = !row.id;if(row.id) ids[row.id] = (ids[row.id] || 0) + 1;nextRows.push(row);
    });
    nextRows.forEach(function(row,index){if(ids[row.id] > 1){row.invalidId = true;row.displayId += "-duplicate-" + index;}if(row.invalidId){row.canEdit = false;row.editReason = row.editReason || "기록 확인 필요";}});
    records = nextRows.sort(function(a,b){return b.sourceRow - a.sourceRow;});state = next;settled = next.status !== "loading" && next.status !== "connecting";localError = "";render();
  }
  function start(){
    if(started){render();return;}
    started = true;provider = window.AiselSampleData || null;if(!provider){settled = true;render();return;}
    try{
      if(typeof provider.subscribe === "function") unsubscribe = provider.subscribe(receive);else if(typeof provider.getState === "function") receive(provider.getState());
      if(typeof provider.load === "function") Promise.resolve(provider.load()).then(function(next){if(next) receive(next);}).catch(function(error){localError = errorMessage(error,"샘플 기록을 불러오지 못했습니다. 잠시 후 다시 연결해 주세요.");settled = true;render();});
    }catch(error){localError = errorMessage(error,"샘플 기록을 불러오지 못했습니다. 잠시 후 다시 연결해 주세요.");settled = true;render();}
  }
  function change(key,value,replace){var next = Object.assign({},sampleFilters);next[key] = value;navigateSamples_(next,!!replace);}
  el.sampleSearch.addEventListener("input",function(event){var next = text(event.target.value);if(next !== sampleFilters.query) change("query",next,!!sampleFilters.query && !!next);});
  el.sampleField.addEventListener("change",function(event){change("field",event.target.value,false);});el.sampleReset.addEventListener("click",function(){navigateSamples_({query:"",field:"name"},false);});
  el.sampleConnect.addEventListener("click",function(){
    if(!provider || typeof provider.connect !== "function" || state.status === "connecting") return;localError = "";
    Promise.resolve().then(function(){return provider.connect();}).then(function(next){if(next) receive(next);}).catch(function(error){localError = errorMessage(error,"계정 연결을 완료하지 못했습니다. 다시 시도해 주세요.");settled = true;render();});
  });
  el.sampleDisconnect.addEventListener("click",function(){
    if(!provider || typeof provider.disconnect !== "function") return;
    Promise.resolve().then(function(){return provider.disconnect();}).then(function(next){if(next) receive(next);else receive({status:"disconnected",connected:false,canEdit:false,records:[]});}).catch(function(error){localError = errorMessage(error,"연결을 해제하지 못했습니다. 다시 시도해 주세요.");render();});
  });
  window.addEventListener("beforeunload",function(event){if(Object.keys(changes).some(function(id){return changes[id].saving;})){event.preventDefault();event.returnValue = "";}});
  window.AiselSamples = {render:render,onShow:start,isReady:function(){return settled;}};
  render();restoreView_(window.history.state);
})();
