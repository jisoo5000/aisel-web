/* Anonymous display catalog + private Google Sheets editing. Credentials stay in memory. */
(function(root, factory){
  if(typeof module === "object" && module.exports) module.exports = factory;
  else root.AiselSampleData = factory({firebase:root.firebase,fetch:root.fetch.bind(root),document:root.document,window:root});
})(typeof window === "undefined" ? this : window, function(deps){
  "use strict";
  var SHEET_ID = 1840754350;
  var FILE_ID = "16sQmAVKB07qrhOgzacozifIATmeqalhqGQViCgY_Pug";
  var API = "https://sheets.googleapis.com/v4/spreadsheets/" + FILE_ID;
  var HEADERS = ["입출고일자","관리번호","공급처명","상품명","컬러","사이즈","수량","작업구분","샘플위치","반납일자","담당자","반납예정일","연장사유"];
  var FIELDS = ["receivedDate","managementNumber","supplier","name","color","size","quantity","operation","location","returnedDate","owner","returnDueDate","extensionReason"];
  var AUDIT_TITLE = "샘플변경이력";
  var AUDIT_HEADERS = ["변경시각","수정계정","관리번호","변경항목","이전값","변경값","상품명","기록키","원본탭ID"];
  var LOCATION_OWNERS = {"물류":"이주용","사무실":"최연경"};
  var PUBLIC_FIELDS = ["name","color","size","quantity","operation","location","owner","receivedDate","returnDueDate"];
  var PUBLIC_PATH = "shootingSampleCatalog";
  var listeners = [], accessToken = null, auth = null, authReady = null, authApp = null, generation = 0;
  var pendingLoad = null, saving = false, timer = null;
  var lastReadTimestamp = 0, disposed = false, publication = Promise.resolve(), publicSnapshot = null;
  var now = deps.now || function(){return new Date();};
  var state = {status:"disconnected",connected:false,canEdit:false,records:[],owners:[],source:null,userLabel:"",message:"",publicSyncWarning:""};
  var userEmail = "";
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function text(value){return value == null ? "" : String(value).trim();}
  function error(code,message){var e = new Error(message);e.name = "AiselSampleError";e.code = code;return e;}
  function filled(value){return !!text(value) && !/^[—–-]+$/.test(text(value));}
  function validStamp(value){return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;}
  function exactKeys(value,keys){return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(function(key){return keys.indexOf(key) >= 0;});}
  // This allowlist is the complete publication boundary. Never spread source
  // records: their version contains every private cell, including extension text.
  function makePublicCatalog(result){
    if(!result || !Array.isArray(result.records) || result.records.length > 20000 || !result.source || !validStamp(result.source.syncedAt)) throw error("PUBLIC_SOURCE_INVALID","공개 목록의 조회 기준을 확인해 주세요.");
    return {schemaVersion:2,source:{syncedAt:result.source.syncedAt},records:result.records.filter(function(row){return row && filled(row.name);}).map(function(row,index){
      var record = {id:"public-" + (index + 1),order:index};
      PUBLIC_FIELDS.forEach(function(key){var value = text(row[key]);if(value.length > 2000) throw error("PUBLIC_SOURCE_INVALID","공개 목록의 표시 항목을 확인해 주세요.");record[key] = value;});
      record.returnCompleted = getReturnInfo(row).completed;
      return record;
    })};
  }
  function parsePublicCatalog(value){
    if(value === null) return {records:[],owners:[],source:null};
    // Realtime Database drops empty arrays; only normalize this known case.
    if(value && value.schemaVersion === 2 && !Object.prototype.hasOwnProperty.call(value,"records")) value = Object.assign({},value,{records:[]});
    if(!exactKeys(value,["schemaVersion","source","records"]) || value.schemaVersion !== 2 || !exactKeys(value.source,["syncedAt"]) || !validStamp(value.source.syncedAt) || !Array.isArray(value.records) || value.records.length > 20000) throw error("PUBLIC_DATA_INVALID","샘플 목록 형식을 확인해야 합니다. 관리자에게 문의해 주세요.");
    var keys = ["id","order","returnCompleted"].concat(PUBLIC_FIELDS);
    var rows = value.records.map(function(row,index){
      if(!exactKeys(row,keys) || row.id !== "public-" + (index + 1) || row.order !== index || typeof row.returnCompleted !== "boolean" || PUBLIC_FIELDS.some(function(key){return typeof row[key] !== "string" || row[key].length > 2000;}) || !filled(row.name)) throw error("PUBLIC_DATA_INVALID","샘플 목록 형식을 확인해야 합니다. 관리자에게 문의해 주세요.");
      var record = {id:row.id,order:row.order,returnCompleted:row.returnCompleted,canEdit:false,editReason:"Google 계정을 연결하면 변경할 수 있습니다."};
      PUBLIC_FIELDS.forEach(function(key){record[key] = row[key];});return record;
    });
    return {records:rows,owners:[],source:{syncedAt:value.source.syncedAt}};
  }
  function publicUrl(){
    if(deps.publicCatalogUrl) return deps.publicCatalogUrl;
    try{var base = deps.firebase.app().options.databaseURL;if(typeof base === "string" && /^https:\/\//.test(base)) return base.replace(/\/$/,"") + "/" + PUBLIC_PATH + ".json";}catch(ignore){}
    throw error("PUBLIC_SETUP","샘플 목록 연결을 확인해야 합니다.");
  }
  // Sheet dates are Seoul calendar dates, never browser-local instants. Parse
  // explicit year/month/day, then use UTC arithmetic to avoid timezone/DST shifts.
  function normalizeDate(value){
    var raw = text(value).replace(/\s+/g,""), match;
    if(!raw) return "";
    match = raw.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(\.)?$/);
    if(match){
      if(match[5] && match[2] !== ".") return "";
      match = [match[0],match[1],match[3],match[4]];
    }else match = raw.match(/^(\d{4})년(\d{1,2})월(\d{1,2})일$/);
    if(!match) return "";
    var year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if(year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return "";
    var date = new Date(Date.UTC(year,month - 1,day));
    if(date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return String(year) + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
  }
  function addCalendarDays(value,days){
    var date = normalizeDate(value);
    if(!date || !Number.isInteger(days)) return "";
    var parts = date.split("-").map(Number), next = new Date(Date.UTC(parts[0],parts[1] - 1,parts[2] + days));
    if(!Number.isFinite(next.getTime()) || next.getUTCFullYear() < 1000 || next.getUTCFullYear() > 9999) return "";
    return next.toISOString().slice(0,10);
  }
  function getReturnInfo(record){
    record = record || {};
    var operation = text(record.operation).replace(/\s+/g,""), isOutgoing = operation === "샘플출고";
    var completed = record.returnCompleted === true || filled(record.returnedDate) || ["샘플반납","반납","반납완료"].indexOf(operation) >= 0;
    var info = {dueDate:"",canExtend:false,suggestedDate:"",reason:"",completed:completed,isOutgoing:isOutgoing};
    if(!isOutgoing){info.reason = completed ? "반납 완료" : "샘플 출고 기록만 연장할 수 있습니다.";return info;}
    // Do not hide invalid edited deadlines by falling back to a calculated one.
    info.dueDate = filled(record.returnDueDate) ? normalizeDate(record.returnDueDate) : addCalendarDays(record.receivedDate,14);
    if(completed){info.reason = "반납 완료";return info;}
    if(!normalizeDate(record.receivedDate)){info.dueDate = "";info.reason = "입출고일자를 확인해 주세요.";return info;}
    if(!info.dueDate){info.reason = "반납예정일을 확인해 주세요.";return info;}
    if(record.canEdit === false){info.reason = record.editReason || "관리번호를 확인해 주세요.";return info;}
    info.suggestedDate = addCalendarDays(info.dueDate,14);
    info.canExtend = !!info.suggestedDate;
    if(!info.canExtend) info.reason = "반납예정일을 확인해 주세요.";
    return info;
  }
  function emit(patch){
    Object.keys(patch || {}).forEach(function(key){state[key] = patch[key];});
    listeners.slice().forEach(function(listener){try{listener(clone(state));}catch(ignore){}});
    return clone(state);
  }
  function wipe(message){
    generation++;accessToken = null;userEmail = "";pendingLoad = null;
    emit({status:"disconnected",connected:false,canEdit:false,records:publicSnapshot ? clone(publicSnapshot.records) : [],owners:[],source:publicSnapshot ? clone(publicSnapshot.source) : null,userLabel:"",message:message || "",publicSyncWarning:""});
  }
  function ensureAuth(){
    if(auth) return authReady;
    if(!deps.firebase || !deps.firebase.auth) return Promise.reject(error("AUTH_SETUP","Google 연결을 준비하지 못했습니다. 페이지를 새로 열어 주세요."));
    try{
      var app;
      try{app = deps.firebase.app("aiselShootingSamples");}
      catch(ignore){app = deps.firebase.initializeApp(deps.firebase.app().options,"aiselShootingSamples");}
      authApp = app;auth = app.auth();
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
  async function loadPublic(message){
    if(disposed) return clone(state);
    if(pendingLoad) return pendingLoad;
    var epoch = generation;
    emit({status:"loading",connected:false,canEdit:false,userLabel:"",message:message || ""});
    var task = (async function(){
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timeout = controller ? setTimeout(function(){controller.abort();},20000) : null;
      try{
        var response = await deps.fetch(publicUrl(),{method:"GET",redirect:"error",cache:"no-store",credentials:"omit",signal:controller ? controller.signal : undefined});
        if(epoch !== generation || disposed || accessToken) throw error("SESSION_CHANGED","계정 연결이 변경되었습니다.");
        if(!response.ok) throw error("PUBLIC_UNAVAILABLE","샘플 목록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.");
        var result = parsePublicCatalog(await response.json());
        if(epoch !== generation || disposed || accessToken) throw error("SESSION_CHANGED","계정 연결이 변경되었습니다.");
        publicSnapshot = clone(result);
        return emit({status:"ready",connected:false,canEdit:false,records:result.records,owners:[],source:result.source,userLabel:"",message:message || "",publicSyncWarning:""});
      }catch(e){
        var issue = e && e.name === "AiselSampleError" ? e : error("PUBLIC_UNAVAILABLE","샘플 목록을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
        if(epoch === generation && !disposed && !accessToken) emit({status:"error",connected:false,canEdit:false,message:issue.message});
        throw issue;
      }finally{if(timeout) clearTimeout(timeout);}
    })();
    pendingLoad = task;
    try{return await task;}finally{if(pendingLoad === task) pendingLoad = null;}
  }
  async function restorePublic(message){
    wipe(message);var epoch = generation;
    if(auth) try{await auth.signOut();}catch(ignore){}
    if(epoch !== generation || disposed) return clone(state);
    return loadPublic(message);
  }
  function publishPublic(result,epoch){
    var catalog;
    try{catalog = makePublicCatalog(result);}catch(e){if(epoch === generation && state.connected) emit({publicSyncWarning:"시트는 연결되어 있지만 로그인 없는 목록 갱신을 확인하지 못했습니다."});return;}
    // Queue this browser's publications and let the RTDB transaction reject any
    // snapshot read before the one already stored. No Sheet success is reversed
    // or retried when this optional projection cannot be published.
    publication = publication.catch(function(){}).then(async function(){
      if(disposed || epoch !== generation || !accessToken || !state.connected) return;
      var invalidExisting = false, newerSnapshot = null, publicationExpired = false, publicationTimer = null;
      try{
        if(!authApp || typeof authApp.database !== "function") throw new Error("PUBLIC_DATABASE_UNAVAILABLE");
        var ref = authApp.database().ref(PUBLIC_PATH);
        var transaction = ref.transaction(function(current){
          if(publicationExpired || disposed || epoch !== generation || !accessToken || !state.connected) return;
          if(current !== null){
            var parsedCurrent;
            try{parsedCurrent = parsePublicCatalog(current);}catch(ignore){invalidExisting = true;return;}
            if(Date.parse(current.source.syncedAt) >= Date.parse(catalog.source.syncedAt)){newerSnapshot = parsedCurrent;return;}
          }
          return catalog;
        },undefined,false);
        var answer = await Promise.race([transaction,new Promise(function(resolve,reject){publicationTimer = setTimeout(function(){publicationExpired = true;reject(new Error("PUBLIC_SYNC_TIMEOUT"));},15000);})]);
        if(disposed || epoch !== generation || !accessToken || !state.connected) return;
        if(invalidExisting) throw new Error("PUBLIC_CATALOG_INVALID");
        if(answer && answer.committed){publicSnapshot = parsePublicCatalog(catalog);emit({publicSyncWarning:""});}
        else if(newerSnapshot){publicSnapshot = newerSnapshot;emit({publicSyncWarning:""});}
      }catch(ignore){
        if(!disposed && epoch === generation && accessToken && state.connected) emit({publicSyncWarning:"시트 반영과 별도로, 로그인 없는 목록 갱신을 확인하지 못했습니다. 연결된 화면에서 다시 조회하면 재시도합니다."});
      }finally{if(publicationTimer) clearTimeout(publicationTimer);}
    });
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
    if(response.status === 401){try{await restorePublic("Google 연결이 만료되었습니다. 조회는 계속할 수 있으며, 변경하려면 다시 연결해 주세요.");}catch(ignore){}throw error("AUTH_EXPIRED","Google 연결이 만료되었습니다. 변경하려면 다시 연결해 주세요.");}
    var reason = JSON.stringify(body && body.error || {});
    if(/SERVICE_DISABLED|accessNotConfigured/i.test(reason)) throw error("API_DISABLED","시트 연결 설정이 필요합니다. 관리자에게 Google Sheets API 활성화를 요청해 주세요.");
    if(response.status === 403) throw error("SHEET_PERMISSION","이 Google 계정의 시트 접근·편집 권한을 확인해 주세요. 권한이 있는 팀원 계정으로 연결할 수 있습니다.");
    if(response.status === 404) throw error("SHEET_NOT_FOUND","촬영 샘플 시트를 찾을 수 없습니다. 계정과 원본 시트를 확인해 주세요.");
    if(response.status === 429) throw error("RATE_LIMIT","요청이 잠시 몰렸습니다. 잠시 후 위치를 다시 선택해 주세요.");
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
    // Capture the start, not completion, so a slow older read cannot win over a
    // more recent verified save from a publisher with a comparable clock.
    lastReadTimestamp = Math.max(now().getTime(),lastReadTimestamp + 1);
    var sourceReadAt = new Date(lastReadTimestamp).toISOString();
    var meta = await request("?fields=spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))");
    var sheet = (meta.sheets || []).filter(function(s){return s.properties && s.properties.sheetId === SHEET_ID;})[0];
    if(!sheet) throw error("TAB_NOT_FOUND","촬영 샘플 탭을 찾을 수 없습니다. 원본 시트를 확인해 주세요.");
    var rows = Number(sheet.properties.gridProperties && sheet.properties.gridProperties.rowCount);
    if(!Number.isInteger(rows) || rows < 2 || rows > 20000) throw error("SHEET_SIZE","원본 시트의 행 범위를 확인해야 합니다. 관리자에게 문의해 주세요.");
    var range = rangeName(sheet.properties.title) + "!A1:M" + rows;
    var result = await request("/values/" + encodeURIComponent(range) + "?valueRenderOption=FORMATTED_VALUE");
    var parsed = parseRows(result.values,meta,sheet.properties);parsed.source.syncedAt = sourceReadAt;return parsed;
  }
  function accept(result){
    var accepted = emit({status:"ready",connected:true,canEdit:true,records:result.records,owners:result.owners,source:result.source,message:""});
    publishPublic(result,generation);return accepted;
  }
  function report(e){
    var issue = friendly(e);
    if(state.connected) emit({status:"error",message:issue.message});
    return issue;
  }
  async function load(){
    if(disposed) return clone(state);
    if(!accessToken) return state.status === "connecting" ? clone(state) : loadPublic();
    if(saving) return clone(state);
    if(pendingLoad) return pendingLoad;
    var epoch = generation;
    emit({status:"loading",message:""});
    var task = readSheet().then(function(result){
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      return accept(result);
    }).catch(async function(e){
      var issue = friendly(e);
      if(epoch === generation && !disposed) try{await restorePublic(issue.message);}catch(ignore){}
      throw issue;
    });
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
      if(epoch === generation && !disposed) try{await restorePublic(issue.message);}catch(ignore){}
      throw issue;
    }
  }
  async function disconnect(){return restorePublic("");}
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
      var col = FIELDS.indexOf(change.key);
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
    requests.push({appendCells:{sheetId:auditId,rows:changes.map(function(change){return {values:[stamp,userEmail,row.managementNumber,HEADERS[FIELDS.indexOf(change.key)],change.previousValue === undefined ? row[change.key] : change.previousValue,change.value,row.name,row.id,String(SHEET_ID)].map(cell)};}),fields:"userEnteredValue"}});
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
    var inputKeys = Object.keys(input.patch), patch, keys;
    var extending = inputKeys.length === 2 && inputKeys.indexOf("returnDueDate") >= 0 && inputKeys.indexOf("extensionReason") >= 0;
    if(extending){
      if(typeof input.patch.returnDueDate !== "string" || typeof input.patch.extensionReason !== "string") throw error("INVALID_EXTENSION","연장 날짜와 사유를 입력해 주세요.");
      var dueDate = normalizeDate(input.patch.returnDueDate), reason = text(input.patch.extensionReason), info = getReturnInfo(loadedRecord);
      if(!info.canExtend) throw error("RETURN_NOT_EXTENDABLE",info.reason || "이 기록은 반납예정일을 연장할 수 없습니다.");
      if(!dueDate || dueDate <= info.dueDate) throw error("INVALID_EXTENSION_DATE","현재 반납예정일보다 늦은 날짜를 선택해 주세요.");
      if(!reason || reason.length > 100 || /[\r\n\u2028\u2029]/.test(input.patch.extensionReason)) throw error("INVALID_EXTENSION_REASON","연장 사유를 한 줄로 100자 이내 입력해 주세요.");
      patch = {returnDueDate:dueDate,extensionReason:reason};keys = ["returnDueDate","extensionReason"];
    }else{
      if(inputKeys.length !== 1 || inputKeys[0] !== "location") throw error("INVALID_EDIT","샘플 위치 또는 반납 연장만 변경할 수 있습니다. 담당자는 위치에 따라 자동으로 정해집니다.");
      if(typeof input.patch.location !== "string" || input.patch.location.length > 100) throw error("INVALID_EDIT","입력한 값을 확인해 주세요.");
      var location = text(input.patch.location);
      if(["물류","사무실"].indexOf(location) < 0) throw error("INVALID_LOCATION","샘플 위치를 물류 또는 사무실로 선택해 주세요.");
      patch = {location:location,owner:LOCATION_OWNERS[location]};keys = ["location","owner"];
    }
    saving = true;var epoch = generation, sent = false;
    try{
      if(pendingLoad) try{await pendingLoad;}catch(ignore){}
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      var result = await readSheet();
      var row = result.records.filter(function(r){return r.id === recordId && r.canEdit;})[0];
      if(!row || row.version !== expectedVersion){accept(result);throw error("CONFLICT","다른 곳에서 이 기록이 변경되었습니다. 입력을 확인한 뒤 취소하고 최신 기록에서 다시 수정해 주세요.");}
      var changes;
      if(extending){
        var currentInfo = getReturnInfo(row);
        if(!currentInfo.canExtend || patch.returnDueDate <= currentInfo.dueDate) throw error("RETURN_NOT_EXTENDABLE",currentInfo.reason || "반납예정일을 다시 확인해 주세요.");
        // Always retain the reason for this extension, even if it repeats the
        // previous reason. Effective previous due date is captured on first use.
        changes = [{key:"returnDueDate",value:patch.returnDueDate,previousValue:currentInfo.dueDate},{key:"extensionReason",value:patch.extensionReason}];
      }else changes = keys.filter(function(k){return row[k] !== patch[k];}).map(function(k){return {key:k,value:patch[k]};});
      if(!changes.length) return accept(result);
      await verifyAuditHeader(result);
      var requests = makeWriteRequests(result,row,changes);
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      sent = true;
      await request(":batchUpdate",{method:"POST",body:JSON.stringify({requests:requests,includeSpreadsheetInResponse:false})});
      var verified = await readSheet();
      if(epoch !== generation) throw error("SESSION_CHANGED","Google 연결이 변경되었습니다.");
      var after = verified.records.filter(function(r){return r.id === recordId && r.canEdit;})[0];
      if(!after || keys.some(function(key){return after[key] !== patch[key];})) throw error("SAVE_UNCONFIRMED","저장 후 값이 다시 변경되었거나 확인되지 않았습니다. 실제 반영됐을 수 있으니 최신 기록을 확인해 주세요.");
      return accept(verified);
    }catch(e){
      var issue = friendly(e);
      if(sent && ["NETWORK_ERROR","SESSION_CHANGED","AUTH_EXPIRED"].indexOf(issue.code) >= 0) issue = error("SAVE_UNCONFIRMED","저장 결과를 확인하지 못했습니다. 시트에는 반영됐을 수 있으니 다시 저장하기 전에 최신 기록을 확인해 주세요.");
      if(epoch === generation && state.connected) emit({status:"error",message:issue.message});
      throw issue;
    }finally{saving = false;}
  }
  function refreshVisible(){if(!disposed && !saving && state.status !== "connecting" && (!deps.document || deps.document.visibilityState !== "hidden")) load().catch(function(){});}
  if(deps.window && deps.window.setInterval) timer = deps.window.setInterval(refreshVisible,60000);
  if(deps.document && deps.document.addEventListener) deps.document.addEventListener("visibilitychange",refreshVisible);
  if(deps.window && deps.window.addEventListener) deps.window.addEventListener("focus",refreshVisible);
  // Prepare persistence before a user gesture; never open a login popup automatically.
  ensureAuth().catch(function(){});
  return {
    getState:function(){return clone(state);},
    subscribe:function(listener){listeners.push(listener);listener(clone(state));return function(){listeners = listeners.filter(function(fn){return fn !== listener;});};},
    connect:connect,disconnect:disconnect,load:load,save:save,
    normalizeDate:normalizeDate,addCalendarDays:addCalendarDays,getReturnInfo:getReturnInfo,makePublicCatalog:makePublicCatalog,
    dispose:function(){disposed = true;publicSnapshot = null;wipe("");if(timer && deps.window && deps.window.clearInterval) deps.window.clearInterval(timer);if(deps.document && deps.document.removeEventListener) deps.document.removeEventListener("visibilitychange",refreshVisible);if(deps.window && deps.window.removeEventListener) deps.window.removeEventListener("focus",refreshVisible);listeners = [];}
  };
});


