const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `brush-workflow-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });
let app;
let fixtures;

async function waitForPreview(page) {
  await page.waitForFunction(() => !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && canvas.dataset.previewQuality === 'full' && Math.max(canvas.width, canvas.height) >= 1050, null, { timeout: 30000 });
}

(async () => {
  fixtures = await createPhotoFixtures(1);
  const errors = [];
  const failures = [];
  app = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--in-process-gpu', `--user-data-dir=${userData}`, root],
    cwd: runtimeCwd
  });
  let page = await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1000));
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForSelector('body');
  if (await page.locator('#tutorialDialog[open]').count()) await page.click('#tutorialSkip');
  await page.evaluate(filePath => {
    photos = [E.migratePhoto({ id: 'brush-workflow-photo', filePath, name: 'brush-workflow.jpg', importedAt: Date.now() })];
    updateLibrary();
    selectPhoto(photos[0]);
  }, fixtures.paths[0]);
  await waitForPreview(page);

  await page.click('#maskPanelTab');
  const beforeActivation = await page.evaluate(() => ({
    requestId: previewRequestId,
    revision: canvas.dataset.previewRevision,
    backing: [canvas.width, canvas.height],
    display: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height]
  }));
  await page.click('#addDodgeMask');
  await page.waitForTimeout(120);
  const activation = await page.evaluate(() => ({
    requestId: previewRequestId,
    revision: canvas.dataset.previewRevision,
    backing: [canvas.width, canvas.height],
    display: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height],
    toolMode,
    purpose: activeMask()?.purpose,
    size: activeMask()?.brushSize,
    feather: activeMask()?.brushFeather
  }));
  if (activation.requestId !== beforeActivation.requestId || activation.revision !== beforeActivation.revision || JSON.stringify(activation.backing) !== JSON.stringify(beforeActivation.backing) || activation.display.some((value, index) => Math.abs(value - beforeActivation.display[index]) > 1) || activation.toolMode !== 'mask-add' || activation.purpose !== 'dodge') failures.push('Dodge activation changed pixels, canvas size, or tool state');

  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('Shift+BracketRight');
  const harder = await page.evaluate(() => ({ size: activeMask().brushSize, feather: activeMask().brushFeather, sizeControl: +document.querySelector('input[data-path="mask.brushSize"]').value, featherControl: +document.querySelector('input[data-path="mask.brushFeather"]').value }));
  await page.keyboard.press('Shift+BracketLeft');
  await page.keyboard.press('KeyB');
  const addMode = await page.evaluate(() => toolMode);
  await page.keyboard.press('KeyE');
  const subtractMode = await page.evaluate(() => toolMode);
  const guardedSize = await page.evaluate(() => activeMask().brushSize);
  await page.focus('#maskName');
  await page.keyboard.press('BracketRight');
  const inputGuardSize = await page.evaluate(() => activeMask().brushSize);
  await page.keyboard.press('Escape');
  await page.click('#helpBtn');
  await page.keyboard.press('BracketLeft');
  const dialogGuardSize = await page.evaluate(() => activeMask().brushSize);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+KeyO');
  const burn = await page.evaluate(() => ({ purpose: activeMask().purpose, count: current.edits.masks.layers.length }));
  await page.keyboard.press('KeyO');
  const repeatedBurn = await page.evaluate(() => ({ purpose: activeMask().purpose, count: current.edits.masks.layers.length }));
  await page.keyboard.press('Shift+KeyO');
  const dodge = await page.evaluate(() => ({ purpose: activeMask().purpose, count: current.edits.masks.layers.length, toolMode }));
  if (harder.size !== 14 || harder.feather !== 75 || harder.sizeControl !== 14 || harder.featherControl !== 75 || addMode !== 'mask-add' || subtractMode !== 'mask-subtract' || inputGuardSize !== guardedSize || dialogGuardSize !== guardedSize || burn.purpose !== 'burn' || repeatedBurn.purpose !== 'burn' || repeatedBurn.count !== burn.count || dodge.purpose !== 'dodge' || dodge.toolMode !== 'mask-add') failures.push('Brush shortcuts, guards, or reusable Dodge/Burn selection failed');

  await page.evaluate(() => {
    const layer = activeMask();
    layer.strokes = [];
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    clearLiveBrushOverlay();
    refreshControls();
    scheduleRender();
  });
  await waitForPreview(page);
  const beforeStroke = await page.evaluate(() => ({ token: previewWorkerToken, backing: [canvas.width, canvas.height], display: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height], requestId: previewRequestId }));
  const canvasBox = await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width * .2, canvasBox.y + canvasBox.height * .35);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * .78, canvasBox.y + canvasBox.height * .62);
  await page.waitForFunction(() => !liveBrushOverlay.classList.contains('hidden') && activeMask()?.strokes?.[0]?.kind === 'path' && activeMask().strokes[0].points.length > 4, null, { timeout: 5000 });
  const duringStroke = await page.evaluate(() => {
    const context = liveBrushOverlay.getContext('2d'), pixels = context.getImageData(0, 0, liveBrushOverlay.width, liveBrushOverlay.height).data;
    let alpha = 0; for (let index = 3; index < pixels.length; index += 4) alpha = Math.max(alpha, pixels[index]);
    return { token: previewWorkerToken, backing: [canvas.width, canvas.height], display: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height], points: activeMask().strokes[0].points.length, history: historyStacks()[0].length, overlayAlpha: alpha };
  });
  await page.mouse.up();
  await waitForPreview(page);
  const afterStroke = await page.evaluate(() => ({
    token: previewWorkerToken,
    backing: [canvas.width, canvas.height],
    display: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height],
    strokes: activeMask().strokes.length,
    kind: activeMask().strokes[0]?.kind,
    points: activeMask().strokes[0]?.points?.length,
    history: historyStacks()[0].length,
    historyLabel: historyStacks()[0].at(-1)?.label,
    overlayHidden: liveBrushOverlay.classList.contains('hidden'),
    quality: canvas.dataset.previewQuality
  }));
  const stableDuring = duringStroke.backing.every((value, index) => value === beforeStroke.backing[index]) && duringStroke.display.every((value, index) => Math.abs(value - beforeStroke.display[index]) <= 1);
  const stableAfter = afterStroke.backing.every((value, index) => value === beforeStroke.backing[index]) && afterStroke.display.every((value, index) => Math.abs(value - beforeStroke.display[index]) <= 1);
  if (!stableDuring || !stableAfter || duringStroke.token !== beforeStroke.token || afterStroke.token !== beforeStroke.token || duringStroke.points <= 4 || duringStroke.history !== 0 || duringStroke.overlayAlpha <= 0 || afterStroke.strokes !== 1 || afterStroke.kind !== 'path' || afterStroke.points <= 4 || afterStroke.history !== 1 || afterStroke.historyLabel !== 'Add to mask' || !afterStroke.overlayHidden || afterStroke.quality !== 'full') failures.push('Smooth brush gesture shrank the canvas, restarted the worker, lost overlay feedback, or broke one-gesture undo');

  const pressurePath = await page.evaluate(() => {
    const layer = activeMask(), rect = canvas.getBoundingClientRect(), pointerId = 9042, originalCapture = canvas.setPointerCapture, originalRelease = canvas.releasePointerCapture;
    const sample = (x, y, pressure, buttons = 1) => ({ button: 0, buttons, pointerId, pointerType: 'pen', pressure, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y, preventDefault() {} });
    try {
      canvas.setPointerCapture = () => {};
      canvas.releasePointerCapture = () => {};
      beginMaskBrush(sample(.18, .78, .15));
      const middle = sample(.72, .56, .9);
      middle.getCoalescedEvents = () => [sample(.32, .72, .3), sample(.48, .66, .55), sample(.62, .6, .78), middle];
      moveMaskBrush(middle);
      finishMaskBrush(sample(.76, .54, 1, 0));
    } finally {
      canvas.setPointerCapture = originalCapture;
      canvas.releasePointerCapture = originalRelease;
    }
    const path = layer.strokes.at(-1), pressures = path.points.map(point => point[2]), pressureEdits = E.clone(current.edits), fullPressureEdits = E.clone(current.edits), pressureLayer = pressureEdits.masks.layers.find(candidate => candidate.id === layer.id), fullPressureLayer = fullPressureEdits.masks.layers.find(candidate => candidate.id === layer.id);
    pressureEdits.masks.layers = [pressureLayer]; pressureEdits.masks.activeId = pressureLayer.id; pressureLayer.strokes = [E.clone(path)];
    fullPressureEdits.masks.layers = [fullPressureLayer]; fullPressureEdits.masks.activeId = fullPressureLayer.id; fullPressureLayer.strokes = [E.clone(path)]; fullPressureLayer.strokes[0].points.forEach(point => { point[2] = 1; });
    const pressured = E.render(sourceImage, pressureEdits, { maxEdge: 220 }).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 220, 138).data, full = E.render(sourceImage, fullPressureEdits, { maxEdge: 220 }).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 220, 138).data;
    let renderDelta = 0; for (let index = 0; index < Math.min(pressured.length, full.length); index += 4) renderDelta += Math.abs(pressured[index] - full[index]) + Math.abs(pressured[index + 1] - full[index + 1]) + Math.abs(pressured[index + 2] - full[index + 2]);
    return { kind: path.kind, points: path.points.length, minimumPressure: Math.min(...pressures), maximumPressure: Math.max(...pressures), history: historyStacks()[0].length, renderDelta };
  });
  await waitForPreview(page);
  const cropSizing = await page.evaluate(() => {
    const layer = activeMask(), rect = canvas.getBoundingClientRect();
    return [100, 200, 300].map(cropZoom => {
      const preparedEdits = E.migratedEdits(current.edits); preparedEdits.geometry.cropZoom = cropZoom;
      return brushSourcePoint({ x: .5, y: .5 }, layer.brushSize, { maskId: layer.id, preparedEdits, canvasRect: rect }).sourceSize;
    });
  });
  const sanitizerBounds = await page.evaluate(() => {
    const points = Array.from({ length: 5000 }, (_value, index) => [index / 4999, .5, index ? 1 : -4, index ? 14 : 999]);
    const makeLayer = id => E.defaultMaskLayer({ id, type: 'brush', strokes: [{ kind: 'path', id: `${id}-path`, mode: 'add', size: 14, feather: 55, flow: 100, spacing: .1, points }] });
    const bounded = E.migratedEdits({ version: 5, masks: { activeId: 'a', layers: [makeLayer('a'), makeLayer('b')] } });
    let inspected = 0; const hostileTarget = []; hostileTarget.length = 1_000_000; const hostile = new Proxy(hostileTarget, { get(target, property, receiver) { if (typeof property === 'string' && /^\d+$/.test(property)) inspected++; return Reflect.get(target, property, receiver); } });
    E.migratedEdits({ version: 5, masks: { activeId: 'hostile', layers: [E.defaultMaskLayer({ id: 'hostile', type: 'brush', strokes: hostile })] } });
    const lengths = bounded.masks.layers.map(layer => layer.strokes[0]?.points.length || 0), first = bounded.masks.layers[0].strokes[0].points[0];
    return { lengths, total: lengths.reduce((sum, length) => sum + length, 0), pressureClamp: first[2], sourceSizeClamp: first[3], inspected };
  });
  if (pressurePath.kind !== 'path' || pressurePath.points <= 8 || pressurePath.minimumPressure > .16 || pressurePath.maximumPressure < .99 || pressurePath.history !== 2 || pressurePath.renderDelta <= 0 || Math.abs(cropSizing[0] / cropSizing[1] - 2) > .08 || Math.abs(cropSizing[0] / cropSizing[2] - 3) > .12) failures.push('Coalesced pen pressure or crop-consistent brush sizing failed');
  if (sanitizerBounds.lengths.join(',') !== '4096,4096' || sanitizerBounds.total !== 8192 || sanitizerBounds.pressureClamp !== .05 || sanitizerBounds.sourceSizeClamp !== 100 || sanitizerBounds.inspected > 32768) failures.push('Brush path ceilings or malformed top-level inspection bounds failed');

  await page.evaluate(() => applyZoom(200, { render: false, recalculate: true }));
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    canvas.focus();
    updateKeyboardCanvasCursor();
  });
  const cursorBeforePan = await page.evaluate(() => !keyboardCanvasCursor.classList.contains('hidden'));
  const pointsBeforePan = await page.evaluate(() => activeMask().strokes.reduce((sum, stroke) => sum + (stroke.points?.length || 0), 0));
  const wrapBox = await page.locator('#canvasWrap').boundingBox();
  await page.mouse.move(wrapBox.x + wrapBox.width * .6, wrapBox.y + wrapBox.height * .6);
  const cursorAfterMouseMove = await page.evaluate(() => keyboardCanvasCursor.classList.contains('hidden'));
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    canvas.focus();
    updateKeyboardCanvasCursor();
  });
  await page.keyboard.down('Space');
  const cursorDuringPan = await page.evaluate(() => !keyboardCanvasCursor.classList.contains('hidden') || !brushCursor.classList.contains('hidden'));
  await page.mouse.move(wrapBox.x + wrapBox.width * .65, wrapBox.y + wrapBox.height * .65);
  await page.mouse.down();
  await page.mouse.move(wrapBox.x + wrapBox.width * .35, wrapBox.y + wrapBox.height * .35, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const pan = await page.evaluate(() => ({ left: canvasWrap.scrollLeft, top: canvasWrap.scrollTop, points: activeMask().strokes.reduce((sum, stroke) => sum + (stroke.points?.length || 0), 0), keyboardHidden: keyboardCanvasCursor.classList.contains('hidden') }));
  await page.click('#rotateRight');
  await waitForPreview(page);
  const geometry = await page.evaluate(() => {
    const rect = canvas.getBoundingClientRect(), checkerRect = checker.getBoundingClientRect();
    return { ratioError: Math.abs(rect.width / rect.height - canvas.width / canvas.height), checkerError: Math.max(Math.abs(rect.width - checkerRect.width), Math.abs(rect.height - checkerRect.height)), quality: canvas.dataset.previewQuality };
  });
  if (!cursorBeforePan || !cursorAfterMouseMove || cursorDuringPan || pan.left <= 0 || pan.top <= 0 || pan.points !== pointsBeforePan || !pan.keyboardHidden || geometry.ratioError > .001 || geometry.checkerError > 1 || geometry.quality !== 'full') failures.push('Zoomed Space-pan, cursor modality, or rotated canvas geometry failed');
  if (errors.length) failures.push('Renderer emitted unexpected errors');

  process.stdout.write(`${JSON.stringify({ activation, shortcuts: { harder, addMode, subtractMode, inputGuardSize, dialogGuardSize, burn, repeatedBurn, dodge }, stroke: { beforeStroke, duringStroke, afterStroke, pressurePath, cropSizing, sanitizerBounds }, pan: { cursorBeforePan, cursorAfterMouseMove, cursorDuringPan, ...pan }, geometry, errors, failures }, null, 2)}\n`);
  await app.close();
  app = null;
  await fixtures.cleanup();
  fixtures = null;
  fs.rmSync(userData, { recursive: true, force: true });
  if (failures.length) throw new Error(failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await app?.close(); } catch {}
  try { await fixtures?.cleanup(); } catch {}
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  process.exitCode = 1;
});
