(() => {
  const COLORS=['red','orange','yellow','green','aqua','blue','purple','magenta'];
  const HUE_CENTERS={red:0,orange:30,yellow:60,green:120,aqua:180,blue:230,purple:275,magenta:320};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const BLOCKED_KEYS=new Set(['__proto__','prototype','constructor']);
  const MAX_CURVE_POINTS=64,MAX_CLEANUP_SPOTS=200,MAX_CANVAS_EDGE=16384,MAX_CANVAS_PIXELS=50_000_000;

  function defaultEdits(){
    const mixer={}; COLORS.forEach(c=>mixer[c]={hue:0,saturation:0,luminance:0});
    return {
      version:2,profile:'Luma Color',profileAmount:100,bw:false,
      light:{exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0},
      curve:{channel:'rgb',rgb:[[0,0],[255,255]],red:[[0,0],[255,255]],green:[[0,0],[255,255]],blue:[[0,0],[255,255]],refineSaturation:0},
      color:{wb:'As Shot',temperature:0,tint:0,vibrance:0,saturation:0},mixer,pointColor:{enabled:false,hue:30,hueShift:0,saturationShift:0,luminanceShift:0,variance:25,range:30,visualize:false},
      grading:{shadows:{hue:220,saturation:0,luminance:0},midtones:{hue:40,saturation:0,luminance:0},highlights:{hue:45,saturation:0,luminance:0},global:{hue:30,saturation:0,luminance:0},blending:50,balance:0},
      effects:{texture:0,clarity:0,dehaze:0,vignette:0,vignetteMidpoint:50,vignetteRoundness:0,vignetteFeather:50,vignetteHighlights:0,grain:0,grainSize:25,grainRoughness:50},
      detail:{sharpening:0,radius:1,sharpenDetail:25,sharpenMasking:0,noiseLuminance:0,noiseDetail:50,noiseContrast:0,noiseColor:0,colorDetail:50,colorSmoothness:50},
      optics:{removeCA:false,lensCorrections:false,distortion:0,lensVignette:0,defringePurple:0,defringeGreen:0},
      geometry:{rotation90:0,flipX:false,flipY:false,straighten:0,distortion:0,vertical:0,horizontal:0,rotate:0,aspect:0,scale:100,xOffset:0,yOffset:0,constrainCrop:false,cropAspect:'Original',cropZoom:100,cropX:0,cropY:0},
      mask:{enabled:false,type:'subject',x:.5,y:.5,size:35,feather:55,invert:false,subjectExposure:0,subjectClarity:0,backgroundExposure:0,backgroundBlur:0,skyExposure:0,skyTemperature:0,show:true},
      cleanup:[]
    };
  }

  function sanitizeNumber(path,value,fallback){
    const n=Number(value);if(!Number.isFinite(n))return fallback;
    if(path==='version')return 2;
    if(path==='mask.x'||path==='mask.y')return Math.max(0,Math.min(1,n));
    if(path.endsWith('.hue')||path==='pointColor.hue')return Math.max(0,Math.min(360,n));
    if(path.includes('exposure')||path==='light.exposure')return Math.max(-5,Math.min(5,n));
    if(path==='profileAmount')return Math.max(0,Math.min(200,n));
    if(path==='mask.size')return Math.max(5,Math.min(90,n));
    if(path==='mask.feather'||path==='mask.backgroundBlur')return Math.max(0,Math.min(100,n));
    if(path==='detail.radius')return Math.max(.1,Math.min(10,n));
    if(path==='geometry.scale')return Math.max(10,Math.min(400,n));
    if(path==='geometry.cropZoom')return Math.max(100,Math.min(1000,n));
    if(path==='geometry.rotation90')return((n+180)%360+360)%360-180;
    return Math.max(-500,Math.min(500,n));
  }
  function sanitizeArray(path,value,fallback){
    if(!Array.isArray(value))return clone(fallback);
    if(path==='cleanup')return value.slice(0,MAX_CLEANUP_SPOTS).flatMap(spot=>{
      if(!spot||typeof spot!=='object')return[];const x=Number(spot.x),y=Number(spot.y),size=Number(spot.size);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(size))return[];
      return[{x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),size:Math.max(.1,Math.min(25,size))}];
    });
    if(path.startsWith('curve.')){
      const points=value.slice(0,MAX_CURVE_POINTS).flatMap(point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(+point[0])&&Number.isFinite(+point[1])?[[Math.max(0,Math.min(255,+point[0])),Math.max(0,Math.min(255,+point[1]))]]:[]).sort((a,b)=>a[0]-b[0]);
      return points.length>=2?points:clone(fallback);
    }
    return value.slice(0,256).map(item=>item&&typeof item==='object'?clone(item):item);
  }
  function deepMerge(target,source,path='',depth=0){
    if(!source||typeof source!=='object'||Array.isArray(source)||depth>10)return target;
    for(const [k,v] of Object.entries(source)){
      if(BLOCKED_KEYS.has(k)||!Object.prototype.hasOwnProperty.call(target,k))continue;
      const next=path?`${path}.${k}`:k,current=target[k];
      if(Array.isArray(current))target[k]=sanitizeArray(next,v,current);
      else if(current&&typeof current==='object'){if(v&&typeof v==='object'&&!Array.isArray(v))deepMerge(current,v,next,depth+1)}
      else if(typeof current==='number')target[k]=sanitizeNumber(next,v,current);
      else if(typeof current==='boolean'){if(typeof v==='boolean')target[k]=v}
      else if(typeof current==='string'&&typeof v==='string')target[k]=v.slice(0,128);
    }
    return target;
  }
  function migratedEdits(old){
    const fresh=defaultEdits();
    if(!old)return fresh;
    const structured=['light','curve','color','mixer','pointColor','grading','effects','detail','optics','geometry','mask','cleanup'].some(key=>Object.prototype.hasOwnProperty.call(old,key));
    if(structured)deepMerge(fresh,old);
    const map={exposure:['light','exposure'],contrast:['light','contrast'],highlights:['light','highlights'],shadows:['light','shadows'],temperature:['color','temperature'],tint:['color','tint'],saturation:['color','saturation'],vignette:['effects','vignette'],grain:['effects','grain']};
    for(const [k,path] of Object.entries(map))if(old[k]!=null)fresh[path[0]][path[1]]=sanitizeNumber(path.join('.'),old[k],fresh[path[0]][path[1]]);
    return fresh;
  }
  function migratePhoto(p){
    p=p&&typeof p==='object'?p:{};
    const editSource=p.edits||p.adjust,rating=Math.max(0,Math.min(5,Math.round(Number.isFinite(+p.rating)?+p.rating:0))),flag=['none','pick','reject'].includes(p.flag)?p.flag:'none',label=['red','yellow','green','blue','purple'].includes(p.label)?p.label:'';
    const tags=Array.isArray(p.tags)?[...new Set(p.tags.filter(x=>typeof x==='string').slice(0,100).map(x=>x.slice(0,100)))]:[];
    const finite=(v,d=0)=>Number.isFinite(+v)?+v:d,quality=p.quality&&typeof p.quality==='object'?{sharpness:finite(p.quality.sharpness),exposure:finite(p.quality.exposure),score:Math.max(0,Math.min(100,finite(p.quality.score))),issue:String(p.quality.issue||'').slice(0,100)}:null;
    const filePath=String(p.filePath||'').slice(0,32767),importedAt=finite(p.importedAt,Date.now());
    return{id:String(p.id||'').slice(0,128),filePath,name:String(p.name||'Untitled').slice(0,260),url:`local-image://load?path=${encodeURIComponent(filePath)}`,edits:migratedEdits(editSource),rating,flag,label,tags,caption:String(p.caption||'').slice(0,2000),selected:false,quality,importedAt};
  }

  const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
  const smooth=t=>t*t*(3-2*t);
  function makeCanvas(width=1,height=1){const canvas=typeof document!=='undefined'?document.createElement('canvas'):new OffscreenCanvas(width,height);canvas.width=width;canvas.height=height;return canvas}
  function hslToRgb(h,s,l){h=((h%360)+360)%360/360;if(s<=0)return[l,l,l];const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;const f=t=>{if(t<0)t++;if(t>1)t--;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p};return[f(h+1/3),f(h),f(h-1/3)]}
  function rgbToHsl(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;if(max===min)return[0,0,l];const d=max-min,s=l>.5?d/(2-max-min):d/(max+min);let h;if(max===r)h=(g-b)/d+(g<b?6:0);else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;return[h*60,s,l]}
  function hueDistance(a,b){const d=Math.abs(a-b)%360;return Math.min(d,360-d)}
  function buildLut(points){const pts=[...points].sort((a,b)=>a[0]-b[0]),lut=new Uint8ClampedArray(256);for(let x=0;x<256;x++){let i=0;while(i<pts.length-2&&x>pts[i+1][0])i++;const a=pts[i],b=pts[Math.min(i+1,pts.length-1)],t=b[0]===a[0]?0:(x-a[0])/(b[0]-a[0]);lut[x]=clamp(a[1]+(b[1]-a[1])*t,0,255)}return lut}
  function tintBlend(r,g,b,hue,sat,weight){if(sat<=0||weight<=0)return[r,g,b];const tint=hslToRgb(hue,Math.min(1,sat/100),.5),a=Math.min(.55,sat/100*.42)*weight;return[r*(1-a)+tint[0]*a,g*(1-a)+tint[1]*a,b*(1-a)+tint[2]*a]}

  function orientedSource(image,e,maxEdge){
    const rot=((e.geometry.rotation90%360)+360)%360,swap=rot===90||rot===270;
    const naturalW=image.naturalWidth||image.width,naturalH=image.naturalHeight||image.height;
    if(!Number.isFinite(naturalW)||!Number.isFinite(naturalH)||naturalW<1||naturalH<1)throw new Error('The image could not be decoded.');
    const requestedEdge=maxEdge==null?null:Math.max(1,Number(maxEdge)||1),scale=requestedEdge?Math.min(1,requestedEdge/Math.max(naturalW,naturalH)):1,iw=Math.max(1,Math.round(naturalW*scale)),ih=Math.max(1,Math.round(naturalH*scale));
    if(iw>MAX_CANVAS_EDGE||ih>MAX_CANVAS_EDGE||iw*ih>MAX_CANVAS_PIXELS)throw new RangeError('This image is too large to process safely. Choose a smaller export size.');
    const c=makeCanvas(swap?ih:iw,swap?iw:ih);const x=c.getContext('2d',{willReadFrequently:true});x.imageSmoothingQuality='high';x.translate(c.width/2,c.height/2);x.rotate(rot*Math.PI/180);x.scale(e.geometry.flipX?-1:1,e.geometry.flipY?-1:1);x.drawImage(image,-iw/2,-ih/2,iw,ih);return c;
  }
  function transformAndCrop(src,e){
    const g=e.geometry,w=src.width,h=src.height,t=makeCanvas(w,h);const x=t.getContext('2d',{willReadFrequently:true});
    x.imageSmoothingQuality='high';x.translate(w/2+g.xOffset/200*w,h/2+g.yOffset/200*h);x.rotate((g.straighten+g.rotate)*Math.PI/180);const constrained=g.constrainCrop?(Math.abs(g.straighten+g.rotate)/180+Math.abs(g.vertical)/500+Math.abs(g.horizontal)/500):0,lensDistortion=e.optics.lensCorrections?e.optics.distortion:0,distortionScale=(1+(g.distortion+lensDistortion)/700)*(1+constrained),sx=(g.scale/100)*(1+g.aspect/200)*distortionScale,sy=(g.scale/100)*(1-g.aspect/200)*distortionScale;x.transform(sx,g.horizontal/260,g.vertical/260,sy,0,0);x.drawImage(src,-w/2,-h/2);
    const ratios={Square:1,'4 × 5':4/5,'5 × 4':5/4,'2 × 3':2/3,'3 × 2':3/2,'9 × 16':9/16,'16 × 9':16/9};let ratio=ratios[g.cropAspect];if(g.cropAspect==='Original'||!ratio)ratio=w/h;
    let cw=w,ch=h;if(w/h>ratio)cw=h*ratio;else ch=w/ratio;const zoom=Math.max(1,g.cropZoom/100);cw/=zoom;ch/=zoom;const maxX=(w-cw)/2,maxY=(h-ch)/2,cx=clamp(w/2-cw/2+g.cropX/100*maxX,0,w-cw),cy=clamp(h/2-ch/2+g.cropY/100*maxY,0,h-ch);
    const out=makeCanvas(Math.max(1,Math.round(cw)),Math.max(1,Math.round(ch)));out.getContext('2d',{willReadFrequently:true}).drawImage(t,cx,cy,cw,ch,0,0,out.width,out.height);return out;
  }

  function applyPixels(canvas,e){
    const x=canvas.getContext('2d',{willReadFrequently:true}),im=x.getImageData(0,0,canvas.width,canvas.height),d=im.data,l=e.light,c=e.color,fx=e.effects,m=e.mask,curve=e.curve;
    const luts={rgb:buildLut(curve.rgb),red:buildLut(curve.red),green:buildLut(curve.green),blue:buildLut(curve.blue)};
    const profile={"Luma Color":[0,0],"Luma Vivid":[8,12],"Luma Neutral":[-8,-10],"Luma Portrait":[-3,4],"Luma Landscape":[9,8],"Monochrome":[8,-100]}[e.profile]||[0,0];
    const profAmount=e.profileAmount/100,contrast=(l.contrast+profile[0]*profAmount)/100,satGlobal=(c.saturation+profile[1]*profAmount)/100,exp=Math.pow(2,l.exposure);
    for(let i=0,p=0;i<d.length;i+=4,p++){
      let r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255;
      r*=exp;g*=exp;b*=exp;
      const temp=c.temperature/100,tint=c.tint/100;r+=temp*.12+tint*.025;b-=temp*.12+tint*.025;g-=tint*.065;
      let lum=.2126*r+.7152*g+.0722*b;
      const shadowW=Math.pow(1-clamp(lum),2),highlightW=Math.pow(clamp(lum),2);
      const tonal=l.shadows/100*.42*shadowW+l.highlights/100*.42*highlightW+l.blacks/100*.28*Math.pow(1-clamp(lum),5)+l.whites/100*.28*Math.pow(clamp(lum),5);
      r+=tonal;g+=tonal;b+=tonal;
      const cf=Math.pow(2,contrast*1.7);r=(r-.5)*cf+.5;g=(g-.5)*cf+.5;b=(b-.5)*cf+.5;
      if(fx.dehaze){const hz=fx.dehaze/100;r=(r-.48)*(1+hz*.65)+.48;g=(g-.48)*(1+hz*.65)+.48;b=(b-.48)*(1+hz*.65)+.48}
      const presence=(fx.clarity*.55+fx.texture*.25)/100;if(presence){const local=(lum-.5)*presence*.28;r+=local;g+=local;b+=local}
      r=luts.red[luts.rgb[Math.round(clamp(r)*255)]]/255;g=luts.green[luts.rgb[Math.round(clamp(g)*255)]]/255;b=luts.blue[luts.rgb[Math.round(clamp(b)*255)]]/255;
      let [h,s,ll]=rgbToHsl(clamp(r),clamp(g),clamp(b));s=clamp(s+curve.refineSaturation/100*s*(1-s)*.65);let hueShift=0,satShift=0,lumShift=0,weightTotal=0;
      for(const name of COLORS){const dist=hueDistance(h,HUE_CENTERS[name]),weight=Math.pow(clamp(1-dist/52),2);if(weight){const q=e.mixer[name];hueShift+=q.hue*.35*weight;satShift+=q.saturation/100*weight;lumShift+=q.luminance/100*.38*weight;weightTotal+=weight}}
      if(weightTotal){h+=hueShift/Math.max(1,weightTotal);s=clamp(s+satShift/Math.max(1,weightTotal)*(1-s*.35));ll=clamp(ll+lumShift/Math.max(1,weightTotal))}
      const pc=e.pointColor;if(pc.enabled){const width=6+pc.range*.75,pw=Math.pow(clamp(1-hueDistance(h,pc.hue)/width),.6+pc.variance/40);h+=pc.hueShift*.35*pw;s=clamp(s+pc.saturationShift/100*pw);ll=clamp(ll+pc.luminanceShift/100*.4*pw);if(pc.visualize&&pw<.08)s=0}
      if(e.optics.removeCA||e.optics.defringePurple||e.optics.defringeGreen){const purple=hueDistance(h,292)<34,green=hueDistance(h,120)<28,reduce=(e.optics.removeCA?12:0)+(purple?e.optics.defringePurple*.55:0)+(green?e.optics.defringeGreen*.55:0);s*=1-clamp(reduce/100,0,.8)}
      const vib=c.vibrance/100;s=clamp(s+vib*(1-s)*(.8-Math.max(0,(hueDistance(h,25)<22?.25:0)))+satGlobal*s);if(e.bw||e.profile==='Monochrome')s=0;
      [r,g,b]=hslToRgb(h,s,ll);lum=.2126*r+.7152*g+.0722*b;
      const bal=e.grading.balance/100,blend=.5+e.grading.blending/200,sw=clamp((.58+bal*.2-lum)/blend),hw=clamp((lum-(.42+bal*.2))/blend),mw=clamp(1-Math.abs(lum-.5)*2);
      [r,g,b]=tintBlend(r,g,b,e.grading.shadows.hue,e.grading.shadows.saturation,sw);[r,g,b]=tintBlend(r,g,b,e.grading.midtones.hue,e.grading.midtones.saturation,mw);[r,g,b]=tintBlend(r,g,b,e.grading.highlights.hue,e.grading.highlights.saturation,hw);[r,g,b]=tintBlend(r,g,b,e.grading.global.hue,e.grading.global.saturation,1);
      const gradeLum=(e.grading.shadows.luminance*sw+e.grading.midtones.luminance*mw+e.grading.highlights.luminance*hw+e.grading.global.luminance)/100*.18;r+=gradeLum;g+=gradeLum;b+=gradeLum;
      const px=p%canvas.width,py=Math.floor(p/canvas.width);if(m.enabled){let maskW=0;if(m.type==='sky'){maskW=clamp(1-py/(canvas.height*.72));}else{const dx=(px/canvas.width-m.x)/(m.size/100),dy=(py/canvas.height-m.y)/(m.size/100*.72),dist=Math.sqrt(dx*dx+dy*dy),edge=Math.max(.02,m.feather/100);maskW=1-smooth(clamp((dist-(1-edge))/edge));}if(m.invert)maskW=1-maskW;const localExp=m.type==='sky'?m.skyExposure*maskW:(m.subjectExposure*maskW+m.backgroundExposure*(1-maskW));r*=Math.pow(2,localExp);g*=Math.pow(2,localExp);b*=Math.pow(2,localExp);if(m.type==='sky'){const wt=m.skyTemperature/100*maskW;r+=wt*.12;b-=wt*.12}else if(m.subjectClarity){const boost=m.subjectClarity/100*maskW*(lum-.5)*.32;r+=boost;g+=boost;b+=boost}}
      const nx=px/canvas.width*2-1,ny=(py/canvas.height*2-1)*(1+fx.vignetteRoundness/150),radius=Math.sqrt(nx*nx+ny*ny),mid=.2+fx.vignetteMidpoint/100*.65,feather=Math.max(.05,fx.vignetteFeather/100),vw=smooth(clamp((radius-mid)/feather));let vignette=fx.vignette/100*vw*.7;if(e.optics.lensCorrections)vignette-=e.optics.lensVignette/100*vw*.45;if(vignette<0){const preserve=clamp(lum)*fx.vignetteHighlights/100,dark=-vignette*(1-preserve*.85);r*=1-dark;g*=1-dark;b*=1-dark}else{r+=vignette;g+=vignette;b+=vignette}
      if(fx.grain){const cell=1+Math.floor(fx.grainSize/28),gx=Math.floor(px/cell),gy=Math.floor(py/cell),seed=((gx*73856093)^(gy*19349663)^(canvas.width*83492791))>>>0,noise=((seed%997)/996-.5)*(fx.grain/100)*(.12+fx.grainRoughness/100*.12);r+=noise;g+=noise;b+=noise}
      d[i]=clamp(r)*255;d[i+1]=clamp(g)*255;d[i+2]=clamp(b)*255;
    }
    x.putImageData(im,0,0);
  }

  function applyDetail(canvas,e){
    const x=canvas.getContext('2d',{willReadFrequently:true}),amount=e.detail.noiseLuminance/100;if(amount>0){const blurred=makeCanvas(canvas.width,canvas.height);const bx=blurred.getContext('2d');bx.filter=`blur(${Math.max(.2,amount*2.2)}px)`;bx.drawImage(canvas,0,0);x.globalAlpha=amount*(.9-e.detail.noiseDetail/200);x.drawImage(blurred,0,0);x.globalAlpha=1}
    const soften=Math.max(0,-e.effects.texture/100*.7-e.effects.clarity/100*.35);if(soften>0){const soft=makeCanvas(canvas.width,canvas.height);const sx=soft.getContext('2d');sx.filter=`blur(${.4+soften*1.6}px)`;sx.drawImage(canvas,0,0);x.globalAlpha=Math.min(.75,soften);x.drawImage(soft,0,0);x.globalAlpha=1}
    const colorNR=e.detail.noiseColor/100,radius=Math.max(1,Math.min(3,Math.round(e.detail.radius))),sharpDetail=.5+e.detail.sharpenDetail/50,sharp=e.detail.sharpening/150*sharpDetail+e.detail.noiseContrast/350+Math.max(0,e.effects.texture)/180+Math.max(0,e.effects.clarity)/220;if(colorNR>0||sharp>0){const im=x.getImageData(0,0,canvas.width,canvas.height),d=im.data,src=new Uint8ClampedArray(d),w=canvas.width,h=canvas.height,threshold=e.detail.sharpenMasking/100*28;for(let py=radius;py<h-radius;py++)for(let px=radius;px<w-radius;px++){const i=(py*w+px)*4,left=i-radius*4,right=i+radius*4,up=i-radius*w*4,down=i+radius*w*4;let ar=(src[left]+src[right]+src[up]+src[down])/4,ag=(src[left+1]+src[right+1]+src[up+1]+src[down+1])/4,ab=(src[left+2]+src[right+2]+src[up+2]+src[down+2])/4;if(colorNR){const lum=.2126*src[i]+.7152*src[i+1]+.0722*src[i+2],avgLum=.2126*ar+.7152*ag+.0722*ab,blend=colorNR*(.85-e.detail.colorDetail/250)*(.65+e.detail.colorSmoothness/200);d[i]=src[i]*(1-blend)+(ar+lum-avgLum)*blend;d[i+1]=src[i+1]*(1-blend)+(ag+lum-avgLum)*blend;d[i+2]=src[i+2]*(1-blend)+(ab+lum-avgLum)*blend}if(sharp){for(let ch=0;ch<3;ch++){const avg=(src[left+ch]+src[right+ch]+src[up+ch]+src[down+ch])/4,edge=src[i+ch]-avg;if(Math.abs(edge)>threshold)d[i+ch]=clamp(d[i+ch]+edge*sharp*1.4,0,255)}}}x.putImageData(im,0,0)}
  }
  function applyFocusBlur(canvas,e){if(!e.mask.enabled||e.mask.backgroundBlur<=0||e.mask.type==='sky')return;const m=e.mask,clear=makeCanvas(canvas.width,canvas.height);clear.getContext('2d').drawImage(canvas,0,0);const x=canvas.getContext('2d');x.clearRect(0,0,canvas.width,canvas.height);x.filter=`blur(${Math.max(1,m.backgroundBlur/8)}px)`;x.drawImage(clear,0,0);x.filter='none';const subject=makeCanvas(canvas.width,canvas.height);const sx=subject.getContext('2d');sx.drawImage(clear,0,0);sx.globalCompositeOperation='destination-in';sx.save();sx.translate(m.x*canvas.width,m.y*canvas.height);sx.scale(1,.72);const rad=m.size/100*canvas.width,inner=rad*(1-m.feather/100),gr=sx.createRadialGradient(0,0,Math.max(0,inner),0,0,rad);gr.addColorStop(0,'#fff');gr.addColorStop(1,'#0000');sx.fillStyle=gr;sx.fillRect(-canvas.width,-canvas.height*2,canvas.width*2,canvas.height*4);sx.restore();x.drawImage(subject,0,0)}
  function applyCleanup(canvas,e){if(!e.cleanup?.length)return;const src=makeCanvas(canvas.width,canvas.height);src.getContext('2d').drawImage(canvas,0,0);const x=canvas.getContext('2d');for(const spot of e.cleanup){const cx=spot.x*canvas.width,cy=spot.y*canvas.height,r=Math.max(4,spot.size/100*canvas.width);x.save();x.beginPath();x.arc(cx,cy,r,0,Math.PI*2);x.clip();x.globalAlpha=.88;x.drawImage(src,cx+r*1.8-r,cy-r,r*2,r*2,cx-r,cy-r,r*2,r*2);x.restore()}}
  function addWatermark(canvas,text){if(!text)return;const x=canvas.getContext('2d'),size=Math.max(14,Math.round(canvas.width/55));x.font=`600 ${size}px Segoe UI`;x.textAlign='right';x.textBaseline='bottom';x.fillStyle='#0009';x.fillText(text,canvas.width-size+2,canvas.height-size+2);x.fillStyle='#fffddd';x.fillText(text,canvas.width-size,canvas.height-size)}
  function render(image,edits,{maxEdge=1500,watermark=''}={}){const e=migratedEdits(edits),oriented=orientedSource(image,e,maxEdge),canvas=transformAndCrop(oriented,e);applyPixels(canvas,e);applyDetail(canvas,e);applyFocusBlur(canvas,e);applyCleanup(canvas,e);addWatermark(canvas,watermark);return canvas}

  async function analyze(image){const max=180,s=Math.min(1,max/Math.max(image.naturalWidth||image.width,image.naturalHeight||image.height)),c=makeCanvas(Math.max(1,Math.round((image.naturalWidth||image.width)*s)),Math.max(1,Math.round((image.naturalHeight||image.height)*s)));const x=c.getContext('2d',{willReadFrequently:true});if(!x)throw new Error('Image analysis canvas is unavailable');x.drawImage(image,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height).data;let lum=0,lap=0,count=0;const gray=new Float32Array(c.width*c.height);for(let i=0,p=0;i<d.length;i+=4,p++){gray[p]=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];lum+=gray[p]}for(let y=1;y<c.height-1;y++)for(let xx=1;xx<c.width-1;xx++){const i=y*c.width+xx,v=Math.abs(gray[i]*4-gray[i-1]-gray[i+1]-gray[i-c.width]-gray[i+c.width]);lap+=v;count++}lum=gray.length?lum/gray.length/255:0;const sharpness=count?lap/count:0;let issue='';if(sharpness<7)issue='Low detail / possible blur';else if(lum<.16)issue='Underexposed';else if(lum>.88)issue='Overexposed';return{sharpness:+sharpness.toFixed(1),exposure:+lum.toFixed(2),issue,score:Math.round(clamp(sharpness/24)*70+clamp(1-Math.abs(lum-.5)*1.5)*30)}}

  globalThis.LumaEngine={COLORS,HUE_CENTERS,defaultEdits,migratedEdits,migratePhoto,deepMerge,clone,render,analyze,buildLut,rgbToHsl};
})();
