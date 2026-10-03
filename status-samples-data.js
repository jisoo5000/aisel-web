/* Private Google Sheets access. Google access tokens and sample records stay in memory. */
(function(root, factory){
  if(typeof module === "object" && module.exports) module.exports = factory;
  else root.AiselSampleData = factory({firebase:root.firebase,fetch:root.fetch.bind(root),document:root.document,window:root});
})(typeof window === "undefined" ? this : window, function(deps){
  "use strict";
  var SHEET_ID = 1840754350;
  var FILE_ID = "16sQmAVKB07qrhOgzacozifIATmeqalhqGQViCgY_Pug";
  var API = "https://sheets.googleapis.com/v4/spreadsheets/" + FILE_ID;
  var HEADERS = ["입출고일자","관리번호","공급처명","상품명","컬러","사이즈","수량","작업구분","샘플위치","반납일자","담당자"];
  var FIELDS = ["receivedDate","managementNumber","supplier","name","color","size","quantity","operation","location","returnedDate","owner"];
  var AUDIT_TITLE = "샘플변경이력";
  var AUDIT_HEADERS = ["변경시각","수정계정","관리번호","변경항목","이전값","변경값","상품명","기록키","원본탭ID"];
  var LOCATION_OWNERS = {"물류":"이주용","사무실":"최연경"};
  var listeners = [], accessToken = null, auth = null, authReady = null, generation = 0;
  var pendingLoad = null, saving = false, timer = null;
  var now = deps.now || function(){return new Date();};
  var state = {status:"disconnected",connected:false,canEdit:false,records:[],owners:[],source:null,userLabel:"",message:""};
  var userEmail = "";
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function text(value){return value == null ? "" : String(value).trim();}
  function error(code,message){var e = new Error(message);e.name = "AiselSampleError";e.code = code;return e;}
  function emit(patch){
    Object.keys(patch || {}).forEach(function(key){state[key] = patch[key];});
    listeners.slice().forEach(function(listener){try{listener(clone(state));}catch(ignore){}});
    return clone(state);
  }
  function wipe(message){
    generation++;accessToken = null;userEmail = "";pendingLoad = null;
    emit({status:"disconnected",connected:false,canEdit:false,records:[],owners:[],source:null,userLabel:"",message:message || ""});
  }
  function ensureAuth(){
    if(auth) return authReady;
    if(!deps.firebase || !deps.firebase.auth) return Promise.reject(error("AUTH_SETUP","Google 연결을 준비하지 못했습니다. 페이지를 새로 열어 주세요."));
    try{
      var app;
      try{app = deps.firebase.app("aiselShootingSamples");}
      catch(ignore){app = deps.firebase.initializeApp(deps.firebase.app().options,"aiselShootingSamples");}
      auth = app.auth();
      authReady = Promise.resolve(auth.setPersistence(deps.firebase.auth.Auth.Persistence.NONE));
      return authReady;
    }catch(e){return Promise.reject(error("AUTH_SETUP","Google 로그인 설정을 확인해야 합니다."));}
  }
  function friendly(e){
    if(e && e.code && /^[A-Z_]+$/.test(e.code)) return e;
    var code = e && e.code || "";
    if(code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return error("LOGIN_CANCELLED","Google 연결을 취소했습니다.");
    if(code === "auth/popup-blocked") return error("POPUP_BLOCKED","팝업을 허용한 뒤 Google 계정으로 다시 연결해 주세요.");
    if(code === "auth/unauthorized-domain" || code === "auth/operation-not-allowed") return error("AUTH_SETUP","Google 로그인 설정이 필요합니다. 관리자에게 연결 설정을 요청해 주세요.");
    return error("CONNECTION_FAILED","연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
  }
  async function request(path, options){
    if(!accessToken) throw error("AUTH_REQUIRED","Google 계정으로 연결해 주세요.");
    var epoch = generation;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeout = controller ? setTimeout(function(){controller.abort();},20000) : null;
    var response, body;
    try{
      response = await deps.fetch(API + path,Object.assign({method:"GET",redirect:"error",cache:"no-store"},options || {},{
        headers:{Authorization:"Bearer " + accessToken,"Content-Type":"application/json"},
        signal:controller ? controller.signal : undefined
      }));
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다. 다시 연결해 주세요.");
      body = await response.json();
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다. 다시 연결해 주세요.");
    }catch(e){
      if(e && e.name === "AiselSampleError") throw e;
      throw error("NETWORK_ERROR","응답을 확인하지 못했습니다. 연결을 확인해 주세요.");
    }finally{if(timeout) clearTimeout(timeout);}
    if(response.ok) return body;
    if(response.status === 401){wipe("Google 연결이 만료되었습니다. 다시 연결해 주세요.");throw error("AUTH_EXPIRED","Google 연결이 만료되었습니다. 다시 연결해 주세요.");}
    var reason = JSON.stringify(body && body.error || {});
    if(/SERVICE_DISABLED|accessNotConfigured/i.test(reason)) throw error("API_DISABLED","시트 연결 설정이 필요합니다. 관리자에게 Google Sheets API 활성화를 요청해 주세요.");
    if(response.status === 403) throw error("SHEET_PERMISSION","이 Google 계정의 시트 접근·편집 권한을 확인해 주세요. 권한이 있는 팀원 계정으로 연결할 수 있습니다.");
    if(response.status === 404) throw error("SHEET_NOT_FOUND","촬영 샘플 시트를 찾을 수 없습니다. 계정과 원본 시트를 확인해 주세요.");
    if(response.status === 429) throw error("RATE_LIMIT","요청이 잠시 몰렸습니다. 입력은 유지되니 잠시 후 다시 시도해 주세요.");
    throw error("SHEET_ERROR","시트에서 요청을 처리하지 못했습니다. 입력을 확인한 뒤 다시 시도해 주세요.");
  }
  function rangeName(title){return "'" + title.replace(/'/g,"''") + "'";}
  function parseRows(values, meta, target){
    if(!Array.isArray(values) || !values.length || HEADERS.some(function(h,i){return text(values[0][i]) !== h;})) throw error("HEADER_CHANGED","원본 시트의 항목이 변경되었습니다. 항목 구성을 확인해 주세요.");
    var counts = Object.create(null), records = [], owners = [];
    values.slice(1).forEach(function(row){var id = text(row[1]);if(id) counts[id] = (counts[id] || 0) + 1;});
    values.slice(1).forEach(function(raw,index){
      var row = FIELDS.map(function(_,i){return text(raw[i]);});
      if(!row[3]) return;
      var number = row[1], unique = !!number && counts[number] === 1;
      var record = {id:unique ? "sample:" + encodeURIComponent(number) : "uneditable:" + (index + 2),sourceRow:index + 2,version:JSON.stringify(row),canEdit:unique,editReason:unique ? "" : "관리번호가 비어 있거나 중복되어 원본 확인이 필요합니다."};
      FIELDS.forEach(function(key,i){record[key] = row[i];});
      records.push(record);
      if(row[10] && owners.indexOf(row[10]) < 0) owners.push(row[10]);
    });
    owners.sort(function(a,b){return a.localeCompare(b,"ko");});
    records.sort(function(a,b){return b.sourceRow - a.sourceRow;});
    return {records:records,owners:owners,source:{spreadsheetId:FILE_ID,sheetId:SHEET_ID,sheetName:target.title,syncedAt:now().toISOString()},metadata:meta};
  }
  async function readSheet(){
    var meta = await request("?fields=spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))");
    var sheet = (meta.sheets || []).filter(function(s){return s.properties && s.properties.sheetId === SHEET_ID;})[0];
    if(!sheet) throw error("TAB_NOT_FOUND","촬영 샘플 탭을 찾을 수 없습니다. 원본 시트를 확인해 주세요.");
    var rows = Number(sheet.properties.gridProperties && sheet.properties.gridProperties.rowCount);
    if(!Number.isInteger(rows) || rows < 2 || rows > 20000) throw error("SHEET_SIZE","원본 시트의 행 범위를 확인해야 합니다. 관리자에게 문의해 주세요.");
    var range = rangeName(sheet.properties.title) + "!A1:K" + rows;
    var result = await request("/values/" + encodeURIComponent(range) + "?valueRenderOption=FORMATTED_VALUE");
    return parseRows(result.values,meta,sheet.properties);
  }
  function accept(result){return emit({status:"ready",connected:true,canEdit:true,records:result.records,owners:result.owners,source:result.source,message:""});}
  function report(e){
    var issue = friendly(e);
    if(state.connected) emit({status:"error",message:issue.message});
    return issue;
  }
  async function load(){
    if(!accessToken) return clone(state);
    if(saving) return clone(state);
    if(pendingLoad) return pendingLoad;
    var epoch = generation;
    emit({status:"loading",message:""});
    var task = readSheet().then(function(result){
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      return accept(result);
    }).catch(function(e){if(epoch === generation) throw report(e);throw e;});
    pendingLoad = task;
    try{return await task;}finally{if(pendingLoad === task) pendingLoad = null;}
  }
  async function connect(){
    wipe("");var epoch = generation;
    emit({status:"connecting",message:""});
    try{
      await ensureAuth();
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      var provider = new deps.firebase.auth.GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/spreadsheets");
      provider.setCustomParameters({prompt:"select_account"});
      var result = await auth.signInWithPopup(provider);
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      if(!result.credential || !result.credential.accessToken || !result.user || !result.user.email) throw error("AUTH_SCOPE","시트 접근 동의가 완료되지 않았습니다. Google 계정으로 다시 연결해 주세요.");
      accessToken = result.credential.accessToken;userEmail = result.user.email;
      emit({connected:true,userLabel:result.user.displayName || userEmail});
      return await load();
    }catch(e){
      var issue = friendly(e);
      if(epoch === generation){
        if(accessToken) emit({status:"error",message:issue.message});
        else emit({status:"disconnected",connected:false,canEdit:false,message:issue.message});
      }
      throw issue;
    }
  }
  async function disconnect(){wipe("");if(auth) try{await auth.signOut();}catch(ignore){}return clone(state);}
  function cell(value){return {userEnteredValue:{stringValue:String(value)}};}
  async function verifyAuditHeader(result){
    var log = (result.metadata.sheets || []).filter(function(s){return s.properties.title === AUDIT_TITLE;})[0];
    if(!log) return;
    var value = await request("/values/" + encodeURIComponent(rangeName(AUDIT_TITLE) + "!A1:I1") + "?valueRenderOption=FORMATTED_VALUE");
    if(!value.values || !value.values[0] || AUDIT_HEADERS.some(function(h,i){return text(value.values[0][i]) !== h;})) throw error("AUDIT_HEADER_CHANGED","변경 이력 탭의 항목 구성을 확인해야 합니다. 기록을 덮어쓰지 않았습니다.");
  }
  function makeWriteRequests(result,row,changes){
    var requests = [];
    changes.forEach(function(change){
      var col = change.key === "owner" ? 10 : 8;
      requests.push({updateCells:{range:{sheetId:SHEET_ID,startRowIndex:row.sourceRow - 1,endRowIndex:row.sourceRow,startColumnIndex:col,endColumnIndex:col + 1},rows:[{values:[cell(change.value)]}],fields:"userEnteredValue"}});
    });
    var sheets = result.metadata.sheets || [];
    var log = sheets.filter(function(s){return s.properties.title === AUDIT_TITLE;})[0], auditId;
    if(log) auditId = log.properties.sheetId;
    else{
      auditId = 1840754351;
      while(sheets.some(function(s){return s.properties.sheetId === auditId;})) auditId++;
      requests.push({addSheet:{properties:{sheetId:auditId,title:AUDIT_TITLE,gridProperties:{rowCount:1000,columnCount:9,frozenRowCount:1}}}});
      requests.push({updateCells:{start:{sheetId:auditId,rowIndex:0,columnIndex:0},rows:[{values:AUDIT_HEADERS.map(cell)}],fields:"userEnteredValue"}});
    }
    var stamp = now().toISOString();
    requests.push({appendCells:{sheetId:auditId,rows:changes.map(function(change){return {values:[stamp,userEmail,row.managementNumber,change.key === "owner" ? "담당자" : "샘플위치",row[change.key],change.value,row.name,row.id,String(SHEET_ID)].map(cell)};}),fields:"userEnteredValue"}});
    return requests;
  }
  async function save(input){
    if(!accessToken || !state.connected) throw error("AUTH_REQUIRED","Google 계정으로 연결해 주세요.");
    if(saving) throw error("SAVE_BUSY","다른 기록을 저장하고 있습니다. 잠시 기다려 주세요.");
    if(!input || typeof input.id !== "string" || typeof input.expectedVersion !== "string" || !input.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) throw error("INVALID_EDIT","수정할 기록을 다시 선택해 주세요.");
    var recordId = input.id, expectedVersion = input.expectedVersion;
    var loadedRecord = state.records.filter(function(r){return r.id === recordId && r.canEdit;})[0];
    if(!state.canEdit || !loadedRecord) throw error("INVALID_EDIT","목록에서 수정할 기록을 다시 선택해 주세요.");
    if(loadedRecord.version !== expectedVersion) throw error("CONFLICT","다른 곳에서 이 기록이 변경되었습니다. 최신 기록을 확인한 뒤 다시 수정해 주세요.");
    var inputKeys = Object.keys(input.patch);
    if(inputKeys.length !== 1 || inputKeys[0] !== "location") throw error("INVALID_EDIT","샘플 위치만 선택할 수 있습니다. 담당자는 위치에 따라 자동으로 정해집니다.");
    if(typeof input.patch.location !== "string" || input.patch.location.length > 100) throw error("INVALID_EDIT","입력한 값을 확인해 주세요.");
    var location = text(input.patch.location);
    if(["물류","사무실"].indexOf(location) < 0) throw error("INVALID_LOCATION","샘플 위치를 물류 또는 사무실로 선택해 주세요.");
    var patch = {location:location,owner:LOCATION_OWNERS[location]}, keys = ["location","owner"];
    saving = true;var epoch = generation, sent = false;
    try{
      if(pendingLoad) try{await pendingLoad;}catch(ignore){}
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      var result = await readSheet();
      var row = result.records.filter(function(r){return r.id === recordId && r.canEdit;})[0];
      if(!row || row.version !== expectedVersion){accept(result);throw error("CONFLICT","다른 곳에서 이 기록이 변경되었습니다. 입력을 확인한 뒤 취소하고 최신 기록에서 다시 수정해 주세요.");}
      var changes = keys.filter(function(k){return row[k] !== patch[k];}).map(function(k){return {key:k,value:patch[k]};});
      if(!changes.length) return accept(result);
      await verifyAuditHeader(result);
      var requests = makeWriteRequests(result,row,changes);
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      sent = true;
      await request(":batchUpdate",{method:"POST",body:JSON.stringify({requests:requests,includeSpreadsheetInResponse:false})});
      var verified = await readSheet();
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      var after = verified.records.filter(function(r){return r.id === recordId && r.canEdit;})[0];
      if(!after || keys.some(function(key){return after[key] !== patch[key];})) throw error("SAVE_UNCONFIRMED","저장 후 값이 다시 변경되었거나 확인되지 않았습니다. 입력을 유지했습니다. 최신 기록을 확인해 주세요.");
      return accept(verified);
    }catch(e){
      var issue = friendly(e);
      if(sent && ["NETWORK_ERROR","SESSION_CHANGED","AUTH_EXPIRED"].indexOf(issue.code) >= 0) issue = error("SAVE_UNCONFIRMED","저장 결과를 확인하지 못했습니다. 시트에는 반영됐을 수 있으니 다시 저장하기 전에 최신 기록을 확인해 주세요.");
      if(epoch === generation && state.connected) emit({status:"error",message:issue.message});
      throw issue;
    }finally{saving = false;}
  }
  function refreshVisible(){if(accessToken && !saving && (!deps.document || deps.document.visibilityState !== "hidden")) load().catch(function(){});}
  if(deps.window && deps.window.setInterval) timer = deps.window.setInterval(refreshVisible,60000);
  if(deps.document && deps.document.addEventListener) deps.document.addEventListener("visibilitychange",refreshVisible);
  if(deps.window && deps.window.addEventListener) deps.window.addEventListener("focus",refreshVisible);
  // Prepare persistence before a user gesture; never open a login popup automatically.
  ensureAuth().catch(function(){});
  return {
    getState:function(){return clone(state);},
    subscribe:function(listener){listeners.push(listener);listener(clone(state));return function(){listeners = listeners.filter(function(fn){return fn !== listener;});};},
    connect:connect,disconnect:disconnect,load:load,save:save,
    dispose:function(){wipe("");if(timer && deps.window && deps.window.clearInterval) deps.window.clearInterval(timer);if(deps.document && deps.document.removeEventListener) deps.document.removeEventListener("visibilitychange",refreshVisible);if(deps.window && deps.window.removeEventListener) deps.window.removeEventListener("focus",refreshVisible);listeners = [];}
  };
});
