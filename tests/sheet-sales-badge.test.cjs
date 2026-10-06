'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('scripts/sheet-sales-view.js','utf8'),context);
const rate=(share,returns)=>context.AiselSheetSalesView.performance({share,returns})?.key??null;
test('whole-store share boundaries and return priority',()=>{
 assert.equal(rate(9.99,0),'low');assert.equal(rate(10,19.99),'normal');
 assert.equal(rate(19.99,0),'normal');assert.equal(rate(20,19.99),'good');
 assert.equal(rate(20,20),'low');assert.equal(rate(100,20.01),'low');
});
test('unknowns are never converted to zero or a favorable rating',()=>{
 for(const missing of [null,undefined,NaN,'0',-1,101]){
  assert.equal(rate(20,missing),null);assert.equal(rate(missing,0),null);
  assert.equal(rate(9,missing),'low');assert.equal(rate(missing,20),'low');
 }
 assert.equal(rate(null,null),null);assert.equal(rate(0,0),'low');
});
