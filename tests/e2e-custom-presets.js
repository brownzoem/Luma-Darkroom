'use strict';

const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-custom-presets-'));
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd);
let app;
let fixtures;

const launchOptions = () => ({
  args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--in-process-gpu', `--user-data-dir=${userData}`, root],
  cwd: runtimeCwd,
  timeout: 30_000
});

async function livePage(runningApp, errors) {
  let page = await runningApp.firstWindow();
  await page.waitForTimeout(700);
  page = runningApp.windows().filter(window => !window.isClosed()).at(-1) || page;
  page.on('pageerror', error => errors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`); });
  await page.waitForSelector('body', { timeout: 15_000 });
  if (await page.locator('#tutorialDialog[open]').count()) await page.click('#tutorialSkip');
  return page;
}

async function waitForPreview(page) {
  await page.waitForFunction(() => current && sourceImage.naturalWidth > 0 && !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && canvas.width > 100, null, { timeout: 30_000 });
}

(async () => {
  fixtures = await createPhotoFixtures(1);
  const errors = [], failures = [];
  app = await electron.launch(launchOptions());
  let page = await livePage(app, errors);
  await page.evaluate(filePath => {
    localStorage.setItem(TUTORIAL_KEY, 'seen');
    const photo = E.migratePhoto({ id: 'custom-preset-photo', filePath, name: 'custom-preset-photo.jpg', importedAt: 1234 });
    photos = [photo];
    updateLibrary();
    selectPhoto(photo);
  }, fixtures.paths[0]);
  await waitForPreview(page);

  await page.evaluate(() => {
    const edits = E.defaultEdits();
    edits.light.exposure = 1.25;
    edits.light.contrast = 37;
    edits.light.highlights = -21;
    edits.color.wb = 'Cloudy';
    edits.color.temperature = 18;
    edits.color.tint = 4;
    edits.color.vibrance = 22;
    edits.geometry.rotate = 13;
    edits.geometry.cropZoom = 142;
    edits.cleanup = [{ kind: 'heal', space: 'source', x: .2, y: .3, sourceX: .25, sourceY: .3, radiusPx: 14, size: 3, feather: 50, opacity: 90 }];
    edits.retouch.size = 11;
    edits.masks = { activeId: 'capture-mask', layers: [E.defaultMaskLayer({ id: 'capture-mask', name: 'Capture mask', type: 'brush', subjectExposure: .6, strokes: [{ x: .5, y: .5, size: 20, feather: 50, flow: 100, mode: 'add' }] })] };
    edits.pointColor = { enabled: true, visualize: true, activeId: 'captured-color', swatches: [{ id: 'captured-color', enabled: true, mode: 'color-v2', hue: 35, saturation: 65, luminance: 52, hueShift: 12, saturationShift: 8, luminanceShift: -4, hueRange: 30, saturationRange: 25, luminanceRange: 25, feather: 50, range: 30, variance: 25 }] };
    current.edits = E.migratedEdits(edits);
    clearPresetTracking();
    refreshControls();
  });
  await page.click('#presetsPanelTab');
  await page.click('#createCustomPreset');
  await page.locator('#customPresetName').evaluate(element => { element.value = '  Studio\u0000   Warm  '; });
  await page.fill('#customPresetGroup', '  Client   Looks  ');
  await page.click('#saveCustomPreset');
  await page.locator('#customPresetDialog').waitFor({ state: 'hidden' });

  const defaultScope = await page.evaluate(() => {
    const preset = customPresets[0], stored = JSON.parse(localStorage.getItem(CUSTOM_PRESET_KEY));
    return {
      count: customPresets.length,
      name: preset.name,
      group: preset.group,
      includePhotoSettings: preset.includePhotoSettings,
      topKeys: Object.keys(preset.patch),
      lightKeys: Object.keys(preset.patch.light || {}),
      colorKeys: Object.keys(preset.patch.color || {}),
      contrast: preset.patch.light?.contrast,
      vibrance: preset.patch.color?.vibrance,
      pointVisualize: preset.patch.pointColor?.visualize,
      storedType: stored.type,
      storedCount: stored.presets.length,
      recoveryRemaining: !!localStorage.getItem(CUSTOM_PRESET_RECOVERY_KEY)
    };
  });

  await page.evaluate(() => {
    const base = E.defaultEdits();
    base.light.exposure = .44;
    base.light.contrast = -9;
    base.color.wb = 'Tungsten';
    base.color.temperature = -35;
    base.color.tint = -2;
    base.geometry.rotate = -9;
    base.geometry.cropZoom = 118;
    base.cleanup = [{ kind: 'clone', space: 'source', x: .7, y: .6, sourceX: .6, sourceY: .6, radiusPx: 9, size: 2, feather: 40, opacity: 80 }];
    base.masks = { activeId: 'base-mask', layers: [E.defaultMaskLayer({ id: 'base-mask', name: 'Base mask', type: 'brush', subjectExposure: -.3, strokes: [{ x: .2, y: .2, size: 10, feather: 50, flow: 100, mode: 'add' }] })] };
    base.pointColor = { enabled: true, visualize: false, activeId: 'base-color', swatches: [{ id: 'base-color', enabled: true, mode: 'color-v2', hue: 210, saturation: 50, luminance: 45, hueShift: -10, saturationShift: 0, luminanceShift: 0, hueRange: 25, saturationRange: 25, luminanceRange: 25, feather: 50, range: 30, variance: 25 }] };
    current.edits = E.migratedEdits(base);
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    clearPresetTracking();
    refreshControls();
  });
  await page.click('#presetGrid .custom-preset .preset');
  const applied = await page.evaluate(() => ({
    exposure: current.edits.light.exposure,
    contrast: current.edits.light.contrast,
    wb: current.edits.color.wb,
    temperature: current.edits.color.temperature,
    tint: current.edits.color.tint,
    rotate: current.edits.geometry.rotate,
    cropZoom: current.edits.geometry.cropZoom,
    cleanupKind: current.edits.cleanup[0]?.kind,
    maskId: current.edits.masks.activeId,
    pointId: current.edits.pointColor.activeId,
    history: historyStacks()[0].length,
    historyLabel: historyStacks()[0].at(-1)?.label
  }));
  await page.click('#undoBtn');
  const undone = await page.evaluate(() => ({ contrast: current.edits.light.contrast, pointId: current.edits.pointColor.activeId, undo: historyStacks()[0].length, redo: historyStacks()[1].length }));

  await page.evaluate(() => {
    const base = E.defaultEdits();
    base.light.contrast = -9;
    base.pointColor = { enabled: true, visualize: false, activeId: 'base-color', swatches: [{ id: 'base-color', enabled: true, mode: 'color-v2', hue: 210, saturation: 50, luminance: 45, hueShift: -10, saturationShift: 0, luminanceShift: 0, hueRange: 25, saturationRange: 25, luminanceRange: 25, feather: 50, range: 30, variance: 25 }] };
    current.edits = E.migratedEdits(base);
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    clearPresetTracking();
    refreshControls();
  });
  await page.click('#presetGrid .custom-preset .preset');
  await page.locator('#presetAmount').evaluate(element => { element.value = '50'; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
  const amount50 = await page.evaluate(() => ({ contrast: current.edits.light.contrast, history: historyStacks()[0].length }));
  await page.locator('#presetAmount').evaluate(element => { element.value = '0'; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
  const amount0 = await page.evaluate(() => ({ contrast: current.edits.light.contrast, pointId: current.edits.pointColor.activeId, history: historyStacks()[0].length }));

  await page.evaluate(() => {
    current.edits.light.exposure = 1.8;
    current.edits.color.wb = 'Daylight';
    current.edits.color.temperature = 8;
    current.edits.color.tint = 3;
    refreshControls();
  });
  await page.click('#createCustomPreset');
  await page.fill('#customPresetName', 'Scoped Look');
  await page.fill('#customPresetGroup', 'User');
  await page.check('#customPresetIncludePhoto');
  await page.click('#saveCustomPreset');
  await page.locator('#customPresetDialog').waitFor({ state: 'hidden' });
  const scoped = await page.evaluate(() => { const preset = customPresets.find(item => item.name === 'Scoped Look'); return { id: preset.id, include: preset.includePhotoSettings, exposure: preset.patch.light.exposure, wb: preset.patch.color.wb, temperature: preset.patch.color.temperature, tint: preset.patch.color.tint }; });

  await page.fill('#presetSearch', 'studio warm');
  const search = await page.evaluate(() => ({ cards: document.querySelectorAll('#presetGrid .preset').length, text: document.querySelector('#presetGrid .preset b')?.textContent }));
  await page.fill('#presetSearch', '');
  await page.click('#presetGroups [data-group="All"]');
  const firstId = await page.evaluate(() => customPresets.find(item => item.name === 'Studio Warm').id);
  await page.click(`[data-rename-preset="${firstId}"]`);
  await page.fill('#customPresetName', 'Renamed Warm');
  await page.click('#saveCustomPreset');
  await page.locator('#customPresetDialog').waitFor({ state: 'hidden' });
  await page.click('#presetGroups [data-group="All"]');
  await page.click(`[data-delete-preset="${scoped.id}"]`);
  await page.click('#confirmDeletePreset');
  await page.locator('#deletePresetDialog').waitFor({ state: 'hidden' });
  const managed = await page.evaluate(() => ({ count: customPresets.length, names: customPresets.map(item => item.name), storageCount: JSON.parse(localStorage.getItem(CUSTOM_PRESET_KEY)).presets.length }));

  const importDefense = await page.evaluate(() => {
    const seed = customPresetRecord(customPresets[0]), valid = { ...seed, id: 'imported-safe', name: 'Imported Safe', group: 'Imports', createdAt: 20, updatedAt: 21 }, invalid = { ...seed, id: 'imported-geometry', name: 'Imported Geometry', group: 'Imports', createdAt: 22, updatedAt: 23, patch: { geometry: { rotate: 45 } } };
    const result = mergeImportedCustomPresets({ app: 'Luma Darkroom', type: 'custom-presets', version: 1, exportedAt: new Date().toISOString(), presets: [valid, invalid] });
    const originalBeforeConflict = customPresetRecord(customPresets.find(item => item.id === seed.id));
    const collision = { ...originalBeforeConflict, name: 'Collision Copy', group: 'Imports', updatedAt: 24, patch: { light: { contrast: 99 } } };
    const conflictResult = mergeImportedCustomPresets({ app: 'Luma Darkroom', type: 'custom-presets', version: 1, exportedAt: new Date().toISOString(), presets: [collision] });
    const originalAfterConflict = customPresets.find(item => item.id === seed.id), importedCopy = customPresets.find(item => item.name === 'Collision Copy');
    const backup = JSON.parse(localStorage.getItem(CUSTOM_PRESET_BACKUP_KEY));
    let blocked = false;
    try { mergeImportedCustomPresets(JSON.parse('{"app":"Luma Darkroom","type":"custom-presets","version":1,"exportedAt":"2026-08-20T12:00:00.000Z","presets":[{"id":"bad","name":"Bad","group":"User","includePhotoSettings":false,"createdAt":1,"updatedAt":1,"patch":{"light":{"__proto__":{"polluted":true}}}}]}')); } catch { blocked = true; }
    const exported = customPresetExportEnvelope();
    return { result, conflictResult, count: customPresets.length, blocked, prototypeClean: {}.polluted === undefined, exportType: exported.type, exportCount: exported.presets.length, forbidden: exported.presets.some(item => ['geometry','cleanup','masks','retouch'].some(key => Object.prototype.hasOwnProperty.call(item.patch, key))), originalName: originalAfterConflict?.name, originalContrast: originalAfterConflict?.patch?.light?.contrast, copyIdChanged: !!importedCopy && importedCopy.id !== seed.id, copyContrast: importedCopy?.patch?.light?.contrast, backupType: backup?.type, backupCount: backup?.presets?.length, backupHasOriginal: backup?.presets?.some(item => item.id === seed.id), backupHasSafe: backup?.presets?.some(item => item.id === 'imported-safe') };
  });

  await app.close();
  app = null;
  app = await electron.launch(launchOptions());
  page = await livePage(app, errors);
  const restart = await page.evaluate(() => ({ names: customPresets.map(item => item.name), count: customPresets.length, recoveryRemaining: !!localStorage.getItem(CUSTOM_PRESET_RECOVERY_KEY), visibleCount: document.querySelectorAll('#presetGrid .custom-preset').length }));

  if (defaultScope.count !== 1 || defaultScope.name !== 'Studio Warm' || defaultScope.group !== 'Client Looks' || defaultScope.includePhotoSettings || ['geometry','cleanup','masks','retouch'].some(key => defaultScope.topKeys.includes(key)) || defaultScope.lightKeys.includes('exposure') || ['wb','temperature','tint'].some(key => defaultScope.colorKeys.includes(key)) || defaultScope.contrast !== 37 || defaultScope.vibrance !== 22 || defaultScope.pointVisualize || defaultScope.storedType !== 'custom-presets-local' || defaultScope.storedCount !== 1 || defaultScope.recoveryRemaining) failures.push('Default custom-preset capture, sanitization, scope, or atomic local save failed');
  if (applied.exposure !== .44 || applied.contrast !== 37 || applied.wb !== 'Tungsten' || applied.temperature !== -35 || applied.tint !== -2 || applied.rotate !== -9 || applied.cropZoom !== 118 || applied.cleanupKind !== 'clone' || applied.maskId !== 'base-mask' || applied.pointId !== 'captured-color' || applied.history !== 1 || applied.historyLabel !== 'Preset: Studio Warm') failures.push('Custom preset did not preserve excluded photo-specific state or create exactly one undo transaction');
  if (undone.contrast !== -9 || undone.pointId !== 'base-color' || undone.undo !== 0 || undone.redo !== 1) failures.push('Custom preset undo did not restore the exact base state');
  if (Math.abs(amount50.contrast - 14) > .001 || amount50.history !== 1 || amount0.contrast !== -9 || amount0.pointId !== 'base-color' || amount0.history !== 1) failures.push('Custom preset amount did not blend from the original base or keep nonnumeric arrays inert at zero');
  if (!scoped.include || scoped.exposure !== 1.8 || scoped.wb !== 'Daylight' || scoped.temperature !== 8 || scoped.tint !== 3) failures.push('Explicit exposure and white-balance capture option failed');
  if (search.cards !== 1 || search.text !== 'Studio Warm') failures.push('Custom preset search failed');
  if (managed.count !== 1 || managed.names.join(',') !== 'Renamed Warm' || managed.storageCount !== 1) failures.push('Custom preset rename/delete or autosave failed');
  if (importDefense.result.added !== 1 || importDefense.result.updated !== 0 || importDefense.result.skipped !== 1 || importDefense.conflictResult.added !== 1 || importDefense.conflictResult.updated !== 0 || importDefense.conflictResult.conflicts !== 1 || importDefense.count !== 3 || !importDefense.blocked || !importDefense.prototypeClean || importDefense.exportType !== 'custom-presets' || importDefense.exportCount !== 3 || importDefense.forbidden || importDefense.originalName !== 'Renamed Warm' || importDefense.originalContrast !== 37 || !importDefense.copyIdChanged || importDefense.copyContrast !== 99 || importDefense.backupType !== 'custom-presets-local' || importDefense.backupCount !== 2 || !importDefense.backupHasOriginal || !importDefense.backupHasSafe) failures.push('Custom preset import/export conflict recovery or defense-in-depth failed');
  if (restart.count !== 3 || !restart.names.includes('Renamed Warm') || !restart.names.includes('Imported Safe') || !restart.names.includes('Collision Copy') || restart.recoveryRemaining || restart.visibleCount !== 3) failures.push('Custom presets failed process-restart persistence');
  if (errors.length) failures.push('Renderer emitted unexpected errors');

  process.stdout.write(`${JSON.stringify({ defaultScope, applied, undone, amount50, amount0, scoped, search, managed, importDefense, restart, errors, failures }, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (app) await app.close().catch(() => {});
  if (fixtures) await fixtures.cleanup().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
});
