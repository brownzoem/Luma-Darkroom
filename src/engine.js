(() => {
  const COLORS=['red','orange','yellow','green','aqua','blue','purple','magenta'];
  const HUE_CENTERS={red:0,orange:30,yellow:60,green:120,aqua:180,blue:230,purple:275,magenta:320};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const BLOCKED_KEYS=new Set(['__proto__','prototype','constructor']);
  const MAX_CURVE_POINTS=64,MAX_CLEANUP_SPOTS=200,MAX_MASK_LAYERS=8,MAX_MASK_STROKES=256,MAX_TOTAL_MASK_STROKES=1024,MAX_MASK_POINTS_PER_PATH=4096,MAX_MASK_POINTS_PER_LAYER=8192,MAX_TOTAL_MASK_POINTS=8192,MAX_CANVAS_EDGE=16384,MAX_CANVAS_PIXELS=50_000_000;

  function defaultMaskLayer(overrides={}){
    return Object.assign({
      id:'',name:'Mask',enabled:true,type:'subject',purpose:'',space:'source',legacyShape:'',legacySampling:false,x:.5,y:.5,x2:.5,y2:.8,size:35,range:35,feather:55,brushSize:12,brushFeather:55,strokes:[],invert:false,opacity:100,flow:100,toneRange:'all',protectTones:false,
      subjectExposure:0,subjectClarity:0,backgroundExposure:0,backgroundBlur:0,skyExposure:0,skyTemperature:0,localTemperature:0,localTint:0,localSaturation:0,localBlur:0,show:true
    },overrides);
  }

  function defaultEdits(){
    const mixer={}; COLORS.forEach(c=>mixer[c]={hue:0,saturation:0,luminance:0});
    return {
      version:5,profile:'Luma Color',profileAmount:100,bw:false,
      light:{exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0},
      curve:{channel:'rgb',rgb:[[0,0],[255,255]],red:[[0,0],[255,255]],green:[[0,0],[255,255]],blue:[[0,0],[255,255]],refineSaturation:0},
      color:{wb:'As Shot',temperature:0,tint:0,vibrance:0,saturation:0},mixer,pointColor:{enabled:false,hue:30,hueShift:0,saturationShift:0,luminanceShift:0,variance:25,range:30,visualize:false},
      grading:{shadows:{hue:220,saturation:0,luminance:0},midtones:{hue:40,saturation:0,luminance:0},highlights:{hue:45,saturation:0,luminance:0},global:{hue:30,saturation:0,luminance:0},blending:50,balance:0},
      effects:{texture:0,clarity:0,dehaze:0,vignette:0,vignetteMidpoint:50,vignetteRoundness:0,vignetteFeather:50,vignetteHighlights:0,grain:0,grainSize:25,grainRoughness:50},
      detail:{sharpening:0,radius:1,sharpenDetail:25,sharpenMasking:0,noiseLuminance:0,noiseDetail:50,noiseContrast:0,noiseColor:0,colorDetail:50,colorSmoothness:50},
      optics:{removeCA:false,lensCorrections:false,distortion:0,lensVignette:0,defringePurple:0,defringeGreen:0},
      geometry:{rotation90:0,flipX:false,flipY:false,straighten:0,distortion:0,vertical:0,horizontal:0,rotate:0,aspect:0,scale:100,xOffset:0,yOffset:0,constrainCrop:false,cropAspect:'Original',cropZoom:100,cropX:0,cropY:0},
      masks:{activeId:'',layers:[]},
      retouch:{size:3,feather:65,opacity:90,aligned:true,pupilSize:45,darken:70},
      cleanup:[]
    };
  }

  function sanitizeNumber(path,value,fallback){
    const n=Number(value);if(!Number.isFinite(n))return fallback;
    if(path==='version')return 5;
    if(['mask.x','mask.y','mask.x2','mask.y2'].includes(path))return Math.max(0,Math.min(1,n));
    if((path.startsWith('grading.')&&path.endsWith('.hue'))||path==='pointColor.hue')return Math.max(0,Math.min(360,n));
    if(path.startsWith('mixer.')&&path.endsWith('.hue')||path==='pointColor.hueShift')return Math.max(-100,Math.min(100,n));
    if(path.includes('exposure')||path==='light.exposure')return Math.max(-5,Math.min(5,n));
    if(path==='profileAmount')return Math.max(0,Math.min(200,n));
    if(path==='mask.size')return Math.max(5,Math.min(90,n));
    if(path==='mask.range'||path==='mask.brushSize')return Math.max(1,Math.min(100,n));
    if(['mask.feather','mask.brushFeather','mask.backgroundBlur','mask.localBlur','mask.opacity','mask.flow'].includes(path))return Math.max(0,Math.min(100,n));
    if(['mask.localTemperature','mask.localTint','mask.localSaturation','mask.subjectClarity','mask.skyTemperature'].includes(path))return Math.max(-100,Math.min(100,n));
    if(path==='retouch.size')return Math.max(.1,Math.min(25,n));
    if(['retouch.feather','retouch.opacity','retouch.pupilSize','retouch.darken'].includes(path))return Math.max(0,Math.min(100,n));
    if(path==='detail.radius')return Math.max(.1,Math.min(10,n));
    if(path==='geometry.scale')return Math.max(10,Math.min(400,n));
    if(path==='geometry.cropZoom')return Math.max(100,Math.min(1000,n));
    if(path==='geometry.rotation90')return((n+180)%360+360)%360-180;
    return Math.max(-500,Math.min(500,n));
  }
  function sanitizeCleanup(value,legacyVersion=4){
    return value.slice(0,MAX_CLEANUP_SPOTS).flatMap(spot=>{
      if(!spot||typeof spot!=='object')return[];const x=Number(spot.x),y=Number(spot.y),size=Number(spot.size),sourceX=spot.sourceX==null?null:Number(spot.sourceX),sourceY=spot.sourceY==null?null:Number(spot.sourceY),radiusPx=spot.radiusPx==null?null:Number(spot.radiusPx),feather=spot.feather==null?65:Number(spot.feather),opacity=spot.opacity==null?90:Number(spot.opacity),pupilSize=spot.pupilSize==null?45:Number(spot.pupilSize),darken=spot.darken==null?70:Number(spot.darken);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(size)||sourceX!=null&&!Number.isFinite(sourceX)||sourceY!=null&&!Number.isFinite(sourceY)||radiusPx!=null&&!Number.isFinite(radiusPx)||![feather,opacity,pupilSize,darken].every(Number.isFinite))return[];
      const modern=['heal','clone','red-eye'].includes(spot.kind),legacy=spot.kind==='legacy-v2'||legacyVersion<4&&!modern;
      return[{kind:legacy?'legacy-v2':modern?spot.kind:'heal',space:legacy?'frame':['source','frame'].includes(spot.space)?spot.space:'frame',x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),sourceX:sourceX==null?null:Math.max(0,Math.min(1,sourceX)),sourceY:sourceY==null?null:Math.max(0,Math.min(1,sourceY)),radiusPx:radiusPx==null?null:Math.max(.1,Math.min(100000,radiusPx)),size:Math.max(.1,Math.min(25,size)),feather:legacy?0:Math.max(0,Math.min(100,feather)),opacity:legacy?88:Math.max(1,Math.min(100,opacity)),pupilSize:Math.max(1,Math.min(100,pupilSize)),darken:Math.max(0,Math.min(100,darken))}];
    });
  }
  function sanitizeMaskStrokes(value,maxStrokes=MAX_MASK_STROKES,maxPoints=MAX_MASK_POINTS_PER_LAYER){
    if(!Array.isArray(value)||maxStrokes<=0||maxPoints<=0)return[];const result=[];let pointCount=0,inspectionLimit=Math.min(value.length,Math.max(maxStrokes*4,maxPoints*4));
    for(let index=0;index<inspectionLimit&&result.length<maxStrokes&&pointCount<maxPoints;index++){
      const stroke=value[index];if(!stroke||typeof stroke!=='object'||!['add','subtract'].includes(stroke.mode))continue;
      if(stroke.kind==='path'){
        const size=Number(stroke.size),feather=Number(stroke.feather),flow=stroke.flow==null?100:Number(stroke.flow),spacing=(stroke.spacing==null ? .1 : Number(stroke.spacing));
        if(!Number.isFinite(size)||!Number.isFinite(feather)||!Number.isFinite(flow)||!Number.isFinite(spacing)||!Array.isArray(stroke.points))continue;
        const points=[],limit=Math.min(stroke.points.length,MAX_MASK_POINTS_PER_PATH,maxPoints-pointCount),inspectionLimit=Math.min(stroke.points.length,MAX_MASK_POINTS_PER_PATH*4,(maxPoints-pointCount)*4);
        for(let pointIndex=0;pointIndex<inspectionLimit&&points.length<limit;pointIndex++){
          const point=stroke.points[pointIndex];if(!Array.isArray(point)||point.length<2)continue;const x=Number(point[0]),y=Number(point[1]),pressure=point[2]==null?1:Number(point[2]),sourceSize=point[3]==null?size:Number(point[3]);
          if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(pressure)||!Number.isFinite(sourceSize))continue;
          points.push([+Math.max(0,Math.min(1,x)).toFixed(5),+Math.max(0,Math.min(1,y)).toFixed(5),+Math.max(.05,Math.min(1,pressure)).toFixed(3),+Math.max(.01,Math.min(100,sourceSize)).toFixed(4)]);
        }
        if(!points.length)continue;result.push({kind:'path',id:String(stroke.id||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64),mode:stroke.mode,size:Math.max(1,Math.min(100,size)),feather:Math.max(0,Math.min(100,feather)),flow:Math.max(1,Math.min(100,flow)),spacing:Math.max(.02,Math.min(.5,spacing)),points});pointCount+=points.length;continue;
      }
      const x=Number(stroke.x),y=Number(stroke.y),size=Number(stroke.size),feather=Number(stroke.feather),flow=stroke.flow==null?100:Number(stroke.flow);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(size)||!Number.isFinite(feather)||!Number.isFinite(flow))continue;
      result.push({x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),size:Math.max(1,Math.min(100,size)),feather:Math.max(0,Math.min(100,feather)),flow:Math.max(1,Math.min(100,flow)),mode:stroke.mode});pointCount++;
    }
    return result;
  }
  function sanitizeArray(path,value,fallback){
    if(!Array.isArray(value))return clone(fallback);
    if(path==='cleanup')return sanitizeCleanup(value,4);
    if(path==='mask.strokes')return sanitizeMaskStrokes(value);
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
  function safeMaskId(value,index,used){
    const seed=String(value||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64)||'mask-'+(index+1);let id=seed,suffix=2;while(used.has(id)){id=seed.slice(0,Math.max(1,61-String(suffix).length))+'-'+suffix;suffix++}used.add(id);return id;
  }
  function sanitizeMaskLayer(raw,index,used,strokeBudget,legacyVersion=5){
    raw=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};const layer=defaultMaskLayer(),id=safeMaskId(raw.id,index,used);
    layer.id=id;layer.name=String(raw.name||(({subject:'Object',sky:'Sky',brush:'Brush',linear:'Linear gradient',radial:'Radial gradient'}[raw.type]||'Mask')+' '+(index+1))).slice(0,60)||('Mask '+(index+1));
    if(typeof raw.enabled==='boolean')layer.enabled=raw.enabled;
    if(['subject','sky','brush','linear','radial'].includes(raw.type))layer.type=raw.type;if(['dodge','burn'].includes(raw.purpose))layer.purpose=raw.purpose;
    layer.space=['source','frame'].includes(raw.space)?raw.space:(legacyVersion<4?'frame':'source');
    if(raw.legacyShape==='ellipse-v2')layer.legacyShape='ellipse-v2';if(raw.legacySampling===true||legacyVersion<5)layer.legacySampling=true;
    for(const key of ['x','y','x2','y2','size','range','feather','brushSize','brushFeather','opacity','flow','subjectExposure','subjectClarity','backgroundExposure','backgroundBlur','skyExposure','skyTemperature','localTemperature','localTint','localSaturation','localBlur'])if(raw[key]!=null)layer[key]=sanitizeNumber('mask.'+key,raw[key],layer[key]);
    if(typeof raw.invert==='boolean')layer.invert=raw.invert;if(typeof raw.show==='boolean')layer.show=raw.show;if(typeof raw.protectTones==='boolean')layer.protectTones=raw.protectTones;
    if(['all','shadows','midtones','highlights'].includes(raw.toneRange))layer.toneRange=raw.toneRange;if(!layer.purpose&&layer.type==='brush'&&layer.protectTones&&layer.toneRange==='midtones'){const legacyPurpose=layer.name.toLowerCase().startsWith('dodge')?'dodge':layer.name.toLowerCase().startsWith('burn')?'burn':'';if(legacyPurpose)layer.purpose=legacyPurpose}
    const available=Math.max(0,Math.min(MAX_MASK_STROKES,MAX_TOTAL_MASK_STROKES-strokeBudget.count)),pointAvailable=Math.max(0,Math.min(MAX_MASK_POINTS_PER_LAYER,MAX_TOTAL_MASK_POINTS-strokeBudget.points));layer.strokes=sanitizeMaskStrokes(raw.strokes,available,pointAvailable);const layerPoints=layer.strokes.reduce((sum,stroke)=>sum+(stroke.kind==='path'?stroke.points.length:1),0);strokeBudget.count+=layer.strokes.length;strokeBudget.points+=layerPoints;return layer;
  }
  function legacyMaskMeaningful(raw){
    if(!raw||typeof raw!=='object')return false;const d=defaultMaskLayer({enabled:false});return!!(raw.enabled||raw.invert||(Array.isArray(raw.strokes)&&raw.strokes.length)||(raw.type&&raw.type!=='subject')||['x','y','size','range','feather','subjectExposure','subjectClarity','backgroundExposure','backgroundBlur','skyExposure','skyTemperature'].some(key=>raw[key]!=null&&Number(raw[key])!==d[key]));
  }
  function migrateMasks(old){
    const used=new Set(),budget={count:0,points:0};let layers=[],activeId='';
    if(old?.masks&&typeof old.masks==='object'&&Array.isArray(old.masks.layers)){
      const sourceVersion=Number(old.version||4);layers=old.masks.layers.slice(0,MAX_MASK_LAYERS).map((raw,index)=>sanitizeMaskLayer(raw,index,used,budget,sourceVersion));activeId=String(old.masks.activeId||'').slice(0,64);
    }else if(legacyMaskMeaningful(old?.mask)){
      const legacyVersion=Number(old.version||0),legacyType=old.mask.type==='sky'?'sky':'subject',raw={...old.mask,id:'legacy-mask',name:legacyType==='sky'?'Sky 1':'Object 1',type:legacyType,legacyShape:legacyVersion<4&&legacyType==='subject'?'ellipse-v2':'',protectTones:false};layers=[sanitizeMaskLayer(raw,0,used,budget,legacyVersion)];activeId=layers[0].id;
    }
    if(!layers.some(layer=>layer.id===activeId))activeId=layers[0]?.id||'';return{activeId,layers};
  }
  function migratedEdits(old){
    const fresh=defaultEdits();
    if(!old)return fresh;
    const mergeSource={};for(const [key,value] of Object.entries(old))if(!BLOCKED_KEYS.has(key)&&!['masks','mask','cleanup'].includes(key))mergeSource[key]=value;deepMerge(fresh,mergeSource);
    fresh.masks=migrateMasks(old);
    if(Array.isArray(old.cleanup))fresh.cleanup=sanitizeCleanup(old.cleanup,Number(old.version||0));
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

  function buildMaskWeights(canvas,m){
    if(!m?.enabled)return null;const width=canvas.width,height=canvas.height,maxAnalysisEdge=512,scale=Math.min(1,maxAnalysisEdge/Math.max(width,height)),smallWidth=Math.max(1,Math.round(width*scale)),smallHeight=Math.max(1,Math.round(height*scale)),small=makeCanvas(smallWidth,smallHeight),smallContext=small.getContext('2d',{willReadFrequently:true});smallContext.imageSmoothingQuality='high';smallContext.drawImage(canvas,0,0,smallWidth,smallHeight);const mask=makeCanvas(smallWidth,smallHeight),maskContext=mask.getContext('2d',{willReadFrequently:true});
    if(m.type==='sky'){
      const gradient=maskContext.createLinearGradient(0,0,0,smallHeight);gradient.addColorStop(0,'#fff');gradient.addColorStop(.72,'#0000');gradient.addColorStop(1,'#0000');maskContext.fillStyle=gradient;maskContext.fillRect(0,0,smallWidth,smallHeight);
    }else if(m.type==='linear'){
      const gradient=maskContext.createLinearGradient(m.x*smallWidth,m.y*smallHeight,m.x2*smallWidth,m.y2*smallHeight);gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'#0000');maskContext.fillStyle=gradient;maskContext.fillRect(0,0,smallWidth,smallHeight);
    }else if(m.type==='radial'){
      const cx=m.x*smallWidth,cy=m.y*smallHeight,radius=Math.max(2,Math.hypot((m.x2-m.x)*smallWidth,(m.y2-m.y)*smallHeight));if(m.feather<=0){maskContext.fillStyle='#fff';maskContext.beginPath();maskContext.arc(cx,cy,radius,0,Math.PI*2);maskContext.fill()}else{const inner=radius*Math.max(0,1-m.feather/100),gradient=maskContext.createRadialGradient(cx,cy,inner,cx,cy,radius);gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'#0000');maskContext.fillStyle=gradient;maskContext.fillRect(0,0,smallWidth,smallHeight)}
    }else if(m.type==='subject'&&m.legacyShape==='ellipse-v2'){
      const image=maskContext.createImageData(smallWidth,smallHeight),radius=Math.max(.0001,m.size/100),edge=Math.max(.02,m.feather/100);
      for(let y=0;y<smallHeight;y++)for(let x=0;x<smallWidth;x++){const dx=(x/smallWidth-m.x)/radius,dy=(y/smallHeight-m.y)/(radius*.72),distance=Math.hypot(dx,dy),weight=1-smooth(clamp((distance-(1-edge))/edge)),offset=(y*smallWidth+x)*4;image.data[offset]=image.data[offset+1]=image.data[offset+2]=255;image.data[offset+3]=weight*255}maskContext.putImageData(image,0,0);
    }else if(m.type==='subject'){
      const source=smallContext.getImageData(0,0,smallWidth,smallHeight).data,count=smallWidth*smallHeight,selected=new Uint8Array(count),queue=new Int32Array(count),seedX=Math.max(0,Math.min(smallWidth-1,Math.round(m.x*(smallWidth-1)))),seedY=Math.max(0,Math.min(smallHeight-1,Math.round(m.y*(smallHeight-1)))),seed=seedY*smallWidth+seedX,tolerance=.045+m.range/100*.42,localTolerance=.025+tolerance*.32,maxSelected=Math.max(1,Math.min(count,Math.round(count*(.02+Math.pow(m.size/100,1.35)*1.12))));let head=0,tail=0;selected[seed]=1;queue[tail++]=seed;
      const distance=(a,b)=>{const ai=a*4,bi=b*4,dr=(source[ai]-source[bi])/255,dg=(source[ai+1]-source[bi+1])/255,db=(source[ai+2]-source[bi+2])/255;return Math.sqrt(dr*dr*.3+dg*dg*.5+db*db*.2)};
      const add=(candidate,from)=>{if(candidate<0||candidate>=count||selected[candidate]||tail>=maxSelected)return;const seedDistance=distance(candidate,seed),stepDistance=distance(candidate,from);if(seedDistance>tolerance&&!(stepDistance<=localTolerance&&seedDistance<=tolerance*1.35))return;selected[candidate]=1;queue[tail++]=candidate};
      while(head<tail){const index=queue[head++],x=index%smallWidth,y=Math.floor(index/smallWidth);if(x>0)add(index-1,index);if(x<smallWidth-1)add(index+1,index);if(y>0)add(index-smallWidth,index);if(y<smallHeight-1)add(index+smallWidth,index)}
      const image=maskContext.createImageData(smallWidth,smallHeight);for(let index=0;index<count;index++)if(selected[index]){const offset=index*4;image.data[offset]=image.data[offset+1]=image.data[offset+2]=image.data[offset+3]=255}maskContext.putImageData(image,0,0);
      if(m.feather>0){const softened=makeCanvas(smallWidth,smallHeight),softContext=softened.getContext('2d');softContext.filter=`blur(${.25+m.feather/100*3}px)`;softContext.drawImage(mask,0,0);maskContext.clearRect(0,0,smallWidth,smallHeight);maskContext.drawImage(softened,0,0)}
    }
    const paintDab=(x,y,size,feather,flow,mode)=>{const radius=Math.max(1,size/100*Math.max(smallWidth,smallHeight)/2);maskContext.save();maskContext.globalAlpha=flow/100;maskContext.globalCompositeOperation=mode==='subtract'?'destination-out':'source-over';if(feather<=0)maskContext.fillStyle='#fff';else{const inner=radius*(1-feather/100),gradient=maskContext.createRadialGradient(x,y,Math.max(0,inner),x,y,radius);gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'#0000');maskContext.fillStyle=gradient}maskContext.beginPath();maskContext.arc(x,y,radius,0,Math.PI*2);maskContext.fill();maskContext.restore()};
    for(const stroke of m.strokes||[]){
      if(stroke.kind==='path'){for(const point of stroke.points||[]){const pressure=point[2]??1,sourceSize=point[3]??stroke.size,size=sourceSize*(.35+.65*pressure),flow=stroke.flow*(.25+.75*pressure);paintDab(point[0]*smallWidth,point[1]*smallHeight,size,stroke.feather,flow,stroke.mode)}}
      else paintDab(stroke.x*smallWidth,stroke.y*smallHeight,stroke.size,stroke.feather,stroke.flow??m.flow??100,stroke.mode);
    }
    const image=maskContext.getImageData(0,0,smallWidth,smallHeight),weights=new Uint8ClampedArray(smallWidth*smallHeight);for(let index=0;index<weights.length;index++){const offset=index*4,value=image.data[offset+3],weight=m.invert?255-value:value;weights[index]=weight;if(m.invert){image.data[offset]=image.data[offset+1]=image.data[offset+2]=255;image.data[offset+3]=weight}}if(m.invert)maskContext.putImageData(image,0,0);return{data:weights,width:smallWidth,height:smallHeight,canvas:mask,nearest:!!m.legacySampling};
  }

  function maskWeightAt(maskMap,x,y,width,height){if(!maskMap)return 0;const nearest=()=>{const mx=Math.max(0,Math.min(maskMap.width-1,Math.floor((x+.5)*maskMap.width/width))),my=Math.max(0,Math.min(maskMap.height-1,Math.floor((y+.5)*maskMap.height/height)));return maskMap.data[my*maskMap.width+mx]/255};if(maskMap.nearest)return nearest();const fx=Math.max(0,Math.min(maskMap.width-1,(x+.5)*maskMap.width/width-.5)),fy=Math.max(0,Math.min(maskMap.height-1,(y+.5)*maskMap.height/height-.5)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(maskMap.width-1,x0+1),y1=Math.min(maskMap.height-1,y0+1),tx=fx-x0,ty=fy-y0,a=maskMap.data[y0*maskMap.width+x0],b=maskMap.data[y0*maskMap.width+x1],c=maskMap.data[y1*maskMap.width+x0],d=maskMap.data[y1*maskMap.width+x1];if((a===0||a===255)&&(b===0||b===255)&&(c===0||c===255)&&(d===0||d===255))return nearest();return(a+(b-a)*tx+(c-a)*ty+(d-c-b+a)*tx*ty)/255}

  function orientedSource(image,e,maxEdge){
    const rot=((e.geometry.rotation90%360)+360)%360,swap=rot===90||rot===270;
    const naturalW=image.naturalWidth||image.width,naturalH=image.naturalHeight||image.height;
    if(!Number.isFinite(naturalW)||!Number.isFinite(naturalH)||naturalW<1||naturalH<1)throw new Error('The image could not be decoded.');
    const requestedEdge=maxEdge==null?null:Math.max(1,Number(maxEdge)||1),scale=requestedEdge?Math.min(1,requestedEdge/Math.max(naturalW,naturalH)):1,iw=Math.max(1,Math.round(naturalW*scale)),ih=Math.max(1,Math.round(naturalH*scale));
    if(iw>MAX_CANVAS_EDGE||ih>MAX_CANVAS_EDGE||iw*ih>MAX_CANVAS_PIXELS)throw new RangeError('This image is too large to process safely. Choose a smaller export size.');
    const c=makeCanvas(swap?ih:iw,swap?iw:ih);const x=c.getContext('2d',{willReadFrequently:true});x.imageSmoothingQuality='high';x.translate(c.width/2,c.height/2);x.rotate(rot*Math.PI/180);x.scale(e.geometry.flipX?-1:1,e.geometry.flipY?-1:1);x.drawImage(image,-iw/2,-ih/2,iw,ih);return c;
  }
  function geometryMetrics(w,h,e){const g=e.geometry,theta=(g.straighten+g.rotate)*Math.PI/180,constrained=g.constrainCrop?(Math.abs(g.straighten+g.rotate)/180+Math.abs(g.vertical)/500+Math.abs(g.horizontal)/500):0,lensDistortion=e.optics.lensCorrections?e.optics.distortion:0,distortionScale=(1+(g.distortion+lensDistortion)/700)*(1+constrained),a=(g.scale/100)*(1+g.aspect/200)*distortionScale,b=g.horizontal/260,c=g.vertical/260,d=(g.scale/100)*(1-g.aspect/200)*distortionScale,ratios={Square:1,'4 × 5':4/5,'5 × 4':5/4,'2 × 3':2/3,'3 × 2':3/2,'9 × 16':9/16,'16 × 9':16/9};let ratio=ratios[g.cropAspect];if(g.cropAspect==='Original'||!ratio)ratio=w/h;let cw=w,ch=h;if(w/h>ratio)cw=h*ratio;else ch=w/ratio;const zoom=Math.max(1,g.cropZoom/100);cw/=zoom;ch/=zoom;const maxX=(w-cw)/2,maxY=(h-ch)/2,cx=clamp(w/2-cw/2+g.cropX/100*maxX,0,w-cw),cy=clamp(h/2-ch/2+g.cropY/100*maxY,0,h-ch);return{theta,a,b,c,d,tx:w/2+g.xOffset/200*w,ty:h/2+g.yOffset/200*h,cx,cy,cw,ch}}
  function transformAndCrop(src,e){
    const w=src.width,h=src.height,t=makeCanvas(w,h),x=t.getContext('2d',{willReadFrequently:true}),g=geometryMetrics(w,h,e);x.imageSmoothingQuality='high';x.translate(g.tx,g.ty);x.rotate(g.theta);x.transform(g.a,g.b,g.c,g.d,0,0);x.drawImage(src,-w/2,-h/2);const out=makeCanvas(Math.max(1,Math.round(g.cw)),Math.max(1,Math.round(g.ch)));out.getContext('2d',{willReadFrequently:true}).drawImage(t,g.cx,g.cy,g.cw,g.ch,0,0,out.width,out.height);return out;
  }

  function outputPointToSourcePrepared(image,e,x,y){const rotation=((e.geometry.rotation90%360)+360)%360,swap=rotation===90||rotation===270,naturalWidth=image.naturalWidth||image.width,naturalHeight=image.naturalHeight||image.height,w=swap?naturalHeight:naturalWidth,h=swap?naturalWidth:naturalHeight,g=geometryMetrics(w,h,e),qx=g.cx+clamp(Number(x)||0)*g.cw,qy=g.cy+clamp(Number(y)||0)*g.ch,dx=qx-g.tx,dy=qy-g.ty,cos=Math.cos(g.theta),sin=Math.sin(g.theta),rx=cos*dx+sin*dy,ry=-sin*dx+cos*dy,det=g.a*g.d-g.b*g.c;if(!Number.isFinite(det)||Math.abs(det)<1e-8)return{x:.5,y:.5};const ux=(g.d*rx-g.c*ry)/det,uy=(-g.b*rx+g.a*ry)/det;return{x:clamp((ux+w/2)/w),y:clamp((uy+h/2)/h)}}
  function outputPointToSource(image,edits,x,y){return outputPointToSourcePrepared(image,migratedEdits(edits),x,y)}
  function sourcePointToOutput(image,edits,x,y){const e=migratedEdits(edits),rotation=((e.geometry.rotation90%360)+360)%360,swap=rotation===90||rotation===270,naturalWidth=image.naturalWidth||image.width,naturalHeight=image.naturalHeight||image.height,w=swap?naturalHeight:naturalWidth,h=swap?naturalWidth:naturalHeight,g=geometryMetrics(w,h,e),ux=(clamp(Number(x)||0)-.5)*w,uy=(clamp(Number(y)||0)-.5)*h,mx=g.a*ux+g.c*uy,my=g.b*ux+g.d*uy,cos=Math.cos(g.theta),sin=Math.sin(g.theta),qx=cos*mx-sin*my+g.tx,qy=sin*mx+cos*my+g.ty;return{x:(qx-g.cx)/g.cw,y:(qy-g.cy)/g.ch}}

  function transformMaskMap(maskMap,e){const canvas=transformAndCrop(maskMap.canvas,e),context=canvas.getContext('2d',{willReadFrequently:true}),rgba=context.getImageData(0,0,canvas.width,canvas.height).data,data=new Uint8ClampedArray(canvas.width*canvas.height);for(let index=0;index<data.length;index++)data[index]=rgba[index*4+3];return{data,width:canvas.width,height:canvas.height,canvas,nearest:maskMap.nearest}}

  function tonalMaskWeight(lum,range,protect){
    let weight=range==='shadows'?Math.pow(1-clamp(lum),2):range==='highlights'?Math.pow(clamp(lum),2):range==='midtones'?Math.pow(clamp(1-Math.abs(lum-.5)*2),1.5):1;if(protect)weight*=.3+.7*clamp(1-Math.abs(lum-.5)*1.25);return weight;
  }
  function applyPixels(canvas,e,maskEntries){
    const x=canvas.getContext('2d',{willReadFrequently:true}),im=x.getImageData(0,0,canvas.width,canvas.height),d=im.data,l=e.light,c=e.color,fx=e.effects,curve=e.curve;
    const luts={rgb:buildLut(curve.rgb),red:buildLut(curve.red),green:buildLut(curve.green),blue:buildLut(curve.blue)};
    const profile={"Luma Color":[0,0],"Luma Vivid":[8,12],"Luma Neutral":[-8,-10],"Luma Portrait":[-3,4],"Luma Landscape":[9,8],"Monochrome":[8,-100]}[e.profile]||[0,0];
    const profAmount=e.profileAmount/100,contrast=(l.contrast+profile[0]*profAmount)/100,satGlobal=(c.saturation+profile[1]*profAmount)/100,exp=Math.pow(2,l.exposure),temp=c.temperature/100,tint=c.tint/100,contrastFactor=Math.pow(2,contrast*1.7),presence=(fx.clarity*.55+fx.texture*.25)/100,toneActive=!!(l.shadows||l.highlights||l.blacks||l.whites),mixerActive=COLORS.some(name=>{const value=e.mixer[name];return value.hue||value.saturation||value.luminance}),defringeActive=!!(e.optics.removeCA||e.optics.defringePurple||e.optics.defringeGreen),hslActive=!!(curve.refineSaturation||mixerActive||e.pointColor.enabled||defringeActive||c.vibrance||satGlobal||e.bw||e.profile==='Monochrome'),gradingActive=['shadows','midtones','highlights','global'].some(name=>e.grading[name].saturation||e.grading[name].luminance),vignetteActive=!!(fx.vignette||(e.optics.lensCorrections&&e.optics.lensVignette));
    for(let i=0,p=0;i<d.length;i+=4,p++){
      let r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255;
      if(exp!==1){r*=exp;g*=exp;b*=exp}
      if(temp||tint){r+=temp*.12+tint*.025;b-=temp*.12+tint*.025;g-=tint*.065}
      let lum=.2126*r+.7152*g+.0722*b;
      if(toneActive){const shadowW=Math.pow(1-clamp(lum),2),highlightW=Math.pow(clamp(lum),2),tonal=l.shadows/100*.42*shadowW+l.highlights/100*.42*highlightW+l.blacks/100*.28*Math.pow(1-clamp(lum),5)+l.whites/100*.28*Math.pow(clamp(lum),5);r+=tonal;g+=tonal;b+=tonal}
      if(contrastFactor!==1){r=(r-.5)*contrastFactor+.5;g=(g-.5)*contrastFactor+.5;b=(b-.5)*contrastFactor+.5}
      if(fx.dehaze){const hz=fx.dehaze/100;r=(r-.48)*(1+hz*.65)+.48;g=(g-.48)*(1+hz*.65)+.48;b=(b-.48)*(1+hz*.65)+.48}
      if(presence){const local=(lum-.5)*presence*.28;r+=local;g+=local;b+=local}
      r=luts.red[luts.rgb[Math.round(clamp(r)*255)]]/255;g=luts.green[luts.rgb[Math.round(clamp(g)*255)]]/255;b=luts.blue[luts.rgb[Math.round(clamp(b)*255)]]/255;
      if(hslActive){let[h,s,ll]=rgbToHsl(clamp(r),clamp(g),clamp(b));if(curve.refineSaturation)s=clamp(s+curve.refineSaturation/100*s*(1-s)*.65);if(mixerActive){let hueShift=0,satShift=0,lumShift=0,weightTotal=0;for(const name of COLORS){const dist=hueDistance(h,HUE_CENTERS[name]),weight=Math.pow(clamp(1-dist/52),2);if(weight){const q=e.mixer[name];hueShift+=q.hue*.35*weight;satShift+=q.saturation/100*weight;lumShift+=q.luminance/100*.38*weight;weightTotal+=weight}}if(weightTotal){h+=hueShift/Math.max(1,weightTotal);s=clamp(s+satShift/Math.max(1,weightTotal)*(1-s*.35));ll=clamp(ll+lumShift/Math.max(1,weightTotal))}}const pc=e.pointColor;if(pc.enabled){const width=6+pc.range*.75,pw=Math.pow(clamp(1-hueDistance(h,pc.hue)/width),.6+pc.variance/40);h+=pc.hueShift*.35*pw;s=clamp(s+pc.saturationShift/100*pw);ll=clamp(ll+pc.luminanceShift/100*.4*pw);if(pc.visualize&&pw<.08)s=0}if(defringeActive){const purple=hueDistance(h,292)<34,green=hueDistance(h,120)<28,reduce=(e.optics.removeCA?12:0)+(purple?e.optics.defringePurple*.55:0)+(green?e.optics.defringeGreen*.55:0);s*=1-clamp(reduce/100,0,.8)}const vib=c.vibrance/100;s=clamp(s+vib*(1-s)*(.8-Math.max(0,(hueDistance(h,25)<22?.25:0)))+satGlobal*s);if(e.bw||e.profile==='Monochrome')s=0;[r,g,b]=hslToRgb(h,s,ll)}lum=.2126*r+.7152*g+.0722*b;
      if(gradingActive){const bal=e.grading.balance/100,blend=.5+e.grading.blending/200,sw=clamp((.58+bal*.2-lum)/blend),hw=clamp((lum-(.42+bal*.2))/blend),mw=clamp(1-Math.abs(lum-.5)*2);[r,g,b]=tintBlend(r,g,b,e.grading.shadows.hue,e.grading.shadows.saturation,sw);[r,g,b]=tintBlend(r,g,b,e.grading.midtones.hue,e.grading.midtones.saturation,mw);[r,g,b]=tintBlend(r,g,b,e.grading.highlights.hue,e.grading.highlights.saturation,hw);[r,g,b]=tintBlend(r,g,b,e.grading.global.hue,e.grading.global.saturation,1);const gradeLum=(e.grading.shadows.luminance*sw+e.grading.midtones.luminance*mw+e.grading.highlights.luminance*hw+e.grading.global.luminance)/100*.18;r+=gradeLum;g+=gradeLum;b+=gradeLum}
      const px=p%canvas.width,py=Math.floor(p/canvas.width);for(const entry of maskEntries){const m=entry.layer,opacity=m.opacity/100,rawW=maskWeightAt(entry.map,px,py,canvas.width,canvas.height),inside=rawW*opacity*tonalMaskWeight(lum,m.toneRange,m.protectTones),outside=(1-rawW)*opacity,localExp=(m.subjectExposure+(m.type==='sky'?m.skyExposure:0))*inside+(m.type==='sky'?0:m.backgroundExposure*outside);if(localExp){const localScale=Math.pow(2,localExp);r*=localScale;g*=localScale;b*=localScale}const localTemp=(m.localTemperature+(m.type==='sky'?m.skyTemperature:0))/100*inside,localTint=m.localTint/100*inside;if(localTemp||localTint){r+=localTemp*.12+localTint*.025;b-=localTemp*.12+localTint*.025;g-=localTint*.065}if(m.localSaturation){const currentLum=.2126*r+.7152*g+.0722*b,sat=1+m.localSaturation/100*inside;r=currentLum+(r-currentLum)*sat;g=currentLum+(g-currentLum)*sat;b=currentLum+(b-currentLum)*sat}if(m.subjectClarity){const boost=m.subjectClarity/100*inside*(lum-.5)*.32;r+=boost;g+=boost;b+=boost}}
      if(vignetteActive){const nx=px/canvas.width*2-1,ny=(py/canvas.height*2-1)*(1+fx.vignetteRoundness/150),radius=Math.sqrt(nx*nx+ny*ny),mid=.2+fx.vignetteMidpoint/100*.65,feather=Math.max(.05,fx.vignetteFeather/100),vw=smooth(clamp((radius-mid)/feather));let vignette=fx.vignette/100*vw*.7;if(e.optics.lensCorrections)vignette-=e.optics.lensVignette/100*vw*.45;if(vignette<0){const preserve=clamp(lum)*fx.vignetteHighlights/100,dark=-vignette*(1-preserve*.85);r*=1-dark;g*=1-dark;b*=1-dark}else{r+=vignette;g+=vignette;b+=vignette}}
      if(fx.grain){const cell=1+Math.floor(fx.grainSize/28),gx=Math.floor(px/cell),gy=Math.floor(py/cell),seed=((gx*73856093)^(gy*19349663)^(canvas.width*83492791))>>>0,noise=((seed%997)/996-.5)*(fx.grain/100)*(.12+fx.grainRoughness/100*.12);r+=noise;g+=noise;b+=noise}
      d[i]=clamp(r)*255;d[i+1]=clamp(g)*255;d[i+2]=clamp(b)*255;
    }
    x.putImageData(im,0,0);
  }

  function applyLocalPixels(canvas,entries){
    if(!entries.length)return;const context=canvas.getContext('2d',{willReadFrequently:true}),image=context.getImageData(0,0,canvas.width,canvas.height),pixels=image.data;
    for(let offset=0,pixel=0;offset<pixels.length;offset+=4,pixel++){
      let r=pixels[offset]/255,g=pixels[offset+1]/255,b=pixels[offset+2]/255,lum=.2126*r+.7152*g+.0722*b;const x=pixel%canvas.width,y=Math.floor(pixel/canvas.width);
      for(const entry of entries){
        const m=entry.layer,opacity=m.opacity/100,rawWeight=maskWeightAt(entry.map,x,y,canvas.width,canvas.height),inside=rawWeight*opacity*tonalMaskWeight(lum,m.toneRange,m.protectTones),outside=(1-rawWeight)*opacity,localExposure=(m.subjectExposure+(m.type==='sky'?m.skyExposure:0))*inside+(m.type==='sky'?0:m.backgroundExposure*outside);
        if(localExposure){const scale=Math.pow(2,localExposure);r*=scale;g*=scale;b*=scale}
        const localTemperature=(m.localTemperature+(m.type==='sky'?m.skyTemperature:0))/100*inside,localTint=m.localTint/100*inside;
        if(localTemperature||localTint){r+=localTemperature*.12+localTint*.025;b-=localTemperature*.12+localTint*.025;g-=localTint*.065}
        if(m.localSaturation){const currentLum=.2126*r+.7152*g+.0722*b,saturation=1+m.localSaturation/100*inside;r=currentLum+(r-currentLum)*saturation;g=currentLum+(g-currentLum)*saturation;b=currentLum+(b-currentLum)*saturation}
        if(m.subjectClarity){const boost=m.subjectClarity/100*inside*(lum-.5)*.32;r+=boost;g+=boost;b+=boost}
        lum=.2126*r+.7152*g+.0722*b;
      }
      pixels[offset]=clamp(r)*255;pixels[offset+1]=clamp(g)*255;pixels[offset+2]=clamp(b)*255;
    }
    context.putImageData(image,0,0);
  }

  function applyDetail(canvas,e){
    const x=canvas.getContext('2d',{willReadFrequently:true}),amount=e.detail.noiseLuminance/100;if(amount>0){const blurred=makeCanvas(canvas.width,canvas.height);const bx=blurred.getContext('2d');bx.filter=`blur(${Math.max(.2,amount*2.2)}px)`;bx.drawImage(canvas,0,0);x.globalAlpha=amount*(.9-e.detail.noiseDetail/200);x.drawImage(blurred,0,0);x.globalAlpha=1}
    const soften=Math.max(0,-e.effects.texture/100*.7-e.effects.clarity/100*.35);if(soften>0){const soft=makeCanvas(canvas.width,canvas.height);const sx=soft.getContext('2d');sx.filter=`blur(${.4+soften*1.6}px)`;sx.drawImage(canvas,0,0);x.globalAlpha=Math.min(.75,soften);x.drawImage(soft,0,0);x.globalAlpha=1}
    const colorNR=e.detail.noiseColor/100,radius=Math.max(1,Math.min(3,Math.round(e.detail.radius))),sharpDetail=.5+e.detail.sharpenDetail/50,sharp=e.detail.sharpening/150*sharpDetail+e.detail.noiseContrast/350+Math.max(0,e.effects.texture)/180+Math.max(0,e.effects.clarity)/220;if(colorNR>0||sharp>0){const im=x.getImageData(0,0,canvas.width,canvas.height),d=im.data,src=new Uint8ClampedArray(d),w=canvas.width,h=canvas.height,threshold=e.detail.sharpenMasking/100*28;for(let py=radius;py<h-radius;py++)for(let px=radius;px<w-radius;px++){const i=(py*w+px)*4,left=i-radius*4,right=i+radius*4,up=i-radius*w*4,down=i+radius*w*4;let ar=(src[left]+src[right]+src[up]+src[down])/4,ag=(src[left+1]+src[right+1]+src[up+1]+src[down+1])/4,ab=(src[left+2]+src[right+2]+src[up+2]+src[down+2])/4;if(colorNR){const lum=.2126*src[i]+.7152*src[i+1]+.0722*src[i+2],avgLum=.2126*ar+.7152*ag+.0722*ab,blend=colorNR*(.85-e.detail.colorDetail/250)*(.65+e.detail.colorSmoothness/200);d[i]=src[i]*(1-blend)+(ar+lum-avgLum)*blend;d[i+1]=src[i+1]*(1-blend)+(ag+lum-avgLum)*blend;d[i+2]=src[i+2]*(1-blend)+(ab+lum-avgLum)*blend}if(sharp){for(let ch=0;ch<3;ch++){const avg=(src[left+ch]+src[right+ch]+src[up+ch]+src[down+ch])/4,edge=src[i+ch]-avg;if(Math.abs(edge)>threshold)d[i+ch]=clamp(d[i+ch]+edge*sharp*1.4,0,255)}}}x.putImageData(im,0,0)}
  }
  function applyLayerBlur(canvas,entry){const m=entry.layer;if(!entry.map||(!m.backgroundBlur&&!m.localBlur))return;const source=makeCanvas(canvas.width,canvas.height),sourceContext=source.getContext('2d');sourceContext.drawImage(canvas,0,0);const context=canvas.getContext('2d');for(const pair of [[m.backgroundBlur,false],[m.localBlur,true]]){const amount=pair[0],inside=pair[1];if(amount<=0)continue;const blurred=makeCanvas(canvas.width,canvas.height),blurContext=blurred.getContext('2d');blurContext.filter='blur('+Math.max(1,amount/8*Math.max(1,Math.max(canvas.width,canvas.height)/1050))+'px)';blurContext.drawImage(source,0,0);const effect=makeCanvas(canvas.width,canvas.height),effectContext=effect.getContext('2d');effectContext.drawImage(blurred,0,0);effectContext.globalCompositeOperation=inside?'destination-in':'destination-out';effectContext.drawImage(entry.map.canvas,0,0,canvas.width,canvas.height);effectContext.globalCompositeOperation='source-over';context.save();context.globalAlpha=m.opacity/100;context.drawImage(effect,0,0);context.restore();blurred.width=blurred.height=effect.width=effect.height=1}source.width=source.height=1}
  function applyMaskOverlay(canvas,maskMap){if(!maskMap)return;const context=canvas.getContext('2d',{willReadFrequently:true}),image=context.getImageData(0,0,canvas.width,canvas.height),pixels=image.data;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const amount=maskWeightAt(maskMap,x,y,canvas.width,canvas.height)*.38;if(amount<=0)continue;const offset=(y*canvas.width+x)*4;pixels[offset]=pixels[offset]*(1-amount)+232*amount;pixels[offset+1]=pixels[offset+1]*(1-amount)+72*amount;pixels[offset+2]=pixels[offset+2]*(1-amount)+154*amount}context.putImageData(image,0,0)}
  function applyCleanup(canvas,e){
    if(!e.cleanup?.length)return;const src=makeCanvas(canvas.width,canvas.height),srcContext=src.getContext('2d',{willReadFrequently:true});srcContext.drawImage(canvas,0,0);const context=canvas.getContext('2d',{willReadFrequently:true});
    for(const spot of e.cleanup){
      const cx=spot.x*canvas.width,cy=spot.y*canvas.height;
      if(spot.kind==='legacy-v2'){const radius=Math.max(4,spot.size/100*canvas.width);context.save();context.beginPath();context.arc(cx,cy,radius,0,Math.PI*2);context.clip();context.globalAlpha=.88;context.drawImage(src,cx+radius*.8,cy-radius,radius*2,radius*2,cx-radius,cy-radius,radius*2,radius*2);context.restore();continue}
      const mappedRadius=Array.isArray(spot.radiusVectors)?spot.radiusVectors.reduce((sum,vector)=>sum+Math.hypot(vector[0]*canvas.width,vector[1]*canvas.height),0)/spot.radiusVectors.length:0,r=Math.max(3,mappedRadius||spot.size/100*canvas.width),opacity=spot.opacity/100;
      if(spot.kind==='red-eye'){const left=Math.max(0,Math.floor(cx-r)),top=Math.max(0,Math.floor(cy-r)),right=Math.min(canvas.width,Math.ceil(cx+r)),bottom=Math.min(canvas.height,Math.ceil(cy+r)),width=right-left,height=bottom-top;if(width<1||height<1)continue;const image=context.getImageData(left,top,width,height),data=image.data;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const nx=(left+x-cx)/r,ny=(top+y-cy)/r,distance=Math.hypot(nx,ny);if(distance>=1)continue;const offset=(y*width+x)*4,red=data[offset],green=data[offset+1],blue=data[offset+2],brightness=(red+green+blue)/3;if(brightness>235||red<green*1.12||red<blue*1.12)continue;const edge=smooth(clamp((1-distance)*4)),amount=edge*opacity*spot.pupilSize/100,target=(green+blue)/2,darken=1-spot.darken/100*.65*amount;data[offset]=(red*(1-amount)+target*amount)*darken;data[offset+1]=green*darken;data[offset+2]=blue*darken}context.putImageData(image,left,top);continue}
      const sx=(spot.sourceX==null?clamp(spot.x+spot.size/100*2.2):spot.sourceX)*canvas.width,sy=(spot.sourceY==null?spot.y:spot.sourceY)*canvas.height,diameter=Math.max(2,Math.ceil(r*2)),destinationX=cx-r,destinationY=cy-r,left=Math.max(0,Math.floor(destinationX)),top=Math.max(0,Math.floor(destinationY)),right=Math.min(canvas.width,Math.ceil(destinationX+diameter)),bottom=Math.min(canvas.height,Math.ceil(destinationY+diameter)),patchWidth=right-left,patchHeight=bottom-top;
      if(patchWidth<1||patchHeight<1)continue;if(patchWidth>MAX_CANVAS_EDGE||patchHeight>MAX_CANVAS_EDGE||patchWidth*patchHeight>MAX_CANVAS_PIXELS)throw new RangeError('A repair region is too large to process safely. Reduce its size.');
      const patch=makeCanvas(patchWidth,patchHeight),patchContext=patch.getContext('2d'),offsetX=left-destinationX,offsetY=top-destinationY;patchContext.drawImage(src,sx-r+offsetX,sy-r+offsetY,patchWidth,patchHeight,0,0,patchWidth,patchHeight);patchContext.globalCompositeOperation='destination-in';
      const localX=cx-left,localY=cy-top;if(spot.feather<=0){patchContext.fillStyle='rgba(255,255,255,'+opacity+')';patchContext.beginPath();patchContext.arc(localX,localY,r,0,Math.PI*2);patchContext.fill()}else{const mask=patchContext.createRadialGradient(localX,localY,r*Math.max(0,1-spot.feather/100),localX,localY,r);mask.addColorStop(0,'rgba(255,255,255,'+opacity+')');mask.addColorStop(1,'rgba(255,255,255,0)');patchContext.fillStyle=mask;patchContext.fillRect(0,0,patchWidth,patchHeight)}
      patchContext.globalCompositeOperation='source-over';context.save();if(spot.kind==='heal')context.globalCompositeOperation='luminosity';context.drawImage(patch,left,top);context.restore();patch.width=patch.height=1
    }src.width=src.height=1
  }
  function addWatermark(canvas,text){if(!text)return;const x=canvas.getContext('2d'),size=Math.max(14,Math.round(canvas.width/55));x.font=`600 ${size}px Segoe UI`;x.textAlign='right';x.textBaseline='bottom';x.fillStyle='#0009';x.fillText(text,canvas.width-size+2,canvas.height-size+2);x.fillStyle='#fffddd';x.fillText(text,canvas.width-size,canvas.height-size)}
  function layerHasEffect(m){return!!(m.subjectExposure||m.subjectClarity||m.backgroundExposure||m.backgroundBlur||m.skyExposure||m.skyTemperature||m.localTemperature||m.localTint||m.localSaturation||m.localBlur)}
  function cleanupForOutput(image,e){
    const naturalWidth=image.naturalWidth||image.width,naturalHeight=image.naturalHeight||image.height,rotation=((e.geometry.rotation90%360)+360)%360,swap=rotation===90||rotation===270,width=swap?naturalHeight:naturalWidth,height=swap?naturalWidth:naturalHeight;
    return{...e,cleanup:e.cleanup.map(spot=>{
      if(spot.space!=='source')return spot;const target=sourcePointToOutput(image,e,spot.x,spot.y),source=spot.sourceX==null||spot.sourceY==null?null:sourcePointToOutput(image,e,spot.sourceX,spot.sourceY);let radiusVectors=null;
      if(spot.radiusPx){const xDirection=spot.x>0.5?-1:1,yDirection=spot.y>0.5?-1:1,right=sourcePointToOutput(image,e,clamp(spot.x+xDirection*spot.radiusPx/width),spot.y),down=sourcePointToOutput(image,e,spot.x,clamp(spot.y+yDirection*spot.radiusPx/height));radiusVectors=[[right.x-target.x,right.y-target.y],[down.x-target.x,down.y-target.y]]}
      return{...spot,space:'frame',x:target.x,y:target.y,radiusVectors,...(source?{sourceX:source.x,sourceY:source.y}:{})}
    })}
  }
  function render(image,edits,{maxEdge=1500,watermark='',visualizeMask=false}={}){
    const e=migratedEdits(edits),oriented=orientedSource(image,e,maxEdge),canvas=transformAndCrop(oriented,e),active=e.masks.layers.find(layer=>layer.id===e.masks.activeId),entries=[];
    for(const layer of [...e.masks.layers].reverse()){
      const overlay=visualizeMask&&active===layer&&layer.show;if(!layer.enabled&&!overlay)continue;if(!layerHasEffect(layer)&&!overlay)continue;let map=buildMaskWeights(layer.space==='source'?oriented:canvas,layer);if(map&&layer.space==='source')map=transformMaskMap(map,e);if(map)entries.push({layer,map})
    }
    applyPixels(canvas,e,[]);applyDetail(canvas,e);
    const effectEntries=entries.filter(entry=>entry.layer.enabled&&layerHasEffect(entry.layer));let segment=[];
    for(const entry of effectEntries){segment.push(entry);if(entry.layer.backgroundBlur||entry.layer.localBlur){applyLocalPixels(canvas,segment);segment=[];applyLayerBlur(canvas,entry)}}
    applyLocalPixels(canvas,segment);applyCleanup(canvas,cleanupForOutput(image,e));
    const overlayEntry=entries.find(entry=>entry.layer===active);if(visualizeMask&&active?.show&&overlayEntry)applyMaskOverlay(canvas,overlayEntry.map);addWatermark(canvas,watermark);for(const entry of entries)if(entry.map.canvas){entry.map.canvas.width=entry.map.canvas.height=1}return canvas
  }

  async function analyze(image){const max=180,s=Math.min(1,max/Math.max(image.naturalWidth||image.width,image.naturalHeight||image.height)),c=makeCanvas(Math.max(1,Math.round((image.naturalWidth||image.width)*s)),Math.max(1,Math.round((image.naturalHeight||image.height)*s)));const x=c.getContext('2d',{willReadFrequently:true});if(!x)throw new Error('Image analysis canvas is unavailable');x.drawImage(image,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height).data;let lum=0,lap=0,count=0;const gray=new Float32Array(c.width*c.height);for(let i=0,p=0;i<d.length;i+=4,p++){gray[p]=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];lum+=gray[p]}for(let y=1;y<c.height-1;y++)for(let xx=1;xx<c.width-1;xx++){const i=y*c.width+xx,v=Math.abs(gray[i]*4-gray[i-1]-gray[i+1]-gray[i-c.width]-gray[i+c.width]);lap+=v;count++}lum=gray.length?lum/gray.length/255:0;const sharpness=count?lap/count:0;let issue='';if(sharpness<7)issue='Low detail / possible blur';else if(lum<.16)issue='Underexposed';else if(lum>.88)issue='Overexposed';return{sharpness:+sharpness.toFixed(1),exposure:+lum.toFixed(2),issue,score:Math.round(clamp(sharpness/24)*70+clamp(1-Math.abs(lum-.5)*1.5)*30)}}

  globalThis.LumaEngine={COLORS,HUE_CENTERS,defaultEdits,defaultMaskLayer,migratedEdits,migratePhoto,deepMerge,clone,render,analyze,buildLut,rgbToHsl,outputPointToSource,outputPointToSourcePrepared,sourcePointToOutput};
})();
