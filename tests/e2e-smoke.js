const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `test-user-data-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
const shots = path.join(root, 'work', 'debug-shots');
fs.mkdirSync(runtimeCwd, { recursive: true });
fs.mkdirSync(shots, { recursive: true });
let fixtures;

async function launch(){
  const app = await electron.launch({ args: ['--no-sandbox','--disable-gpu','--disable-gpu-compositing','--disable-software-rasterizer','--in-process-gpu', `--user-data-dir=${userData}`, root], cwd: runtimeCwd });
  let page = await app.firstWindow();
  await new Promise(resolve=>setTimeout(resolve,1200));
  page = app.windows().filter(window=>!window.isClosed()).at(-1) || page;
  app.process().on('exit',code=>process.stderr.write(`\nELECTRON_EXIT ${code}\n`));
  page.on('crash',()=>process.stderr.write('\nPAGE_CRASH\n'));
  page.on('close',()=>process.stderr.write('\nPAGE_CLOSE\n'));
  return { app, page };
}

(async()=>{
  fixtures=await createPhotoFixtures(4);
  const samples=fixtures.paths;
  const mark=s=>process.stderr.write(`\nSTEP ${s}\n`);
  const errors=[];
  let {app,page}=await launch();
  page.on('pageerror',e=>errors.push(`PAGE: ${e.stack||e}`));
  page.on('console',m=>{if(m.type()==='error')errors.push(`CONSOLE: ${m.text()}`)});
  await page.waitForSelector('body',{timeout:15000});mark('body');
  if (await page.locator('#tutorialDialog[open]').count()) {
    await page.click('#tutorialSkip');
    await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
  }
  await page.evaluate(paths=>{
    const catalog=paths.map((filePath,i)=>({id:`test-${i}`,filePath,name:filePath.split('\\').pop(),importedAt:Date.now()-i*1000,rating:i,flag:i===1?'pick':'none',label:i===2?'blue':'',tags:i===0?['wallpaper','windows']:[],caption:'',edits:null}));
    localStorage.setItem('luma-catalog-v2',JSON.stringify(catalog));
    photos=catalog.map(p=>E.migratePhoto(p));
    updateLibrary();
    selectPhoto(photos[0]);
  },samples);mark('catalog injected');
  await page.waitForSelector('#canvas:not([width="300"])');
  await page.waitForFunction(()=>document.querySelector('#canvas').width>500,null,{timeout:30000});mark('canvas ready');
  const initial=await page.evaluate(()=>({canvas:[canvas.width,canvas.height],photos:document.querySelectorAll('.thumb').length,panels:document.querySelectorAll('.panel').length,empty:!document.querySelector('#empty').classList.contains('hidden')}));
  if(initial.photos!==4||initial.panels<9||initial.empty)throw new Error(`Bad initial state ${JSON.stringify(initial)}`);
  await page.screenshot({path:path.join(shots,'01-develop.png'),fullPage:true});mark('develop shot');

  // Light control, undo, and render performance.
  const exposure=page.locator('[data-path="light.exposure"]');
  const started=Date.now();
  await exposure.dispatchEvent('pointerdown');
  await exposure.fill('1.15');
  await exposure.dispatchEvent('change');
  await page.waitForTimeout(250);
  const sliderMs=Date.now()-started;
  if(await exposure.inputValue()!=='1.15')throw new Error('Exposure did not update');
  await page.click('#undoBtn');
  await page.click('#redoBtn');

  // Color mixer and grading controls.
  await page.locator('[data-panel-name="Color Mixer"]').evaluate(el=>el.classList.remove('collapsed'));
  await page.click('.color-chip[data-color="blue"]');
  await page.locator('[data-path="mixer.blue.saturation"]').fill('-35');
  await page.locator('[data-path="mixer.blue.saturation"]').dispatchEvent('change');
  await page.locator('[data-panel-name="Color Grading"]').evaluate(el=>el.classList.remove('collapsed'));
  await page.click('[data-grade="shadows"]');
  await page.locator('[data-path="grading.shadows.saturation"]').fill('20');
  await page.locator('[data-path="grading.shadows.saturation"]').dispatchEvent('change');

  // Tone curve point addition.
  const curve=page.locator('#curveCanvas');
  await curve.scrollIntoViewIfNeeded();
  const cb=await curve.boundingBox();
  await page.mouse.click(cb.x+cb.width*.3,cb.y+cb.height*.62);
  const curvePoints=await page.evaluate(()=>current.edits.curve.rgb.length);
  if(curvePoints<3)throw new Error('Curve point was not added');

  // Preset and amount.
  await page.click('.panel-tabs [data-panel="presets"]');
  await page.fill('#presetSearch','cinema');
  await page.click('.preset');
  await page.locator('#presetAmount').fill('125');
  await page.waitForTimeout(200);
  await page.screenshot({path:path.join(shots,'02-presets.png'),fullPage:true});mark('presets shot');

  // Subject focus and cleanup interactions.
  await page.click('.panel-tabs [data-panel="mask"]');
  await page.click('#subjectMaskBtn');
  const canvasBox=await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvasBox.x+canvasBox.width*.42,canvasBox.y+canvasBox.height*.43);
  await page.locator('[data-path="mask.backgroundBlur"]').fill('30');
  await page.locator('[data-path="mask.backgroundBlur"]').dispatchEvent('change');
  await page.click('#cleanupMaskBtn');
  await page.mouse.click(canvasBox.x+canvasBox.width*.65,canvasBox.y+canvasBox.height*.5);
  const maskState=await page.evaluate(()=>({enabled:current.edits.masks.layers[0]?.enabled,spots:current.edits.cleanup.length}));
  if(!maskState.enabled||maskState.spots!==1)throw new Error(`Mask failure ${JSON.stringify(maskState)}`);
  await page.screenshot({path:path.join(shots,'03-mask.png'),fullPage:true});mark('mask shot');

  // Library selection and metadata.
  await page.click('.tab[data-view="library"]');
  await page.waitForSelector('.card');
  await page.locator('.card').first().locator('.select-box').click();
  await page.locator('.card').first().locator('.info-btn').click();
  await page.locator('#ratingEditor [data-rating="5"]').click();
  await page.fill('#tagsEditor','wallpaper, test, blue');
  await page.click('#saveMetadata');
  const savedMeta=await page.evaluate(()=>photos.find(p=>p.id==='test-0'));
  if(savedMeta.rating!==5||!savedMeta.tags.includes('blue'))throw new Error('Metadata did not save');
  await page.screenshot({path:path.join(shots,'04-library.png'),fullPage:true});mark('library shot');

  // Quality analysis.
  await page.click('#cullBtn');mark('cull clicked');
  await page.waitForFunction(()=>photos.every(p=>p.quality),null,{timeout:30000});

  // Minimum window-size layout inspection.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1120,720));
  await page.waitForTimeout(300);
  const layout=await page.evaluate(()=>{
    const bad=[];for(const el of document.querySelectorAll('header,main,.left,.workspace,.right,.library-head,.panel-tabs')){const r=el.getBoundingClientRect();if(r.right>innerWidth+2||r.bottom>innerHeight+2||r.left<-2)bad.push({el:el.className||el.tagName,r:[r.left,r.top,r.right,r.bottom]})}return{bad,inner:[innerWidth,innerHeight],bodyScroll:[document.body.scrollWidth,document.body.scrollHeight]};
  });
  await page.screenshot({path:path.join(shots,'05-min-window.png'),fullPage:true});mark('min shot');

  // Export dialog should fit and offer all formats; do not trigger native file picker.
  await page.locator('.card').first().dblclick();
  await page.click('#exportBtn');
  const formats=await page.locator('#exportFormat option').allTextContents();
  if(formats.length!==5)throw new Error('Export formats missing');
  await page.press('#exportDialog','Escape');

  const persisted=await page.evaluate(()=>localStorage.getItem('luma-catalog-v2'));
  if(!persisted?.includes('"rating":5'))throw new Error('Catalog did not persist edits');
  await app.close();
  await new Promise(r=>setTimeout(r,1500));

  // Restart persistence.
  ({app,page}=await launch());
  page.on('pageerror',e=>errors.push(`RESTART PAGE: ${e.stack||e}`));
  await page.waitForFunction(()=>document.querySelectorAll('.thumb').length===4);
  await page.waitForFunction(()=>document.querySelector('#canvas').width>500,null,{timeout:30000});
  const restart=await page.evaluate(()=>({rating:photos.find(p=>p.id==='test-0')?.rating,exposure:photos[0]?.edits.light.exposure,canvas:document.querySelector('#canvas').width}));
  await app.close();
  const report={initial,sliderMs,curvePoints,maskState,savedMeta:{rating:savedMeta.rating,tags:savedMeta.tags},layout,formats,restart,errors};
  process.stdout.write(JSON.stringify(report,null,2));
  if(errors.length||layout.bad.length)process.exitCode=2;
  await fixtures.cleanup();
})().catch(async e=>{process.stderr.write(e.stack||String(e));await fixtures?.cleanup();process.exitCode=1});
