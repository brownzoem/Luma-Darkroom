const {_electron:electron}=require('playwright-core');
const path=require('path');
const fs=require('fs');
const {createPhotoFixtures}=require('./helpers/photo-fixtures');
const root=path.resolve(__dirname,'..'),userData=path.join(root,'work',`stress-data-${process.pid}`);
const runtimeCwd=path.join(userData,'cwd');
fs.mkdirSync(runtimeCwd,{recursive:true});
let fixtures;
(async()=>{
  fixtures=await createPhotoFixtures(4);const samples=fixtures.paths;
  const errors=[],app=await electron.launch({args:['--no-sandbox','--disable-gpu','--disable-gpu-compositing','--disable-software-rasterizer','--in-process-gpu',`--user-data-dir=${userData}`,root],cwd:runtimeCwd});let page=await app.firstWindow();await new Promise(resolve=>setTimeout(resolve,1200));page=app.windows().filter(window=>!window.isClosed()).at(-1)||page;
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.waitForSelector('body');
  if(await page.locator('#tutorialDialog[open]').count()){await page.click('#tutorialSkip');await page.locator('#tutorialDialog').waitFor({state:'hidden'})}
  await page.evaluate(paths=>{photos=paths.map((filePath,i)=>E.migratePhoto({id:`stress-${i}`,filePath,name:filePath.split('\\').pop(),importedAt:Date.now()-i,rating:i,flag:'none',tags:[],caption:''}));updateLibrary();selectPhoto(photos[0])},samples);
  await page.waitForFunction(()=>canvas.width>500);

  const controls=await page.evaluate(()=>{const failures=[];for(const el of document.querySelectorAll('input[data-path]')){const min=+el.min,max=+el.max,target=+(min+(max-min)*.63).toFixed(el.step.includes('.')?2:0);el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));el.value=target;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));const actual=getPath(current.edits,el.dataset.path);if(Math.abs(actual-target)>Math.max(.011,+el.step/2+.001))failures.push({path:el.dataset.path,target,actual})}return{count:document.querySelectorAll('input[data-path]').length,failures}});
  await page.waitForTimeout(500);
  const checks=await page.evaluate(()=>{const failures=[];for(const el of document.querySelectorAll('input[data-check-path]')){const before=!!getPath(current.edits,el.dataset.checkPath);el.click();const actual=!!getPath(current.edits,el.dataset.checkPath);if(actual===before)failures.push(el.dataset.checkPath)}return{count:document.querySelectorAll('input[data-check-path]').length,failures}});
  await page.waitForTimeout(250);
  await page.selectOption('[data-select-path="profile"]','Luma Vivid');
  await page.selectOption('[data-select-path="color.wb"]','Cloudy');
  await page.locator('[data-panel-name="Crop & Geometry"]').evaluate(el=>el.classList.remove('collapsed'));
  await page.selectOption('[data-select-path="geometry.cropAspect"]','Square');
  await page.waitForTimeout(250);
  const selectState=await page.evaluate(()=>({profile:current.edits.profile,wb:current.edits.color.wb,aspect:current.edits.geometry.cropAspect,canvas:[canvas.width,canvas.height]}));
  if(selectState.canvas[0]!==selectState.canvas[1])errors.push('Square crop did not render square');

  await page.click('#zoomRange');await page.locator('#zoomRange').fill('150');await page.locator('#zoomRange').dispatchEvent('input');
  if(!await page.locator('#canvasWrap').evaluate(el=>el.classList.contains('zoomed')))errors.push('Zoom mode missing');
  await page.click('#fitBtn');if(await page.locator('#canvasWrap').evaluate(el=>el.classList.contains('zoomed')))errors.push('Fit did not reset zoom');
  await page.click('#clipToggle');await page.click('#clipToggle');
  await page.locator('[data-panel-name="Tone Curve"]').evaluate(el=>el.classList.remove('collapsed'));await page.locator('[data-curve-preset="strong"]').scrollIntoViewIfNeeded();await page.click('[data-curve-preset="strong"]');
  const curve=await page.evaluate(()=>current.edits.curve.rgb);if(curve.length!==5)errors.push('Strong curve preset failed');

  await page.click('.tab[data-view="library"]');
  await page.fill('#search','no-such-photo');if(await page.locator('.card').count())errors.push('Search filter failed');await page.fill('#search','');
  await page.selectOption('#filterRating','3');if(await page.locator('.card').count()!==1)errors.push('Rating filter failed');await page.selectOption('#filterRating','0');
  await page.locator('.card').nth(0).locator('.select-box').click();await page.locator('.card').nth(1).locator('.select-box').click();
  await page.click('#compareSelectedBtn');await page.waitForSelector('#compareDialog[open]');await page.waitForFunction(()=>compareCanvasA.width>100&&compareCanvasB.width>100);const compareState=await page.evaluate(()=>({a:[compareCanvasA.width,compareCanvasA.height],b:[compareCanvasB.width,compareCanvasB.height],names:[compareNameA.textContent,compareNameB.textContent]}));await page.press('#compareDialog','Escape');
  await page.click('#batchPresetBtn');await page.waitForSelector('#presets:not(.hidden)');await page.click('.preset[data-name="HDR Natural"]');
  const batch=await page.evaluate(()=>photos.filter(p=>p.id==='stress-0'||p.id==='stress-1').map(p=>p.edits.light.highlights));if(batch.some(v=>v!==-50))errors.push(`Batch preset failed: ${batch}`);

  const shortcutStart=await page.evaluate(()=>current.id);await page.keyboard.press('5');await page.keyboard.press('p');const shortcutMarked=await page.evaluate(()=>({id:current.id,rating:current.rating,flag:current.flag}));await page.keyboard.press('ArrowRight');const shortcutEnd=await page.evaluate(()=>current.id);await page.keyboard.press('g');const shortcutLibrary=await page.locator('body').evaluate(el=>el.classList.contains('library-mode'));await page.keyboard.press('d');if(shortcutMarked.rating!==5||shortcutMarked.flag!=='pick'||shortcutEnd===shortcutStart||!shortcutLibrary)errors.push('Culling keyboard shortcuts failed');
  const watermarks=await page.evaluate(()=>{rememberWatermark('Studio proof');rememberWatermark('Client ©');return[...document.querySelectorAll('#watermarkHistory option')].map(option=>option.value)});if(watermarks[0]!=='Client ©'||watermarks[1]!=='Studio proof')errors.push('Watermark history failed');

  await page.click('.tab[data-view="library"]');await page.locator('.card').first().locator('.info-btn').click();const oldRating=await page.evaluate(()=>metadataPhoto.rating);await page.click('#ratingEditor [data-rating="5"]');await page.press('#metadataDialog','Escape');if(await page.evaluate(()=>metadataPhoto.rating)!==oldRating)errors.push('Metadata cancel mutated rating');
  await page.click('#mergeBtn');if(!await page.locator('#mergeDialog').evaluate(d=>d.open))errors.push('Merge dialog did not open');await page.press('#mergeDialog','Escape');

  const overlap=await page.evaluate(()=>{const bad=[];for(const el of document.querySelectorAll('button,input,select')){const s=getComputedStyle(el),r=el.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||r.width===0||r.height===0||r.bottom<0||r.top>innerHeight)continue;const top=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.top+r.height/2)));if(top&&!el.contains(top)&&!top.contains(el))bad.push({id:el.id||el.className,coveredBy:top.id||top.className})}return bad});
  const security=await page.evaluate(()=>{const p=E.migratePhoto({id:'\"><img src=x onerror=alert(1)>',filePath:'C:\\fake.jpg',name:'<script>bad()</script>',rating:99,flag:'evil',label:'\" onclick=alert(1)',tags:['ok',42],caption:'x'});return{requireType:typeof require,processType:typeof process,label:p.label,flag:p.flag,rating:p.rating,tags:p.tags,name:p.name,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,popup:window.open('https://example.com')===null}});
  if(security.requireType!=='undefined'||security.processType!=='undefined'||security.label||security.flag!=='none'||security.rating!==5||security.tags.length!==1||!security.popup)errors.push('Renderer security invariant failed');
  const report={controls,checks,selectState,curvePoints:curve.length,batch,compareState,shortcutMarked,watermarks,overlap,security,errors};
  process.stdout.write(JSON.stringify(report,null,2));await app.close();await fixtures.cleanup();if(controls.failures.length||checks.failures.length||errors.length)process.exitCode=1;
})().catch(async e=>{console.error(e);await fixtures?.cleanup();process.exitCode=1});
