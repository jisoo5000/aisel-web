'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../design-meeting-core.js');
const source=fs.readFileSync(path.join(__dirname,'../design-meeting.js'),'utf8');
const start=source.indexOf(' function setDetailPhotoSource('),end=source.indexOf(' function renderDetailPhotos(',start);
const context=vm.createContext({C});
vm.runInContext(source.slice(start,end),context);
function image(){const requests=[];return{requests,onerror:null,set src(url){requests.push(url);},get src(){return requests.at(-1);},fail(){this.onerror?.();}};}
const thumb='https://photos.example.test/small.jpg',original='https://photos.example.test/original.png';

test('a successful preview never requests the large original or changes source metadata',()=>{
 const photo=Object.freeze({thumb,original,hash:'unchanged',bytes:8267571}),img=image();
 context.setDetailPhotoSource(img,photo);
 assert.deepEqual(img.requests,[thumb]);
 assert.equal(photo.original,original);
});
test('failed preview falls back once and stops even if the original also fails',()=>{
 const img=image();context.setDetailPhotoSource(img,{thumb,original});
 img.fail();img.fail();img.fail();
 assert.deepEqual(img.requests,[thumb,original]);
 assert.equal(img.onerror,null);
});
test('legacy photos and identical URLs have a single request without a retry loop',()=>{
 for(const photo of [{original},{thumb:original,original},{thumb,original:thumb}]){
  const img=image();context.setDetailPhotoSource(img,photo);img.fail();img.fail();
  assert.equal(img.requests.length,1);assert.equal(img.onerror,null);
 }
});
test('invalid preview uses the valid original; empty and unsafe URLs make no request',()=>{
 const img=image();context.setDetailPhotoSource(img,{thumb:'javascript:alert(1)',original});
 assert.deepEqual(img.requests,[original]);
 for(const photo of [{},{thumb:'',original:''},{thumb:'data:image/png;base64,invalid',original:'javascript:alert(1)'}]){
  const empty=image();context.setDetailPhotoSource(empty,photo);empty.fail();assert.deepEqual(empty.requests,[]);
 }
});
