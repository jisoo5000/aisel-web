/* Reference saves: compare confirmed inputs, merge independent edits, never guess an unknown base. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AiselReferenceSave=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  function equal(a,b){
    if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
    if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>equal(value,b[index]));
    const keys=Object.keys(a).sort(),other=Object.keys(b).sort();return equal(keys,other)&&keys.every(key=>equal(a[key],b[key]));
  }
  function inputs(record={}){
    const sourceLinks=Array.isArray(record.sourceLinks)?record.sourceLinks:record.sourceUrl?[record.sourceUrl]:[];
    const noteEntries=Array.isArray(record.noteEntries)?record.noteEntries.map(note=>({id:note.id,date:note.date||'',text:note.text||'',categoryId:note.categoryId||''})):[];
    return {title:record.title||'',designer:record.designer||'',date:record.date||'',category:record.category||'product',contentType:record.contentType||'',categoryMode:record.categoryMode||'auto',sourceLinks:clone(sourceLinks),sourceUrl:sourceLinks[0]||'',photos:(record.photos||[]).map(photo=>Object.fromEntries(['hash','original','thumb','width','height','bytes','thumbBytes'].filter(key=>photo[key]!==undefined).map(key=>[key,clone(photo[key])]))),noteEntries,notes:noteEntries.length?noteEntries.map(note=>'['+note.date+'] '+note.text).join('\n\n'):record.notes||''};
  }
  function patch(base,record){
    const current=inputs(record),before=base?inputs(base):null,out={};
    for(const key of Object.keys(current))if((key!=='designer'||Object.prototype.hasOwnProperty.call(record,'designer'))&&(!before||!equal(before[key],current[key])))out[key]=current[key];
    if(out.noteEntries)out.notes=current.notes;
    if(out.sourceLinks)out.sourceUrl=current.sourceUrl;
    return out;
  }
  function confirmedAttempt(attempt,remote){
    if(!attempt||!Object.keys(attempt.patch||{}).length||attempt.snapshot?.id!==remote.id||remote.version<=attempt.snapshot.version)return false;
    const latest=inputs(remote);return Object.entries(attempt.patch||{}).every(([key,value])=>equal(latest[key],value));
  }
  function merge(base,local,remote,attempt){
    const conflicts=[];
    if(!remote||local.id!==remote.id||remote.archivedAt)return {ok:false,conflicts:['record']};
    if(confirmedAttempt(attempt,remote))base={...(base||attempt.base||{}),...clone(attempt.patch),id:remote.id,version:attempt.snapshot.version+1};
    // Legacy drafts never supplied a designer. Missing means unspecified; only an explicit empty string clears it.
    const desired=inputs(Object.prototype.hasOwnProperty.call(local,'designer')?local:{...local,designer:base?.designer||remote.designer||''}),latest=inputs(remote);
    if(!base){if(equal(desired,latest))return {ok:true,record:clone(remote),patch:{}};return {ok:false,conflicts:['unknown_base']};}
    if(base.id!==local.id||Number(base.version)>Number(remote.version))return {ok:false,conflicts:['version']};
    const before=inputs(base),result={...latest};
    function choose(previous,mine,theirs,path){
      if(equal(mine,previous))return clone(theirs);
      if(equal(theirs,previous)||equal(mine,theirs))return clone(mine);
      conflicts.push(path);return clone(mine);
    }
    for(const key of ['title','designer','date','categoryMode','sourceLinks','photos'])result[key]=choose(before[key],desired[key],latest[key],key);
    [result.category,result.contentType]=choose([before.category,before.contentType],[desired.category,desired.contentType],[latest.category,latest.contentType],'category');
    const oldNotes=new Map(before.noteEntries.map(note=>[note.id,note])),myNotes=new Map(desired.noteEntries.map(note=>[note.id,note])),theirNotes=new Map(latest.noteEntries.map(note=>[note.id,note]));
    result.noteEntries=[];
    for(const id of new Set([...theirNotes.keys(),...myNotes.keys(),...oldNotes.keys()])){
      const previous=oldNotes.get(id),mine=myNotes.get(id),theirs=theirNotes.get(id);let note;
      if(previous&&mine&&theirs){note={id};for(const key of ['date','text','categoryId'])note[key]=choose(previous[key],mine[key],theirs[key],'note:'+id+':'+key);}
      else note=choose(previous,mine,theirs,'note:'+id);
      if(note)result.noteEntries.push(note);
    }
    if(!before.noteEntries.length&&!desired.noteEntries.length&&!latest.noteEntries.length)result.notes=choose(before.notes,desired.notes,latest.notes,'notes');
    const record={...clone(remote),...inputs(result)};
    return {ok:conflicts.length===0,record,patch:patch(remote,record),conflicts};
  }
  return {inputs,patch,merge,equal,confirmedAttempt};
});
