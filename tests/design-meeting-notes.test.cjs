'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const N=require('../design-meeting-notes.js'),C=require('../design-meeting-core.js');
const id='note_fixture01',second='note_fixture02',base={date:'2026-10-12',text:'기존 참고',createdAt:10,updatedAt:10};
const candidate=()=>({id:'dm_fixture01',designMeeting:true,inputVersion:4,reviewRequestedVersion:4,reviewState:'done',title:'UUR 셋업',photos:[{original:'https://example.test/photo.jpg'}],memo:'기존 메모',meetingMemo:'기존 회의 메모',cost:{confirmed:12000},convertedCode:'AS-26F-BL-001',referenceNotes:{[id]:{...base}},updatedAt:10});
test('reference text/date save preserves every unrelated field and review input signature',()=>{
 const c=candidate(),next=N.apply(c,[{id,base,next:{...base,date:'2026-10-13',text:'수정한 참고'}}],50);
 assert.equal(next.referenceNotes[id].text,'수정한 참고');assert.equal(next.referenceNotes[id].date,'2026-10-13');assert.equal(next.referenceNotes[id].createdAt,10);assert.equal(next.referenceNotes[id].updatedAt,50);
 const {referenceNotes,updatedAt,...rest}=next,{referenceNotes:oldNotes,updatedAt:oldAt,...previous}=c;assert.deepEqual(rest,previous);assert.equal(C.signature(next),C.signature(c));assert.equal(C.edit(next,{referenceNotes:next.referenceNotes}).inputVersion,4);assert.equal(c.referenceNotes[id].text,'기존 참고');
});
test('adding/deleting one note preserves other notes; delete retry is idempotent',()=>{
 const c=candidate(),added=N.apply(c,[{id:second,base:null,next:{date:'2026-10-12',text:'추가 참고',createdAt:20}}],50);
 assert.deepEqual(added.referenceNotes[id],base);assert.equal(Object.keys(added.referenceNotes).length,2);
 const changes=[{id,base,next:null}],deleted=N.apply(added,changes,60);assert.equal(deleted.referenceNotes[id],undefined);assert.deepEqual(deleted.referenceNotes[second],added.referenceNotes[second]);assert.deepEqual(N.apply(deleted,changes,60),deleted);
});
test('different fields and separate note edits merge without losing remote changes',()=>{
 const c=candidate();c.referenceNotes[id].date='2026-10-14';c.referenceNotes[second]={date:'2026-10-12',text:'다른 기기 참고'};c.designer='다른 기기 담당자';
 const next=N.apply(c,[{id,base,next:{...base,text:'현재 입력'}}],60);
 assert.equal(next.referenceNotes[id].date,'2026-10-14');assert.equal(next.referenceNotes[id].text,'현재 입력');assert.deepEqual(next.referenceNotes[second],c.referenceNotes[second]);assert.equal(next.designer,c.designer);
});
test('same-field concurrent edits and remotely deleted notes fail without overwriting',()=>{
 const c=candidate();c.referenceNotes[id].text='다른 기기 변경';
 assert.throws(()=>N.apply(c,[{id,base,next:{...base,text:'현재 입력'}}]),{code:'note_conflict'});assert.equal(c.referenceNotes[id].text,'다른 기기 변경');
 assert.throws(()=>N.apply(c,[{id,base,next:null}]),{code:'note_conflict'});
 delete c.referenceNotes[id];assert.throws(()=>N.apply(c,[{id,base,next:{...base,text:'현재 입력'}}]),{code:'note_conflict'});
});
test('save retry with the same new note ID does not create duplicate notes',()=>{
 const c=candidate(),change={id:second,base:null,next:{date:'2026-10-12',text:'저장 확인 재시도',createdAt:20}};
 const saved=N.apply(c,[change],50),retried=N.apply(saved,[change],60);assert.equal(Object.keys(retried.referenceNotes).length,2);assert.equal(retried.referenceNotes[second].createdAt,20);
});
test('invalid dates, excessive input, unexpected data shape and deleted candidates fail safely',()=>{
 for(const date of ['2026-02-30','2026-13-01','','2026-1-1'])assert.throws(()=>N.apply(candidate(),[{id,base,next:{...base,date}}]),/날짜/);
 assert.throws(()=>N.apply(candidate(),[{id,base,next:{...base,text:'x'.repeat(20001)}}]),/20,000/);
 assert.throws(()=>N.apply({...candidate(),referenceNotes:[]},[]),/형식/);
 assert.throws(()=>N.apply({...candidate(),designMeetingDeletedAt:50},[]),/삭제/);
 assert.equal(N.today(new Date('2026-10-11T16:00:00Z')),'2026-10-12');
});
test('category changes merge with independent text/date edits and never change review inputs',()=>{
 const category='cat_'+'a'.repeat(64),c=candidate();c.referenceNotes[id].date='2026-10-14';c.referenceNotes[id].text='서버 참고';
 const next=N.apply(c,[{id,base,next:{...base,categoryId:category}}],60);
 assert.equal(next.referenceNotes[id].categoryId,category);assert.equal(next.referenceNotes[id].date,'2026-10-14');assert.equal(next.referenceNotes[id].text,'서버 참고');assert.equal(C.signature(next),C.signature(c));assert.equal(next.inputVersion,c.inputVersion);
});
test('same-category-field conflicts preserve both inputs for caller reconciliation',()=>{
 const c=candidate(),remote='cat_'+'a'.repeat(64),local='cat_'+'b'.repeat(64);c.referenceNotes[id].categoryId=remote;
 assert.throws(()=>N.apply(c,[{id,base,next:{...base,categoryId:local}}]),{code:'note_conflict'});assert.equal(c.referenceNotes[id].categoryId,remote);
});
test('legacy omission preserves existing category while explicit empty string clears it',()=>{
 const c=candidate(),category='cat_'+'a'.repeat(64);c.referenceNotes[id].categoryId=category;
 const legacy=N.apply(c,[{id,base,next:{...base,text:'구형 화면 수정'}}],60);assert.equal(legacy.referenceNotes[id].categoryId,category);
 const clear=N.apply(c,[{id,base:{...base,categoryId:category},next:{...base,categoryId:''}}],70);assert.equal(clear.referenceNotes[id].categoryId,'');
 assert.equal(N.same(base,{...base,categoryId:''}),true);assert.throws(()=>N.apply(c,[{id,base,next:{...base,categoryId:'arbitrary'}}]),/분류/);
});
