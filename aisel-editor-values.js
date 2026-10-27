(function(root){
 'use strict';
 const aliases={5:4,9:8,11:10};
 function categoryIndex(value){const n=Number(value);return Object.hasOwn(aliases,n)?aliases[n]:n;}
 function blend(value){
  const source=String(value||'').trim();if(!source)return '';
  const fibers={polyester:'폴리에스터',poly:'폴리에스터','폴리에스터':'폴리에스터','폴리':'폴리에스터',p:'폴리에스터',cotton:'면',cot:'면','코튼':'면','면':'면',c:'면',polyurethane:'폴리우레탄',spandex:'폴리우레탄',elastane:'폴리우레탄','폴리우레탄':'폴리우레탄','스판덱스':'폴리우레탄','스판':'폴리우레탄',nylon:'나일론','나일론':'나일론',n:'나일론',rayon:'레이온','레이온':'레이온',r:'레이온',wool:'울','울':'울',w:'울',linen:'린넨','린넨':'린넨',acrylic:'아크릴','아크릴':'아크릴'};
  const english={'폴리에스터':'POLYESTER','면':'COTTON','폴리우레탄':'SPANDEX','나일론':'NYLON','레이온':'RAYON','울':'WOOL','린넨':'LINEN','아크릴':'ACRYLIC'};
  const re=new RegExp('('+Object.keys(fibers).sort((a,b)=>b.length-a.length).join('|')+')\\s*(\\d+(?:\\.\\d+)?)\\s*%?','igy');const parts=[];let at=0,total=0;
  while(at<source.length){re.lastIndex=at;const m=re.exec(source);if(!m)return value;const n=Number(m[2]);if(n<=0||n>100)return value;total+=n;parts.push(english[fibers[m[1].toLowerCase()]]+' '+m[2]+'%');at=re.lastIndex;const sep=source.slice(at).match(/^[\s/,+·]+/);if(sep)at+=sep[0].length;if(at===source.length&&sep&&/[\/,+·]/.test(sep[0]))return value;}
  return Math.abs(total-100)<0.01?parts.join(' '):value;
 }
 // Workroom shorthand is normalized only when both stripe colors are explicit.
 const stripeAliases={아이보리:'아이보리',아이:'아이보리',아:'아이보리',ivory:'아이보리',검정:'검정',블랙:'검정',검:'검정',black:'검정',화이트:'화이트',흰색:'화이트',흰:'화이트',white:'화이트',크림:'크림',cream:'크림',베이지:'베이지',베:'베이지',beige:'베이지',네이비:'네이비',곤색:'네이비',곤:'네이비',navy:'네이비',딥네이비:'딥 네이비',그레이:'그레이',회색:'그레이',gray:'그레이',grey:'그레이',차콜:'차콜',먹색:'차콜',charcoal:'차콜',블루:'블루',blue:'블루',핑크:'핑크',pink:'핑크',브라운:'브라운',brown:'브라운'};
 function stripeColors(value){
  const s=String(value||'').trim();
  const prefix=/^(?:스트라이프|줄무늬|striped|stripes|stripe|st)[\s·/,_+-]*(.+)$/i;
  const suffix=/^(.+?)[\s·/,_+-]*(?:스트라이프|줄무늬|striped|stripes|stripe|st)$/i;
  const match=s.match(prefix)||s.match(suffix);if(!match)return null;
  const body=match[1].trim().toLowerCase(),parts=body.split(/[\s·/,_+&-]+/).filter(Boolean);
  let result=parts.length===2&&parts.every(x=>Object.hasOwn(stripeAliases,x))?parts.map(x=>stripeAliases[x]):null;
  if(!result){const compact=body.replace(/[\s·/,_+&-]+/g,'');for(const a of Object.keys(stripeAliases).sort((a,b)=>b.length-a.length)){if(!compact.startsWith(a))continue;const b=compact.slice(a.length);if(Object.hasOwn(stripeAliases,b)){result=[stripeAliases[a],stripeAliases[b]];break;}}}
  if(!result||result[0]===result[1])return null;
  if(result.includes('아이보리')&&result.includes('검정'))return ['아이보리','검정'];
  return result;
 }
 function color(value){const s=String(value||'').trim(),stripe=stripeColors(s);return stripe?stripe.join('·')+' 스트라이프':s;}
 function validCode(value){return /^AS-\d{2}[A-Z]{1,2}-(?:BL|SH|HT|LT|SL|KT|KN|CD|OP|SK|WSK|PT|CP|DN|JK|CT|VT|SET|OPS|SC)-\d{3,6}$/.test(value)&&Number(value.split('-').at(-1))>0;}
 const api={categoryIndex,blend,color,stripeColors,validCode,navy:'#2F3B52'};root.AiselEditorValues=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
