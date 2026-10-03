/* 샘플 인수인계 수량과 반납 기한. 원본 저장과 인증은 연결 공급자가 처리합니다. */
(function(){
  "use strict";
  var fields = ["name","color","size","quantity","operation","location","owner","receivedDate","returnedDate","returnDueDate","extensionReason","flowState","flowTotal","officeSent","officeReceived","returnSent","warehouseReceived","cafe24Reflected","sellmateReflected"];
  var labels = {name:"품명",color:"컬러"};
  var records = [], changes = Object.create(null), extensions = Object.create(null), completedOpen = false, flowNotice = "";
  var state = {status:"disconnected",connected:false,canEdit:false,records:[]};
  var provider = null, started = false, settled = false, localError = "", unsubscribe = null;
  var el = {};
  ["sampleSearch","sampleField","sampleReset","sampleList","sampleEmpty","sampleResultCount","sampleError","sampleSyncWarning","sampleUpdated","sampleColumns","sampleEditTools","sampleConnect","sampleDisconnect","sampleAccount","sampleOutboundTab","sampleReturnsTab","sampleOutboundCount","sampleReturnsCount","sampleWarehouseFilter","sampleInventoryFilter","sampleWarehouseCount","sampleInventoryCount","sampleFlowResult"].forEach(function(id){el[id] = document.getElementById(id);});
  function text(value){return value === null || value === undefined ? "" : String(value).trim();}
  function missing(value){return !text(value) || /^[—–-]+$/.test(text(value));}
  function display(value){return missing(value) ? "미입력" : text(value);}
  function normalized(value){return text(value).toLowerCase().replace(/\s+/g,"");}
  function versionKey(value){return JSON.stringify(value === undefined ? null : value);}
  function copyVersion(value){return value === undefined ? null : JSON.parse(JSON.stringify(value));}
  function node(tag,className,value){var result = document.createElement(tag);if(className) result.className = className;if(value !== undefined) result.textContent = value;return result;}
  function valueNode(tag,className,value){return node(tag,className + (missing(value) ? " sample-missing" : ""),display(value));}
  function cell(label,value,className){var result = node("span","sample-cell " + (className || ""));result.appendChild(node("span","sample-mobile-label",label));result.appendChild(valueNode("span","",value));return result;}
  function responsiveValue(value,compact){
    var result = node("span","sample-responsive-value");result.title = display(value);
    result.appendChild(valueNode("span","sample-full-value",value));
    var shortValue = node("span","sample-compact-value",compact);shortValue.setAttribute("aria-hidden","true");result.appendChild(shortValue);return result;
  }
  function shortDate(value){
    var normalizedDate = provider && typeof provider.normalizeDate === "function" ? provider.normalizeDate(value) : "";
    var currentYear = new Intl.DateTimeFormat("en",{timeZone:"Asia/Seoul",year:"numeric"}).format(new Date());
    return normalizedDate ? (normalizedDate.slice(0,4) === currentYear ? normalizedDate.slice(5) : normalizedDate).replace(/-/g,"/") : missing(value) ? "—" : text(value);
  }
  function dateCell(label,value,className){var result = node("span","sample-cell " + className);result.appendChild(node("span","sample-mobile-label",label));result.appendChild(responsiveValue(value,shortDate(value)));return result;}
  function canEdit(row){return !!(state.connected && state.canEdit && row.canEdit !== false && row.id && !row.invalidId && row.version !== undefined && row.version !== null);}
  function findRow(id){return records.filter(function(row){return row.id === id && !row.invalidId;})[0] || null;}
  function currentRows(){var needle = normalized(sampleFilters.query);return records.filter(function(row){return !needle || normalized(row[sampleFilters.field]).indexOf(needle) !== -1;});}
  function flowInfo(row){
    if(window.AiselSampleFlow && typeof window.AiselSampleFlow.inspect === "function") return window.AiselSampleFlow.inspect(row);
    return {state:"invalid",valid:false,error:"진행 정보를 불러오지 못했습니다.",groups:["review"],statusLabel:"현황 확인 필요",stageLabel:"현황 확인 필요",actor:"",nextActions:[],counts:{},pending:{warehouseReceipt:0,inventory:0},total:0,returnComplete:false};
  }
  function hasGroup(row,group){return flowInfo(row).groups.indexOf(group) !== -1;}
  function selectedRows(rows){
    var result = {main:[],arrival:[],review:[],completed:[]};
    rows.forEach(function(row){
      var info = flowInfo(row);
      if(info.groups.indexOf("review") !== -1){result.review.push(row);return;}
      if(info.groups.indexOf("completed") !== -1){result.completed.push(row);return;}
      if(info.groups.indexOf("arrival") !== -1){if(sampleFilters.query || sampleFilters.flowTab === "outbound") result.arrival.push(row);return;}
      if(sampleFilters.query){result.main.push(row);return;}
      if(info.groups.indexOf(sampleFilters.flowTab) === -1) return;
      if(sampleFilters.flowTab === "returns" && sampleFilters.attention !== "all" && !(info.pending[sampleFilters.attention] > 0)) return;
      result.main.push(row);
    });
    return result;
  }
  function renderFlowTabs(){
    [["outbound","sampleOutboundTab","sampleOutboundCount"],["returns","sampleReturnsTab","sampleReturnsCount"]].forEach(function(item){
      var selected = sampleFilters.flowTab === item[0];el[item[1]].classList.toggle("on",selected);el[item[1]].setAttribute("aria-pressed",String(selected));
      el[item[2]].textContent = records.filter(function(row){return hasGroup(row,item[0]);}).length;
    });
    [["warehouseReceipt","sampleWarehouseFilter","sampleWarehouseCount"],["inventory","sampleInventoryFilter","sampleInventoryCount"]].forEach(function(item){
      var selected = sampleFilters.flowTab === "returns" && sampleFilters.attention === item[0];el[item[1]].classList.toggle("on",selected);el[item[1]].setAttribute("aria-pressed",String(selected));
      el[item[2]].textContent = records.filter(function(row){var info = flowInfo(row);return info.groups.indexOf("returns") !== -1 && info.pending[item[0]] > 0;}).length;
    });
  }
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
    if(!row || !canEdit(row) || !returnInfo(row).canExtend || changes[id] && (changes[id].saving || changes[id].editing) || current && current.saving) return;
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
  function beginFlow(id,type){
    var row = findRow(id), info = row && flowInfo(row);
    if(!row || !canEdit(row) || !window.AiselSampleFlow || changes[id] && changes[id].saving || extensions[id] && (extensions[id].saving || extensions[id].editing)) return;
    var action = type === "initialize" && info.state === "unverified" && info.valid ? {type:type,label:"현황 확인",actor:"실제 수량 확인"} : info.nextActions.filter(function(value){return value.type === type;})[0];
    if(!action) return;
    changes[id] = {editing:true,saving:false,saved:false,type:type,start:"",quantity:"",expectedVersion:copyVersion(row.version),sourceOwner:row.owner,label:action.label,actor:action.actor,error:""};
    render();focusRowControl(id,type === "initialize" ? "sample-flow-start" : "sample-flow-quantity");
  }
  function cancelFlow(id){if(changes[id] && changes[id].saving) return;delete changes[id];render();focusRowControl(id,"sample-flow-trigger");}
  function saveFlow(id){
    var row = findRow(id), change = changes[id];
    if(!row || !change || !change.editing || change.saving || extensions[id] && extensions[id].saving) return;
    var info = flowInfo(row), action = {type:change.type,quantity:Number(change.quantity)};
    if(change.type === "initialize") action.start = change.start;
    if(!canEdit(row) || !provider || typeof provider.save !== "function") change.error = "이 기록을 변경할 권한을 확인해 주세요.";
    else if(versionKey(row.version) !== versionKey(change.expectedVersion)) change.error = "다른 변경이 있습니다. 취소 후 최신 수량에서 다시 확인해 주세요.";
    else if(!String(change.quantity).trim() || !Number.isSafeInteger(action.quantity) || action.quantity <= 0) change.error = "실제로 확인한 수량을 1개 이상 정수로 입력해 주세요.";
    else {
      try{window.AiselSampleFlow.apply(row,action);change.error = "";}catch(error){change.error = errorMessage(error,"진행 상태와 확인 수량을 다시 확인해 주세요.");}
      if(!change.error){
        change.saving = true;change.saved = false;render();
        Promise.resolve().then(function(){return provider.save({id:id,expectedVersion:copyVersion(change.expectedVersion),action:action});}).then(function(next){
          if(changes[id] !== change) return;
          change.saving = false;change.editing = false;change.saved = true;
          flowNotice = change.label + " · " + action.quantity + "개 확인했습니다.";
          if(next) receive(next);else render();
        }).catch(function(error){
          if(changes[id] !== change) return;
          change.saving = false;change.saved = false;change.error = error && /conflict/i.test(String(error.code || "")) ? "다른 변경이 있어 저장하지 않았습니다. 취소 후 최신 수량에서 다시 확인해 주세요." : errorMessage(error,"저장하지 못했습니다. 입력한 수량은 유지했습니다.");render();
        });
        return;
      }
    }
    render();focusRowControl(id,"sample-flow-quantity");
  }
  function locationCell(row){
    var result = node("span","sample-cell sample-location-cell");result.appendChild(node("span","sample-mobile-label","기록 위치"));
    var badge = node("span","sample-location-badge" + (row.location === "물류" ? " warehouse" : row.location === "사무실" ? " office" : ""),display(row.location));result.appendChild(badge);return result;
  }
  function workflowElement(row){
    var info = flowInfo(row), change = row.invalidId ? null : changes[row.id], box = node("div","sample-flow-bar"), form = null;
    if(info.state === "invalid") box.appendChild(node("span","sample-flow-note",info.error || "기록의 수량과 진행 상태를 확인해 주세요."));
    if(info.state === "unverified") box.appendChild(node("span","sample-flow-note","기존 기록 · 실제 위치와 수량 확인 필요"));
    else if(info.valid){
      var counts = info.counts;
      var progress = info.state === "arrival" ? "입고 예정 " + info.total + "개 · 실제 도착 확인 전" : "관리 " + info.total + "개 · 사무실 발송 " + counts.officeSent + " / 수령 " + counts.officeReceived + " · 반납 발송 " + counts.returnSent + " / 물류 수령 " + counts.warehouseReceived + " · 카페24 " + counts.cafe24Reflected + " / 셀메이트 " + counts.sellmateReflected;
      box.appendChild(node("span","sample-flow-progress",progress));
    }
    var available = info.state === "unverified" && info.valid ? [{type:"initialize",label:"현황 확인",actor:"실제 수량 확인"}] : info.nextActions;
    if(canEdit(row) && !(change && change.editing)){
      var actions = node("div","sample-flow-actions");
      available.forEach(function(action){
        var button = node("button","sample-flow-trigger",action.label);button.type = "button";button.dataset.action = action.type;button.disabled = !!(change && change.saving || extensions[row.id] && (extensions[row.id].saving || extensions[row.id].editing));
        button.setAttribute("aria-label",row.name + " " + display(row.color) + " " + action.label);
        button.addEventListener("click",function(){beginFlow(row.id,action.type);});actions.appendChild(button);
      });
      if(actions.childNodes.length) box.appendChild(actions);
    }
    if(change && change.editing && canEdit(row)){
      form = node("form","sample-flow-form");form.noValidate = true;
      var actionTitle = node("span","sample-flow-form-title",change.label + (change.actor ? " · " + change.actor : ""));form.appendChild(actionTitle);
      if(change.type === "initialize"){
        var startLabel = node("label","sample-flow-field");startLabel.appendChild(node("span","sample-return-label","현재 시작 상태"));
        var select = node("select","sample-flow-start");var blank = node("option","","상태 선택");blank.value = "";blank.disabled = true;select.appendChild(blank);
        window.AiselSampleFlow.INITIAL_OPTIONS.forEach(function(option){var item = node("option","",option.label);item.value = option.value;select.appendChild(item);});select.value = change.start;select.disabled = change.saving;
        select.addEventListener("change",function(){change.start = select.value;});startLabel.appendChild(select);form.appendChild(startLabel);
      }
      var currentAction = info.nextActions.filter(function(action){return action.type === change.type;})[0];
      var maximum = change.type === "initialize" ? Number(row.quantity) : currentAction && currentAction.max;
      var quantityLabel = node("label","sample-flow-field");quantityLabel.appendChild(node("span","sample-return-label",change.type === "initialize" ? "확인 수량" : "이번 확인 수량"));
      var input = node("input","sample-flow-quantity");input.type = "number";input.inputMode = "numeric";input.min = "1";input.step = "1";input.required = true;input.value = change.quantity;input.disabled = change.saving;input.placeholder = Number.isSafeInteger(maximum) && maximum > 0 ? maximum + (change.type === "initialize" ? "개 확인" : "개 이하") : "수량 입력";
      if(Number.isSafeInteger(maximum) && maximum > 0) input.max = String(maximum);
      input.addEventListener("input",function(){change.quantity = input.value;});quantityLabel.appendChild(input);form.appendChild(quantityLabel);
      var actions = node("div","sample-flow-form-actions"), submit = node("button","sample-flow-save",change.saving ? "저장 중…" : "확인 기록");submit.type = "submit";submit.disabled = change.saving;actions.appendChild(submit);
      var cancel = node("button","sample-flow-cancel","취소");cancel.type = "button";cancel.disabled = change.saving;cancel.addEventListener("click",function(){cancelFlow(row.id);});actions.appendChild(cancel);form.appendChild(actions);
      if(change.type === "reflectCafe24" || change.type === "reflectSellmate") form.appendChild(node("span","sample-flow-form-help",(change.type === "reflectCafe24" ? "카페24" : "셀메이트") + " 재고에 이미 반영한 수량을 기록합니다."));
      else if(change.type === "initialize") form.appendChild(node("span","sample-flow-form-help",Number.isSafeInteger(maximum) && maximum > 0 ? "원본 수량 " + maximum + "개와 실제 확인 수량을 맞춰 주세요. 입고 대기는 예정 수량입니다." : "입고 대기는 예정 수량, 그 외 상태는 실제 확인한 수량으로 시작합니다."));
      if(change.error){var error = node("span","sample-row-error sample-flow-error",change.error);error.setAttribute("role","alert");form.appendChild(error);}
      form.addEventListener("submit",function(event){event.preventDefault();saveFlow(row.id);});
    }
    return {bar:box,form:form};
  }
  function returnElement(row){
    var info = returnInfo(row), change = row.invalidId ? null : extensions[row.id];
    var result = node("div","sample-cell sample-return"), summary = node("div","sample-return-summary"), form = null;
    if(!info.isOutgoing && !info.completed && !info.dueDate){result.appendChild(node("span","sample-mobile-label","반납 예정일"));result.appendChild(node("span","sample-missing","—"));return {cell:result,form:null};}
    if(info.isOutgoing || info.dueDate){
      var due = node("span","sample-return-date");due.appendChild(node("span","sample-mobile-label","반납 예정일"));
      var dueLabel = node("span","sample-compact-value sample-due-label","반납 ");dueLabel.setAttribute("aria-hidden","true");due.appendChild(dueLabel);
      due.appendChild(responsiveValue(info.dueDate || "확인 필요",info.dueDate ? shortDate(info.dueDate) : "확인 필요"));summary.appendChild(due);
    }
    if(info.completed){
      if(state.connected && missing(row.returnedDate) && flowInfo(row).returnComplete){
        summary.appendChild(node("span","sample-return-completed","반납 수령 확인"));
      }else if(state.connected){
        var actual = node("span","sample-return-actual");actual.appendChild(node("span","sample-return-label","실제 반납일"));
        actual.appendChild(responsiveValue(missing(row.returnedDate) ? "입력 필요" : provider.normalizeDate(row.returnedDate) || row.returnedDate,missing(row.returnedDate) ? "입력 필요" : shortDate(row.returnedDate)));summary.appendChild(actual);
      }else summary.appendChild(node("span","sample-return-completed","반납 완료"));
    }
    var allowed = canEdit(row) && info.canExtend;
    if(allowed && !(change && change.editing)){
      var extend = node("button","sample-extend","연장");extend.type = "button";extend.disabled = !!(changes[row.id] && (changes[row.id].saving || changes[row.id].editing));
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
    var line = node("div","sample-row"), primary = node("div","sample-primary-line"), secondary = node("div","sample-secondary-line"), product = node("span","sample-product");product.appendChild(node("span","sample-product-name",row.name));
    var info = flowInfo(row);var stage = node("span","sample-flow-stage",info.statusLabel || info.stageLabel);stage.title = info.stageLabel || "";product.appendChild(stage);if(info.actor) product.appendChild(node("span","sample-flow-actor",info.actor));
    var statusId = "sample-location-status-" + encodeURIComponent(row.displayId).replace(/%/g,"_");
    if(change && (change.saving || change.saved || change.error && !change.editing)){
      var status = node("span",change.error ? "sample-row-error" : change.saving ? "sample-saving" : "sample-saved",change.error || (change.saving ? "저장 중…" : "저장됨"));
      status.id = statusId;status.setAttribute("role",change.error ? "alert" : "status");product.appendChild(status);
    }
    primary.appendChild(product);
    var options = node("span","sample-options");options.appendChild(node("span","sample-option-main",display(row.color)));
    var shownQuantity = missing(row.quantity) && info.total > 0 ? info.total : row.quantity;
    var optionSub = node("span","sample-option-sub"), fullOptions = "사이즈 " + display(row.size) + " · 수량 " + display(shownQuantity);
    var compactQuantity = missing(shownQuantity) ? "수량 —" : text(shownQuantity) + (/^\d+(?:\.\d+)?$/.test(text(shownQuantity)) ? "개" : "");
    optionSub.appendChild(responsiveValue(fullOptions,"사이즈 " + (missing(row.size) ? "—" : text(row.size)) + " · " + compactQuantity));options.appendChild(optionSub);primary.appendChild(options);line.appendChild(primary);
    var operation = node("span","sample-cell sample-operation");operation.appendChild(node("span","sample-mobile-label","작업구분"));
    operation.appendChild(responsiveValue(row.operation,text(row.operation).replace(/^샘플(?=출고|반납|입고)/,"") || "미입력"));secondary.appendChild(operation);secondary.appendChild(locationCell(row,change,statusId));
    secondary.appendChild(cell("담당자",change && change.saving ? change.sourceOwner : row.owner,"sample-owner"));secondary.appendChild(dateCell("입출고일자",row.receivedDate,"sample-date"));
    var returnRow = returnElement(row);secondary.appendChild(returnRow.cell);line.appendChild(secondary);record.appendChild(line);var flow = workflowElement(row);record.appendChild(flow.bar);if(flow.form) record.appendChild(flow.form);if(returnRow.form) record.appendChild(returnRow.form);return record;
  }
  function sectionElement(key,title,rows,note){
    if(!rows.length) return null;
    var section = node(key === "completed" ? "details" : "section","sample-group sample-group-" + key);section.dataset.group = key;
    if(key === "completed"){
      section.open = !!sampleFilters.query || completedOpen;var toggle = node("summary","sample-group-title",title + " · " + rows.length + "건");section.appendChild(toggle);
      section.addEventListener("toggle",function(){if(!sampleFilters.query) completedOpen = section.open;});
    }else{section.appendChild(node("h4","sample-group-title",title + " · " + rows.length + "건"));}
    if(note) section.appendChild(node("p","sample-group-note",note));
    var list = node("div","sample-group-list");rows.forEach(function(row){list.appendChild(recordElement(row));});section.appendChild(list);return section;
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
    el.sampleConnect.hidden = !!state.connected || !provider || typeof provider.connect !== "function";el.sampleConnect.disabled = busy;el.sampleConnect.textContent = state.status === "connecting" ? "로그인 중…" : "Google 연결 후 여기서 수정";
    el.sampleDisconnect.hidden = !state.connected || !provider || typeof provider.disconnect !== "function";el.sampleDisconnect.disabled = pendingSave();
    el.sampleAccount.hidden = !state.connected || !text(state.userLabel);el.sampleAccount.textContent = state.connected ? text(state.userLabel) : "";el.sampleAccount.title = state.connected ? text(state.userLabel) : "";
    renderFlowTabs();el.sampleFlowResult.hidden = !flowNotice;el.sampleFlowResult.textContent = flowNotice;
    var rows = currentRows(), grouped = selectedRows(rows), shownCount = grouped.main.length + grouped.arrival.length + grouped.review.length + grouped.completed.length;
    el.sampleResultCount.textContent = records.length || settled ? shownCount + "건" + (sampleFilters.query ? " / 전체 " + records.length + "건" : "") : "";el.sampleReset.hidden = !sampleFilters.query && sampleFilters.field === "name";
    var active = document.activeElement, focusedId = null, focusedClass = null, selection = null;
    ["sample-flow-start","sample-flow-quantity","sample-extension-date","sample-extension-reason"].some(function(className){
      if(!active || !active.classList || !active.classList.contains(className)) return false;
      var focusedRow = active.closest(".sample-record");if(focusedRow){focusedId = focusedRow.dataset.displayId;focusedClass = className;selection = [active.selectionStart,active.selectionEnd];}return true;
    });
    // 원격 갱신이 한글 조합 중인 입력 요소를 교체하지 않도록 조합 종료까지 기다립니다.
    if(state.connected && active && active._sampleComposing && focusedClass === "sample-extension-reason") return;
    el.sampleList.textContent = "";var fragment = document.createDocumentFragment();
    [["main",sampleFilters.query ? "전체 검색 결과" : sampleFilters.flowTab === "outbound" ? "출고 진행" : "반납·재고 확인",""],["arrival","입고 대기","도착과 실제 수량을 확인한 뒤 출고를 진행합니다."],["review","현황 확인 필요","기존 기록의 실제 위치와 수량을 먼저 확인해 주세요."],["completed","완료 기록","물류 수령과 카페24·셀메이트 재고 반영까지 확인된 기록입니다."]].forEach(function(item){var section = sectionElement(item[0],item[1],grouped[item[0]],item[2]);if(section) fragment.appendChild(section);});el.sampleList.appendChild(fragment);
    if(focusedId) Array.prototype.some.call(el.sampleList.querySelectorAll(".sample-record"),function(record){if(record.dataset.displayId !== focusedId) return false;var control = record.querySelector("." + focusedClass);if(control && !control.disabled){control.focus({preventScroll:true});if(selection && selection[0] !== null && control.setSelectionRange) control.setSelectionRange(selection[0],selection[1]);}return true;});
    el.sampleEmpty.hidden = shownCount > 0;el.sampleColumns.hidden = shownCount === 0;
    el.sampleEmpty.textContent = (busy || !settled) && !records.length ? "샘플 기록을 불러오고 있습니다."
      : (state.status === "error" || localError) && !records.length ? "샘플 기록을 불러오지 못했습니다. 위 안내를 확인해 주세요."
      : !records.length ? "등록된 샘플 기록이 없습니다." : sampleFilters.query ? "검색 결과가 없습니다. 검색 항목이나 검색어를 확인해 주세요." : "이 단계에서 확인할 기록이 없습니다.";
    if(typeof applyPendingScroll_ === "function") applyPendingScroll_();
  }
  function receive(next){
    if(!next || typeof next !== "object") {localError = "샘플 기록을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.";settled = true;render();return;}
    if(!next.connected){changes = Object.create(null);extensions = Object.create(null);flowNotice = "";}
    var nextRows = [], ids = Object.create(null);
    if(Array.isArray(next.records)) next.records.forEach(function(value,index){
      if(!value || typeof value !== "object" || missing(value.name)) return;
      var row = {};fields.forEach(function(field){row[field] = !next.connected && ["extensionReason","returnedDate"].indexOf(field) !== -1 ? "" : text(value[field]);});row.id = text(value.id);row.version = next.connected ? value.version : undefined;row.canEdit = next.connected ? value.canEdit : false;row.editReason = next.connected ? text(value.editReason) : "";row.flowUpdatedAt = next.connected ? text(value.flowUpdatedAt) : "";row.flowUpdatedBy = next.connected ? text(value.flowUpdatedBy) : "";row.returnCompleted = value.returnCompleted === true;row.sourceRow = next.connected ? Number(value.sourceRow) || 0 : 0;row.displayId = row.id || "unavailable-" + index;row.invalidId = !row.id;if(row.id) ids[row.id] = (ids[row.id] || 0) + 1;nextRows.push(row);
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
  el.sampleField.addEventListener("change",function(event){change("field",event.target.value,false);});el.sampleReset.addEventListener("click",function(){navigateSamples_(Object.assign({},sampleFilters,{query:"",field:"name"}),false);});
  [["sampleOutboundTab","outbound"],["sampleReturnsTab","returns"]].forEach(function(item){el[item[0]].addEventListener("click",function(){navigateSamples_(Object.assign({},sampleFilters,{flowTab:item[1],attention:"all"}),false);});});
  [["sampleWarehouseFilter","warehouseReceipt"],["sampleInventoryFilter","inventory"]].forEach(function(item){el[item[0]].addEventListener("click",function(){var active = sampleFilters.flowTab === "returns" && sampleFilters.attention === item[1];navigateSamples_(Object.assign({},sampleFilters,{flowTab:"returns",attention:active ? "all" : item[1]}),false);});});
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



