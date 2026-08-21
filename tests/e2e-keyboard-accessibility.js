const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `keyboard-accessibility-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });

let app;
let fixtures;

async function waitForPreview(page) {
  await page.waitForFunction(() => current && sourceImage.naturalWidth > 0 && !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && canvas.width > 100, null, { timeout: 30000 });
}

(async () => {
  fixtures = await createPhotoFixtures(1);
  const errors = [];
  const failures = [];
  app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-software-rasterizer',
      '--in-process-gpu',
      `--user-data-dir=${userData}`,
      root,
    ],
    cwd: runtimeCwd,
  });
  let page = await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1200));
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  await page.waitForSelector('body', { timeout: 15000 });
  page.on('pageerror', error => errors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`);
  });
  if (await page.locator('#tutorialDialog[open]').count()) await page.click('#tutorialSkip');

  await page.evaluate(filePath => {
    const photo = E.migratePhoto({ id: 'keyboard-photo', filePath, name: 'keyboard-photo.jpg', importedAt: 123456 });
    photos = [photo];
    updateLibrary();
    selectPhoto(photo);
  }, fixtures.paths[0]);
  await waitForPreview(page);

  await page.click('[data-panel="mask"]');
  await page.click('#addMaskMenuBtn');
  await page.click('#addBrushMask');
  await page.waitForFunction(() => document.activeElement === canvas);
  const toolAutoFocused = await page.evaluate(() => document.activeElement === canvas);
  await page.keyboard.press('ArrowRight');
  await waitForPreview(page);
  const objectState = await page.evaluate(() => ({
    enabled: activeMask()?.enabled,
    type: activeMask()?.type,
    x: activeMask()?.x,
    toolMode,
    cursorVisible: !keyboardCanvasCursor.classList.contains('hidden'),
    canvasLabel: canvas.getAttribute('aria-label'),
  }));

  await page.keyboard.press('b');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter');
  const brushState = await page.evaluate(() => ({ count: activeMask().strokes.length, stroke: E.clone(activeMask().strokes.at(-1)), history: historyStacks()[0].at(-1)?.label }));

  await page.click('#addMaskMenuBtn');
  await page.click('#addLinearMask');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  const gradientState = await page.evaluate(() => ({
    type: activeMask().type,
    distance: Math.hypot(activeMask().x2 - activeMask().x, activeMask().y2 - activeMask().y),
    history: historyStacks()[0].at(-1)?.label,
  }));

  const repairStart = await page.evaluate(() => current.edits.cleanup.length);
  await page.click('#cleanupMaskBtn');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Enter');
  await page.click('#cloneMaskBtn');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Enter');
  await page.click('#redEyeMaskBtn');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Enter');
  await waitForPreview(page);
  const repairs = await page.evaluate(start => current.edits.cleanup.slice(start).map(repair => ({ kind: repair.kind, source: [repair.sourceX, repair.sourceY], target: [repair.x, repair.y] })), repairStart);

  await page.click('#pickColorBtn');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Enter');
  const colorState = await page.evaluate(() => ({ mixerColor, toolMode, editVisible: !editPanel.classList.contains('hidden') }));

  await page.evaluate(() => {
    switchRightPanel('edit');
    const panel = document.querySelector('[data-panel-name="Tone Curve"]');
    panel?.classList.remove('collapsed');
    drawCurve();
  });
  await page.locator('#curveCanvas').scrollIntoViewIfNeeded();
  await page.locator('#curveCanvas').focus();
  const curveBefore = await page.evaluate(() => E.clone(current.edits.curve.rgb));
  await page.keyboard.press('Enter');
  const curveAfterAdd = await page.evaluate(() => ({ points: E.clone(current.edits.curve.rgb), label: curveCanvas.getAttribute('aria-label') }));
  await page.keyboard.press('ArrowUp');
  const curveAfterMove = await page.evaluate(() => E.clone(current.edits.curve.rgb));
  await page.keyboard.press('Delete');
  const curveAfterDelete = await page.evaluate(() => E.clone(current.edits.curve.rgb));

  const heldKeyState = await page.evaluate(() => {
    current.edits.curve.rgb = [[0, 0], [128, 128], [255, 255]];
    keyboardCurvePoint = 1;
    const [undo, redo] = historyStacks();
    undo.length = 0;
    redo.length = 0;
    curveCanvas.focus();
    for (let index = 0; index < 80; index += 1) curveCanvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, repeat: index > 0 }));
    curveCanvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
    return { moved: E.clone(current.edits.curve.rgb), history: undo.length, label: undo.at(-1)?.label };
  });
  await page.click('#undoBtn');
  heldKeyState.afterUndo = await page.evaluate(() => E.clone(current.edits.curve.rgb));

  await page.evaluate(() => {
    current.edits.curve.rgb = [[0, 0], [128, 128], [255, 255]];
    keyboardCurvePoint = 1;
    const [undo, redo] = historyStacks();
    undo.length = 0;
    redo.length = 0;
    drawCurve();
  });
  const curveBox = await page.locator('#curveCanvas').boundingBox();
  await page.mouse.move(curveBox.x + curveBox.width * 0.5, curveBox.y + curveBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(curveBox.x + curveBox.width * 0.65, curveBox.y + curveBox.height * 0.35);
  await page.locator('#curveCanvas').dispatchEvent('pointercancel', { pointerId: 1 });
  const pointerCancelState = await page.evaluate(() => ({ afterCancel: E.clone(current.edits.curve.rgb), history: historyStacks()[0].length }));
  await page.mouse.move(curveBox.x + curveBox.width * 0.8, curveBox.y + curveBox.height * 0.2);
  await page.mouse.up();
  pointerCancelState.afterLaterMove = await page.evaluate(() => E.clone(current.edits.curve.rgb));
  await page.click('#undoBtn');
  pointerCancelState.afterUndo = await page.evaluate(() => E.clone(current.edits.curve.rgb));

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(4);
  });
  await page.waitForTimeout(500);
  const zoomState = await page.evaluate(() => {
    const header = document.querySelector('body > header');
    const target = document.querySelector('.right');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    canvas.focus();
    updateKeyboardCanvasCursor();
    const canvasBox = canvas.getBoundingClientRect();
    const cursorBox = keyboardCanvasCursor.getBoundingClientRect();
    target.scrollIntoView({ block: 'start' });
    const box = target.getBoundingClientRect();
    return {
      factor: devicePixelRatio,
      viewport: [innerWidth, innerHeight],
      headerPosition: getComputedStyle(header).position,
      documentScrollable: document.scrollingElement.scrollHeight > innerHeight,
      scrollTop: document.scrollingElement.scrollTop,
      targetIntersectsViewport: box.bottom > 0 && box.top < innerHeight,
      canvasSize: [canvasBox.width, canvasBox.height],
      keyboardCursorVisible: !keyboardCanvasCursor.classList.contains('hidden') && cursorBox.width > 0 && cursorBox.height > 0,
    };
  });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);
  });

  if (!toolAutoFocused || objectState.type !== 'brush' || !objectState.enabled || objectState.toolMode !== 'mask-add' || !objectState.cursorVisible || !/keyboard cursor/i.test(objectState.canvasLabel)) failures.push('Tool focus, keyboard brush selection, or canvas cursor state failed');
  if (brushState.count !== 1 || brushState.stroke?.mode !== 'add' || brushState.history !== 'Add to mask') failures.push('Keyboard mask brush did not create one undoable stroke');
  if (gradientState.type !== 'linear' || gradientState.distance < 0.04 || gradientState.history !== 'Set mask gradient') failures.push('Two-step keyboard gradient creation failed');
  if (repairs.map(repair => repair.kind).join(',') !== 'heal,clone,red-eye' || repairs.some(repair => !repair.target.every(Number.isFinite)) || !repairs[0].source.every(Number.isFinite) || !repairs[1].source.every(Number.isFinite)) failures.push('Keyboard heal, clone, or red-eye records failed');
  if (colorState.toolMode || !colorState.editVisible || !['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'].includes(colorState.mixerColor)) failures.push('Keyboard color sampling failed');
  if (curveBefore.length !== 2 || curveAfterAdd.points.length !== 3 || !/Point 2 of 3/i.test(curveAfterAdd.label) || curveAfterMove[1][1] !== curveAfterAdd.points[1][1] + 1 || curveAfterDelete.length !== 2) failures.push('Keyboard tone-curve add, move, delete, or announcement failed');
  if (heldKeyState.moved[1][1] !== 208 || heldKeyState.history !== 1 || heldKeyState.label !== 'Move curve point' || heldKeyState.afterUndo[1][1] !== 128) failures.push('Held tone-curve movement was not one fully undoable transaction');
  if (pointerCancelState.history !== 1 || JSON.stringify(pointerCancelState.afterLaterMove) !== JSON.stringify(pointerCancelState.afterCancel) || pointerCancelState.afterUndo[1][0] !== 128 || pointerCancelState.afterUndo[1][1] !== 128) failures.push('Canceled tone-curve pointer gesture was not finalized safely');
  if (zoomState.viewport[0] > 760 || zoomState.viewport[1] > 260 || zoomState.headerPosition !== 'static' || !zoomState.documentScrollable || zoomState.scrollTop <= 0 || !zoomState.targetIntersectsViewport || zoomState.canvasSize[0] < 100 || zoomState.canvasSize[1] < 100 || !zoomState.keyboardCursorVisible) failures.push('Application content or editing canvas was not usable at 400% zoom');
  if (errors.length) failures.push('Renderer emitted unexpected errors');

  process.stdout.write(`${JSON.stringify({ toolAutoFocused, objectState, brushState, gradientState, repairs, colorState, curve: { before: curveBefore, added: curveAfterAdd, moved: curveAfterMove, deleted: curveAfterDelete, heldKeyState, pointerCancelState }, zoomState, errors, failures }, null, 2)}\n`);
  await app.close();
  await fixtures.cleanup();
  if (failures.length) throw new Error(failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await app?.close(); } catch {}
  try { await fixtures?.cleanup(); } catch {}
  process.exitCode = 1;
});
