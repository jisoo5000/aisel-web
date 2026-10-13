(function(root){
 'use strict';
 const profiles={workorder:{maxWidth:800,maxHeight:3200,target:300*1024,quality:.8,minQuality:.72},collection:{maxWidth:1600,maxHeight:8000,target:1024*1024,quality:.86,minQuality:.78},thumb:{maxWidth:480,maxHeight:480,target:100*1024,quality:.76,minQuality:.6},workorderThumb:{maxWidth:320,maxHeight:320,target:60*1024,quality:.7,minQuality:.6}};
 function dataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error||Error('사진을 읽지 못했습니다.'));r.readAsDataURL(blob);});}
 async function prepare(file,profile='collection'){
   if(!(file instanceof Blob))throw Error('사진 파일을 확인해주세요.');
   const p=profiles[profile];if(!p)throw Error('사진 크기 기준을 확인해주세요.');
   const url=URL.createObjectURL(file),img=new Image();
   try{
     img.src=url;await img.decode();
     const sourceWidth=img.naturalWidth,sourceHeight=img.naturalHeight;
     if(!sourceWidth||!sourceHeight)throw Error('사진 크기를 읽지 못했습니다.');
     if(profile==='collection'&&file.type==='image/gif')return {blob:file,width:sourceWidth,height:sourceHeight,sourceWidth,sourceHeight,sourceBytes:file.size,bytes:file.size,quality:null};
     const scale=Math.min(1,p.maxWidth/sourceWidth,p.maxHeight/sourceHeight),width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale));
     const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
     const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(img,0,0,width,height);
     let blob,quality=p.quality;
     do{blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(!blob)throw Error('사진 용량을 줄이지 못했습니다. 다시 선택해주세요.');if(blob.size<=p.target||quality<=p.minQuality)break;quality=Math.max(p.minQuality,quality-.04);}while(true);
     // Do not enlarge a small image's file or strip its animation when no resize
     // is necessary. Readability sets a quality floor, not an arbitrary hard cap.
     if(scale===1&&file.size<=blob.size&&['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))blob=file;
     return {blob,width,height,sourceWidth,sourceHeight,sourceBytes:file.size,bytes:blob.size,quality:blob===file?null:quality};
   }finally{URL.revokeObjectURL(url);}
 }
 root.AiselPhoto={prepare,dataURL,profiles};
})(globalThis);
