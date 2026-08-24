const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `precision-controls-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closeEnough(actual, expected, tolerance = 1e-6) {
  return Math.abs(actual - expected) <= tolerance;
}

async function clearHistoryAndSetExposure(page, value) {
  await page.evaluate(next => {
    current.edits.light.exposure = next;
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    refreshControls();
  }, value);
}

async function editNumber(locator, value, finish = 'Enter') {
  await locator.click();
  await locator.fill(value);
  await locator.press(finish);
}

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function middleDrag(page, locator, dx, { shift = false, escape = false } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box, 'Precision scrub target has no layout box');
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 4 });
  if (escape) await page.keyboard.press('Escape');
  await page.mouse.up({ button: 'middle' });
  if (shift) await page.keyboard.up('Shift');
}

(async () => {
  let app;
  let fixtures;
  const errors = [];
  try {
    await fs.mkdir(runtimeCwd, { recursive: true });
    fixtures = await createPhotoFixtures(1);
    app = await electron.launch({
      args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--in-process-gpu', `--user-data-dir=${userData}`, root],
      cwd: runtimeCwd
    });
    let page = await app.firstWindow();
    await page.waitForTimeout(900);
    page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
    page.on('pageerror', error => errors.push(`PAGE: ${error.stack || error}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`); });
    await page.waitForSelector('body', { timeout: 15_000 });
    await page.locator('#tutorialDialog[open]').waitFor({ state: 'visible', timeout: 5_000 });
    await page.click('#tutorialSkip');
    await page.evaluate(filePath => {
      const record = { id: 'precision-photo', filePath, name: 'precision.jpg', importedAt: Date.now(), rating: 0, flag: 'none', label: '', tags: [], caption: '', edits: null };
      photos = [E.migratePhoto(record)];
      updateLibrary();
      selectPhoto(photos[0]);
    }, fixtures.paths[0]);
    await page.waitForFunction(() => document.querySelector('#canvas')?.width > 500, null, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll('input[type="range"]').length === document.querySelectorAll('.range-number').length);

    const inventory = await page.evaluate(() => {
      const ranges = [...document.querySelectorAll('input[type="range"]')];
      const numbers = [...document.querySelectorAll('.range-number')];
      return {
        rangeCount: ranges.length,
        numberCount: numbers.length,
        uniqueIds: new Set(numbers.map(input => input.id)).size,
        invalid: ranges.filter(range => {
          const number = numbers.find(input => input.dataset.numberFor === range.id);
          const expectedStep = range.dataset.path ? String(Math.min(Number(range.step || 1), 0.01)) : range.step || '1';
          return !number || number.min !== range.min || number.max !== range.max || number.step !== expectedStep || !number.getAttribute('aria-label');
        }).map(range => range.id)
      };
    });
    assert(inventory.rangeCount > 50, `Expected the full slider inventory, found ${inventory.rangeCount}`);
    assert(inventory.rangeCount === inventory.numberCount, `Range/number mismatch: ${JSON.stringify(inventory)}`);
    assert(inventory.uniqueIds === inventory.numberCount, 'Precision value fields do not have unique IDs');
    assert(!inventory.invalid.length, `Invalid precision companions: ${inventory.invalid.join(', ')}`);

    const exposureRange = page.locator('[data-path="light.exposure"]');
    const exposureNumber = page.locator('[data-number-for="control-light-exposure"]');
    const canvasBefore = await page.locator('#canvas').boundingBox();

    let state = await page.evaluate(() => {
      current.edits.color.temperature = 12.3456;
      current.edits.geometry.xOffset = 4.754321;
      refreshControls();
      return {
        temperature: current.edits.color.temperature,
        xOffset: current.edits.geometry.xOffset,
        temperatureNumber: document.querySelector('[data-number-for="control-color-temperature"]').value,
        xOffsetNumber: document.querySelector('[data-number-for="control-geometry-xoffset"]').value
      };
    });
    assert(closeEnough(state.temperature, 12.3456) && closeEnough(state.xOffset, 4.754321), `Refreshing rounded precise model values: ${JSON.stringify(state)}`);
    assert(state.temperatureNumber === '12.3456' && state.xOffsetNumber === '4.7543', `Precise model values were not represented accurately: ${JSON.stringify(state)}`);
    const temperatureNumber = page.locator('[data-number-for="control-color-temperature"]');
    await temperatureNumber.focus();
    await temperatureNumber.press('Tab');
    assert(closeEnough(await page.evaluate(() => current.edits.color.temperature), 12.3456), 'Focusing and blurring a precise value rounded the edit');

    await clearHistoryAndSetExposure(page, 0);
    await editNumber(exposureNumber, '1.23');
    state = await page.evaluate(() => ({
      value: current.edits.light.exposure,
      range: document.querySelector('[data-path="light.exposure"]').value,
      number: document.querySelector('[data-number-for="control-light-exposure"]').value,
      output: document.querySelector('[data-out="light.exposure"]').value,
      undo: undoByPhoto.get(current.id)?.length || 0
    }));
    assert(closeEnough(state.value, 1.23) && state.range === '1.23' && state.number === '1.23', `Exact decimal entry failed: ${JSON.stringify(state)}`);
    assert(state.undo === 1, `Exact entry created ${state.undo} undo items instead of one`);
    await page.click('#undoBtn');
    assert(closeEnough(await page.evaluate(() => current.edits.light.exposure), 0), 'Undo did not restore exact slider value');
    assert(await exposureNumber.inputValue() === '0.00', 'Undo did not synchronize the numeric field');
    await page.click('#redoBtn');
    assert(closeEnough(await page.evaluate(() => current.edits.light.exposure), 1.23), 'Redo did not restore exact slider value');

    const contrastNumber = page.locator('[data-number-for="control-light-contrast"]');
    await page.evaluate(() => {
      current.edits.light.contrast = 0;
      undoByPhoto.set(current.id, []);
      redoByPhoto.set(current.id, []);
      refreshControls();
    });
    await editNumber(contrastNumber, '12.34');
    state = await page.evaluate(() => ({ value: current.edits.light.contrast, undo: undoByPhoto.get(current.id)?.length || 0 }));
    assert(closeEnough(state.value, 12.34) && state.undo === 1, `A whole-step slider rejected refined decimal input: ${JSON.stringify(state)}`);
    await page.click('#undoBtn');
    assert(closeEnough(await page.evaluate(() => current.edits.light.contrast), 0), 'Undo did not restore a refined whole-step slider edit');

    await clearHistoryAndSetExposure(page, 1.23);
    await exposureNumber.click();
    await exposureNumber.fill('-2.34');
    assert(closeEnough(await page.evaluate(() => current.edits.light.exposure), -2.34), 'Numeric edit did not preview live');
    await exposureNumber.press('Escape');
    state = await page.evaluate(() => ({ value: current.edits.light.exposure, undo: undoByPhoto.get(current.id)?.length || 0 }));
    assert(closeEnough(state.value, 1.23) && state.undo === 0, `Escape did not cancel cleanly: ${JSON.stringify(state)}`);
    await exposureNumber.fill('');
    await exposureNumber.press('Tab');
    assert(closeEnough(await page.evaluate(() => current.edits.light.exposure), 1.23), 'Blank numeric input changed the edit');

    await clearHistoryAndSetExposure(page, 0);
    await exposureNumber.click();
    await exposureNumber.fill('1');
    await exposureNumber.fill('');
    await exposureNumber.press('Tab');
    state = await page.evaluate(() => ({ value: current.edits.light.exposure, undo: undoByPhoto.get(current.id)?.length || 0 }));
    assert(closeEnough(state.value, 0) && state.undo === 0, `Invalid final text committed a valid prefix: ${JSON.stringify(state)}`);

    await editNumber(exposureNumber, '999');
    assert(closeEnough(await page.evaluate(() => current.edits.light.exposure), 5), 'Out-of-range numeric input was not clamped');
    assert(await exposureNumber.inputValue() === '5.00', 'Clamped numeric value was not normalized');

    await clearHistoryAndSetExposure(page, 0);
    await exposureNumber.click();
    await exposureNumber.fill('1.5');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(50);
    state = await page.evaluate(() => ({ value: current.edits.light.exposure, undo: undoByPhoto.get(current.id)?.length || 0 }));
    assert(closeEnough(state.value, 1.5) && state.undo === 1, `Window deactivation did not finalize numeric input: ${JSON.stringify(state)}`);

    await clearHistoryAndSetExposure(page, 1.11);
    await exposureNumber.dblclick();
    assert(closeEnough(await page.evaluate(() => current.edits.light.exposure), 1.11), 'Double-clicking numeric text triggered slider reset');
    await page.locator('[data-path="light.exposure"]').locator('xpath=ancestor::div[contains(@class,"control")]//label').dblclick();
    assert(closeEnough(await page.evaluate(() => current.edits.light.exposure), 0), 'Double-clicking the slider label no longer resets it');

    await clearHistoryAndSetExposure(page, 0.5);
    await exposureNumber.scrollIntoViewIfNeeded();
    await exposureNumber.focus();
    const numberBox = await exposureNumber.boundingBox();
    assert(numberBox, 'Exposure number has no layout box');
    const scrollBeforeWheel = await page.locator('.right').evaluate(element => element.scrollTop);
    await page.mouse.move(numberBox.x + numberBox.width / 2, numberBox.y + numberBox.height / 2);
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(50);
    state = await page.evaluate(() => ({ value: current.edits.light.exposure, scroll: document.querySelector('.right').scrollTop, focused: document.activeElement?.classList.contains('range-number') }));
    assert(closeEnough(state.value, 0.5), `Ordinary wheel changed a numeric slider: ${JSON.stringify(state)}`);
    assert(state.scroll > scrollBeforeWheel, 'Ordinary wheel no longer scrolls the adjustment panel');

    await clearHistoryAndSetExposure(page, 0);
    const panelScroll = await page.locator('.right').evaluate(element => element.scrollTop);
    await middleDrag(page, exposureRange, 60);
    state = await page.evaluate(() => ({
      value: current.edits.light.exposure,
      number: document.querySelector('[data-number-for="control-light-exposure"]').value,
      undo: undoByPhoto.get(current.id)?.length || 0,
      scrubbing: document.body.classList.contains('precision-scrubbing'),
      panelScroll: document.querySelector('.right').scrollTop
    }));
    assert(closeEnough(state.value, 0.1), `Middle drag did not use precise step movement: ${JSON.stringify(state)}`);
    assert(state.number === '0.10' && state.undo === 1, `Middle drag did not synchronize/commit once: ${JSON.stringify(state)}`);
    assert(!state.scrubbing && Math.abs(state.panelScroll - panelScroll) < 2, 'Middle drag left a stuck cursor or autoscrolled the panel');
    const canvasAfter = await page.locator('#canvas').boundingBox();
    assert(canvasBefore && canvasAfter && Math.abs(canvasBefore.width - canvasAfter.width) < 2 && Math.abs(canvasBefore.height - canvasAfter.height) < 2, 'Precision editing resized the photograph preview');
    await page.click('#undoBtn');
    assert(closeEnough(await page.evaluate(() => current.edits.light.exposure), 0), 'Middle drag was not one-step undoable');

    await clearHistoryAndSetExposure(page, 0);
    await page.evaluate(() => {
      const range = document.querySelector('[data-path="light.exposure"]');
      range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 1, buttons: 4, pointerId: 91, clientX: 100 }));
      range.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: -1, buttons: 4, pointerId: 91, clientX: 160 }));
      range.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 91, clientX: 160 }));
    });
    await page.waitForTimeout(50);
    state = await page.evaluate(() => ({ value: current.edits.light.exposure, undo: undoByPhoto.get(current.id)?.length || 0, scrubbing: document.body.classList.contains('precision-scrubbing') }));
    assert(closeEnough(state.value, 0.1) && state.undo === 1 && !state.scrubbing, `Lost capture split or stranded a scrub transaction: ${JSON.stringify(state)}`);

    await clearHistoryAndSetExposure(page, 0);
    await middleDrag(page, exposureRange, 60, { shift: true });
    const fineValue = await page.evaluate(() => current.edits.light.exposure);
    assert(closeEnough(fineValue, 0.03), `Shift middle-drag was not extra precise: ${fineValue}`);

    await clearHistoryAndSetExposure(page, 0);
    await page.evaluate(async () => {
      const range = document.querySelector('[data-path="light.exposure"]');
      range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 1, buttons: 4, pointerId: 92, clientX: 100 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: -1, buttons: 4, pointerId: 92, clientX: 160 }));
      await new Promise(resolve => requestAnimationFrame(resolve));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: -1, buttons: 4, pointerId: 92, clientX: 200, shiftKey: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: -1, buttons: 4, pointerId: 92, clientX: 224, shiftKey: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 1, buttons: 0, pointerId: 92, clientX: 224, shiftKey: true }));
    });
    state = await page.evaluate(() => ({ value: current.edits.light.exposure, undo: undoByPhoto.get(current.id)?.length || 0 }));
    assert(closeEnough(state.value, 0.11) && state.undo === 1, `Changing scrub precision caused a jump or split history: ${JSON.stringify(state)}`);

    await clearHistoryAndSetExposure(page, 5);
    await page.evaluate(() => {
      const range = document.querySelector('[data-path="light.exposure"]');
      range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 1, buttons: 4, pointerId: 93, clientX: 100 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: -1, buttons: 4, pointerId: 93, clientX: 160 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: -1, buttons: 4, pointerId: 93, clientX: 154 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 1, buttons: 0, pointerId: 93, clientX: 154 }));
    });
    state = await page.evaluate(() => ({ value: current.edits.light.exposure, undo: undoByPhoto.get(current.id)?.length || 0 }));
    assert(closeEnough(state.value, 4.99) && state.undo === 1, `Scrub stuck at its limit instead of reversing immediately: ${JSON.stringify(state)}`);

    await clearHistoryAndSetExposure(page, 0);
    await middleDrag(page, exposureRange, 60, { escape: true });
    state = await page.evaluate(() => ({ value: current.edits.light.exposure, undo: undoByPhoto.get(current.id)?.length || 0, scrubbing: document.body.classList.contains('precision-scrubbing') }));
    assert(closeEnough(state.value, 0) && state.undo === 0 && !state.scrubbing, `Escape left a precision scrub active: ${JSON.stringify(state)}`);

    await exposureNumber.focus();
    const toolBeforeTyping = await page.evaluate(() => toolMode);
    await exposureNumber.press('b');
    assert(await page.evaluate(() => toolMode) === toolBeforeTyping, 'Editing a number leaked into application shortcuts');
    await exposureNumber.press('F1');
    await page.locator('#helpDialog[open]').waitFor({ state: 'visible' });
    await page.locator('#helpDialog').press('Escape');
    await page.locator('#helpDialog').waitFor({ state: 'hidden' });

    await page.click('.panel-tabs [data-panel="presets"]');
    state = await page.evaluate(() => ({ disabled: document.querySelector('#removeAppliedPreset').disabled, status: document.querySelector('#appliedPresetStatus').textContent }));
    assert(state.disabled && state.status === 'No removable preset on this photo', `Preset removal did not explain its inactive state: ${JSON.stringify(state)}`);
    await page.locator('#presetGrid .preset').first().click();
    await page.evaluate(() => { undoByPhoto.set(current.id, []); redoByPhoto.set(current.id, []); });
    state = await page.evaluate(() => {
      const range = document.querySelector('[data-path="light.exposure"]');
      const value = current.edits.light.exposure;
      range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 1, buttons: 4, pointerId: 94, clientX: 100 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 1, buttons: 0, pointerId: 94, clientX: 100 }));
      return { value, after: current.edits.light.exposure, active: !!activePreset, base: !!presetBase, history: undoByPhoto.get(current.id)?.length || 0 };
    });
    assert(closeEnough(state.after, state.value) && state.active && state.base && state.history === 0, `A stationary middle-click changed or detached the active preset: ${JSON.stringify(state)}`);
    const presetNumber = page.locator('[data-number-for="presetAmount"]');
    await presetNumber.click();
    await presetNumber.press('Control+A');
    await presetNumber.pressSequentially('125', { delay: 15 });
    await presetNumber.press('Enter');
    state = await page.evaluate(() => ({ amount: document.querySelector('#presetAmount').value, output: document.querySelector('#presetAmountOut').value, history: undoByPhoto.get(current.id)?.length || 0, active: !!activePreset, name: activePreset?.name, baseJson: JSON.stringify(presetBase), appliedJson: JSON.stringify(current.edits), removeDisabled: document.querySelector('#removeAppliedPreset').disabled, removeLabel: document.querySelector('#removeAppliedPreset').getAttribute('aria-label'), status: document.querySelector('#appliedPresetStatus').textContent }));
    assert(state.amount === '125' && state.output === '125' && state.active && state.history === 1 && !state.removeDisabled && state.removeLabel === `Remove ${state.name} from this photo` && state.status === `Applied to this photo: ${state.name} · 125%`, `Preset amount/removal controls broke blending, history, or status: ${JSON.stringify(state)}`);
    const trackedPreset = state;
    await page.click('#removeAppliedPreset');
    state = await page.evaluate(() => ({ editsJson: JSON.stringify(current.edits), active: !!activePreset, base: !!presetBase, history: undoByPhoto.get(current.id)?.length || 0, amount: document.querySelector('#presetAmount').value, number: Number(document.querySelector('[data-number-for="presetAmount"]').value), output: document.querySelector('#presetAmountOut').value, removeDisabled: document.querySelector('#removeAppliedPreset').disabled, status: document.querySelector('#appliedPresetStatus').textContent }));
    assert(state.editsJson === trackedPreset.baseJson && !state.active && !state.base && state.history === 2 && state.amount === '100' && state.number === 100 && state.output === '100' && state.removeDisabled && state.status === 'No removable preset on this photo', `Removing a preset did not restore the exact base and reset its UI: ${JSON.stringify(state)}`);
    await page.click('#undoBtn');
    state = await page.evaluate(() => ({ editsJson: JSON.stringify(current.edits), active: !!activePreset, base: !!presetBase }));
    assert(state.editsJson === trackedPreset.appliedJson && !state.active && !state.base, `Undo did not restore the removed preset result exactly: ${JSON.stringify(state)}`);
    await page.click('#redoBtn');
    state = await page.evaluate(() => ({ editsJson: JSON.stringify(current.edits), active: !!activePreset, base: !!presetBase }));
    assert(state.editsJson === trackedPreset.baseJson && !state.active && !state.base, `Redo did not remove the preset result exactly: ${JSON.stringify(state)}`);

    const zoomNumber = page.locator('[data-number-for="zoomRange"]');
    const historyBeforeZoom = await page.evaluate(() => undoByPhoto.get(current.id)?.length || 0);
    await editNumber(zoomNumber, '150');
    state = await page.evaluate(() => ({ zoom: document.querySelector('#zoomRange').value, label: document.querySelector('#zoomLabel').value, history: undoByPhoto.get(current.id)?.length || 0 }));
    assert(state.zoom === '150' && state.label === '150%' && state.history === historyBeforeZoom, `Zoom precision input changed edit history: ${JSON.stringify(state)}`);

    await page.evaluate(() => LumaToolRail.activateTool('wand'));
    const wandRange = page.locator('.tool-options input[type="range"][aria-label="Wand tolerance"]');
    await wandRange.waitFor();
    const wandId = await wandRange.getAttribute('id');
    const wandNumber = page.locator(`[data-number-for="${wandId}"]`);
    await editNumber(wandNumber, '42');
    assert(await wandRange.inputValue() === '42', 'Dynamic Wand tolerance did not accept exact numeric input');

    const shapedCrop = await withTimeout(page.evaluate(async () => {
      current.edits.geometry.cropShapeKind = 'oval';
      current.edits.geometry.cropShapeRotation = 17;
      current.edits.geometry.cropShapeFeather = 8;
      let heartbeat = 0;
      const timer = setInterval(() => { heartbeat++; }, 10);
      LumaToolRail.activateTool('crop');
      await new Promise(resolve => setTimeout(resolve, 120));
      clearInterval(timer);
      const ranges = [...document.querySelectorAll('.tool-options input[type="range"]')];
      return {
        heartbeat,
        ranges: ranges.length,
        numbers: ranges.filter(range => document.querySelector(`[data-number-for="${range.id}"]`)).length
      };
    }), 3_000, 'Entering a shaped crop froze while replacing dynamic precision controls');
    assert(shapedCrop.heartbeat >= 2 && shapedCrop.ranges >= 3 && shapedCrop.numbers === shapedCrop.ranges, `Shaped crop controls did not remain responsive: ${JSON.stringify(shapedCrop)}`);
    const cropRange = page.locator('#cropStraightenRange');
    await cropRange.waitFor();
    const cropNumber = page.locator('[data-number-for="cropStraightenRange"]');
    await page.evaluate(() => { undoByPhoto.set(current.id, []); redoByPhoto.set(current.id, []); });
    await middleDrag(page, cropRange, 60, { escape: true });
    state = await page.evaluate(() => ({
      tool: toolMode,
      value: current.edits.geometry.straighten,
      range: document.querySelector('#cropStraightenRange')?.value,
      history: undoByPhoto.get(current.id)?.length || 0,
      scrubbing: document.body.classList.contains('precision-scrubbing')
    }));
    assert(state.tool === 'tool-crop' && closeEnough(state.value, 0) && state.range === '0' && state.history === 0 && !state.scrubbing, `Escape escaped Crop instead of only reverting its precision scrub: ${JSON.stringify(state)}`);
    await editNumber(cropNumber, '2.5');
    assert(closeEnough(await page.evaluate(() => current.edits.geometry.straighten), 2.5), 'Crop slider companion did not update the staged crop');
    await page.evaluate(() => LumaCropTool.cancel());
    assert(closeEnough(await page.evaluate(() => current.edits.geometry.straighten), 0), 'Crop cancel did not restore a numeric slider edit');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => {
      const right = document.querySelector('.right');
      const toolbar = document.querySelector('.editor-tools');
      const rect = toolbar.getBoundingClientRect();
      return { rightOverflow: right.scrollWidth - right.clientWidth, toolbar: [rect.left, rect.right], viewport: innerWidth };
    });
    assert(layout.rightOverflow <= 1, `Precision fields overflow the adjustment panel: ${JSON.stringify(layout)}`);
    assert(layout.toolbar[0] >= -1 && layout.toolbar[1] <= layout.viewport + 1, `Zoom precision field overflows the canvas toolbar: ${JSON.stringify(layout)}`);
    assert(!errors.length, `Renderer errors during precision-control workflow:\n${errors.join('\n')}`);

    process.stdout.write(`${JSON.stringify({ inventory, direct: state, fineValue, layout, errors }, null, 2)}\n`);
  } finally {
    if (app) await app.close().catch(() => {});
    if (fixtures) await fixtures.cleanup().catch(() => {});
    await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
