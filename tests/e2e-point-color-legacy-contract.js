'use strict';

const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `point-color-contract-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });

let runningApp;
let fixtures;

const launchOptions = () => ({
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

async function livePage(app, rendererErrors) {
  let page = await app.firstWindow();
  await page.waitForTimeout(800);
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  page.on('pageerror', error => rendererErrors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error') rendererErrors.push(`CONSOLE: ${message.text()}`);
  });
  await page.waitForSelector('body', { timeout: 15_000 });
  return page;
}

(async () => {
  const rendererErrors = [];
  fixtures = await createPhotoFixtures(1);
  runningApp = await electron.launch(launchOptions());
  let page = await livePage(runningApp, rendererErrors);

  if (await page.locator('#tutorialDialog[open]').count()) {
    await page.click('#tutorialSkip');
    await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
  }

  const engine = await page.evaluate(async () => {
    const clamp = value => Math.max(0, Math.min(1, value));
    const hueDistance = (left, right) => Math.abs(((left - right + 540) % 360) - 180);
    const rgbToHsl = (r, g, b) => {
      const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b), lightness = (maximum + minimum) / 2;
      if (maximum === minimum) return [0, 0, lightness];
      const delta = maximum - minimum;
      const saturation = lightness > .5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
      let hue = maximum === r ? (g - b) / delta + (g < b ? 6 : 0) : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      return [hue * 60, saturation, lightness];
    };
    const hslToRgb = (hue, saturation, lightness) => {
      const h = ((hue % 360) + 360) % 360 / 360;
      if (saturation <= 0) return [lightness, lightness, lightness];
      const q = lightness < .5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
      const p = 2 * lightness - q;
      const channel = value => {
        let t = value;
        if (t < 0) t++;
        if (t > 1) t--;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
    };
    const canvasFromRgba = (width, height, values) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(values), width, height), 0, 0);
      return canvas;
    };
    const canvasFromHsl = samples => {
      const values = [];
      for (const [hue, saturation, luminance] of samples) {
        const rgb = hslToRgb(hue, saturation, luminance);
        values.push(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, 255);
      }
      return canvasFromRgba(samples.length, 1, values);
    };
    const pixels = canvas => [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data];
    const renderPixels = (source, edits) => {
      const output = LumaEngine.render(source, edits, { maxEdge: Math.max(source.width, source.height) });
      const data = pixels(output);
      output.width = output.height = 1;
      return data;
    };
    const maximumDelta = (left, right) => {
      let maximum = 0;
      for (let index = 0; index < Math.min(left.length, right.length); index++) maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
      return maximum;
    };
    const pixelDelta = (left, right, pixel) => {
      let total = 0;
      for (let channel = 0; channel < 3; channel++) total += Math.abs(left[pixel * 4 + channel] - right[pixel * 4 + channel]);
      return total;
    };
    const makeSwatch = overrides => ({
      id: 'point', enabled: true, mode: 'color-v2', hue: 30, saturation: 80, luminance: 50,
      hueShift: 0, saturationShift: 0, luminanceShift: 0, hueRange: 30,
      saturationRange: 25, luminanceRange: 25, feather: 50, range: 30, variance: 25,
      ...overrides,
    });
    const editsWith = (swatches, calibration = {}) => LumaEngine.migratedEdits({
      version: 7,
      pointColor: { enabled: true, visualize: false, activeId: swatches[0]?.id || '', swatches },
      calibration,
    });

    // Frozen v6 point-color calculation. It intentionally does not call the
    // current renderer's color helpers, so migration regressions are visible.
    const legacySettings = {
      enabled: true, hue: 30, hueShift: 42, saturationShift: -27,
      luminanceShift: 31, variance: 25, range: 30, visualize: false,
    };
    const legacySourceValues = [
      240, 50, 40, 255,
      220, 130, 40, 255,
      45, 160, 195, 255,
      118, 118, 118, 255,
    ];
    const legacySource = canvasFromRgba(4, 1, legacySourceValues);
    const expected = new Uint8ClampedArray(legacySourceValues);
    for (let offset = 0; offset < expected.length; offset += 4) {
      let [hue, saturation, lightness] = rgbToHsl(expected[offset] / 255, expected[offset + 1] / 255, expected[offset + 2] / 255);
      const width = 6 + legacySettings.range * .75;
      const weight = Math.pow(clamp(1 - hueDistance(hue, legacySettings.hue) / width), .6 + legacySettings.variance / 40);
      hue += legacySettings.hueShift * .35 * weight;
      saturation = clamp(saturation + legacySettings.saturationShift / 100 * weight);
      lightness = clamp(lightness + legacySettings.luminanceShift / 100 * .4 * weight);
      const rgb = hslToRgb(hue, saturation, lightness);
      expected[offset] = clamp(rgb[0]) * 255;
      expected[offset + 1] = clamp(rgb[1]) * 255;
      expected[offset + 2] = clamp(rgb[2]) * 255;
    }
    const legacyInput = { version: 6, pointColor: legacySettings };
    const legacyBefore = JSON.stringify(legacyInput);
    const legacyActual = renderPixels(legacySource, legacyInput);
    const legacyNeutral = renderPixels(legacySource, { version: 6, pointColor: { ...legacySettings, enabled: false } });
    const legacy = {
      maximumDelta: maximumDelta(legacyActual, expected),
      neutralMaximumDelta: maximumDelta(legacyNeutral, legacySourceValues),
      inputUnchanged: JSON.stringify(legacyInput) === legacyBefore,
      mode: LumaEngine.migratedEdits(legacyInput).pointColor.swatches[0]?.mode,
    };

    // Hostile catalog input: reject malformed entries, cap work and output,
    // normalize IDs, clamp values, and leave global prototypes untouched.
    const hostileSwatches = [null, [], 'bad'];
    for (let index = 0; index < 37; index++) hostileSwatches.push({
      id: index % 2 ? '../duplicate' : '__proto__',
      enabled: index % 3 !== 0,
      mode: index % 2 ? 'not-a-mode' : 'hue-v1',
      hue: index ? 9999 : NaN,
      saturation: -9999,
      luminance: Infinity,
      hueShift: -9999,
      saturationShift: 9999,
      luminanceShift: -Infinity,
      hueRange: -50,
      saturationRange: 9999,
      luminanceRange: -10,
      feather: 9999,
      range: -20,
      variance: 9999,
      constructor: { prototype: { pointColorPolluted: true } },
    });
    const hostileInput = {
      version: 999,
      pointColor: { enabled: true, visualize: true, activeId: '../duplicate', swatches: hostileSwatches },
      calibration: {
        shadowTint: 9999, redPrimaryHue: -9999, redPrimarySaturation: Infinity,
        greenPrimaryHue: 9999, greenPrimarySaturation: NaN,
        bluePrimaryHue: -9999, bluePrimarySaturation: 9999,
      },
    };
    const pollutedBefore = {}.pointColorPolluted;
    const hostileResult = LumaEngine.migratedEdits(hostileInput);
    const sanitized = hostileResult.pointColor.swatches;
    const hostile = {
      version: hostileResult.version,
      count: sanitized.length,
      uniqueIds: new Set(sanitized.map(swatch => swatch.id)).size,
      safeIds: sanitized.every(swatch => /^[A-Za-z0-9_-]{1,64}$/.test(swatch.id)),
      validModes: sanitized.every(swatch => ['hue-v1', 'color-v2'].includes(swatch.mode)),
      allFinite: sanitized.every(swatch => Object.entries(swatch).every(([, value]) => typeof value !== 'number' || Number.isFinite(value))),
      bounded: sanitized.every(swatch => swatch.hue >= 0 && swatch.hue <= 360 && swatch.saturation >= 0 && swatch.saturation <= 100 && swatch.luminance >= 0 && swatch.luminance <= 100 && swatch.hueShift >= -100 && swatch.hueShift <= 100 && swatch.saturationShift >= -100 && swatch.saturationShift <= 100 && swatch.luminanceShift >= -100 && swatch.luminanceShift <= 100 && swatch.hueRange >= 1 && swatch.hueRange <= 180 && swatch.saturationRange >= 0 && swatch.saturationRange <= 100 && swatch.luminanceRange >= 0 && swatch.luminanceRange <= 100 && swatch.feather >= 0 && swatch.feather <= 100 && swatch.range >= 1 && swatch.range <= 100 && swatch.variance >= 0 && swatch.variance <= 100),
      activeValid: sanitized.some(swatch => swatch.id === hostileResult.pointColor.activeId),
      calibration: hostileResult.calibration,
      prototypeClean: pollutedBefore === undefined && {}.pointColorPolluted === undefined,
    };

    // Circular hue matching must include a color across the 0/360 boundary.
    const wrapSource = canvasFromHsl([[359, .8, .5], [180, .8, .5]]);
    const wrapBase = renderPixels(wrapSource, LumaEngine.defaultEdits());
    const wrapOutput = renderPixels(wrapSource, editsWith([makeSwatch({ id: 'wrap', hue: 1, hueShift: 70, hueRange: 8, saturationRange: 100, luminanceRange: 100, feather: 40 })]));
    const hueWrap = { selectedDelta: pixelDelta(wrapOutput, wrapBase, 0), distantDelta: pixelDelta(wrapOutput, wrapBase, 1) };

    // Same hue is insufficient: saturation and luminance ranges must exclude
    // chroma- and tone-mismatched pixels.
    const rangeSource = canvasFromHsl([[25, .8, .5], [25, .25, .5], [25, .8, .2]]);
    const rangeBase = renderPixels(rangeSource, LumaEngine.defaultEdits());
    const rangeOutput = renderPixels(rangeSource, editsWith([makeSwatch({ id: 'range', hue: 25, saturation: 80, luminance: 50, luminanceShift: 70, hueRange: 20, saturationRange: 8, luminanceRange: 8, feather: 30 })]));
    const rangeExclusion = [0, 1, 2].map(pixel => pixelDelta(rangeOutput, rangeBase, pixel));

    // All weights are computed from one source snapshot. Reversing eight
    // overlapping samples should not change the rendered result.
    const overlapValues = [];
    for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) overlapValues.push((x * 17 + y * 7) % 256, (x * 9 + y * 23) % 256, (x * 29 + y * 3) % 256, 255);
    const overlapSource = canvasFromRgba(24, 12, overlapValues);
    const overlapSwatches = Array.from({ length: 8 }, (_, index) => makeSwatch({
      id: `overlap-${index}`, hue: 18 + index * 7, saturation: 55 + index * 4,
      luminance: 38 + index * 3, hueShift: (index - 3) * 13,
      saturationShift: index % 2 ? -35 : 28, luminanceShift: (index - 4) * 8,
      hueRange: 95, saturationRange: 90, luminanceRange: 90, feather: 65,
    }));
    const overlapForward = renderPixels(overlapSource, editsWith(overlapSwatches));
    const overlapReverse = renderPixels(overlapSource, editsWith([...overlapSwatches].reverse()));
    const overlap = { maximumDelta: maximumDelta(overlapForward, overlapReverse) };

    // Primary calibration must preserve neutral RGB while changing colored
    // patches. Shadow tint intentionally changes neutral shadows.
    const graySource = canvasFromRgba(4, 1, [32, 32, 32, 255, 96, 96, 96, 255, 160, 160, 160, 255, 224, 224, 224, 255]);
    const grayBase = renderPixels(graySource, LumaEngine.defaultEdits());
    const colorSource = canvasFromRgba(4, 1, [205, 94, 71, 255, 66, 191, 112, 255, 74, 103, 214, 255, 184, 148, 91, 255]);
    const colorBase = renderPixels(colorSource, LumaEngine.defaultEdits());
    const calibrationFields = ['redPrimaryHue', 'redPrimarySaturation', 'greenPrimaryHue', 'greenPrimarySaturation', 'bluePrimaryHue', 'bluePrimarySaturation'];
    const calibrationEffects = {};
    let neutralPrimaryMaximumDelta = 0;
    for (const field of calibrationFields) {
      const calibrationSetting = { [field]: 75 };
      const grayOutput = renderPixels(graySource, editsWith([], calibrationSetting));
      const colorOutput = renderPixels(colorSource, editsWith([], calibrationSetting));
      neutralPrimaryMaximumDelta = Math.max(neutralPrimaryMaximumDelta, maximumDelta(grayBase, grayOutput));
      calibrationEffects[field] = colorOutput.reduce((total, value, index) => total + Math.abs(value - colorBase[index]), 0);
    }
    const defaultCalibrationDelta = maximumDelta(grayBase, renderPixels(graySource, editsWith([], {})));

    const positiveShadow = renderPixels(graySource, editsWith([], { shadowTint: 100 }));
    const negativeShadow = renderPixels(graySource, editsWith([], { shadowTint: -100 }));
    const shadowChroma = (data, pixel) => (data[pixel * 4] + data[pixel * 4 + 2]) / 2 - data[pixel * 4 + 1];
    const shadowTint = {
      positiveDark: shadowChroma(positiveShadow, 0),
      positiveBright: shadowChroma(positiveShadow, 3),
      negativeDark: shadowChroma(negativeShadow, 0),
      negativeBright: shadowChroma(negativeShadow, 3),
    };
    const calibration = { defaultDelta: defaultCalibrationDelta, neutralPrimaryMaximumDelta, effects: calibrationEffects, shadowTint };

    // The shared engine must produce the same pixels through preview and
    // encoded export workers.
    const workerSource = document.createElement('canvas');
    workerSource.width = 96;
    workerSource.height = 64;
    const workerContext = workerSource.getContext('2d');
    const gradient = workerContext.createLinearGradient(0, 0, 96, 64);
    gradient.addColorStop(0, '#dc6547');
    gradient.addColorStop(.5, '#46a978');
    gradient.addColorStop(1, '#355fd1');
    workerContext.fillStyle = gradient;
    workerContext.fillRect(0, 0, 96, 64);
    const workerEdits = editsWith([
      makeSwatch({ id: 'worker-a', hue: 18, saturation: 70, luminance: 55, hueShift: 36, hueRange: 70, saturationRange: 80, luminanceRange: 80 }),
      makeSwatch({ id: 'worker-b', hue: 150, saturation: 50, luminance: 48, saturationShift: 32, hueRange: 70, saturationRange: 80, luminanceRange: 80 }),
    ], { redPrimaryHue: 22, greenPrimarySaturation: -18, shadowTint: 12 });

    const previewPixels = await new Promise(async (resolve, reject) => {
      const worker = new Worker('preview-worker.js');
      const token = 'point-color-parity';
      const bitmap = await createImageBitmap(workerSource);
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Preview worker parity timed out')); }, 20_000);
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message || 'Preview worker failed')); };
      worker.onmessage = event => {
        const message = event.data || {};
        if (message.type === 'ready') {
          worker.postMessage({ type: 'render', token, id: 1, edits: workerEdits, maxEdge: 96, visualizeMask: false, clipping: false });
        } else if (message.type === 'error') {
          clearTimeout(timer); worker.terminate(); reject(new Error(message.error));
        } else if (message.type === 'rendered' && message.id === 1) {
          const canvas = document.createElement('canvas');
          canvas.width = message.width;
          canvas.height = message.height;
          canvas.getContext('2d').drawImage(message.bitmap, 0, 0);
          message.bitmap.close();
          const data = pixels(canvas);
          canvas.width = canvas.height = 1;
          clearTimeout(timer);
          worker.postMessage({ type: 'close' });
          resolve(data);
        }
      };
      worker.postMessage({ type: 'init', token, bitmap }, [bitmap]);
    });

    const exportPixels = await new Promise(async (resolve, reject) => {
      const worker = new Worker('render-worker.js');
      const bitmap = await createImageBitmap(workerSource);
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Export worker parity timed out')); }, 20_000);
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message || 'Export worker failed')); };
      worker.onmessage = async event => {
        const message = event.data || {};
        if (message.id !== 2 || message.progress) return;
        if (message.error) {
          clearTimeout(timer); worker.terminate(); reject(new Error(message.error));
          return;
        }
        try {
          const decoded = await createImageBitmap(new Blob([message.bytes], { type: message.mime }));
          const canvas = document.createElement('canvas');
          canvas.width = message.width;
          canvas.height = message.height;
          canvas.getContext('2d').drawImage(decoded, 0, 0);
          decoded.close();
          const data = pixels(canvas);
          canvas.width = canvas.height = 1;
          clearTimeout(timer);
          worker.terminate();
          resolve(data);
        } catch (error) {
          clearTimeout(timer); worker.terminate(); reject(error);
        }
      };
      worker.postMessage({ id: 2, bitmap, edits: workerEdits, maxEdge: 96, watermark: '', mime: 'image/png', quality: 1 }, [bitmap]);
    });
    const workerParity = { maximumDelta: maximumDelta(previewPixels, exportPixels), byteLength: previewPixels.length };

    for (const canvas of [legacySource, wrapSource, rangeSource, overlapSource, graySource, colorSource, workerSource]) canvas.width = canvas.height = 1;
    return { legacy, hostile, hueWrap, rangeExclusion, overlap, calibration, workerParity };
  });

  // Install a real fixture-backed catalog item for UI, undo, autosave, and
  // process-restart coverage.
  await page.evaluate(filePath => {
    const record = LumaEngine.migratePhoto({ id: 'point-color-ui', filePath, name: 'Point Color fixture.jpg', importedAt: Date.now() });
    photos = [record];
    updateLibrary();
    selectPhoto(record);
    localStorage.setItem(TUTORIAL_KEY, 'seen');
  }, fixtures.paths[0]);
  await page.waitForFunction(() => current?.id === 'point-color-ui' && sourceImage.complete && sourceImage.naturalWidth > 0, null, { timeout: 30_000 });

  const uiSetup = await page.evaluate(() => {
    const makeSwatch = index => ({
      id: `ui-${index}`, enabled: true, mode: 'color-v2', hue: index * 42,
      saturation: 60, luminance: 50, hueShift: index - 4, saturationShift: 0,
      luminanceShift: 0, hueRange: 30, saturationRange: 25, luminanceRange: 25,
      feather: 50, range: 30, variance: 25,
    });
    const edits = LumaEngine.defaultEdits();
    edits.pointColor = { enabled: true, visualize: false, activeId: 'ui-7', swatches: Array.from({ length: 8 }, (_, index) => makeSwatch(index)) };
    edits.calibration = { ...edits.calibration, redPrimaryHue: 27, shadowTint: -14 };
    current.edits = LumaEngine.migratedEdits(edits);
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    pointColorUiSignature = '';
    switchRightPanel('edit');
    refreshControls();
    const panel = document.querySelector('[data-panel-name="Color Mixer"]');
    panel?.classList.remove('collapsed');
    panel?.querySelector('.panel-head')?.setAttribute('aria-expanded', 'true');
    return { count: current.edits.pointColor.swatches.length, history: historyStacks()[0].length };
  });

  const uiBefore = await page.evaluate(() => ({
    disabled: document.querySelector('#addPointColor')?.disabled,
    countText: document.querySelector('.point-color-head>span')?.textContent.trim(),
    options: document.querySelectorAll('[data-pc-id]').length,
    active: document.querySelectorAll('[data-pc-id][aria-selected="true"]').length,
    namesValid: [...document.querySelectorAll('[data-pc-id]')].every(button => button.getAttribute('aria-label')),
    toolBefore: toolMode,
  }));
  const samplingStability = await page.evaluate(() => {
    const before = JSON.stringify(current.edits.pointColor), neutral = [...sampleEditableColor(.5, .5)];
    current.edits.pointColor.enabled = true;
    for (const swatch of current.edits.pointColor.swatches) { swatch.hueShift = 100; swatch.saturationShift = 100; swatch.luminanceShift = -100; swatch.hueRange = 180; swatch.saturationRange = 100; swatch.luminanceRange = 100; }
    const shifted = [...sampleEditableColor(.5, .5)];
    current.edits.pointColor = JSON.parse(before);
    return { neutral, shifted, stateRestored: JSON.stringify(current.edits.pointColor) === before };
  });
  await page.evaluate(() => document.querySelector('#addPointColor')?.click());
  const ninthGuard = await page.evaluate(() => ({ count: current.edits.pointColor.swatches.length, toolAfter: toolMode }));

  await page.click('#deletePointColor');
  const afterDelete = await page.evaluate(() => ({ count: current.edits.pointColor.swatches.length, undo: historyStacks()[0].length, redo: historyStacks()[1].length }));
  await page.click('#undoBtn');
  const afterUndo = await page.evaluate(() => ({ count: current.edits.pointColor.swatches.length, undo: historyStacks()[0].length, redo: historyStacks()[1].length, activeId: current.edits.pointColor.activeId }));
  const persistenceWrite = await page.evaluate(() => {
    catalogDirty = true;
    const compact = catalogRecords()[0].edits;
    return { saved: saveCatalog(), compactVersion: compact.version, compactCount: compact.pointColor?.swatches?.length || 0 };
  });

  await runningApp.close();
  runningApp = null;
  runningApp = await electron.launch(launchOptions());
  page = await livePage(runningApp, rendererErrors);
  await page.waitForFunction(() => photos.length === 1 && current?.id === 'point-color-ui', null, { timeout: 30_000 });
  const afterRestart = await page.evaluate(() => ({
    version: current.edits.version,
    count: current.edits.pointColor.swatches.length,
    activeId: current.edits.pointColor.activeId,
    redPrimaryHue: current.edits.calibration.redPrimaryHue,
    shadowTint: current.edits.calibration.shadowTint,
    addDisabled: document.querySelector('#addPointColor')?.disabled,
  }));

  const ui = { uiSetup, uiBefore, samplingStability, ninthGuard, afterDelete, afterUndo, persistenceWrite, afterRestart };
  const failures = [];
  if (engine.legacy.maximumDelta > 1 || engine.legacy.neutralMaximumDelta !== 0 || !engine.legacy.inputUnchanged || engine.legacy.mode !== 'hue-v1') failures.push('v6 Point Color migration or frozen renderer parity failed');
  const hostile = engine.hostile;
  if (hostile.version !== 7 || hostile.count !== 8 || hostile.uniqueIds !== 8 || !hostile.safeIds || !hostile.validModes || !hostile.allFinite || !hostile.bounded || !hostile.activeValid || !hostile.prototypeClean || Object.values(hostile.calibration).some(value => !Number.isFinite(value) || value < -100 || value > 100)) failures.push('Hostile Point Color or calibration input escaped schema bounds');
  if (!(engine.hueWrap.selectedDelta > 20 && engine.hueWrap.distantDelta <= 1)) failures.push('Point Color hue selection did not wrap cleanly across 0/360 degrees');
  if (!(engine.rangeExclusion[0] > 20 && engine.rangeExclusion[1] <= 1 && engine.rangeExclusion[2] <= 1)) failures.push('Point Color saturation or luminance range failed to exclude a same-hue mismatch');
  if (engine.overlap.maximumDelta > 1) failures.push(`Overlapping Point Color samples depend on array order (maximum delta ${engine.overlap.maximumDelta})`);
  if (engine.calibration.defaultDelta !== 0 || engine.calibration.neutralPrimaryMaximumDelta > 1 || Object.values(engine.calibration.effects).some(value => value <= 4)) failures.push('Primary calibration defaults, neutral preservation, or measurable color effects failed');
  const tint = engine.calibration.shadowTint;
  if (!(tint.positiveDark > 0 && tint.negativeDark < 0 && Math.abs(tint.positiveDark) > Math.abs(tint.positiveBright) && Math.abs(tint.negativeDark) > Math.abs(tint.negativeBright))) failures.push('Shadow tint direction or shadow-weighted falloff failed');
  if (engine.workerParity.maximumDelta > 1 || engine.workerParity.byteLength !== 96 * 64 * 4) failures.push(`Preview/export worker parity failed (maximum delta ${engine.workerParity.maximumDelta})`);
  if (ui.uiSetup.count !== 8 || ui.uiSetup.history !== 0 || !ui.uiBefore.disabled || ui.uiBefore.countText !== '8 / 8' || ui.uiBefore.options !== 8 || ui.uiBefore.active !== 1 || !ui.uiBefore.namesValid || ui.ninthGuard.count !== 8 || ui.ninthGuard.toolAfter !== ui.uiBefore.toolBefore) failures.push('Eight-sample UI limit or accessible swatch state failed');
  if (ui.samplingStability.neutral.join(',') !== ui.samplingStability.shifted.join(',') || !ui.samplingStability.stateRestored) failures.push('Point Color sampling fed an active Point Color result back into its own target');
  if (ui.afterDelete.count !== 7 || ui.afterDelete.undo !== 1 || ui.afterDelete.redo !== 0 || ui.afterUndo.count !== 8 || ui.afterUndo.undo !== 0 || ui.afterUndo.redo !== 1 || ui.afterUndo.activeId !== 'ui-7') failures.push('Point Color delete was not one deterministic undo transaction');
  if (!ui.persistenceWrite.saved || ui.persistenceWrite.compactVersion !== 7 || ui.persistenceWrite.compactCount !== 8 || ui.afterRestart.version !== 7 || ui.afterRestart.count !== 8 || ui.afterRestart.activeId !== 'ui-7' || ui.afterRestart.redPrimaryHue !== 27 || ui.afterRestart.shadowTint !== -14 || !ui.afterRestart.addDisabled) failures.push('Point Color or calibration state failed compact save/process restart round-trip');
  if (rendererErrors.length) failures.push('Renderer emitted unexpected errors');

  process.stdout.write(`${JSON.stringify({ engine, ui, rendererErrors, failures }, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (runningApp) await runningApp.close().catch(() => {});
  if (fixtures) await fixtures.cleanup().catch(() => {});
  const resolved = path.resolve(userData);
  if (resolved.startsWith(path.resolve(root, 'work') + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
});
