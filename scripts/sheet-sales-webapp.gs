/** v233: server-only sales bridge. The deployment script injects a digest;
 * no credential or digest is sent to the browser. Keep existing Sheets scope.
 */
var AISEL_SALES_KEY_SHA256 = '__AISEL_SALES_KEY_SHA256__';
function doGet(e){
  return salesJson_({ok:false,error:'authentication_required'});
}
function doPost(e){
  var p;
  try {
    var body=e&&e.postData&&e.postData.contents;
    if(typeof body!=='string'||body.length>4096)throw Error('invalid');
    p=JSON.parse(body);
  } catch(ignore) { return salesJson_({ok:false,error:'authentication_required'}); }
  if(!p||p.action!=='sales'||!salesServerKey_(p.key))return salesJson_({ok:false,error:'authentication_required'});
  return salesRead_();
}
function salesServerKey_(key){
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||!/^[a-f0-9]{64}$/.test(AISEL_SALES_KEY_SHA256))return false;
  var hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,key,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  var difference=0;for(var i=0;i<64;i++)difference|=hash.charCodeAt(i)^AISEL_SALES_KEY_SHA256.charCodeAt(i);
  return difference===0;
}
function salesRead_(){
  try{
    var id='1lgJpmwHFRQYT0XqXyZOdTiMswaPOmUj2e_36cFQrit0';
    var meta=Sheets.Spreadsheets.get(id,{fields:'sheets.properties'});
    var tab=meta.sheets.filter(function(s){return s.properties.sheetId===2026100512;})[0];
    if(!tab)throw Error('source_tab_missing');
    // Fixed tab/range: caller cannot request other sheets, cells, or write actions.
    var range="'"+tab.properties.title.replace(/'/g,"''")+"'!A1:J160";
    var values=Sheets.Spreadsheets.Values.get(id,range,{valueRenderOption:'FORMATTED_VALUE'}).values||[];
    var result=globalThis.AiselSheetSales.parse(values);
    result.readAt=new Date().toISOString();
    // readAt is read time, not Cafe24 collection or source-sheet update time.
    result.ok=true;
    return salesJson_(result);
  }catch(err){console.error('Sales sheet read failed');return salesJson_({ok:false,error:'source_unavailable'});}
}
function salesJson_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
