/* 샘플 화면은 팀원 연결 공급자를 통해 읽고, 담당자·작업구분만 명시적으로 저장합니다. */
(function(){
  "use strict";
  var fields = [["receivedDate","입출고일자"],["managementNumber","관리번호"],["supplier","공급처명"],["name","상품명"],["color","컬러"],["size","사이즈"],["quantity","수량"],["operation","작업구분"],["location","샘플위치"],["returnedDate","반납일자"],["owner","담당자"]];
  var labels = {name:"품명",managementNumber:"관리번호",color:"컬러"};
  var records = [], owners = [], drafts = Object.create(null), notices = Object.create(null);
  var state = {status:"disconnected",connected:false,canEdit:false,records:[],owners:[]};
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
  function changed(draft){return draft.owner !== draft.baseOwner || draft.operation !== draft.baseOperation;}
  function findRow(id){return records.filter(function(row){return row.id === id && !row.invalidId;})[0] || null;}
  function currentRows(){var needle = normalized(sampleFilters.query);return records.filter(function(row){return !needle || normalized(row[sampleFilters.field]).indexOf(needle) !== -1;});}
  function actButton(className,label,action){
    var button = node("button",className,label);button.type = "button";
    button.addEventListener("click",function(event){event.preventDefault();event.stopPropagation();action();});
    return button;
  }
  function beginEdit(row){
    if(!canEdit(row)) return;
    drafts[row.id] = {owner:row.owner,operation:row.operation,baseOwner:row.owner,baseOperation:row.operation,expectedVersion:copyVersion(row.version),saving:false,error:"",conflict:false};
    delete notices[row.id];render();
  }
  function editSelect(row,draft,key){
    var select = node("select",key === "owner" ? "sample-owner-input" : "sample-operation-input");
    select.setAttribute("aria-label",row.name + " " + (key === "owner" ? "담당자" : "작업구분"));
    var values = key === "owner" ? [""].concat(owners) : ["샘플출고","샘플반납"];
    var original = key === "owner" ? draft.baseOwner : draft.baseOperation;
    if(values.indexOf(original) === -1) values.unshift(original);
    if(values.indexOf(draft[key]) === -1) values.push(draft[key]);
    values.filter(function(value,index,array){return array.indexOf(value) === index;}).forEach(function(value){var option = node("option","",display(value));option.value = value;select.appendChild(option);});
    select.value = draft[key];select.disabled = draft.saving || !canEdit(row);
    select.addEventListener("click",function(event){event.stopPropagation();});
    select.addEventListener("keydown",function(event){event.stopPropagation();});
    select.addEventListener("change",function(){
      draft[key] = select.value;if(!draft.conflict) draft.error = "";
      var record = select.closest(".sample-record");
      var save = record && record.querySelector(".sample-save");if(save) save.disabled = !changed(draft) || draft.saving || draft.conflict || !canEdit(row);
      var error = record && record.querySelector(".sample-row-error");if(error && !draft.error) error.remove();
    });
    var result = node("span","sample-cell");result.appendChild(node("span","sample-mobile-label",key === "owner" ? "담당자" : "작업구분"));result.appendChild(select);return result;
  }
  function errorMessage(error,fallback){return error && typeof error.message === "string" && text(error.message) ? text(error.message) : fallback;}
  function saveDraft(id){
    var row = findRow(id), draft = drafts[id];
    if(!row || !draft || draft.saving || draft.conflict) return;
    if(!canEdit(row) || !provider || typeof provider.save !== "function") {draft.error = "수정 권한을 확인해 주세요. 입력한 내용은 유지했습니다.";render();return;}
    if(versionKey(row.version) !== versionKey(draft.expectedVersion)){draft.conflict = true;draft.error = "다른 변경이 있습니다. 취소 후 최신 기록에서 다시 수정해 주세요. 입력한 내용은 유지했습니다.";render();return;}
    var patch = {};
    if(draft.owner !== draft.baseOwner) patch.owner = draft.owner;
    if(draft.operation !== draft.baseOperation) patch.operation = draft.operation;
    if(!Object.keys(patch).length){delete drafts[id];render();return;}
    draft.saving = true;draft.error = "";render();
    Promise.resolve().then(function(){return provider.save({id:id,expectedVersion:copyVersion(draft.expectedVersion),patch:patch});}).then(function(next){
      if(drafts[id] !== draft) return;
      delete drafts[id];notices[id] = "저장됨";
      if(next) receive(next);else render();
    }).catch(function(error){
      if(drafts[id] !== draft) return;
      draft.saving = false;draft.error = errorMessage(error,"저장하지 못했습니다. 입력한 내용은 유지했습니다. 다시 저장해 주세요.");
      var latest = findRow(id);
      if(latest && versionKey(latest.version) !== versionKey(draft.expectedVersion)) draft.conflict = true;
      if(error && /conflict/i.test(String(error.code || ""))) draft.conflict = true;
      render();
    });
  }
  function recordElement(row,open){
    var draft = row.invalidId ? null : drafts[row.id];
    var details = node("details","sample-record" + (draft ? " editing" : ""));details.dataset.recordId = row.id;details.dataset.displayId = row.displayId;details.open = !!open;
    var summary = node("summary","sample-summary"), product = node("span","sample-product");
    product.appendChild(node("span","sample-product-name",row.name));product.appendChild(node("span","sample-product-meta","관리번호 " + display(row.managementNumber) + " · " + display(row.supplier)));
    var actions = node("span","sample-row-actions");
    if(draft){
      var save = actButton("sample-save",draft.saving ? "저장 중…" : "저장",function(){saveDraft(row.id);});save.disabled = !changed(draft) || draft.saving || draft.conflict || !canEdit(row);actions.appendChild(save);
      var cancel = actButton("sample-cancel","취소",function(){delete drafts[row.id];render();});cancel.disabled = draft.saving;actions.appendChild(cancel);
      if(draft.error || !canEdit(row)){var error = node("span","sample-row-error",draft.error || "수정 권한이 없습니다. 입력한 내용은 유지했습니다.");error.setAttribute("role","alert");product.appendChild(error);}
    }else if(canEdit(row)){
      actions.appendChild(actButton("sample-edit-toggle","수정",function(){beginEdit(row);}));
      if(notices[row.id]){var notice = node("span","sample-saved",notices[row.id]);notice.setAttribute("role","status");actions.appendChild(notice);}
    }else{
      var readOnly = node("span","sample-row-readonly",row.editReason || "읽기 전용");actions.appendChild(readOnly);
    }
    product.appendChild(actions);summary.appendChild(product);
    var options = node("span","sample-options");options.appendChild(node("span","sample-option-main",display(row.color)));options.appendChild(node("span","sample-option-sub","사이즈 " + display(row.size) + " · 수량 " + display(row.quantity)));summary.appendChild(options);
    summary.appendChild(draft ? editSelect(row,draft,"operation") : cell("작업구분",row.operation));
    var location = node("span","sample-cell");location.appendChild(node("span","sample-mobile-label","샘플 위치"));location.appendChild(node("span","sample-location " + (row.location === "사무실" ? "office" : row.location === "물류" ? "logistics" : missing(row.location) ? "missing" : ""),display(row.location)));summary.appendChild(location);
    summary.appendChild(draft ? editSelect(row,draft,"owner") : cell("담당자",row.owner));summary.appendChild(cell("입출고일자",row.receivedDate,"sample-date"));
    var chevron = node("span","sample-chevron");chevron.setAttribute("aria-hidden","true");summary.appendChild(chevron);details.appendChild(summary);
    var detail = node("div","sample-detail"), grid = node("dl","sample-detail-grid");
    fields.forEach(function(field){var item = node("div","sample-detail-field" + (field[0] === "name" ? " wide" : ""));item.appendChild(node("dt","",field[1]));item.appendChild(valueNode("dd","",row[field[0]]));grid.appendChild(item);});detail.appendChild(grid);details.appendChild(detail);return details;
  }
  function render(){
    if(document.activeElement !== el.sampleSearch) el.sampleSearch.value = sampleFilters.query;
    el.sampleField.value = sampleFilters.field;el.sampleSearch.placeholder = labels[sampleFilters.field] + (sampleFilters.field === "name" ? "으로 검색" : "로 검색");
    var busy = state.status === "connecting" || state.status === "loading";
    var message = localError || (state.status === "error" ? text(state.message) : "");
    el.sampleError.hidden = !message;el.sampleError.textContent = message;
    el.sampleList.setAttribute("aria-busy",String(busy));
    el.sampleConnect.hidden = !!state.connected || !provider || typeof provider.connect !== "function";
    el.sampleConnect.disabled = busy;el.sampleConnect.textContent = state.status === "connecting" ? "연결 중…" : "Google 계정으로 연결";
    el.sampleDisconnect.hidden = !state.connected || !provider || typeof provider.disconnect !== "function";
    el.sampleDisconnect.disabled = Object.keys(drafts).some(function(id){return drafts[id].saving;});
    el.sampleAccount.hidden = !state.connected || !text(state.userLabel);el.sampleAccount.textContent = text(state.userLabel);el.sampleAccount.title = text(state.userLabel);
    el.sampleReadOnly.hidden = !state.connected || state.canEdit;
    var rows = currentRows();
    el.sampleResultCount.textContent = state.connected ? rows.length + "건" + (sampleFilters.query ? " / 전체 " + records.length + "건" : "") : "";
    el.sampleReset.hidden = !sampleFilters.query && sampleFilters.field === "name";
    var opened = Object.create(null), active = document.activeElement, focused = null;
    if(active && active.closest){var activeRow = active.closest(".sample-record");if(activeRow && (active.classList.contains("sample-owner-input") || active.classList.contains("sample-operation-input"))) focused = {id:activeRow.dataset.displayId,owner:active.classList.contains("sample-owner-input")};}
    Array.prototype.forEach.call(el.sampleList.querySelectorAll("details[open]"),function(detail){opened[detail.dataset.displayId] = true;});
    el.sampleList.textContent = "";var fragment = document.createDocumentFragment();rows.forEach(function(row){fragment.appendChild(recordElement(row,opened[row.displayId]));});el.sampleList.appendChild(fragment);
    if(focused) Array.prototype.some.call(el.sampleList.querySelectorAll(".sample-record"),function(record){if(record.dataset.displayId !== focused.id) return false;var control = record.querySelector(focused.owner ? ".sample-owner-input" : ".sample-operation-input");if(control && !control.disabled) control.focus({preventScroll:true});return true;});
    el.sampleEmpty.hidden = rows.length > 0;el.sampleColumns.hidden = rows.length === 0;
    el.sampleEmpty.textContent = !state.connected ? (state.status === "connecting" ? "계정에 연결하고 있습니다." : "팀원 계정으로 연결하면 샘플 기록을 확인할 수 있습니다.")
      : busy && !records.length ? "샘플 기록을 불러오고 있습니다."
      : state.status === "error" && !records.length ? "샘플 기록을 불러오지 못했습니다. 위 안내를 확인해 주세요."
      : !records.length ? "등록된 샘플 기록이 없습니다." : "검색 결과가 없습니다. 검색 항목이나 검색어를 확인해 주세요.";
    if(typeof applyPendingScroll_ === "function") applyPendingScroll_();
  }
  function receive(next){
    if(!next || typeof next !== "object") {localError = "샘플 기록을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.";settled = true;render();return;}
    if(!next.connected && next.status !== "connecting"){drafts = Object.create(null);notices = Object.create(null);}
    var nextRows = [], ids = Object.create(null);
    if(next.connected && Array.isArray(next.records)) next.records.forEach(function(value,index){
      if(!value || typeof value !== "object" || missing(value.name)) return;
      var row = {};fields.forEach(function(field){row[field[0]] = text(value[field[0]]);});row.id = text(value.id);row.version = value.version;row.canEdit = value.canEdit;row.editReason = text(value.editReason);row.sourceRow = Number(value.sourceRow) || 0;row.displayId = row.id || "unavailable-" + index;
      row.invalidId = !row.id;if(row.id) ids[row.id] = (ids[row.id] || 0) + 1;nextRows.push(row);
    });
    nextRows.forEach(function(row,index){
      if(ids[row.id] > 1){row.invalidId = true;row.displayId += "-duplicate-" + index;}
      if(row.invalidId){row.canEdit = false;row.editReason = row.editReason || "기록 확인 필요";}
      var draft = !row.invalidId && drafts[row.id];
      if(draft && !draft.saving && versionKey(row.version) !== versionKey(draft.expectedVersion)){draft.conflict = true;draft.error = "다른 변경이 있습니다. 취소 후 최신 기록에서 다시 수정해 주세요. 입력한 내용은 유지했습니다.";}
    });
    records = nextRows.sort(function(a,b){return b.sourceRow - a.sourceRow;});
    owners = Array.isArray(next.owners) ? next.owners.map(text).filter(function(value,index,array){return value && array.indexOf(value) === index;}) : [];
    state = next;settled = next.status !== "loading" && next.status !== "connecting";localError = "";render();
  }
  function start(){
    if(started){render();return;}
    started = true;provider = window.AiselSampleData || null;
    if(!provider){settled = true;render();return;}
    try{
      if(typeof provider.subscribe === "function") unsubscribe = provider.subscribe(receive);
      else if(typeof provider.getState === "function") receive(provider.getState());
      if(typeof provider.load === "function") Promise.resolve(provider.load()).then(function(next){if(next) receive(next);}).catch(function(error){localError = errorMessage(error,"샘플 기록을 불러오지 못했습니다. 잠시 후 다시 연결해 주세요.");settled = true;render();});
    }catch(error){localError = errorMessage(error,"샘플 기록을 불러오지 못했습니다. 잠시 후 다시 연결해 주세요.");settled = true;render();}
  }
  function change(key,value,replace){var next = Object.assign({},sampleFilters);next[key] = value;navigateSamples_(next,!!replace);}
  el.sampleSearch.addEventListener("input",function(event){var next = text(event.target.value);if(next !== sampleFilters.query) change("query",next,!!sampleFilters.query && !!next);});
  el.sampleField.addEventListener("change",function(event){change("field",event.target.value,false);});
  el.sampleReset.addEventListener("click",function(){navigateSamples_({query:"",field:"name"},false);});
  el.sampleConnect.addEventListener("click",function(){
    if(!provider || typeof provider.connect !== "function" || state.status === "connecting") return;
    localError = "";
    Promise.resolve().then(function(){return provider.connect();}).then(function(next){if(next) receive(next);}).catch(function(error){localError = errorMessage(error,"계정 연결을 완료하지 못했습니다. 다시 시도해 주세요.");settled = true;render();});
  });
  el.sampleDisconnect.addEventListener("click",function(){
    if(!provider || typeof provider.disconnect !== "function") return;
    if(Object.keys(drafts).some(function(id){return changed(drafts[id]);}) && !window.confirm("저장하지 않은 변경사항이 있습니다. 연결을 해제하면 입력한 내용이 사라집니다. 연결을 해제할까요?")) return;
    Promise.resolve().then(function(){return provider.disconnect();}).then(function(next){
      if(next) receive(next);else receive({status:"disconnected",connected:false,canEdit:false,records:[],owners:[]});
    }).catch(function(error){localError = errorMessage(error,"연결을 해제하지 못했습니다. 다시 시도해 주세요.");render();});
  });
  window.addEventListener("beforeunload",function(event){
    if(Object.keys(drafts).some(function(id){return drafts[id].saving || changed(drafts[id]);})){event.preventDefault();event.returnValue = "";}
  });
  window.AiselSamples = {render:render,onShow:start,isReady:function(){return settled;}};
  render();restoreView_(window.history.state);
})();
