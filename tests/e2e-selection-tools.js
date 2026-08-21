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
const mark = label => process.stderr.write('\nSTEP ' + label + '\n');
const check = (condition, message, detail) => {
  if (!condition) failures.push(message + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
};

(async () => {
  const fixtures = await createPhotoFixtures(2);
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

  mark('rail');
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

  mark('lasso');
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

  mark('shift-marquee');
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

  mark('replace-star');
  // Drawing with combine "new" REPLACES the active selection's shape — no new layer.
  await page.evaluate(() => { LumaToolRail.state.marqueeVariant = 'shape'; LumaToolRail.state.marqueeShape = 'star'; LumaToolRail.state.combine = 'new'; LumaToolRail.refresh(); });
  const s0 = at(0.1, 0.6), s1 = at(0.35, 0.9);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  await page.mouse.move(s1.x, s1.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  layers = await layerSummary();
  check(layers.length === 1 && layers[0].regions.length === 1 && layers[0].regions[0]?.shape === 'star', 'new-combine star replaces the active selection', layers);

  mark('add-layer');
  // A second layer only appears through the explicit ＋ action.
  await page.evaluate(() => LumaToolRail.addSelectionLayer());
  await page.waitForTimeout(150);
  layers = await layerSummary();
  check(layers.length === 2 && layers[0].regions.length === 0, '＋ adds a fresh empty selection layer', layers);

  mark('wand');
  // Magic wand shapes the new layer.
  await page.keyboard.press('w');
  const wandPoint = at(0.5, 0.25);
  await page.mouse.click(wandPoint.x, wandPoint.y);
  await page.waitForTimeout(200);
  layers = await layerSummary();
  check(layers.length === 2 && layers[0].regions[0]?.kind === 'wand', 'wand click fills the new layer', layers);

  mark('poly');
  // Polygonal lasso with Enter replaces it again (still 2 layers).
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
  check(layers.length === 2 && layers[0].regions.length === 1 && layers[0].regions[0]?.kind === 'polygon', 'polygonal lasso replaces without adding layers', layers);

  mark('pen');
  // Pen path with Enter close — replaces again.
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
  check(layers.length === 2 && layers[0].regions[0]?.kind === 'bezier', 'pen path closes to bezier region', layers);

  mark('render-check');
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

  mark('transform');
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

  mark('undo');
  // Undo storm unwinds every tool action; redo restores it.
  for (let i = 0; i < 14; i++) await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const undone = await page.evaluate(() => ({ layers: current.edits.masks.layers.length, scale: current.edits.geometry.scale }));
  check(undone.layers === 0 && undone.scale === 100, 'undo storm restores pristine state', undone);
  for (let i = 0; i < 14; i++) await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  const redone = await page.evaluate(() => current.edits.masks.layers.length);
  check(redone === 2, 'redo storm restores both selection layers', redone);

  mark('shortcuts');
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

  mark('panel');
  // --- Photoshop-style layers panel ----------------------------------------
  const panelRows = await page.evaluate(() => ({
    rows: document.querySelectorAll('#maskList .mask-row').length,
    thumbs: document.querySelectorAll('#maskList .mask-thumb img').length,
    types: [...document.querySelectorAll('#maskList .mask-row-type')].map(element => element.textContent)
  }));
  check(panelRows.rows === 3 && panelRows.thumbs === 3 && panelRows.types.length === 3, 'rows show thumbnails and type labels', panelRows);

  mark('rename');
  await page.locator('#maskList .mask-row.active').dblclick();
  await page.fill('#maskName', 'Hero subject');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => activeMask().name) === 'Hero subject', 'double-click rename commits with Enter');

  await page.locator('#maskList .mask-row.active .mask-row-more').click();
  await page.click('#maskDuplicate');
  await page.waitForTimeout(150);
  let panelCount = await page.evaluate(() => current.edits.masks.layers.length);
  check(panelCount === 4, 'row menu duplicates', panelCount);
  await page.locator('#maskList .mask-row.active .mask-row-more').click();
  await page.click('#maskDelete');
  await page.waitForTimeout(150);
  panelCount = await page.evaluate(() => current.edits.masks.layers.length);
  check(panelCount === 3, 'row menu deletes', panelCount);

  mark('reorder');
  const beforeOrder = await page.evaluate(() => current.edits.masks.layers.map(layer => layer.id));
  const rowA = await page.locator('#maskList .mask-row').nth(0).boundingBox();
  const rowB = await page.locator('#maskList .mask-row').nth(1).boundingBox();
  await page.mouse.move(rowA.x + rowA.width * 0.6, rowA.y + rowA.height / 2);
  await page.mouse.down();
  await page.mouse.move(rowB.x + rowB.width * 0.6, rowB.y + rowB.height * 0.95, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterOrder = await page.evaluate(() => current.edits.masks.layers.map(layer => layer.id));
  check(afterOrder[0] === beforeOrder[1] && afterOrder[1] === beforeOrder[0], 'drag reorders the mask stack', { beforeOrder, afterOrder });

  mark('thumb-mods');
  await page.locator('#maskList .mask-row.active .mask-thumb').click({ modifiers: ['Shift'] });
  await page.waitForTimeout(200);
  check(await page.evaluate(() => activeMask().enabled) === false, 'Shift+click thumbnail disables the mask');
  await page.locator('#maskList .mask-row.active .mask-thumb').click({ modifiers: ['Shift'] });
  await page.waitForTimeout(200);
  await page.locator('#maskList .mask-row.active .mask-thumb').click({ modifiers: ['Alt'] });
  await page.waitForFunction(() => !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && canvas.dataset.previewQuality === 'full', null, { timeout: 20000 });
  const maskViewState = await page.evaluate(() => {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const data = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return { viewing: !!maskViewLayerId, gray: data[0] === data[1] && data[1] === data[2] };
  });
  check(maskViewState.viewing && maskViewState.gray, 'Alt+click thumbnail shows grayscale mask view', maskViewState);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check(await page.evaluate(() => maskViewLayerId) === '', 'Escape exits mask view');

  // --- Review-pass refinements ----------------------------------------------
  mark('review-pass');
  await page.evaluate(() => commit('Reset all', () => { current.edits = E.defaultEdits(); }));
  await page.waitForTimeout(200);

  // Neutral white-balance eyedropper solves temperature/tint from a click.
  await page.evaluate(() => commit('Warm cast', () => { current.edits.color.temperature = 40; current.edits.color.tint = -25; }));
  await page.evaluate(() => setTool('wb-pick', { force: true }));
  const wbPoint = at(0.5, 0.5);
  await page.mouse.click(wbPoint.x, wbPoint.y);
  await page.waitForTimeout(400);
  const wbResult = await page.evaluate(() => ({ tool: toolMode, temperature: current.edits.color.temperature, tint: current.edits.color.tint }));
  check(wbResult.tool === '' && (wbResult.temperature !== 40 || wbResult.tint !== -25) && Math.abs(wbResult.temperature) <= 100 && Math.abs(wbResult.tint) <= 100, 'neutral WB pick adjusts temperature/tint and exits the tool', wbResult);

  // Double-click a slider resets just that control (sliders live on the Edit tab).
  await page.click('#editPanelTab');
  const contrast = page.locator('[data-path="light.contrast"]');
  await contrast.dispatchEvent('pointerdown');
  await contrast.fill('55');
  await contrast.dispatchEvent('change');
  await page.waitForTimeout(150);
  await contrast.dblclick();
  await page.waitForTimeout(150);
  check(await page.evaluate(() => current.edits.light.contrast) === 0, 'double-click resets a single slider');

  // Ctrl+wheel zooms about the cursor.
  const zoomPoint = at(0.5, 0.5);
  await page.mouse.move(zoomPoint.x, zoomPoint.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(500);
  const wheelZoom = await page.evaluate(() => +document.querySelector('#zoomRange').value);
  check(wheelZoom > 100, 'Ctrl+wheel zooms in', wheelZoom);
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(300);

  // Copy develop settings; paste onto the second photo (crop/masks stay per-photo).
  await page.evaluate(() => commit('Look', () => { current.edits.light.exposure = 1.11; current.edits.color.vibrance = 33; }));
  await page.keyboard.press('Control+Shift+c');
  // Arrows adjust a focused slider/canvas by design; blur whatever holds focus to navigate.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => current?.id === 'sel-1', null, { timeout: 15000 });
  await page.keyboard.press('Control+Shift+v');
  await page.waitForTimeout(300);
  const pasted = await page.evaluate(() => ({ id: current.id, exposure: current.edits.light.exposure, vibrance: current.edits.color.vibrance, layers: current.edits.masks.layers.length, cropR: current.edits.geometry.cropR }));
  check(pasted.id === 'sel-1' && pasted.exposure === 1.11 && pasted.vibrance === 33 && pasted.layers === 0 && pasted.cropR === 1, 'Ctrl+Shift+C/V pastes the look, not the crop or masks', pasted);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => current?.id === 'sel-0', null, { timeout: 15000 });

  const report = { failures, errors };
  process.stdout.write(JSON.stringify(report, null, 2));
  await app.close().catch(() => {});
  fixtures.cleanup();
  fs.rmSync(userData, { recursive: true, force: true });
  if (failures.length || errors.length) throw new Error([...failures, ...errors].join('; '));
})().catch(error => { console.error('\n' + (error?.stack || error)); process.exitCode = 2; });
