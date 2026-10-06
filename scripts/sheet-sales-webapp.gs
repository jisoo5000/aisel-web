/** Prepared only. Do not deploy without approval of the six-field access scope.
 * Standalone read-only project: no existing write bridge or Cafe24 collector changes.
 * Include sheet-sales-adapter.js as a .gs file in the same project.
 */
function doGet(e){
  if(!e||e.parameter.action!=='sales')return salesJson_({ok:false,error:'unsupported_request'});
  try{
    var ss=SpreadsheetApp.openById('1lgJpmwHFRQYT0XqXyZOdTiMswaPOmUj2e_36cFQrit0');
    var tab=ss.getSheets().filter(function(s){return s.getSheetId()===2026100512;})[0];
    if(!tab)throw Error('source_tab_missing');
    // Fixed tab/range: caller cannot request other sheets, cells, or write actions.
    var values=tab.getRange(1,1,Math.min(tab.getLastRow(),160),10).getDisplayValues();
    var result=AiselSheetSales.parse(values);
    result.readAt=new Date().toISOString();
    // readAt is read time, not Cafe24 collection or source-sheet update time.
    result.ok=true;
    return salesJson_(result);
  }catch(err){return salesJson_({ok:false,error:'source_unavailable'});}
}
function salesJson_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
