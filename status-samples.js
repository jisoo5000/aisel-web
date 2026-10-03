/* 촬영샘플관리의 수동 반영본을 읽습니다. 원본 시트와 제품 상태는 수정하지 않습니다. */
(function(){
  "use strict";
  var SOURCE_URL = "https://docs.google.com/spreadsheets/d/16sQmAVKB07qrhOgzacozifIATmeqalhqGQViCgY_Pug/edit?gid=1840754350#gid=1840754350";
  var fields = [
    ["receivedDate","입출고일자"],["managementNumber","관리번호"],["supplier","공급처명"],
    ["name","상품명"],["color","컬러"],["size","사이즈"],["quantity","수량"],
    ["operation","작업구분"],["location","샘플위치"],["returnedDate","반납일자"],["owner","담당자"]
  ];
  var records = [], source = null, loaded = false, settled = false, loading = false;
  var started = false, failure = "", timer = null, ref = null;
  var el = {};
  ["sampleSearch","sampleLocation","sampleOperation","sampleOwner","sampleReload","sampleReset",
    "sampleList","sampleEmpty","sampleResultCount","sampleSync","sampleConnection","sampleError",
    "sampleTotal","sampleOffice","sampleLogistics","sampleMissingQuantity","sampleColumns"]
    .forEach(function(id){el[id] = document.getElementById(id);});

  function text(value){return value === null || value === undefined ? "" : String(value).trim();}
  function missing(value){return !text(value) || /^[—–-]+$/.test(text(value));}
  function display(value){return missing(value) ? "미입력" : text(value);}
  function normalized(value){return text(value).toLowerCase().replace(/\s+/g,"");}
  function node(tag,className,value){
    var result = document.createElement(tag);
    if(className) result.className = className;
    if(value !== undefined) result.textContent = value;
    return result;
  }
  function valueNode(tag,className,value){return node(tag,className + (missing(value) ? " sample-missing" : ""),display(value));}
  function sampleCell(label,value,className){
    var cell = node("span","sample-cell " + (className || ""));
    cell.appendChild(node("span","sample-mobile-label",label));
    cell.appendChild(valueNode("span","",value));
    return cell;
  }
  function hasFilter(){
    return !!sampleFilters.query || sampleFilters.location !== "all" || sampleFilters.operation !== "all" || sampleFilters.owner !== "all";
  }
  function currentRows(){
    var needle = normalized(sampleFilters.query);
    return records.filter(function(row){
      if(needle && [row.name,row.managementNumber,row.color].every(function(value){return normalized(value).indexOf(needle) === -1;})) return false;
      return ["location","operation","owner"].every(function(key){
        var wanted = sampleFilters[key];
        return wanted === "all" || (wanted === "missing" ? missing(row[key]) : text(row[key]) === wanted);
      });
    });
  }
  function setOptions(select,key,label){
    var current = sampleFilters[key];
    var values = records.map(function(row){return text(row[key]);}).filter(function(value,index,array){
      return !missing(value) && array.indexOf(value) === index;
    }).sort(function(a,b){return a.localeCompare(b,"ko");});
    if(current !== "all" && current !== "missing" && values.indexOf(current) === -1) values.push(current);
    select.textContent = "";
    [["all",label]].concat(values.map(function(value){return [value,value];}),[["missing","미입력"]]).forEach(function(option){
      var item = node("option","",option[1]);item.value = option[0];select.appendChild(item);
    });
    select.value = current;
  }
  function renderSource(){
    var stamp = source && source.importedAt ? new Date(source.importedAt) : null;
    var validStamp = stamp && Number.isFinite(stamp.getTime());
    el.sampleSync.classList.remove("is-stale");
    if(validStamp){
      var date = new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(stamp);
      var age = Date.now() - stamp.getTime();
      el.sampleSync.textContent = "시트 반영: " + date + " · 수동 반영" + (age > 7 * 86400000 ? " · 반영 후 7일 이상 경과" : "");
      el.sampleSync.classList.toggle("is-stale",age > 7 * 86400000);
    }else{
      el.sampleSync.textContent = loaded ? "시트 반영: 반영 시각 미입력 · 수동 반영" : "시트 반영: 확인 중 · 수동 반영";
      if(settled && !loaded) el.sampleSync.textContent = "시트 반영: 반영된 자료 없음 · 수동 반영";
    }
  }
  function recordElement(row,open){
    var details = node("details","sample-record");details.dataset.recordId = row.id;details.open = !!open;
    var summary = node("summary","sample-summary");
    var product = node("span","sample-product");
    product.appendChild(node("span","sample-product-name",row.name));
    product.appendChild(node("span","sample-product-meta","관리번호 " + display(row.managementNumber) + " · " + display(row.supplier)));
    summary.appendChild(product);
    var options = node("span","sample-options");
    options.appendChild(node("span","sample-option-main",display(row.color)));
    options.appendChild(node("span","sample-option-sub","사이즈 " + display(row.size) + " · 수량 " + display(row.quantity)));
    summary.appendChild(options);
    summary.appendChild(sampleCell("작업구분",row.operation));
    var location = node("span","sample-cell");location.appendChild(node("span","sample-mobile-label","기록 위치"));
    location.appendChild(node("span","sample-location " + (row.location === "사무실" ? "office" : row.location === "물류" ? "logistics" : missing(row.location) ? "missing" : ""),display(row.location)));
    summary.appendChild(location);
    summary.appendChild(sampleCell("담당자",row.owner));
    summary.appendChild(sampleCell("입출고일자",row.receivedDate,"sample-date"));
    var chevron = node("span","sample-chevron");chevron.setAttribute("aria-hidden","true");summary.appendChild(chevron);
    details.appendChild(summary);
    var detail = node("div","sample-detail");
    detail.appendChild(node("p","sample-detail-title","원본 기록 · 시트 " + row.sourceRow + "행"));
    var grid = node("dl","sample-detail-grid");
    fields.forEach(function(field){
      var item = node("div","sample-detail-field" + (field[0] === "name" ? " wide" : ""));
      item.appendChild(node("dt","",field[1]));item.appendChild(valueNode("dd","",row[field[0]]));grid.appendChild(item);
    });
    detail.appendChild(grid);
    var link = node("a","sample-row-link","원본 시트에서 이 기록 보기 ↗");
    link.href = SOURCE_URL + "&range=A" + row.sourceRow + ":K" + row.sourceRow;
    link.target = "_blank";link.rel = "noopener noreferrer";detail.appendChild(link);details.appendChild(detail);
    return details;
  }
  function render(){
    if(document.activeElement !== el.sampleSearch) el.sampleSearch.value = sampleFilters.query;
    el.sampleLocation.value = sampleFilters.location;
    setOptions(el.sampleOperation,"operation","작업구분 전체");setOptions(el.sampleOwner,"owner","담당자 전체");
    el.sampleReload.disabled = loading;
    el.sampleReload.textContent = loading ? "불러오는 중…" : "목록 다시 불러오기";
    el.sampleConnection.className = "sample-connection" + (failure ? " error" : loaded ? " ready" : "");
    el.sampleConnection.textContent = loading ? "목록 불러오는 중" : failure ? "목록 연결 확인" : loaded ? "반영본 불러오기 완료" : settled ? "시트 반영 대기" : "목록 불러오는 중";
    el.sampleError.hidden = !failure;el.sampleError.textContent = failure;
    el.sampleList.setAttribute("aria-busy",String(loading));
    el.sampleTotal.textContent = loaded ? records.length : "–";
    el.sampleOffice.textContent = loaded ? records.filter(function(row){return row.location === "사무실";}).length : "–";
    el.sampleLogistics.textContent = loaded ? records.filter(function(row){return row.location === "물류";}).length : "–";
    el.sampleMissingQuantity.textContent = loaded ? records.filter(function(row){return missing(row.quantity);}).length : "–";
    renderSource();
    var rows = currentRows();
    el.sampleResultCount.textContent = loaded ? rows.length + "건" + (hasFilter() ? " / 전체 " + records.length + "건" : "") : "";
    el.sampleReset.hidden = !hasFilter();
    var opened = Object.create(null);
    Array.prototype.forEach.call(el.sampleList.querySelectorAll("details[open]"),function(details){opened[details.dataset.recordId] = true;});
    el.sampleList.textContent = "";
    var fragment = document.createDocumentFragment();rows.forEach(function(row){fragment.appendChild(recordElement(row,opened[row.id]));});el.sampleList.appendChild(fragment);
    el.sampleEmpty.hidden = rows.length > 0;el.sampleColumns.hidden = rows.length === 0;
    el.sampleEmpty.textContent = !settled ? "촬영 샘플 기록을 불러오고 있습니다."
      : failure && !loaded ? "목록을 불러오지 못했습니다. 연결을 확인한 뒤 목록을 다시 불러와 주세요."
      : !loaded ? "아직 반영된 촬영 샘플이 없습니다. 원본 시트 내용을 반영하면 이곳에 표시됩니다."
      : !records.length ? "반영된 시트에 상품명이 입력된 기록이 없습니다."
      : "조건에 맞는 기록이 없습니다. 검색어나 필터를 바꿔 주세요.";
    if(typeof applyPendingScroll_ === "function") applyPendingScroll_();
  }
  function clearLoading(){if(timer !== null) window.clearTimeout(timer);timer = null;loading = false;}
  function fail(message){
    clearLoading();settled = true;
    failure = message + (loaded ? " 마지막으로 불러온 반영본을 표시합니다." : "");render();
  }
  function receive(snap){
    var catalog = snap.val();
    if(catalog && (catalog.schemaVersion !== 1 || typeof catalog !== "object")){
      fail("샘플 자료의 형식을 확인해야 합니다.");return;
    }
    var raw = catalog && catalog.records;
    if(raw && typeof raw !== "object"){
      fail("샘플 기록의 형식을 확인해야 합니다.");return;
    }
    var next = [];
    if(raw) Object.keys(raw).forEach(function(key){
      var value = raw[key];
      if(!value || typeof value !== "object" || missing(value.name)) return;
      var row = {};
      fields.forEach(function(field){row[field[0]] = text(value[field[0]]);});
      row.sourceRow = Math.max(2,Math.floor(Number(value.sourceRow) || (Number(key) + 2) || 2));
      row.id = text(value.id) || "row-" + row.sourceRow + "-" + key;
      next.push(row);
    });
    // 같은 상품명과 관리번호도 합치지 않습니다. 원본 행을 그대로 유지합니다.
    next.sort(function(a,b){return b.sourceRow - a.sourceRow;});
    records = next;source = catalog && catalog.source || null;loaded = !!catalog;settled = true;failure = "";clearLoading();render();
  }
  function beginLoading(){
    clearLoading();loading = true;failure = "";
    timer = window.setTimeout(function(){fail("목록 응답이 늦어지고 있습니다. 잠시 후 다시 불러와 주세요.");},12000);render();
  }
  function start(){
    if(started){render();return;}
    started = true;beginLoading();
    try{
      ref = firebase.database().ref("shootingSampleCatalog");
      ref.on("value",receive,function(){fail("샘플 목록에 연결하지 못했습니다. 인터넷 또는 읽기 권한을 확인해 주세요.");});
    }catch(error){fail("샘플 목록에 연결하지 못했습니다. 잠시 후 다시 불러와 주세요.");}
  }
  function change(key,value,replace){
    var next = Object.assign({},sampleFilters);next[key] = value;navigateSamples_(next,!!replace);
  }
  el.sampleSearch.addEventListener("input",function(event){
    var next = text(event.target.value);if(next === sampleFilters.query) return;
    change("query",next,!!sampleFilters.query && !!next);
  });
  [["sampleLocation","location"],["sampleOperation","operation"],["sampleOwner","owner"]].forEach(function(pair){
    el[pair[0]].addEventListener("change",function(event){change(pair[1],event.target.value,false);});
  });
  el.sampleReset.addEventListener("click",function(){navigateSamples_({query:"",location:"all",operation:"all",owner:"all"},false);});
  el.sampleReload.addEventListener("click",function(){
    if(loading) return;
    if(!ref){started = false;start();return;}
    beginLoading();
    ref.once("value").then(receive).catch(function(){fail("목록을 다시 불러오지 못했습니다. 연결을 확인해 주세요.");});
  });
  window.AiselSamples = {render:render,onShow:start,isReady:function(){return settled;}};
  render();restoreView_(window.history.state);
})();
