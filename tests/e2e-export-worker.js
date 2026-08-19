const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `export-worker-user-data-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });
const launchArgs = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-software-rasterizer',
  '--in-process-gpu',
  `--user-data-dir=${userData}`,
  root,
];

let runningApp;
let fixtures;

async function livePage(app) {
  let page = await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1200));
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  await page.waitForSelector('body', { timeout: 15000 });
  return page;
}

(async () => {
  fixtures = await createPhotoFixtures(1);
  const [sample] = fixtures.paths;
  const errors = [];
  runningApp = await electron.launch({ args: launchArgs, cwd: runtimeCwd });
  const page = await livePage(runningApp);
  page.on('pageerror', error => errors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`);
  });

  if (await page.locator('#tutorialDialog[open]').count()) {
    await page.click('#tutorialSkip');
    await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
  }
  await page.evaluate(filePath => {
    const photo = E.migratePhoto({ id: 'worker-selected', filePath, name: 'worker-selected.jpg', importedAt: Date.now() });
    photos = [photo];
    updateLibrary();
    selectPhoto(photo);
  }, sample);
  await page.waitForFunction(() => current?.id === 'worker-selected' && sourceImage.naturalWidth === 1600 && canvas.width > 500, null, { timeout: 30000 });

  const render = await page.evaluate(async () => {
    const selectedPixels = document.createElement('canvas');
    selectedPixels.width = 3200;
    selectedPixels.height = 2000;
    selectedPixels.getContext('2d').drawImage(sourceImage, 0, 0, selectedPixels.width, selectedPixels.height);
    const edits = E.clone(current.edits);
    edits.geometry.cropAspect = 'Square';
    edits.light.exposure = 0.35;
    edits.color.vibrance = 30;
    edits.detail.sharpening = 90;
    edits.detail.sharpenDetail = 70;
    edits.detail.noiseColor = 35;
    edits.effects.grain = 18;
    edits.mask.enabled = true;
    edits.mask.type = 'subject';
    edits.mask.backgroundBlur = 25;

    let ticks = 0;
    let frames = 0;
    let keepAnimating = true;
    const interval = setInterval(() => { ticks += 1; }, 10);
    const animate = () => {
      frames += 1;
      if (keepAnimating) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    const started = performance.now();
    const result = await renderExportInWorker(selectedPixels, edits, {
      maxEdge: 2400,
      watermark: 'Worker verification',
      mime: 'image/jpeg',
      quality: 0.86,
    });
    const duration = performance.now() - started;
    keepAnimating = false;
    clearInterval(interval);

    const encoded = new Uint8Array(result.bytes);
    const decoded = await createImageBitmap(new Blob([encoded], { type: result.mime }));
    const decodedSize = [decoded.width, decoded.height];
    decoded.close();
    selectedPixels.width = selectedPixels.height = 1;
    return {
      selectedId: current.id,
      duration: Math.round(duration),
      ticks,
      frames,
      byteLength: encoded.byteLength,
      signature: [...encoded.slice(0, 3)],
      ending: [...encoded.slice(-2)],
      mime: result.mime,
      workerSize: [result.width, result.height],
      decodedSize,
      workerReleased: activeExportWorker === null,
    };
  });

  const cancellation = await page.evaluate(async () => {
    const source = document.createElement('canvas');
    source.width = 3200;
    source.height = 2000;
    source.getContext('2d').drawImage(sourceImage, 0, 0, source.width, source.height);
    const edits = E.clone(current.edits);
    edits.detail.sharpening = 120;
    edits.detail.noiseColor = 80;
    const started = performance.now();
    const pending = renderExportInWorker(source, edits, { maxEdge: 2800, watermark: '', mime: 'image/png', quality: 1 });
    while (!activeExportWorker && performance.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 5));
    const workerWasActive = !!activeExportWorker;
    cancelExportRender();
    const outcome = await Promise.race([
      pending.then(() => ({ state: 'resolved' }), error => ({ state: 'rejected', name: error?.name, message: error?.message })),
      new Promise(resolve => setTimeout(() => resolve({ state: 'timeout' }), 1500)),
    ]);
    source.width = source.height = 1;
    return { workerWasActive, outcome, elapsed: Math.round(performance.now() - started), workerReleased: activeExportWorker === null };
  });

  const failures = [];
  if (render.selectedId !== 'worker-selected') failures.push('Worker did not render the selected photograph');
  if (render.mime !== 'image/jpeg' || render.byteLength < 10_000 || render.signature.join(',') !== '255,216,255' || render.ending.join(',') !== '255,217') failures.push('Worker did not produce a valid JPEG payload');
  if (render.workerSize.join(',') !== '1500,1500' || render.decodedSize.join(',') !== '1500,1500') failures.push('Worker crop dimensions or encoded dimensions are wrong');
  if (render.ticks < 5 || render.frames < 2) failures.push('Renderer event loop did not remain responsive during export');
  if (!render.workerReleased) failures.push('Completed export retained its Worker');
  if (!cancellation.workerWasActive || cancellation.outcome.state !== 'rejected' || cancellation.outcome.name !== 'AbortError' || cancellation.elapsed > 1500 || !cancellation.workerReleased) failures.push('Active Worker cancellation did not settle promptly');
  if (errors.length) failures.push('Renderer emitted unexpected errors');

  const report = { render, cancellation, errors, failures };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await runningApp.close();
  await fixtures.cleanup();
  if (failures.length) throw new Error(failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await runningApp?.close(); } catch {}
  await fixtures?.cleanup();
  process.exitCode = 1;
});
