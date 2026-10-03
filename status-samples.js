/* 샘플 위치와 반납 기한 연장. 담당자 매핑과 날짜 규칙은 연결 공급자가 처리합니다. */
(function(){
  "use strict";
  var fields = ["name","color","size","quantity","operation","location","owner","receivedDate","returnedDate","returnDueDate","extensionReason"];
  var labels = {name:"품명",color:"컬러"};
  var records = [], changes = Object.create(null), extensions = Object.create(null);
  var state = {status:"disconnected",connected:false,canEdit:false,records:[]};
  var provider = null, started = false, settled = false, localError = "", unsubscribe = null;
  var el = {};
  ["sampleSearch","sampleField","sampleReset","sampleList","sampleEmpty","sampleResultCount","sampleError","sampleSyncWarning","sampleUpdated","sampleColumns","sampleReadOnly","sampleConnect","sampleDisconnect","sampleAccount"].forEach(function(id){el[id] = document.getElementById(id);});
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
  function returnInfo(row){return provider && typeof provider.getReturnInfo === "function" ? provider.getReturnInfo(row) : {dueDate:"",canExtend:false,suggestedDate:"",reason:"",completed:false,isOutgoing:false};}
  function pendingSave(){return Object.keys(changes).some(function(id){return changes[id].saving;}) || Object.keys(extensions).some(function(id){return extensions[id].saving;});}
  function focusRowControl(id,className){
    Array.prototype.some.call(el.sampleList.querySelectorAll(".sample-record"),function(record){
      if(record.dataset.recordId !== id) return false;
      var control = record.querySelector("." + className);if(control && !control.disabled) control.focus({preventScroll:true});return true;
    });
  }
  function startExtension(id){
    var row = findRow(id), current = extensions[id];
    if(!row || !canEdit(row) || !returnInfo(row).canExtend || changes[id] && changes[id].saving || current && current.saving) return;
    extensions[id] = {editing:true,saving:false,saved:false,date:returnInfo(row).suggestedDate,reason:"",expectedVersion:copyVersion(row.version),error:""};
    render();focusRowControl(id,"sample-extension-reason");
  }
  function cancelExtension(id){
    if(extensions[id] && extensions[id].saving) return;
    delete extensions[id];render();focusRowControl(id,"sample-extend");
  }
  function saveExtension(id){
    var row = findRow(id), change = extensions[id];
    if(!row || !change || !change.editing || change.saving || changes[id] && changes[id].saving) return;
    var info = returnInfo(row), invalidField = "sample-extension-date";
    if(!canEdit(row) || !info.canExtend || !provider || typeof provider.save !== "function") change.error = "반납 기한을 연장할 수 있는 기록인지 확인해 주세요.";
    else if(versionKey(row.version) !== versionKey(change.expectedVersion)) change.error = "다른 변경이 있어 저장하지 않았습니다. 취소 후 최신 기록에서 다시 연장해 주세요.";
    else {
      var date = provider.normalizeDate(change.date), reason = text(change.reason);
      if(!date || date <= info.dueDate) change.error = "현재 반납 예정일보다 늦은 날짜를 선택해 주세요.";
      else if(!reason || reason.length > 100 || /[\r\n\u2028\u2029]/.test(change.reason)) {change.error = "연장 사유를 100자 이내 한 줄로 입력해 주세요.";invalidField = "sample-extension-reason";}
      else {
        change.saving = true;change.saved = false;change.error = "";render();
        Promise.resolve().then(function(){return provider.save({id:id,expectedVersion:copyVersion(change.expectedVersion),patch:{returnDueDate:date,extensionReason:reason}});}).then(function(next){
          if(extensions[id] !== change) return;
          change.saving = false;change.editing = false;change.saved = true;
          if(next) receive(next);else render();focusRowControl(id,"sample-extend");
        }).catch(function(error){
          if(extensions[id] !== change) return;
          change.saving = false;change.saved = false;
          change.error = error && /conflict/i.test(String(error.code || ""))
            ? "다른 변경이 있어 저장하지 않았습니다. 취소 후 최신 기록에서 다시 연장해 주세요."
            : errorMessage(error,"연장 내용을 저장하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.");
          render();
        });
        return;
      }
    }
    render();focusRowControl(id,invalidField);
  }
  function saveLocation(rowId,location,expectedVersion){
    var row = findRow(rowId), previous = changes[rowId];
    if(!row || previous && previous.saving || extensions[rowId] && extensions[rowId].saving || ["물류","사무실"].indexOf(location) === -1) return;
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
    select.value = current;select.disabled = !!(change && change.saving || extensions[row.id] && extensions[row.id].saving) || !canEdit(row);
    if(!canEdit(row)) select.title = state.connected ? row.editReason || "읽기 전용" : "수정하려면 Google 로그인";
    select.addEventListener("change",function(){saveLocation(row.id,select.value,row.version);});result.appendChild(select);return result;
  }
  function returnElement(row){
    var info = returnInfo(row), change = row.invalidId ? null : extensions[row.id];
    var result = node("div","sample-cell sample-return"), summary = node("div","sample-return-summary"), form = null;
    if(!info.isOutgoing && !info.completed && !info.dueDate){result.appendChild(node("span","sample-mobile-label","반납 예정일"));result.appendChild(node("span","sample-missing","—"));return {cell:result,form:null};}
    if(info.isOutgoing || info.dueDate){
      var due = node("span","sample-return-date");due.appendChild(node("span","sample-mobile-label","반납 예정일"));
      due.appendChild(node("span","",info.dueDate || "확인 필요"));summary.appendChild(due);
    }
    if(info.completed){
      if(state.connected){
        var actual = node("span","sample-return-actual");actual.appendChild(node("span","sample-return-label","실제 반납일"));
        actual.appendChild(node("span","",missing(row.returnedDate) ? "입력 필요" : provider.normalizeDate(row.returnedDate) || row.returnedDate));summary.appendChild(actual);
      }else summary.appendChild(node("span","sample-return-completed","반납 완료"));
    }
    var allowed = canEdit(row) && info.canExtend;
    if(allowed && !(change && change.editing)){
      var extend = node("button","sample-extend","연장");extend.type = "button";extend.disabled = !!(changes[row.id] && changes[row.id].saving);
      extend.setAttribute("aria-label",row.name + " " + display(row.color) + " 반납 기한 연장");
      extend.addEventListener("click",function(){startExtension(row.id);});summary.appendChild(extend);
    }
    result.appendChild(summary);
    if(state.connected && !missing(row.extensionReason)){var reasonView = node("div","sample-return-reason","연장 사유 · " + text(row.extensionReason).replace(/\s+/g," "));reasonView.title = text(row.extensionReason);result.appendChild(reasonView);}
    if(change && change.editing && allowed){
      form = node("form","sample-extension-form");form.noValidate = true;
      var dateLabel = node("label","sample-extension-field");dateLabel.appendChild(node("span","sample-return-label","연장 날짜"));
      var date = node("input","sample-extension-date");date.type = "date";date.required = true;date.value = change.date;
      date.min = provider.addCalendarDays(info.dueDate,1);date.disabled = change.saving;
      date.addEventListener("input",function(){change.date = date.value;});dateLabel.appendChild(date);form.appendChild(dateLabel);
      var reasonLabel = node("label","sample-extension-field reason-field");reasonLabel.appendChild(node("span","sample-return-label","연장 사유"));
      var reason = node("input","sample-extension-reason");reason.type = "text";reason.required = true;reason.maxLength = 100;reason.autocomplete = "off";reason.placeholder = "사유를 한 줄로 입력";reason.value = change.reason;reason.disabled = change.saving;
      reason.addEventListener("input",function(){change.reason = reason.value;});
      reason.addEventListener("compositionstart",function(){reason._sampleComposing = true;});
      reason.addEventListener("compositionend",function(){reason._sampleComposing = false;change.reason = reason.value;render();});reasonLabel.appendChild(reason);form.appendChild(reasonLabel);
      var buttons = node("div","sample-extension-actions");
      var save = node("button","sample-extension-save",change.saving ? "저장 중…" : "저장");save.type = "submit";save.disabled = change.saving || !!(changes[row.id] && changes[row.id].saving);buttons.appendChild(save);
      var cancel = node("button","sample-extension-cancel","취소");cancel.type = "button";cancel.disabled = change.saving;cancel.addEventListener("click",function(){cancelExtension(row.id);});buttons.appendChild(cancel);form.appendChild(buttons);
      form.addEventListener("submit",function(event){event.preventDefault();saveExtension(row.id);});
      if(change.error){
        var errorId = "sample-extension-error-" + encodeURIComponent(row.displayId).replace(/%/g,"_");
        var message = node("span","sample-row-error sample-extension-error",change.error);message.id = errorId;message.setAttribute("role","alert");
        date.setAttribute("aria-describedby",errorId);reason.setAttribute("aria-describedby",errorId);form.appendChild(message);
      }
    }else if(change && change.saved){var saved = node("span","sample-saved","연장 저장됨");saved.setAttribute("role","status");result.appendChild(saved);}
    return {cell:result,form:form};
  }
  function recordElement(row){
    var change = row.invalidId ? null : changes[row.id];
    var extension = row.invalidId ? null : extensions[row.id], busy = !!(change && change.saving || extension && extension.saving);
    var record = node("article","sample-record" + (busy ? " saving" : ""));record.dataset.recordId = row.id;record.dataset.displayId = row.displayId;
    record.setAttribute("aria-busy",String(busy));
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
    var returnRow = returnElement(row);line.appendChild(returnRow.cell);record.appendChild(line);if(returnRow.form) record.appendChild(returnRow.form);return record;
  }
  function render(){
    if(document.activeElement !== el.sampleSearch) el.sampleSearch.value = sampleFilters.query;
    el.sampleField.value = sampleFilters.field;el.sampleSearch.placeholder = labels[sampleFilters.field] + (sampleFilters.field === "name" ? "으로 검색" : "로 검색");
    var busy = state.status === "connecting" || state.status === "loading";
    var message = localError || (state.status === "error" ? text(state.message) : "");
    el.sampleError.hidden = !message;el.sampleError.textContent = message;el.sampleList.setAttribute("aria-busy",String(busy));
    el.sampleSyncWarning.hidden = !state.publicSyncWarning;el.sampleSyncWarning.textContent = typeof state.publicSyncWarning === "string" ? state.publicSyncWarning : state.publicSyncWarning ? "목록 반영이 지연되고 있습니다. 잠시 후 다시 확인해 주세요." : "";
    var syncedAt = state.source && state.source.syncedAt, syncedDate = syncedAt ? new Date(syncedAt) : null;
    var hasSyncTime = !!(syncedDate && Number.isFinite(syncedDate.getTime()));
    el.sampleUpdated.hidden = !hasSyncTime;el.sampleUpdated.textContent = hasSyncTime ? "최근 반영 " + new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(syncedDate) : "";
    el.sampleUpdated.title = hasSyncTime ? syncedDate.toISOString() : "";
    el.sampleConnect.hidden = !!state.connected || !provider || typeof provider.connect !== "function";el.sampleConnect.disabled = busy;el.sampleConnect.textContent = state.status === "connecting" ? "로그인 중…" : "수정하려면 Google 로그인";
    el.sampleDisconnect.hidden = !state.connected || !provider || typeof provider.disconnect !== "function";el.sampleDisconnect.disabled = pendingSave();
    el.sampleAccount.hidden = !state.connected || !text(state.userLabel);el.sampleAccount.textContent = state.connected ? text(state.userLabel) : "";el.sampleAccount.title = state.connected ? text(state.userLabel) : "";el.sampleReadOnly.hidden = !records.length || !!(state.connected && state.canEdit);
    var rows = currentRows();el.sampleResultCount.textContent = records.length || settled ? rows.length + "건" + (sampleFilters.query ? " / 전체 " + records.length + "건" : "") : "";el.sampleReset.hidden = !sampleFilters.query && sampleFilters.field === "name";
    var active = document.activeElement, focusedId = null, focusedClass = null, selection = null;
    ["sample-location-input","sample-extension-date","sample-extension-reason"].some(function(className){
      if(!active || !active.classList || !active.classList.contains(className)) return false;
      var focusedRow = active.closest(".sample-record");if(focusedRow){focusedId = focusedRow.dataset.displayId;focusedClass = className;selection = [active.selectionStart,active.selectionEnd];}return true;
    });
    // 원격 갱신이 한글 조합 중인 입력 요소를 교체하지 않도록 조합 종료까지 기다립니다.
    if(state.connected && active && active._sampleComposing && focusedClass === "sample-extension-reason") return;
    el.sampleList.textContent = "";var fragment = document.createDocumentFragment();rows.forEach(function(row){fragment.appendChild(recordElement(row));});el.sampleList.appendChild(fragment);
    if(focusedId) Array.prototype.some.call(el.sampleList.querySelectorAll(".sample-record"),function(record){if(record.dataset.displayId !== focusedId) return false;var control = record.querySelector("." + focusedClass);if(control && !control.disabled){control.focus({preventScroll:true});if(selection && selection[0] !== null && control.setSelectionRange) control.setSelectionRange(selection[0],selection[1]);}return true;});
    el.sampleEmpty.hidden = rows.length > 0;el.sampleColumns.hidden = rows.length === 0;
    el.sampleEmpty.textContent = (busy || !settled) && !records.length ? "샘플 기록을 불러오고 있습니다."
      : (state.status === "error" || localError) && !records.length ? "샘플 기록을 불러오지 못했습니다. 위 안내를 확인해 주세요."
      : !records.length ? "등록된 샘플 기록이 없습니다." : "검색 결과가 없습니다. 검색 항목이나 검색어를 확인해 주세요.";
    if(typeof applyPendingScroll_ === "function") applyPendingScroll_();
  }
  function receive(next){
    if(!next || typeof next !== "object") {localError = "샘플 기록을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.";settled = true;render();return;}
    if(!next.connected){changes = Object.create(null);extensions = Object.create(null);}
    var nextRows = [], ids = Object.create(null);
    if(Array.isArray(next.records)) next.records.forEach(function(value,index){
      if(!value || typeof value !== "object" || missing(value.name)) return;
      var row = {};fields.forEach(function(field){row[field] = !next.connected && ["extensionReason","returnedDate"].indexOf(field) !== -1 ? "" : text(value[field]);});row.id = text(value.id);row.version = next.connected ? value.version : undefined;row.canEdit = next.connected ? value.canEdit : false;row.editReason = next.connected ? text(value.editReason) : "";row.returnCompleted = value.returnCompleted === true;row.sourceRow = next.connected ? Number(value.sourceRow) || 0 : 0;row.displayId = row.id || "unavailable-" + index;row.invalidId = !row.id;if(row.id) ids[row.id] = (ids[row.id] || 0) + 1;nextRows.push(row);
    });
    nextRows.forEach(function(row,index){if(ids[row.id] > 1){row.invalidId = true;row.displayId += "-duplicate-" + index;}if(row.invalidId){row.canEdit = false;row.editReason = row.editReason || "기록 확인 필요";}});
    records = nextRows.sort(function(a,b){return b.sourceRow - a.sourceRow;});state = next;settled = nextRows.length > 0 || next.status !== "loading" && next.status !== "connecting";localError = "";render();
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
  window.addEventListener("beforeunload",function(event){if(pendingSave()){event.preventDefault();event.returnValue = "";}});
  window.AiselSamples = {render:render,onShow:start,isReady:function(){return settled;}};
  render();restoreView_(window.history.state);
})();


