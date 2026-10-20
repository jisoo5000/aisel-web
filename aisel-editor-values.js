(function(root){
 'use strict';
 const aliases={5:4,9:8,11:10};
 function categoryIndex(value){const n=Number(value);return Object.hasOwn(aliases,n)?aliases[n]:n;}
 function blend(value){
  const source=String(value||'').trim();if(!source)return '';
  const fibers={polyester:'폴리에스터',poly:'폴리에스터','폴리에스터':'폴리에스터','폴리':'폴리에스터',p:'폴리에스터',cotton:'면',cot:'면','코튼':'면','면':'면',c:'면',polyurethane:'폴리우레탄',spandex:'폴리우레탄',elastane:'폴리우레탄','폴리우레탄':'폴리우레탄','스판덱스':'폴리우레탄','스판':'폴리우레탄',nylon:'나일론','나일론':'나일론',n:'나일론',rayon:'레이온','레이온':'레이온',r:'레이온',wool:'울','울':'울',w:'울',linen:'린넨','린넨':'린넨',acrylic:'아크릴','아크릴':'아크릴'};
  const re=new RegExp('('+Object.keys(fibers).sort((a,b)=>b.length-a.length).join('|')+')\\s*(\\d+(?:\\.\\d+)?)\\s*%?','igy');const parts=[];let at=0,total=0;
  while(at<source.length){re.lastIndex=at;const m=re.exec(source);if(!m)return value;const n=Number(m[2]);if(n<=0||n>100)return value;total+=n;parts.push(fibers[m[1].toLowerCase()]+' '+m[2]+'%');at=re.lastIndex;const sep=source.slice(at).match(/^[\s/,+·]+/);if(sep)at+=sep[0].length;if(at===source.length&&sep&&/[\/,+·]/.test(sep[0]))return value;}
  return Math.abs(total-100)<0.01?parts.join(' · '):value;
 }
 function color(value){const s=String(value||'').trim();return /^(?:아검|아이검정|아이보리[·/\s-]*(?:검정|블랙))(?:st|스트라이프)$/i.test(s.replace(/\s/g,''))?'아이보리·검정 스트라이프':s;}
 function validCode(value){return /^AS-\d{2}[A-Z]{1,2}-(?:BL|SH|HT|LT|SL|KT|KN|CD|OP|SK|WSK|PT|CP|DN|JK|CT|VT|SET|OPS|SC)-\d{3,6}$/.test(value)&&Number(value.split('-').at(-1))>0;}
 const api={categoryIndex,blend,color,validCode,navy:'#2F3B52'};root.AiselEditorValues=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
