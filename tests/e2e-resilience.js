const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `qa-user-data-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
const shots = path.join(root, 'work', 'debug-shots');
fs.mkdirSync(runtimeCwd, { recursive: true });
fs.mkdirSync(shots, { recursive: true });
let fixtures;
let sample;
const launchArgs = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-software-rasterizer',
  '--in-process-gpu',
  `--user-data-dir=${userData}`,
  root
];
let runningApp = null;

async function livePage(app) {
  let page = await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1200));
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  await page.waitForSelector('body', { timeout: 15000 });
  return page;
}

(async () => {
  fixtures = await createPhotoFixtures(1);
  [sample] = fixtures.paths;
  const errors = [];
  const results = {};
  const app = await electron.launch({ args: launchArgs, cwd: runtimeCwd });
  runningApp = app;
  const page = await livePage(app);
  page.on('pageerror', error => errors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('[Luma] Load photo') && !message.text().includes('status of 404')) {
      errors.push(`CONSOLE: ${message.text()}`);
    }
  });

  // Fresh-profile onboarding should remain inside the viewport and persist dismissal.
  await page.locator('#tutorialDialog[open]').waitFor({ timeout: 5000 });
  results.tutorial = await page.evaluate(() => {
    const dialog = tutorialDialog.getBoundingClientRect();
    const target = document.querySelector('.tutorial-target');
    return {
      step: tutorialStepLabel.textContent,
      inViewport: dialog.left >= 0 && dialog.top >= 0 && dialog.right <= innerWidth && dialog.bottom <= innerHeight,
      target: target?.id || target?.className || ''
    };
  });
  await page.screenshot({ path: path.join(shots, '00-first-run.png') });
  for (let index = 0; index < 5; index++) {
    await page.click('#tutorialNext');
    if (index === 1) {
      results.emptyLibrary = await page.evaluate(() => ({
        view,
        emptyVisible: !document.querySelector('#empty').classList.contains('hidden'),
        libraryHidden: document.querySelector('#library').classList.contains('hidden')
      }));
    }
  }
  await page.click('#tutorialNext');
  results.tutorial.persisted = await page.evaluate(() => localStorage.getItem('luma-first-run-tutorial-v1'));

  await page.evaluate(filePath => {
    photos = Array.from({ length: 12 }, (_item, index) => E.migratePhoto({
      id: `qa-${index}`,
      filePath,
      name: `qa-${index}.jpg`,
      importedAt: Date.now() - index,
      edits: null
    }));
    catalogDirty = false;
    updateLibrary();
    selectPhoto(photos[0]);
  }, sample);
  await page.waitForFunction(() => canvas.width > 500, null, { timeout: 30000 });

  // Library actions must expose one unambiguous active target while selections remain batch targets.
  await page.keyboard.press('g');
  await page.locator('.card').nth(1).focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => current?.id === 'qa-1' && view === 'library');
  results.targeting = await page.evaluate(() => ({
    activeId: current.id,
    currentCards: grid.querySelectorAll('.card.current').length,
    currentName: grid.querySelector('.card.current .caption')?.textContent,
    targetCopy: libraryTarget.textContent,
    exportName: exportBtn.getAttribute('aria-label'),
    initialDisabled: { export: exportBtn.disabled, sync: batchBtn.disabled, merge: mergeBtn.disabled, compare: compareSelectedBtn.disabled, preset: batchPresetBtn.disabled }
  }));
  await page.locator('.card .select-box').nth(0).click();
  await page.locator('.card .select-box').nth(2).click();
  Object.assign(results.targeting, await page.evaluate(() => ({
    sourceAfterSelection: current.id,
    selected: photos.filter(photo => photo.selected).map(photo => photo.id),
    syncTitle: batchBtn.title,
    selectedDisabled: { sync: batchBtn.disabled, merge: mergeBtn.disabled, compare: compareSelectedBtn.disabled, preset: batchPresetBtn.disabled }
  })));

  // Sync and batch presets must enter history as one transaction and undo every target together.
  results.bulkSync = await page.evaluate(() => {
    current.edits.light.exposure = 0.77;
    photos[0].edits.light.exposure = -1.25;
    photos[2].edits.light.exposure = 1.25;
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    const before = [photos[0].edits.light.exposure, photos[2].edits.light.exposure];
    syncSelected();
    return { before, after: [photos[0].edits.light.exposure, photos[2].edits.light.exposure], history: undoByPhoto.get(current.id)?.length || 0 };
  });
  await page.click('#undoBtn');
  results.bulkSync.undo = await page.evaluate(() => [photos[0].edits.light.exposure, photos[2].edits.light.exposure]);
  await page.click('#redoBtn');
  results.bulkSync.redo = await page.evaluate(() => [photos[0].edits.light.exposure, photos[2].edits.light.exposure]);
  results.bulkPreset = await page.evaluate(() => {
    photos[0].edits.light.contrast = -22;
    photos[2].edits.light.contrast = 41;
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    batchPresetMode = true;
    const before = [photos[0].edits.light.contrast, photos[2].edits.light.contrast];
    applyPreset(presets[0], 100);
    return { before, after: [photos[0].edits.light.contrast, photos[2].edits.light.contrast], history: undoByPhoto.get(current.id)?.length || 0 };
  });
  await page.click('#undoBtn');
  results.bulkPreset.undo = await page.evaluate(() => [photos[0].edits.light.contrast, photos[2].edits.light.contrast]);

  await page.evaluate(() => {
    photos.forEach(photo => { photo.selected = false; });
    selectPhoto(photos[0]);
    updateLibrary();
  });
  await page.waitForFunction(() => current?.id === 'qa-0' && canvas.width > 500, null, { timeout: 30000 });

  // Generated controls, dialogs, cards, filmstrip, and press/hold comparison need programmatic names/state.
  results.accessibility = await page.evaluate(() => ({
    unnamedControls: [...document.querySelectorAll('input,select,textarea')].filter(element => !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).map(element => element.id || element.outerHTML.slice(0, 60)),
    unnamedDialogs: [...document.querySelectorAll('dialog')].filter(dialog => !dialog.getAttribute('aria-label') && !dialog.getAttribute('aria-labelledby')).map(dialog => dialog.id),
    cardsOperable: [...document.querySelectorAll('.card')].every(card => card.tabIndex === 0 && card.getAttribute('role') === 'button'),
    filmstripOperable: [...document.querySelectorAll('.filmstrip-item')].every(item => item.tagName === 'BUTTON' && !!item.getAttribute('aria-label')),
    panelTabs: [...document.querySelectorAll('.panel-tabs [role="tab"]')].every(tab => tab.hasAttribute('aria-selected')),
    rangeOutputs: [...document.querySelectorAll('input[type="range"][id]')].every(input => !!document.querySelector(`output[for="${input.id}"]`) || input.id === 'zoomRange')
  }));
  await page.locator('#compareBtn').focus();
  await page.keyboard.down('Space');
  results.beforeHold = { down: await page.evaluate(() => ({ compare, pressed: compareBtn.getAttribute('aria-pressed') })) };
  await page.keyboard.up('Space');
  results.beforeHold.up = await page.evaluate(() => ({ compare, pressed: compareBtn.getAttribute('aria-pressed') }));

  // Quota failures must keep the in-memory catalog available and explain recovery.
  results.quotaFailure = await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    const originalConsoleError = console.error;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === CATALOG_KEY || key === RECOVERY_KEY) throw new DOMException('Simulated quota', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    };
    console.error = () => {};
    catalogDirty = true;
    lastSaveErrorAt = 0;
    lastErrorToastAt = 0;
    let saved;
    try {
      saved = saveCatalog();
    }
    finally {
      Storage.prototype.setItem = originalSetItem;
      console.error = originalConsoleError;
    }
    const message = document.querySelector('#toast').textContent;
    const dirtyAfterFailure = catalogDirty;
    dismissToast();
    catalogDirty = false;
    return { saved, dirtyAfterFailure, message, photos: photos.length, toastPointerEvents: getComputedStyle(document.querySelector('#toast')).pointerEvents };
  });

  // Range edits made entirely from the keyboard must enter undo history.
  const exposure = page.locator('[data-path="light.exposure"]');
  await exposure.focus();
  const keyboardBefore = Number(await exposure.inputValue());
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const keyboardValue = Number(await exposure.inputValue());
  await page.keyboard.press('Control+z');
  results.keyboardUndo = {
    before: keyboardBefore,
    edited: keyboardValue,
    undone: Number(await exposure.inputValue()),
    undoDisabled: await page.locator('#undoBtn').isDisabled()
  };

  results.presetManualEdit = await page.evaluate(() => {
    applyPreset(presets[0], 100);
    commit('Manual preset follow-up', () => { current.edits.light.exposure = 0.5; });
    const beforeAmountMove = current.edits.light.exposure;
    document.querySelector('#presetAmount').value = '50';
    document.querySelector('#presetAmount').dispatchEvent(new Event('input', { bubbles: true }));
    return { trackingCleared: activePreset === null && presetBase === null, beforeAmountMove, afterAmountMove: current.edits.light.exposure };
  });

  // Activating Focus changes edit state and therefore must autosave and be undoable.
  await page.evaluate(() => {
    catalogDirty = false;
    current.edits.mask.enabled = false;
    current.edits.mask.type = 'subject';
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    toolMode = '';
    refreshControls();
  });
  await page.click('#focusModeBtn');
  results.focusActivation = await page.evaluate(() => ({
    enabled: current.edits.mask.enabled,
    dirty: catalogDirty,
    undoEntries: undoByPhoto.get(current.id)?.length || 0,
    toolMode
  }));

  // Native constraints must reject invalid export values before opening a save dialog.
  await page.click('#exportBtn');
  await page.selectOption('#exportFormat', 'original');
  results.originalExport = await page.evaluate(() => ({
    target: exportTarget.textContent,
    disabled: [exportQuality.disabled, exportSize.disabled, exportWatermark.disabled],
    note: exportFormatNote.textContent,
    noteVisible: !exportFormatNote.classList.contains('hidden')
  }));
  await page.selectOption('#exportFormat', 'jpg');
  await page.fill('#exportSize', '-1');
  await page.click('#doExport');
  results.exportValidation = await page.evaluate(() => ({ open: exportDialog.open, invalid: exportSize.matches(':invalid') }));
  await page.fill('#exportSize', '0');
  await page.keyboard.press('Escape');

  // Restore preview must disclose the incoming/current counts without mutating either catalog.
  results.restorePreview = await page.evaluate(async () => {
    const before = photos.length;
    const promise = confirmCatalogRestore({ photos: [photos[0], photos[1]], skipped: 3 });
    const summary = restoreConfirmSummary.textContent;
    setTimeout(() => restoreConfirmDialog.close('cancel'), 0);
    const accepted = await promise;
    return { before, after: photos.length, accepted, summary };
  });

  // Editing/culling shortcuts must not fire while a modal dialog owns input.
  await page.click('#exportBtn');
  await page.keyboard.press('p');
  await page.keyboard.press('F1');
  results.modalShortcuts = await page.evaluate(() => ({
    exportOpen: exportDialog.open,
    helpOpen: helpDialog.open,
    flag: current.flag
  }));
  await page.keyboard.press('Escape');

  // Leaving Develop should not leave a destructive click tool armed.
  if ((await page.evaluate(() => toolMode)) !== 'cleanup') await page.click('#cleanupModeBtn');
  await page.keyboard.press('g');
  results.toolExit = await page.evaluate(() => ({ view, toolMode }));

  // Rapid keyboard culling should settle on the requested image without stale renders.
  await page.keyboard.press('d');
  for (let index = 0; index < 9; index++) await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => current?.id === 'qa-9' && canvas.width > 500, null, { timeout: 30000 });
  results.rapidNavigation = await page.evaluate(() => ({ id: current.id, prefetch: prefetchCache.size, canvas: [canvas.width, canvas.height] }));

  // A missing original should recover to Library with an actionable message.
  await page.evaluate(() => {
    const missing = E.migratePhoto({ id: 'qa-missing', filePath: 'C:\\definitely-missing\\photo.jpg', name: 'missing-photo.jpg' });
    photos.push(missing);
    selectPhoto(missing);
  });
  await page.waitForFunction(() => view === 'library' && document.querySelector('#toast')?.textContent.includes('Could not open'), null, { timeout: 10000 });
  results.missingFile = await page.evaluate(() => ({ view, toast: document.querySelector('#toast').textContent, canvas: [canvas.width, canvas.height] }));

  // Recovery records newer than the main catalog should win on reload.
  await page.evaluate(filePath => {
    const make = (id, rating, generation) => {
      const list = [{ id, filePath, name: `${id}.jpg`, rating, edits: null }];
      return JSON.stringify({ app: 'Luma Darkroom', version: 2, savedAt: generation, generation, checksum: checksum(JSON.stringify(list)), photos: list });
    };
    localStorage.removeItem('luma-catalog-v2-last-good');
    localStorage.setItem('luma-catalog-v2', make('old', 1, 100));
    localStorage.setItem('luma-catalog-v2-recovery', make('recovered', 5, 200));
    clearTimeout(saveTimer);
    saveTimer = null;
    catalogDirty = false;
  }, sample);
  await page.reload({ waitUntil: 'load' });
  try {
    await page.waitForFunction(() => current?.id === 'recovered' && canvas.width > 500, null, { timeout: 30000 });
  }
  catch (error) {
    const state = await page.evaluate(() => ({ current: current?.id, photos: photos.map(photo => photo.id), view, canvas: [canvas.width, canvas.height], source: [sourceImage.complete, sourceImage.naturalWidth, sourceImage.naturalHeight], toast: document.querySelector('#toast')?.textContent, catalogDirty }));
    throw new Error(`Crash recovery did not render: ${JSON.stringify(state)}; ${error.message}`);
  }
  results.crashRecovery = await page.evaluate(() => ({ id: current.id, rating: current.rating, recoveryRemaining: !!localStorage.getItem('luma-catalog-v2-recovery') }));

  // Corrupt settings and extremely small images must be contained by migration/analysis.
  results.corruptSettings = await page.evaluate(() => {
    const edits = E.migratedEdits({ mask: { enabled: true, size: -9999, feather: 9999, backgroundBlur: 100 } });
    return { size: edits.mask.size, feather: edits.mask.feather };
  });
  results.rotationCycle = await page.evaluate(() => {
    let edits = E.defaultEdits();
    const values = [];
    for (let index = 0; index < 12; index++) {
      edits.geometry.rotation90 += 90;
      edits = E.migratedEdits(edits);
      values.push(edits.geometry.rotation90);
    }
    return { values, final: edits.geometry.rotation90, unique: new Set(values).size };
  });
  results.tinyAnalysis = await page.evaluate(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await image.decode();
    const quality = await E.analyze(image);
    return { quality, finite: Object.values(quality).filter(value => typeof value === 'number').every(Number.isFinite) };
  });

  // Detail radius/detail and the lens-correction switch must have observable output.
  results.controlEffects = await page.evaluate(() => {
    const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const difference = (a, b) => {
      let total = 0;
      for (let index = 0; index < a.length; index += 4) total += Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]);
      return total;
    };
    const sharp = E.defaultEdits();
    sharp.detail.sharpening = 100;
    sharp.detail.radius = 1;
    sharp.detail.sharpenDetail = 25;
    const base = pixels(E.render(sourceImage, sharp, { maxEdge: 96 }));
    sharp.detail.radius = 3;
    const radius = difference(base, pixels(E.render(sourceImage, sharp, { maxEdge: 96 })));
    sharp.detail.radius = 1;
    sharp.detail.sharpenDetail = 100;
    const detail = difference(base, pixels(E.render(sourceImage, sharp, { maxEdge: 96 })));
    const lens = E.defaultEdits();
    lens.optics.distortion = 100;
    const disabled = pixels(E.render(sourceImage, lens, { maxEdge: 96 }));
    lens.optics.lensCorrections = true;
    const enabled = difference(disabled, pixels(E.render(sourceImage, lens, { maxEdge: 96 })));
    return { radius, detail, lensSwitch: enabled };
  });

  // CSS-device-width emulation approximates high OS zoom and must reflow without horizontal clipping.
  const cdp = await page.context().newCDPSession(page);
  results.responsive = [];
  for (const width of [780, 450, 320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: 900 });
    await page.waitForTimeout(100);
    results.responsive.push(await page.evaluate(() => {
      const workspaceBox = document.querySelector('.workspace').getBoundingClientRect();
      const leftBox = document.querySelector('.left').getBoundingClientRect();
      const clippedFocusable = [...document.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.left < -2 || box.right > innerWidth + 2);
      }).map(element => element.id || element.getAttribute('aria-label') || element.textContent.trim().slice(0, 40));
      return {
        width: innerWidth,
        mainDisplay: getComputedStyle(document.querySelector('main')).display,
        workspaceBeforeSidebar: workspaceBox.top < leftBox.top,
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        dialogMaxHeight: getComputedStyle(document.querySelector('#exportDialog')).maxHeight,
        clippedFocusable
      };
    }));
    await page.screenshot({ path: path.join(shots, `05-responsive-${width}.png`), fullPage: false });
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.waitForTimeout(100);

  // Exercise catalog-scale DOM work to expose unbounded thumbnail rendering.
  results.catalogScale = await page.evaluate(filePath => {
    photos = Array.from({ length: 5000 }, (_item, index) => E.migratePhoto({ id: `bulk-${index}`, filePath, name: `bulk-${index}.jpg`, importedAt: index }));
    current = photos[2500];
    const started = performance.now();
    renderFilmstrip();
    const filmstripMilliseconds = Math.round(performance.now() - started);
    const libraryStarted = performance.now();
    setView('library');
    return {
      filmstripMilliseconds,
      filmstripNodes: filmstrip.querySelectorAll('.thumb').length,
      libraryMilliseconds: Math.round(performance.now() - libraryStarted),
      libraryNodes: grid.querySelectorAll('.card').length,
      moreVisible: !libraryMore.classList.contains('hidden')
    };
  }, sample);
  await page.click('#loadMoreBtn');
  results.catalogScale.afterLoadMore = await page.locator('.card').count();
  await page.locator('#libraryMore').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, '06-large-library.png') });

  const failures = [];
  if (!results.tutorial.inViewport || results.tutorial.persisted !== 'complete') failures.push('Tutorial placement or persistence failed');
  if (results.emptyLibrary.view !== 'library' || !results.emptyLibrary.emptyVisible || !results.emptyLibrary.libraryHidden) failures.push('Empty Library state is inconsistent');
  if (results.quotaFailure.saved !== false || !results.quotaFailure.dirtyAfterFailure || results.quotaFailure.photos !== 12 || !results.quotaFailure.message.includes('storage is full') || results.quotaFailure.toastPointerEvents !== 'none') failures.push('Quota failure recovery failed');
  if (results.targeting.activeId !== 'qa-1' || results.targeting.currentCards !== 1 || !results.targeting.currentName.includes('qa-1') || !results.targeting.targetCopy.includes('qa-1') || !results.targeting.exportName.includes('qa-1') || results.targeting.initialDisabled.export || !results.targeting.initialDisabled.sync || !results.targeting.initialDisabled.merge || !results.targeting.initialDisabled.compare || !results.targeting.initialDisabled.preset || results.targeting.sourceAfterSelection !== 'qa-1' || results.targeting.selected.join(',') !== 'qa-0,qa-2' || results.targeting.selectedDisabled.sync || results.targeting.selectedDisabled.merge || results.targeting.selectedDisabled.compare || results.targeting.selectedDisabled.preset || !results.targeting.syncTitle.includes('qa-1')) failures.push('Active/selected target state is ambiguous or unsafe');
  if (results.bulkSync.history !== 1 || results.bulkSync.after.some(value => value !== 0.77) || results.bulkSync.undo.join(',') !== results.bulkSync.before.join(',') || results.bulkSync.redo.some(value => value !== 0.77)) failures.push('Batch sync is not one reversible transaction');
  if (results.bulkPreset.history !== 1 || results.bulkPreset.after.some(value => value !== 8) || results.bulkPreset.undo.join(',') !== results.bulkPreset.before.join(',')) failures.push('Batch preset is not one reversible transaction');
  if (results.accessibility.unnamedControls.length || results.accessibility.unnamedDialogs.length || !results.accessibility.cardsOperable || !results.accessibility.filmstripOperable || !results.accessibility.panelTabs || !results.accessibility.rangeOutputs) failures.push('Accessibility naming or keyboard semantics failed');
  if (!results.beforeHold.down.compare || results.beforeHold.down.pressed !== 'true' || results.beforeHold.up.compare || results.beforeHold.up.pressed !== 'false') failures.push('Before press/hold state failed');
  if (results.keyboardUndo.edited === results.keyboardUndo.before || results.keyboardUndo.undone !== results.keyboardUndo.before || !results.keyboardUndo.undoDisabled) failures.push('Keyboard range undo failed');
  if (!results.presetManualEdit.trackingCleared || results.presetManualEdit.beforeAmountMove !== results.presetManualEdit.afterAmountMove) failures.push('Preset amount overwrote a later manual edit');
  if (!results.focusActivation.enabled || !results.focusActivation.dirty || results.focusActivation.undoEntries !== 1) failures.push('Focus activation was not persisted as one undoable edit');
  if (!results.exportValidation.open || !results.exportValidation.invalid) failures.push('Export validation did not contain invalid input');
  if (!results.originalExport.target.includes('qa-0') || results.originalExport.disabled.some(value => !value) || !results.originalExport.noteVisible || !results.originalExport.note.includes('unchanged')) failures.push('Original export left irrelevant controls enabled');
  if (!results.modalShortcuts.exportOpen || results.modalShortcuts.helpOpen || results.modalShortcuts.flag !== 'none') failures.push('Modal shortcut containment failed');
  if (results.restorePreview.before !== results.restorePreview.after || results.restorePreview.accepted || !results.restorePreview.summary.includes('Incoming catalog: 2') || !results.restorePreview.summary.includes('Current catalog: 12') || !results.restorePreview.summary.includes('3 invalid')) failures.push('Restore preview did not disclose or preserve state');
  if (results.toolExit.view !== 'library' || results.toolExit.toolMode) failures.push('Library retained an armed edit tool');
  if (results.rapidNavigation.id !== 'qa-9' || results.rapidNavigation.prefetch > 4 || results.rapidNavigation.canvas[0] < 500) failures.push('Rapid navigation or prefetch bound failed');
  if (results.missingFile.view !== 'library' || results.missingFile.canvas[0] !== 1) failures.push('Missing-file recovery failed');
  if (results.crashRecovery.id !== 'recovered' || results.crashRecovery.rating !== 5 || results.crashRecovery.recoveryRemaining) failures.push('Crash recovery selection failed');
  if (results.corruptSettings.size !== 5 || results.corruptSettings.feather !== 100 || !results.tinyAnalysis.finite || results.rotationCycle.final !== 0 || results.rotationCycle.unique !== 4) failures.push('Corrupt/tiny input or rotation containment failed');
  if (Object.values(results.controlEffects).some(value => value <= 0)) failures.push('A tested adjustment has no rendered effect');
  if (results.responsive.some(state => state.mainDisplay !== 'flex' || !state.workspaceBeforeSidebar || state.horizontalOverflow > 2 || state.dialogMaxHeight === 'none' || state.clippedFocusable.length)) failures.push('High-zoom responsive reflow failed');
  if (results.catalogScale.filmstripNodes > 201 || results.catalogScale.libraryNodes > 400 || !results.catalogScale.moreVisible || results.catalogScale.afterLoadMore !== 800) failures.push('Catalog rendering bounds failed');
  if (errors.length) failures.push('Renderer emitted unexpected errors');
  results.failures = failures;
  results.errors = errors;
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  await app.close();
  await fixtures.cleanup();
  if (failures.length) throw new Error(failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await runningApp?.close(); } catch {}
  await fixtures?.cleanup();
  process.exitCode = 1;
});
