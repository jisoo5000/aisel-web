/** Prepared only. Do not deploy without approval of the six-field access scope.
 * Standalone read-only project: no existing write bridge or Cafe24 collector changes.
 * Include sheet-sales-adapter.js as a .gs file in the same project.
 */
function doGet(e){
  if(!e||e.parameter.action!=='sales')return salesJson_({ok:false,error:'unsupported_request'});
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
  }catch(err){console.error(err.message);return salesJson_({ok:false,error:'source_unavailable'});}
}
function salesJson_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
