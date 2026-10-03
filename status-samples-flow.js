/* Sample custody quantities. Pure functions: no storage, dates, or network access. */
(function(root, factory){
  if(typeof module === "object" && module.exports) module.exports = factory();
  else root.AiselSampleFlow = factory();
})(typeof window === "undefined" ? this : window, function(){
  "use strict";
  var HEADERS = ["진행상태","관리수량","사무실발송수량","사무실수령수량","반납발송수량","물류수령수량","카페24반영수량","셀메이트반영수량","진행확인시각","진행확인계정"];
  var FIELDS = ["flowState","flowTotal","officeSent","officeReceived","returnSent","warehouseReceived","cafe24Reflected","sellmateReflected","flowUpdatedAt","flowUpdatedBy"];
  var PUBLIC_FIELDS = FIELDS.slice(0,8);
  var COUNT_FIELDS = FIELDS.slice(2,8);
  var INITIAL_OPTIONS = [
    {value:"arrival",label:"아직 입고 전",actor:"이주용"},
    {value:"warehouse",label:"물류에 실제 입고됨 · 사무실 발송 전",actor:"이주용"},
    {value:"office",label:"사무실에서 실제 보관 중",actor:"최연경"},
    {value:"returned",label:"물류에서 반납 실물 수령함 · 재고 확인 전",actor:"이주용"}
  ];
  var ACTIONS = [
    {type:"sendOffice",field:"officeSent",label:"사무실 발송",actor:"이주용"},
    {type:"receiveOffice",field:"officeReceived",label:"사무실 수령 확인",actor:"최연경"},
    {type:"sendReturn",field:"returnSent",label:"물류로 반납 발송",actor:"최연경"},
    {type:"receiveWarehouse",field:"warehouseReceived",label:"물류 수령 확인",actor:"이주용"},
    {type:"reflectCafe24",field:"cafe24Reflected",label:"카페24 반영 완료 확인",actor:"이주용"},
    {type:"reflectSellmate",field:"sellmateReflected",label:"셀메이트 반영 완료 확인",actor:"이주용"}
  ];
  function text(value){return value == null ? "" : String(value).trim();}
  function isRecord(value){return !!value && typeof value === "object" && !Array.isArray(value);}
  function integer(value){
    if(typeof value !== "string" && typeof value !== "number") return null;
    var raw = text(value);
    if(!/^\d+$/.test(raw)) return null;
    var number = Number(raw);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }
  function sourceQuantity(value){
    var raw = text(value);
    if(!raw || /^[—–-]+$/.test(raw)) return {missing:true,value:null};
    // The original quantity column may have a thousands separator display format.
    if(/^\d{1,3}(,\d{3})+$/.test(raw)) raw = raw.replace(/,/g,"");
    var number = integer(raw);
    return {missing:false,value:number !== null && number > 0 ? number : null};
  }
  function failure(code,message){var error = new Error(message);error.name = "AiselSampleFlowError";error.code = code;return error;}
  function base(){return {state:"unverified",valid:true,error:"",total:0,counts:{officeSent:0,officeReceived:0,returnSent:0,warehouseReceived:0,cafe24Reflected:0,sellmateReflected:0},groups:["review"],statusLabel:"현황 확인 필요",stageLabel:"실제 위치와 수량을 확인해 주세요.",actor:"이주용 · 최연경",nextActions:[],pending:{warehouseReceipt:0,inventory:0},returnComplete:false};}
  function invalid(info,message){info.state = "invalid";info.valid = false;info.error = message;info.groups = ["review"];info.statusLabel = "진행 기록 확인 필요";info.stageLabel = message;info.nextActions = [];info.pending = {warehouseReceipt:0,inventory:0};info.returnComplete = false;return info;}
  function sameCounts(counts,total){return COUNT_FIELDS.every(function(key){return counts[key] === total;});}
  function inspect(record){
    var info = base();
    if(!isRecord(record)) return invalid(info,"샘플 기록을 확인해 주세요.");
    var state = text(record.flowState);
    if(!state){
      if(FIELDS.slice(1).some(function(key){return text(record[key]) !== "";})) return invalid(info,"진행상태가 없는 수량 기록입니다. 원본 시트를 확인해 주세요.");
      var known = sourceQuantity(record.quantity);
      info.total = known.value || 0;
      return info;
    }
    if(["입고대기","진행중","완료"].indexOf(state) < 0) return invalid(info,"알 수 없는 진행상태입니다. 원본 시트를 확인해 주세요.");
    var total = integer(record.flowTotal);
    if(total === null || total < 1) return invalid(info,"관리수량은 1장 이상의 정수여야 합니다.");
    info.total = total;
    for(var i = 0; i < COUNT_FIELDS.length; i++){
      var key = COUNT_FIELDS[i], count = integer(record[key]);
      if(count === null) return invalid(info,"진행 수량은 빈칸 없이 0 이상의 정수로 기록해야 합니다.");
      info.counts[key] = count;
    }
    var c = info.counts;
    if(c.officeSent > total || c.officeReceived > c.officeSent || c.returnSent > c.officeReceived || c.warehouseReceived > c.returnSent || c.cafe24Reflected > c.warehouseReceived || c.sellmateReflected > c.warehouseReceived) return invalid(info,"발송·수령·재고 반영 수량의 순서가 맞지 않습니다. 원본 시트를 확인해 주세요.");
    if(state === "입고대기"){
      if(COUNT_FIELDS.some(function(key){return c[key] !== 0;})) return invalid(info,"입고대기 기록에 이미 이동 수량이 있습니다. 원본 시트를 확인해 주세요.");
      info.state = "arrival";info.groups = ["arrival"];info.statusLabel = "입고 대기";info.stageLabel = "입고 예정 " + total + "장 · 실제 입고 확인 전";info.actor = "이주용";
      info.nextActions = [{type:"arrive",label:"물류 입고 확인",actor:"이주용",max:total}];
      return info;
    }
    var completed = sameCounts(c,total);
    if(state === "완료" && !completed) return invalid(info,"완료 수량이 맞지 않습니다. 물류 수령과 두 재고 반영 수량을 확인해 주세요.");
    info.returnComplete = c.warehouseReceived === total;
    if(completed){info.state = "completed";info.groups = ["completed"];info.statusLabel = "완료";info.stageLabel = "반납 " + total + "장 · 카페24/셀메이트 재고 반영 확인 완료";info.actor = "이주용";return info;}
    info.state = "active";info.groups = [];
    // A split row can be in both queues; none of its remaining units disappear.
    if(c.officeReceived < total) info.groups.push("outbound");
    if(c.officeReceived > Math.min(c.cafe24Reflected,c.sellmateReflected)) info.groups.push("returns");
    info.pending.warehouseReceipt = c.returnSent - c.warehouseReceived;
    info.pending.inventory = c.warehouseReceived - Math.min(c.cafe24Reflected,c.sellmateReflected);
    var maxima = [total - c.officeSent,c.officeSent - c.officeReceived,c.officeReceived - c.returnSent,c.returnSent - c.warehouseReceived,c.warehouseReceived - c.cafe24Reflected,c.warehouseReceived - c.sellmateReflected];
    ACTIONS.forEach(function(action,index){if(maxima[index] > 0) info.nextActions.push({type:action.type,label:action.label,actor:action.actor,max:maxima[index]});});
    var stages = [];
    if(maxima[0]) stages.push("물류 출고 대기 " + maxima[0] + "장");
    if(maxima[1]) stages.push("사무실 수령 대기 " + maxima[1] + "장");
    if(maxima[2]) stages.push("촬영·반납 대기 " + maxima[2] + "장");
    if(maxima[3]) stages.push("물류 수령 대기 " + maxima[3] + "장");
    if(info.pending.inventory) stages.push("재고 반영 대기 " + info.pending.inventory + "장");
    info.stageLabel = stages.join(" · ");
    info.statusLabel = maxima[3] ? "물류 확인 대기" : info.pending.inventory ? "재고 반영 대기" : maxima[2] ? "샘플 반납 예정" : maxima[1] ? "사무실 수령 대기" : "물류 출고 예정";
    info.actor = info.nextActions.map(function(action){return action.actor;}).filter(function(actor,index,actors){return actors.indexOf(actor) === index;}).join(" · ");
    return info;
  }
  function validateAction(action){
    if(!isRecord(action) || typeof action.type !== "string") throw failure("FLOW_ACTION_INVALID","진행 작업을 선택해 주세요.");
    var allowed = action.type === "initialize" ? ["type","start","quantity"] : ["type","quantity"];
    if(Object.keys(action).length !== allowed.length || Object.keys(action).some(function(key){return allowed.indexOf(key) < 0;})) throw failure("FLOW_ACTION_INVALID","진행 작업의 입력 항목을 확인해 주세요.");
    var quantity = integer(action.quantity);
    if(quantity === null || quantity < 1) throw failure("FLOW_QUANTITY_INVALID","실제 확인한 수량을 1장 이상의 정수로 입력해 주세요.");
    return quantity;
  }
  function changed(record,candidate){
    var patch = {};
    Object.keys(candidate).forEach(function(key){var value = String(candidate[key]);if(text(record[key]) !== value) patch[key] = value;});
    return patch;
  }
  function apply(record,action){
    var quantity = validateAction(action), info = inspect(record);
    if(!info.valid) throw failure("FLOW_STATE_INVALID",info.error);
    var candidate = {}, type = action.type;
    if(type === "initialize"){
      if(info.state !== "unverified") throw failure("FLOW_ALREADY_INITIALIZED","이미 진행을 시작한 샘플입니다. 현재 단계에서 처리해 주세요.");
      if(INITIAL_OPTIONS.every(function(option){return option.value !== action.start;})) throw failure("FLOW_ACTION_INVALID","확인한 현재 위치를 선택해 주세요.");
      var known = sourceQuantity(record.quantity);
      if(!known.missing && known.value === null) throw failure("FLOW_QUANTITY_INVALID","원본 시트의 수량을 먼저 확인해 주세요.");
      if(known.value !== null && known.value !== quantity) throw failure("FLOW_QUANTITY_MISMATCH","원본 수량 " + known.value + "장과 확인 수량이 다릅니다. 누락된 수량을 확인해 주세요.");
      candidate.flowState = action.start === "arrival" ? "입고대기" : "진행중";
      candidate.flowTotal = quantity;
      COUNT_FIELDS.forEach(function(key){candidate[key] = 0;});
      if(action.start === "office" || action.start === "returned") candidate.officeSent = candidate.officeReceived = quantity;
      if(action.start === "returned") candidate.returnSent = candidate.warehouseReceived = quantity;
      // Explicit physical baselines do not assert who performed earlier handoffs.
      if(action.start !== "arrival"){
        candidate.location = action.start === "office" ? "사무실" : "물류";
        candidate.owner = action.start === "office" ? "최연경" : "이주용";
      }
      return changed(record,candidate);
    }
    var available = info.nextActions.filter(function(option){return option.type === type;})[0];
    if(!available) throw failure("FLOW_ACTION_UNAVAILABLE","현재 단계에서는 선택한 작업을 처리할 수 없습니다.");
    if(quantity > available.max) throw failure("FLOW_QUANTITY_INVALID","처리 가능한 남은 수량은 " + available.max + "장입니다.");
    if(type === "arrive"){
      if(quantity !== info.total) throw failure("FLOW_QUANTITY_MISMATCH","입고 예정 " + info.total + "장 전체의 실제 수량을 확인해 주세요. 수량이 다르면 원본을 먼저 확인해 주세요.");
      candidate.flowState = "진행중";candidate.location = "물류";candidate.owner = "이주용";
    }else{
      var definition = ACTIONS.filter(function(option){return option.type === type;})[0];
      candidate[definition.field] = info.counts[definition.field] + quantity;
      if(type === "receiveOffice" && candidate.officeReceived === info.total){candidate.location = "사무실";candidate.owner = "최연경";}
      if(type === "receiveWarehouse" && candidate.warehouseReceived === info.total){candidate.location = "물류";candidate.owner = "이주용";}
      var nextCounts = Object.assign({},info.counts,candidate);
      if(sameCounts(nextCounts,info.total)) candidate.flowState = "완료";
    }
    return changed(record,candidate);
  }
  return {HEADERS:HEADERS,FIELDS:FIELDS,PUBLIC_FIELDS:PUBLIC_FIELDS,INITIAL_OPTIONS:INITIAL_OPTIONS,inspect:inspect,apply:apply};
});
