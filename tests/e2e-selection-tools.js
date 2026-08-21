/**
 * End-to-end coverage for the selection tool system (v3.0): tool rail,
 * single-key tool shortcuts, freehand/polygonal lasso, marquee (rect and
 * preset shapes) with combine modifiers, magic wand, pen paths, the
 * Move/Transform tool, geometry-mask rendering, and history behavior.
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `selection-tools-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });

const failures = [];
const check = (condition, message, detail) => {
  if (!condition) failures.push(message + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
};

(async () => {
  const fixtures = await createPhotoFixtures(1);
  const app = await electron.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--in-process-gpu', `--user-data-dir=${userData}`, root], cwd: runtimeCwd });
  let page = await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1400));
  page = app.windows().filter(w => !w.isClosed()).at(-1) || page;
  const errors = [];
  page.on('pageerror', e => errors.push(`PAGE: ${e.stack || e}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

  await page.locator('#tutorialDialog[open]').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if (await page.locator('#tutorialDialog[open]').count()) {
    await page.click('#tutorialSkip');
    await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
  }
  await page.evaluate(paths => {
    const catalog = paths.map((filePath, i) => ({ id: `sel-${i}`, filePath, name: 'sel-' + i, importedAt: Date.now(), edits: null }));
    localStorage.setItem('luma-catalog-v2', JSON.stringify(catalog));
    photos = catalog.map(p => E.migratePhoto(p));
    updateLibrary();
    selectPhoto(photos[0]);
  }, fixtures.paths);
  await page.waitForFunction(() => document.querySelector('#canvas').width > 500, null, { timeout: 30000 });
  await page.waitForFunction(() => !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && canvas.dataset.previewQuality === 'full', null, { timeout: 20000 });

  const railState = await page.evaluate(() => ({
    buttons: document.querySelectorAll('.tool-rail-btn').length,
    icons: document.querySelectorAll('.tool-rail-btn svg').length,
    optionsVisible: !document.querySelector('#toolOptions').classList.contains('hidden'),
    overlay: !!document.querySelector('#toolOverlay')
  }));
  check(railState.buttons === 13 && railState.icons === 13, 'tool rail has 13 icon buttons', railState);
  check(railState.optionsVisible && railState.overlay, 'options bar and overlay exist', railState);

  const box = await page.locator('#canvas').boundingBox();
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const layerSummary = () => page.evaluate(() => current.edits.masks.layers.map(l => ({ type: l.type, regions: (l.regions || []).map(r => ({ kind: r.kind, mode: r.mode, shape: r.shape || null })) })));

  // Freehand lasso creates a polygon-region geometry mask.
  await page.keyboard.press('l');
  check(await page.evaluate(() => toolMode) === 'tool-lasso', 'L activates lasso');
  const lassoPath = [[0.2, 0.2], [0.45, 0.18], [0.5, 0.42], [0.3, 0.5], [0.18, 0.4]];
  const start = at(...lassoPath[0]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const [fx, fy] of lassoPath.slice(1)) { const point = at(fx, fy); await page.mouse.move(point.x, point.y, { steps: 6 }); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  let layers = await layerSummary();
  check(layers.length === 1 && layers[0].type === 'geometry' && layers[0].regions[0]?.kind === 'polygon', 'lasso creates polygon region', layers);

  // Shift+marquee adds a rect-shape region to the SAME layer.
  await page.keyboard.press('m');
  await page.keyboard.down('Shift');
  const m0 = at(0.6, 0.6), m1 = at(0.85, 0.8);
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(m1.x, m1.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
  layers = await layerSummary();
  check(layers.length === 1 && layers[0].regions.length === 2 && layers[0].regions[1].kind === 'shape' && layers[0].regions[1].mode === 'add', 'Shift-marquee adds to active selection', layers);

  // Star-shape marquee as a NEW layer.
  await page.evaluate(() => { LumaToolRail.state.marqueeVariant = 'shape'; LumaToolRail.state.marqueeShape = 'star'; LumaToolRail.state.combine = 'new'; LumaToolRail.refresh(); });
  const s0 = at(0.1, 0.6), s1 = at(0.35, 0.9);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  await page.mouse.move(s1.x, s1.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  layers = await layerSummary();
  check(layers.length === 2 && layers[0].regions[0]?.shape === 'star', 'star marquee creates new layer', layers);

  // Magic wand click.
  await page.keyboard.press('w');
  const wandPoint = at(0.5, 0.25);
  await page.mouse.click(wandPoint.x, wandPoint.y);
  await page.waitForTimeout(200);
  layers = await layerSummary();
  check(layers.length === 3 && layers[0].regions[0]?.kind === 'wand', 'wand click creates wand region', layers);

  // Polygonal lasso with Enter close.
  await page.evaluate(() => { LumaToolRail.state.lassoVariant = 'polygonal'; });
  await page.keyboard.press('l');
  for (const [fx, fy] of [[0.65, 0.15], [0.9, 0.2], [0.8, 0.45]]) {
    const point = at(fx, fy);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  layers = await layerSummary();
  check(layers.length === 4 && layers[0].regions[0]?.kind === 'polygon', 'polygonal lasso closes with Enter', layers);

  // Pen path with Enter close.
  await page.keyboard.press('p');
  check(await page.evaluate(() => toolMode) === 'tool-pen', 'P activates pen');
  for (const [fx, fy] of [[0.15, 0.75], [0.3, 0.65], [0.35, 0.85]]) {
    const point = at(fx, fy);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  layers = await layerSummary();
  check(layers.length === 5 && layers[0].regions[0]?.kind === 'bezier', 'pen path closes to bezier region', layers);

  // A geometry mask constrains local adjustments to its region.
  const renderCheck = await page.evaluate(() => {
    const layer = activeMask();
    layer.subjectExposure = 2.5;
    const withoutMasks = E.render(sourceImage, { ...E.clone(current.edits), masks: { activeId: '', layers: [] } }, { maxEdge: 200 });
    const withMasks = E.render(sourceImage, E.clone(current.edits), { maxEdge: 200 });
    const withoutData = withoutMasks.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, withoutMasks.width, withoutMasks.height).data;
    const withData = withMasks.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, withMasks.width, withMasks.height).data;
    let changed = 0;
    for (let i = 0; i < withoutData.length; i += 4) if (Math.abs(withoutData[i] - withData[i]) > 6) changed++;
    layer.subjectExposure = 0;
    return { changed, total: withoutData.length / 4 };
  });
  check(renderCheck.changed > 20 && renderCheck.changed < renderCheck.total * 0.9, 'geometry mask constrains local exposure', renderCheck);

  // Move/Transform: pan, then corner-scale from the true handle position.
  await page.keyboard.press('v');
  const beforeTransform = await page.evaluate(() => ({ x: current.edits.geometry.xOffset, scale: current.edits.geometry.scale }));
  const panFrom = at(0.5, 0.5), panTo = at(0.56, 0.55);
  await page.mouse.move(panFrom.x, panFrom.y);
  await page.mouse.down();
  await page.mouse.move(panTo.x, panTo.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterPan = await page.evaluate(() => current.edits.geometry.xOffset);
  check(Math.abs(afterPan - beforeTransform.x) > 1, 'Move tool drag pans the photo', { before: beforeTransform.x, afterPan });
  const cornerScreen = await page.evaluate(() => {
    const rect = LumaToolRail.canvasDisplayRect();
    const matrix = LumaToolRail.screenFromSourceMatrix({ geometry: current.edits.geometry, optics: current.edits.optics }, rect.width, rect.height);
    const point = matrix.transformPoint(new DOMPoint(0, 0));
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  await page.mouse.move(cornerScreen.x + 1, cornerScreen.y + 1);
  await page.mouse.down();
  await page.mouse.move(cornerScreen.x + box.width * 0.08, cornerScreen.y + box.height * 0.08, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterScale = await page.evaluate(() => current.edits.geometry.scale);
  check(Math.abs(afterScale - beforeTransform.scale) > 2, 'corner drag zooms the photo (scale)', { before: beforeTransform.scale, afterScale });

  // Undo storm unwinds every tool action; redo restores it.
  for (let i = 0; i < 14; i++) await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const undone = await page.evaluate(() => ({ layers: current.edits.masks.layers.length, scale: current.edits.geometry.scale }));
  check(undone.layers === 0 && undone.scale === 100, 'undo storm restores pristine state', undone);
  for (let i = 0; i < 14; i++) await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  const redone = await page.evaluate(() => current.edits.masks.layers.length);
  check(redone === 5, 'redo storm restores all selections', redone);

  // Ctrl+Shift+I inverts, Ctrl+D deselects.
  await page.keyboard.press('Control+Shift+i');
  check(await page.evaluate(() => activeMask()?.invert) === true, 'Ctrl+Shift+I inverts active mask');
  await page.keyboard.press('Control+d');
  check(await page.evaluate(() => current.edits.masks.activeId) === '', 'Ctrl+D deselects');

  // Existing shortcuts still work in edit view: B (brush) and Escape.
  await page.keyboard.press('b');
  const brushState = await page.evaluate(() => ({ tool: toolMode, mask: activeMask()?.type }));
  check(brushState.tool === 'mask-add' && brushState.mask === 'brush', 'B still activates the mask brush', brushState);
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => toolMode) === '', 'Escape clears the tool');

  const report = { failures, errors };
  process.stdout.write(JSON.stringify(report, null, 2));
  await app.close().catch(() => {});
  fixtures.cleanup();
  fs.rmSync(userData, { recursive: true, force: true });
  if (failures.length || errors.length) throw new Error([...failures, ...errors].join('; '));
})().catch(error => { console.error('\n' + (error?.stack || error)); process.exitCode = 2; });
