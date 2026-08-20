const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `layered-tools-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });

let app;
let fixtures;

async function livePage(runningApp) {
  let page = await runningApp.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1200));
  page = runningApp.windows().filter(window => !window.isClosed()).at(-1) || page;
  await page.waitForSelector('body', { timeout: 15000 });
  return page;
}

async function waitForPreview(page) {
  await page.waitForFunction(() => current && sourceImage.naturalWidth > 0 && !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && canvas.width > 100, null, { timeout: 30000 });
}

async function dragAcrossCanvas(page, start, end) {
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('Preview canvas has no visible bounds');
  await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1], { steps: 14 });
  await page.mouse.up();
  await waitForPreview(page);
}

async function previewExportParity(page) {
  return page.evaluate(async () => {
    const previewContext = canvas.getContext('2d', { willReadFrequently: true });
    const preview = new Uint8ClampedArray(previewContext.getImageData(0, 0, canvas.width, canvas.height).data);
    const maxEdge = previewEdge(false);
    const result = await renderExportInWorker(sourceImage, E.clone(current.edits), { maxEdge, watermark: '', mime: 'image/png', quality: 1 });
    const bitmap = await createImageBitmap(new Blob([result.bytes], { type: result.mime }));
    const decoded = document.createElement('canvas');
    decoded.width = bitmap.width;
    decoded.height = bitmap.height;
    decoded.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const exported = decoded.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, decoded.width, decoded.height).data;
    let maximumDelta = 0;
    let totalDelta = 0;
    let changedChannels = 0;
    for (let index = 0; index < Math.min(preview.length, exported.length); index += 1) {
      const delta = Math.abs(preview[index] - exported[index]);
      maximumDelta = Math.max(maximumDelta, delta);
      totalDelta += delta;
      if (delta) changedChannels += 1;
    }
    return {
      previewSize: [canvas.width, canvas.height],
      exportSize: [decoded.width, decoded.height],
      maximumDelta,
      meanDelta: totalDelta / Math.max(1, preview.length),
      changedChannels,
      workerReleased: activeExportWorker === null,
    };
  });
}

(async () => {
  fixtures = await createPhotoFixtures(1);
  const errors = [];
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
  const page = await livePage(app);
  page.on('pageerror', error => errors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`);
  });

  if (await page.locator('#tutorialDialog[open]').count()) {
    await page.click('#tutorialSkip');
    await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
  }

  await page.evaluate(filePath => {
    const photo = E.migratePhoto({ id: 'layered-photo', filePath, name: 'layered-photo.jpg', importedAt: 123456 });
    photos = [photo];
    updateLibrary();
    selectPhoto(photo);
  }, fixtures.paths[0]);
  await waitForPreview(page);

  const engine = await page.evaluate(() => {
    const pixels = surface => surface.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, surface.width, surface.height).data;
    const pixel = (surface, x, y) => [...surface.getContext('2d', { willReadFrequently: true }).getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const luminance = value => value[0] * 0.2126 + value[1] * 0.7152 + value[2] * 0.0722;
    const maximumDelta = (a, b) => {
      let maximum = 0;
      for (let index = 0; index < Math.min(a.length, b.length); index += 1) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
      return maximum;
    };
    const surface = (width = 240, height = 160, fill = 'rgb(96 96 96)') => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = fill;
      context.fillRect(0, 0, width, height);
      return canvas;
    };

    const subject = surface();
    const subjectContext = subject.getContext('2d');
    subjectContext.fillStyle = '#df573f';
    subjectContext.fillRect(35, 35, 80, 90);
    subjectContext.fillStyle = '#3779ca';
    subjectContext.fillRect(145, 20, 70, 120);
    const legacy = {
      version: 2,
      light: { exposure: 0.12 },
      mask: {
        enabled: true,
        type: 'subject',
        x: 0.28,
        y: 0.5,
        size: 42,
        range: 30,
        feather: 18,
        subjectExposure: 0.55,
        backgroundExposure: -0.15,
        strokes: [{ x: 0.5, y: 0.5, size: 12, feather: 30, mode: 'add' }],
        show: false,
      },
    };
    const migratedLegacy = E.migratedEdits(legacy);
    const legacyPixels = pixels(E.render(subject, legacy, { maxEdge: 180 }));
    const migratedPixels = pixels(E.render(subject, migratedLegacy, { maxEdge: 180 }));
    const inertLegacy = E.migratedEdits({ version: 2, mask: { enabled: false, type: 'subject' } });
    const legacyState = {
      version: migratedLegacy.version,
      activeId: migratedLegacy.masks.activeId,
      layers: migratedLegacy.masks.layers.length,
      type: migratedLegacy.masks.layers[0]?.type,
      space: migratedLegacy.masks.layers[0]?.space,
      exposure: migratedLegacy.masks.layers[0]?.subjectExposure,
      strokes: migratedLegacy.masks.layers[0]?.strokes.length,
      protectTones: migratedLegacy.masks.layers[0]?.protectTones,
      parityMaxDelta: maximumDelta(legacyPixels, migratedPixels),
      inertLayers: inertLegacy.masks.layers.length,
    };

    const manyStrokes = Array.from({ length: 1500 }, (_, index) => ({
      x: (index % 100) / 99,
      y: ((index * 7) % 100) / 99,
      size: 200,
      feather: -20,
      flow: 200,
      mode: index % 2 ? 'add' : 'subtract',
    }));
    const unsafe = {
      version: 4,
      masks: {
        activeId: 'missing',
        layers: Array.from({ length: 12 }, (_, index) => ({
          id: 'same<script>',
          name: `${'<b>unsafe</b>'.repeat(12)}-${index}`,
          type: index === 1 ? 'unknown' : ['brush', 'linear', 'radial'][index % 3],
          x: -4,
          y: 9,
          opacity: 800,
          brushSize: 500,
          strokes: manyStrokes,
        })),
      },
      cleanup: Array.from({ length: 250 }, () => ({ kind: 'unknown', x: -2, y: 5, radiusPx: 999999, size: 80, opacity: 0 })),
    };
    const sanitized = E.migratedEdits(unsafe);
    const sanitizedState = {
      layers: sanitized.masks.layers.length,
      totalStrokes: sanitized.masks.layers.reduce((total, layer) => total + layer.strokes.length, 0),
      maximumLayerStrokes: Math.max(...sanitized.masks.layers.map(layer => layer.strokes.length)),
      uniqueIds: new Set(sanitized.masks.layers.map(layer => layer.id)).size,
      safeIds: sanitized.masks.layers.every(layer => /^[A-Za-z0-9_-]+$/.test(layer.id)),
      namesBounded: sanitized.masks.layers.every(layer => layer.name.length <= 60),
      typesSafe: sanitized.masks.layers.every(layer => ['subject', 'sky', 'brush', 'linear', 'radial'].includes(layer.type)),
      activeValid: sanitized.masks.layers.some(layer => layer.id === sanitized.masks.activeId),
      boundedLayer: {
        x: sanitized.masks.layers[0].x,
        y: sanitized.masks.layers[0].y,
        opacity: sanitized.masks.layers[0].opacity,
        brushSize: sanitized.masks.layers[0].brushSize,
      },
      cleanup: sanitized.cleanup.length,
      boundedCleanup: sanitized.cleanup[0],
    };

    const neutral = surface();
    const baseEdits = E.defaultEdits();
    const baseRender = E.render(neutral, baseEdits);
    const baseValue = luminance(pixel(baseRender, 12, 80));
    const linearEdits = E.defaultEdits();
    linearEdits.masks = {
      activeId: 'linear',
      layers: [E.defaultMaskLayer({ id: 'linear', name: 'Linear', type: 'linear', x: 0, y: 0.5, x2: 1, y2: 0.5, subjectExposure: 1, show: false })],
    };
    const linear = E.render(neutral, linearEdits);
    const linearLeft = luminance(pixel(linear, 12, 80));
    const linearRight = luminance(pixel(linear, 227, 80));
    linearEdits.masks.layers[0].opacity = 50;
    const halfLinear = E.render(neutral, linearEdits);
    const halfLinearLeft = luminance(pixel(halfLinear, 12, 80));
    linearEdits.masks.layers[0].enabled = false;
    const hiddenLinear = E.render(neutral, linearEdits);
    const hiddenDelta = maximumDelta(pixels(baseRender), pixels(hiddenLinear));

    const radialEdits = E.defaultEdits();
    radialEdits.masks = {
      activeId: 'radial',
      layers: [E.defaultMaskLayer({ id: 'radial', name: 'Radial', type: 'radial', x: 0.5, y: 0.5, x2: 0.76, y2: 0.5, feather: 0, subjectExposure: 1, show: false })],
    };
    const radial = E.render(neutral, radialEdits);
    const radialCenter = luminance(pixel(radial, 120, 80));
    const radialCorner = luminance(pixel(radial, 8, 8));

    const dodgeBurnEdits = E.defaultEdits();
    const dodge = E.defaultMaskLayer({
      id: 'dodge', name: 'Dodge', type: 'brush', subjectExposure: 0.65, toneRange: 'midtones', protectTones: true, show: false,
      strokes: [{ x: 0.25, y: 0.5, size: 35, feather: 0, flow: 100, mode: 'add' }],
    });
    const burn = E.defaultMaskLayer({
      id: 'burn', name: 'Burn', type: 'brush', subjectExposure: -0.65, toneRange: 'midtones', protectTones: true, show: false,
      strokes: [{ x: 0.75, y: 0.5, size: 35, feather: 0, flow: 100, mode: 'add' }],
    });
    dodgeBurnEdits.masks = { activeId: dodge.id, layers: [dodge, burn] };
    const dodgeBurn = E.render(neutral, dodgeBurnEdits);
    const dodgeBurnState = {
      base: baseValue,
      dodge: luminance(pixel(dodgeBurn, 60, 80)),
      burn: luminance(pixel(dodgeBurn, 180, 80)),
    };

    const cloneSource = surface(240, 160, 'rgb(120 120 120)');
    const cloneContext = cloneSource.getContext('2d');
    cloneContext.fillStyle = 'rgb(20 70 220)';
    cloneContext.fillRect(28, 20, 40, 40);
    const cloneEdits = E.defaultEdits();
    cloneEdits.cleanup = [{ kind: 'clone', space: 'frame', x: 0.8, y: 0.25, sourceX: 0.2, sourceY: 0.25, size: 8, feather: 0, opacity: 100 }];
    const cloned = E.render(cloneSource, cloneEdits);

    const healSource = surface(240, 160, 'rgb(55 100 135)');
    const healContext = healSource.getContext('2d');
    healContext.fillStyle = 'rgb(235 235 235)';
    healContext.fillRect(28, 84, 40, 40);
    const healEdits = E.defaultEdits();
    healEdits.cleanup = [{ kind: 'heal', space: 'frame', x: 0.8, y: 0.65, sourceX: 0.2, sourceY: 0.65, size: 8, feather: 0, opacity: 100 }];
    const healed = E.render(healSource, healEdits);

    const eyeSource = surface(240, 160, 'rgb(90 90 90)');
    const eyeContext = eyeSource.getContext('2d');
    eyeContext.fillStyle = 'rgb(235 22 20)';
    eyeContext.beginPath();
    eyeContext.arc(120, 80, 17, 0, Math.PI * 2);
    eyeContext.fill();
    eyeContext.fillStyle = 'white';
    eyeContext.beginPath();
    eyeContext.arc(113, 73, 3, 0, Math.PI * 2);
    eyeContext.fill();
    const eyeEdits = E.defaultEdits();
    eyeEdits.cleanup = [{ kind: 'red-eye', space: 'frame', x: 0.5, y: 0.5, size: 10, feather: 65, opacity: 100, pupilSize: 100, darken: 100 }];
    const correctedEye = E.render(eyeSource, eyeEdits);
    const retouchState = {
      cloneSource: pixel(cloneSource, 48, 40),
      cloneTarget: pixel(cloned, 192, 40),
      healBefore: luminance(pixel(healSource, 192, 104)),
      healAfter: luminance(pixel(healed, 192, 104)),
      eyeBefore: pixel(eyeSource, 120, 80),
      eyeAfter: pixel(correctedEye, 120, 80),
      catchlightAfter: pixel(correctedEye, 113, 73),
    };

    const legacyRepairSource = surface(240, 160, 'rgb(45 85 115)');
    const legacyRepairContext = legacyRepairSource.getContext('2d');
    legacyRepairContext.fillStyle = 'rgb(235 235 235)';
    legacyRepairContext.beginPath();
    legacyRepairContext.arc(0.51 * legacyRepairSource.width, 0.5 * legacyRepairSource.height, 18, 0, Math.PI * 2);
    legacyRepairContext.fill();
    const legacyRepairEdits = E.defaultEdits();
    legacyRepairEdits.cleanup = [{ kind: 'heal', space: 'frame', x: 0.4, y: 0.5, size: 5, feather: 0, opacity: 100 }];
    const migratedLegacyRepair = E.migratedEdits(legacyRepairEdits).cleanup[0];
    const legacyRepairRendered = E.render(legacyRepairSource, legacyRepairEdits);
    const legacyRepairState = {
      radiusPx: migratedLegacyRepair.radiusPx,
      sourceX: migratedLegacyRepair.sourceX,
      before: luminance(pixel(legacyRepairSource, 0.4 * legacyRepairSource.width, 0.5 * legacyRepairSource.height)),
      after: luminance(pixel(legacyRepairRendered, 0.4 * legacyRepairRendered.width, 0.5 * legacyRepairRendered.height)),
    };

    const anchorSource = surface(800, 500, 'rgb(72 78 84)');
    const anchorContext = anchorSource.getContext('2d');
    const disk = (point, radius, color) => {
      anchorContext.fillStyle = color;
      anchorContext.beginPath();
      anchorContext.arc(point.x * anchorSource.width, point.y * anchorSource.height, radius, 0, Math.PI * 2);
      anchorContext.fill();
    };
    const originalSpots = {
      heal: { kind: 'heal', space: 'source', x: 0.38, y: 0.38, sourceX: 0.28, sourceY: 0.38, radiusPx: 24, size: 3, feather: 0, opacity: 100 },
      clone: { kind: 'clone', space: 'source', x: 0.62, y: 0.38, sourceX: 0.28, sourceY: 0.62, radiusPx: 24, size: 3, feather: 0, opacity: 100 },
      'red-eye': { kind: 'red-eye', space: 'source', x: 0.62, y: 0.62, radiusPx: 24, size: 3, feather: 50, opacity: 100, pupilSize: 100, darken: 100 },
    };
    disk({ x: 0.28, y: 0.38 }, 38, 'rgb(238 238 238)');
    disk({ x: 0.38, y: 0.38 }, 34, 'rgb(30 95 120)');
    disk({ x: 0.28, y: 0.62 }, 38, 'rgb(18 64 224)');
    disk({ x: 0.62, y: 0.38 }, 34, 'rgb(225 190 35)');
    disk({ x: 0.62, y: 0.62 }, 34, 'rgb(238 20 18)');

    const transformPoint = (point, operation) => operation === 'right'
      ? { x: 1 - point.y, y: point.x }
      : operation === 'left'
        ? { x: point.y, y: 1 - point.x }
        : operation === 'flip-x'
          ? { x: 1 - point.x, y: point.y }
          : { x: point.x, y: 1 - point.y };
    const remapSpot = (spot, operations) => operations.reduce((value, operation) => {
      const target = transformPoint(value, operation);
      const source = value.sourceX == null || value.sourceY == null ? null : transformPoint({ x: value.sourceX, y: value.sourceY }, operation);
      return { ...value, ...target, ...(source ? { sourceX: source.x, sourceY: source.y } : {}) };
    }, { ...spot });
    const physicalPoint = (point, geometry) => {
      let value = { ...point };
      if (geometry.flipX) value.x = 1 - value.x;
      if (geometry.flipY) value.y = 1 - value.y;
      const rotation = ((geometry.rotation90 || 0) % 360 + 360) % 360;
      if (rotation === 90) value = { x: 1 - value.y, y: value.x };
      else if (rotation === 180) value = { x: 1 - value.x, y: 1 - value.y };
      else if (rotation === 270) value = { x: value.y, y: 1 - value.x };
      return value;
    };
    const changedFootprint = (before, after, expected) => {
      const a = pixels(before), b = pixels(after);
      let count = 0, minX = after.width, minY = after.height, maxX = -1, maxY = -1, sumX = 0, sumY = 0;
      for (let y = 0; y < after.height; y += 1) for (let x = 0; x < after.width; x += 1) {
        const offset = (y * after.width + x) * 4;
        const delta = Math.abs(a[offset] - b[offset]) + Math.abs(a[offset + 1] - b[offset + 1]) + Math.abs(a[offset + 2] - b[offset + 2]);
        if (delta <= 12) continue;
        count += 1;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); sumX += x; sumY += y;
      }
      const centerX = count ? sumX / count : -100000;
      const centerY = count ? sumY / count : -100000;
      return {
        count,
        width: count ? maxX - minX + 1 : 0,
        height: count ? maxY - minY + 1 : 0,
        centerError: Math.hypot(centerX - expected.x, centerY - expected.y),
        center: [centerX, centerY],
      };
    };
    const orientationVariants = [];
    for (let turns = 0; turns < 4; turns += 1) for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const operations = Array.from({ length: turns }, () => 'right');
      const swapsAxes = turns % 2 === 1;
      if (flipX) operations.push(swapsAxes ? 'flip-y' : 'flip-x');
      if (flipY) operations.push(swapsAxes ? 'flip-x' : 'flip-y');
      orientationVariants.push({
        name: `r${turns * 90}-x${Number(flipX)}-y${Number(flipY)}`,
        geometry: { rotation90: turns * 90, flipX, flipY, cropZoom: 150 },
        operations,
      });
    }
    const variants = [
      { name: 'identity', geometry: {}, operations: [] },
      { name: 'crop-offset', geometry: { cropZoom: 150, cropX: 8, cropY: -6 }, operations: [] },
      { name: 'aspect-square', geometry: { cropAspect: 'Square' }, operations: [] },
      { name: 'aspect-portrait', geometry: { cropAspect: '4 × 5' }, operations: [] },
      { name: 'aspect-wide', geometry: { cropAspect: '16 × 9' }, operations: [] },
      ...orientationVariants,
    ];
    const radiusAnchoring = [];
    for (const variant of variants) for (const [kind, original] of Object.entries(originalSpots)) {
      const edits = E.defaultEdits();
      Object.assign(edits.geometry, variant.geometry);
      const stored = remapSpot(original, variant.operations);
      const baseline = E.render(anchorSource, edits, { maxEdge: 800 });
      edits.cleanup = [stored];
      const rendered = E.render(anchorSource, edits, { maxEdge: 800 });
      const physical = physicalPoint(original, edits.geometry);
      const expectedNormalized = E.sourcePointToOutput(anchorSource, edits, physical.x, physical.y);
      const expected = { x: expectedNormalized.x * rendered.width, y: expectedNormalized.y * rendered.height };
      const footprint = changedFootprint(baseline, rendered, expected);
      radiusAnchoring.push({
        variant: variant.name,
        kind,
        output: [rendered.width, rendered.height],
        stored: [stored.x, stored.y],
        expected: [expected.x, expected.y],
        ...footprint,
        centerPixel: pixel(rendered, Math.max(0, Math.min(rendered.width - 1, expected.x)), Math.max(0, Math.min(rendered.height - 1, expected.y))),
      });
    }
    const halfEdits = E.defaultEdits();
    const halfBaseline = E.render(anchorSource, halfEdits, { maxEdge: 400 });
    halfEdits.cleanup = [originalSpots.clone];
    const halfRendered = E.render(anchorSource, halfEdits, { maxEdge: 400 });
    const halfPoint = E.sourcePointToOutput(anchorSource, halfEdits, originalSpots.clone.x, originalSpots.clone.y);
    const halfResolutionFootprint = changedFootprint(halfBaseline, halfRendered, { x: halfPoint.x * halfRendered.width, y: halfPoint.y * halfRendered.height });

    const geometry = E.defaultEdits();
    geometry.geometry.rotate = 7;
    geometry.geometry.scale = 108;
    geometry.geometry.horizontal = 4;
    geometry.geometry.vertical = -3;
    const sourcePoint = { x: 0.48, y: 0.52 };
    const outputPoint = E.sourcePointToOutput(neutral, geometry, sourcePoint.x, sourcePoint.y);
    const roundTrip = E.outputPointToSource(neutral, geometry, outputPoint.x, outputPoint.y);
    const sourceRoundTripError = Math.hypot(sourcePoint.x - roundTrip.x, sourcePoint.y - roundTrip.y);

    return {
      legacyState,
      sanitizedState,
      gradients: { baseValue, linearLeft, linearRight, halfLinearLeft, hiddenDelta, radialCenter, radialCorner },
      dodgeBurnState,
      retouchState,
      legacyRepairState,
      radiusAnchoring,
      halfResolutionFootprint,
      sourceRoundTripError,
    };
  });

  await page.evaluate(() => {
    current.edits = E.defaultEdits();
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    clearPresetTracking();
    refreshControls();
    scheduleRender();
  });
  await waitForPreview(page);
  await page.click('#maskPanelTab');

  await page.click('#addLinearMask');
  const linearArmed = await page.evaluate(() => toolMode === 'mask-linear');
  await dragAcrossCanvas(page, [0.18, 0.34], [0.82, 0.67]);
  const linearUi = await page.evaluate(() => {
    const layer = activeMask();
    return {
      type: layer.type,
      space: layer.space,
      distance: Math.hypot(layer.x2 - layer.x, layer.y2 - layer.y),
      guideVisible: !gradientGuide.classList.contains('hidden'),
      history: historyStacks()[0].at(-1)?.label,
    };
  });

  await page.click('#addRadialMask');
  const radialArmed = await page.evaluate(() => toolMode === 'mask-radial');
  await dragAcrossCanvas(page, [0.48, 0.46], [0.72, 0.64]);
  const radialUi = await page.evaluate(() => ({ type: activeMask().type, distance: Math.hypot(activeMask().x2 - activeMask().x, activeMask().y2 - activeMask().y), guideVisible: !gradientGuide.classList.contains('hidden') }));

  await page.click('#addDodgeMask');
  const dodgeArmed = await page.evaluate(() => toolMode === 'mask-add');
  await dragAcrossCanvas(page, [0.28, 0.46], [0.38, 0.54]);
  await page.click('#addBurnMask');
  const burnArmed = await page.evaluate(() => toolMode === 'mask-add');
  if (burnArmed) await dragAcrossCanvas(page, [0.65, 0.43], [0.76, 0.56]);

  const stackBefore = await page.evaluate(() => ({
    names: current.edits.masks.layers.map(layer => layer.name),
    types: current.edits.masks.layers.map(layer => layer.type),
    dodge: current.edits.masks.layers.find(layer => layer.name === 'Dodge'),
    burn: current.edits.masks.layers.find(layer => layer.name === 'Burn'),
    countLabel: maskLayerCount.textContent,
  }));

  await page.locator('[data-path="mask.opacity"]').evaluate(element => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    element.value = '42';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitForPreview(page);
  await page.locator('#maskList .mask-row').first().locator('.mask-eye').click();
  await waitForPreview(page);
  const beforeOrder = await page.evaluate(() => current.edits.masks.layers.map(layer => layer.id));
  await page.click('#maskMoveDown');
  const afterOrder = await page.evaluate(() => current.edits.masks.layers.map(layer => layer.id));
  await page.click('#undoBtn');
  const orderAfterUndo = await page.evaluate(() => current.edits.masks.layers.map(layer => layer.id));
  await page.click('#redoBtn');
  const orderAfterRedo = await page.evaluate(() => current.edits.masks.layers.map(layer => layer.id));
  await page.fill('#maskName', 'Burn shadows');
  await page.locator('#maskName').dispatchEvent('change');
  const stackAfter = await page.evaluate(() => ({
    order: current.edits.masks.layers.map(layer => layer.name),
    active: activeMask().name,
    opacity: activeMask().opacity,
    enabled: activeMask().enabled,
  }));

  const canvasBox = await page.locator('#canvas').boundingBox();
  const clickCanvas = async (x, y) => page.mouse.click(canvasBox.x + canvasBox.width * x, canvasBox.y + canvasBox.height * y);
  await page.click('#cleanupMaskBtn');
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.7, canvasBox.y + canvasBox.height * 0.3);
  const retouchCursor = await page.evaluate(() => {
    const canvasRect = canvas.getBoundingClientRect(), cursorRect = brushCursor.getBoundingClientRect(), x = 0.7, y = 0.3, cssRadius = cursorRect.width / 2;
    const rotation = ((current.edits.geometry.rotation90 % 360) + 360) % 360, swap = rotation === 90 || rotation === 270, width = swap ? sourceImage.naturalHeight : sourceImage.naturalWidth, height = swap ? sourceImage.naturalWidth : sourceImage.naturalHeight;
    const center = E.outputPointToSource(sourceImage, current.edits, x, y), dx = cssRadius / canvasRect.width, dy = cssRadius / canvasRect.height;
    const horizontal = E.outputPointToSource(sourceImage, current.edits, x - dx, y), vertical = E.outputPointToSource(sourceImage, current.edits, x, y + dy);
    const expectedRadiusPx = (Math.hypot((horizontal.x - center.x) * width, (horizontal.y - center.y) * height) + Math.hypot((vertical.x - center.x) * width, (vertical.y - center.y) * height)) / 2;
    const sampleOutputX = x - current.edits.retouch.size / 100 * 2.2, expectedSample = E.outputPointToSource(sourceImage, current.edits, sampleOutputX, y);
    return { visible: !brushCursor.classList.contains('hidden'), cursorDiameter: cursorRect.width, canvasSize: [canvasRect.width, canvasRect.height], expectedRadiusPx, expectedSample };
  });
  await clickCanvas(0.7, 0.3);
  await page.click('#cloneMaskBtn');
  await clickCanvas(0.22, 0.25);
  await clickCanvas(0.72, 0.7);
  await page.click('#redEyeMaskBtn');
  await clickCanvas(0.51, 0.48);
  await waitForPreview(page);
  const repairs = await page.evaluate(() => E.clone(current.edits.cleanup));
  const healSampleAnchor = await page.evaluate(() => {
    const repair = current.edits.cleanup[0], target = E.sourcePointToOutput(sourceImage, current.edits, repair.x, repair.y), delta = repair.size / 100 * 2.2, direction = target.x > 0.5 ? -1 : 1;
    const expected = E.outputPointToSource(sourceImage, current.edits, Math.max(0, Math.min(1, target.x + direction * delta)), target.y);
    return { expected, error: Math.hypot(repair.sourceX - expected.x, repair.sourceY - expected.y) };
  });

  const remapMatrix = await page.evaluate(() => {
    const saved = E.clone(current.edits);
    const original = {
      layer: E.defaultMaskLayer({
        id: 'matrix-gradient', name: 'Matrix gradient', type: 'linear', x: 0.31, y: 0.27, x2: 0.73, y2: 0.68,
        strokes: [{ x: 0.44, y: 0.55, size: 12, feather: 40, flow: 70, mode: 'add' }],
      }),
      repair: { kind: 'clone', space: 'source', x: 0.62, y: 0.34, sourceX: 0.23, sourceY: 0.71, radiusPx: 42, size: 3, feather: 50, opacity: 90 },
    };
    const physical = (point, geometry) => {
      let value = { ...point };
      if (geometry.flipX) value.x = 1 - value.x;
      if (geometry.flipY) value.y = 1 - value.y;
      const rotation = ((geometry.rotation90 % 360) + 360) % 360;
      if (rotation === 90) value = { x: 1 - value.y, y: value.x };
      else if (rotation === 180) value = { x: 1 - value.x, y: 1 - value.y };
      else if (rotation === 270) value = { x: value.y, y: 1 - value.x };
      return value;
    };
    const cases = [];
    for (const order of ['rotate-first', 'flip-first']) for (let turns = 0; turns < 4; turns += 1) for (const flipX of [false, true]) for (const flipY of [false, true]) {
      current.edits = E.defaultEdits();
      current.edits.masks = { activeId: original.layer.id, layers: [E.clone(original.layer)] };
      current.edits.cleanup = [E.clone(original.repair)];
      const rotate = () => { current.edits.geometry.rotation90 += 90; remapEditPoints('right'); };
      const flipHorizontal = () => { current.edits.geometry.flipX = !current.edits.geometry.flipX; remapEditPoints('flip-x'); };
      const flipVertical = () => { current.edits.geometry.flipY = !current.edits.geometry.flipY; remapEditPoints('flip-y'); };
      if (order === 'rotate-first') {
        for (let index = 0; index < turns; index += 1) rotate();
        if (flipX) flipHorizontal();
        if (flipY) flipVertical();
      } else {
        if (flipX) flipHorizontal();
        if (flipY) flipVertical();
        for (let index = 0; index < turns; index += 1) rotate();
      }
      const geometry = current.edits.geometry;
      const layer = current.edits.masks.layers[0];
      const repair = current.edits.cleanup[0];
      const comparisons = [
        [layer, physical(original.layer, geometry)],
        [{ x: layer.x2, y: layer.y2 }, physical({ x: original.layer.x2, y: original.layer.y2 }, geometry)],
        [layer.strokes[0], physical(original.layer.strokes[0], geometry)],
        [repair, physical(original.repair, geometry)],
        [{ x: repair.sourceX, y: repair.sourceY }, physical({ x: original.repair.sourceX, y: original.repair.sourceY }, geometry)],
      ];
      let maximumError = 0;
      for (const [actual, expected] of comparisons) maximumError = Math.max(maximumError, Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y));
      cases.push({ order, turns, flipX, flipY, maximumError, radiusError: Math.abs(repair.radiusPx - original.repair.radiusPx) });
    }
    current.edits = saved;
    refreshControls();
    scheduleRender();
    return { cases, maximumError: Math.max(...cases.map(item => item.maximumError)), maximumRadiusError: Math.max(...cases.map(item => item.radiusError)) };
  });
  await waitForPreview(page);

  const beforeRotation = await page.evaluate(() => E.clone(current.edits));
  await page.click('#rotateRight');
  await waitForPreview(page);
  const rotation = await page.evaluate(before => {
    const expected = point => ({ x: 1 - point.y, y: point.x });
    let maximumError = 0;
    let maximumRadiusError = 0;
    const compare = (actual, prior) => {
      const target = expected(prior);
      maximumError = Math.max(maximumError, Math.abs(actual.x - target.x), Math.abs(actual.y - target.y));
    };
    current.edits.masks.layers.forEach((layer, index) => {
      const prior = before.masks.layers[index];
      compare(layer, prior);
      compare({ x: layer.x2, y: layer.y2 }, { x: prior.x2, y: prior.y2 });
      layer.strokes.forEach((stroke, strokeIndex) => compare(stroke, prior.strokes[strokeIndex]));
    });
    current.edits.cleanup.forEach((spot, index) => {
      const prior = before.cleanup[index];
      compare(spot, prior);
      maximumRadiusError = Math.max(maximumRadiusError, Math.abs((spot.radiusPx || 0) - (prior.radiusPx || 0)));
      if (prior.sourceX != null && prior.sourceY != null) compare({ x: spot.sourceX, y: spot.sourceY }, { x: prior.sourceX, y: prior.sourceY });
    });
    return { rotation90: current.edits.geometry.rotation90, maximumError, maximumRadiusError, after: E.clone(current.edits) };
  }, beforeRotation);
  await page.click('#undoBtn');
  const undoRestoredRotation = await page.evaluate(before => JSON.stringify(current.edits) === JSON.stringify(before), beforeRotation);
  await page.click('#redoBtn');
  const redoRestoredRotation = await page.evaluate(after => JSON.stringify(current.edits) === JSON.stringify(after), rotation.after);
  await page.click('#undoBtn');

  const persistenceBefore = await page.evaluate(() => {
    const saved = saveCatalog({ silent: true });
    const payload = JSON.parse(localStorage.getItem(CATALOG_KEY));
    return {
      saved,
      checksumValid: payload.checksum === checksum(JSON.stringify(payload.photos)),
      edits: E.clone(current.edits),
      serialized: JSON.stringify(current.edits),
      maskCount: current.edits.masks.layers.length,
      cleanupCount: current.edits.cleanup.length,
    };
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => current?.id === 'layered-photo' && sourceImage.naturalWidth > 0, null, { timeout: 30000 });
  await waitForPreview(page);
  const persistenceAfter = await page.evaluate(serialized => ({
    exact: JSON.stringify(current.edits) === serialized,
    maskCount: current.edits.masks.layers.length,
    cleanupCount: current.edits.cleanup.length,
    activeValid: current.edits.masks.layers.some(layer => layer.id === current.edits.masks.activeId),
  }), persistenceBefore.serialized);
  await page.click('#maskPanelTab');
  const persistedUi = await page.evaluate(() => ({ rows: document.querySelectorAll('#maskList .mask-row').length, countLabel: maskLayerCount.textContent }));

  await page.evaluate(() => {
    current.edits.masks.layers.forEach(layer => { layer.show = false; });
    refreshControls();
    scheduleRender();
  });
  await waitForPreview(page);
  const parity = await previewExportParity(page);
  await page.evaluate(() => {
    current.edits.geometry.cropZoom = 135;
    current.edits.geometry.cropX = 7;
    current.edits.geometry.cropY = -5;
    current.edits.geometry.rotation90 += 90;
    remapEditPoints('right');
    current.edits.geometry.flipX = !current.edits.geometry.flipX;
    remapEditPoints('flip-x');
    refreshControls();
    scheduleRender();
  });
  await waitForPreview(page);
  const transformedParity = await previewExportParity(page);
  await page.evaluate(() => { if (toolMode === 'cleanup') toolMode = ''; setTool('cleanup'); });
  const transformedCanvasBox = await page.locator('#canvas').boundingBox();
  await page.mouse.move(transformedCanvasBox.x + transformedCanvasBox.width * 0.55, transformedCanvasBox.y + transformedCanvasBox.height * 0.55);
  const transformedRetouchCursor = await page.evaluate(() => {
    const canvasRect = canvas.getBoundingClientRect(), cursorRect = brushCursor.getBoundingClientRect(), x = 0.55, y = 0.55, cssRadius = cursorRect.width / 2;
    const rotation = ((current.edits.geometry.rotation90 % 360) + 360) % 360, swap = rotation === 90 || rotation === 270, width = swap ? sourceImage.naturalHeight : sourceImage.naturalWidth, height = swap ? sourceImage.naturalWidth : sourceImage.naturalHeight;
    const center = E.outputPointToSource(sourceImage, current.edits, x, y), dx = cssRadius / canvasRect.width, dy = cssRadius / canvasRect.height;
    const horizontal = E.outputPointToSource(sourceImage, current.edits, x - dx, y), vertical = E.outputPointToSource(sourceImage, current.edits, x, y - dy);
    const expectedRadiusPx = (Math.hypot((horizontal.x - center.x) * width, (horizontal.y - center.y) * height) + Math.hypot((vertical.x - center.x) * width, (vertical.y - center.y) * height)) / 2;
    return { visible: !brushCursor.classList.contains('hidden'), cursorDiameter: cursorRect.width, canvasSize: [canvasRect.width, canvasRect.height], expectedRadiusPx };
  });
  await page.mouse.click(transformedCanvasBox.x + transformedCanvasBox.width * 0.55, transformedCanvasBox.y + transformedCanvasBox.height * 0.55);
  await waitForPreview(page);
  const transformedHeal = await page.evaluate(() => E.clone(current.edits.cleanup.at(-1)));

  const failures = [];
  const legacy = engine.legacyState;
  if (legacy.version !== 5 || legacy.layers !== 1 || legacy.activeId !== 'legacy-mask' || legacy.type !== 'subject' || legacy.space !== 'frame' || legacy.exposure !== 0.55 || legacy.strokes !== 1 || legacy.protectTones !== false || legacy.parityMaxDelta !== 0 || legacy.inertLayers !== 0) failures.push('Version 2 local-mask migration lost state or render parity');
  const sanitize = engine.sanitizedState;
  if (sanitize.layers !== 8 || sanitize.totalStrokes !== 1024 || sanitize.maximumLayerStrokes !== 256 || sanitize.uniqueIds !== 8 || !sanitize.safeIds || !sanitize.namesBounded || !sanitize.typesSafe || !sanitize.activeValid || sanitize.boundedLayer.x !== 0 || sanitize.boundedLayer.y !== 1 || sanitize.boundedLayer.opacity !== 100 || sanitize.boundedLayer.brushSize !== 100 || sanitize.cleanup !== 200 || sanitize.boundedCleanup.x !== 0 || sanitize.boundedCleanup.y !== 1 || sanitize.boundedCleanup.radiusPx !== 100000 || sanitize.boundedCleanup.size !== 25 || sanitize.boundedCleanup.opacity !== 1 || sanitize.boundedCleanup.kind !== 'heal') failures.push('Mask or repair sanitization limits failed');
  const gradients = engine.gradients;
  if (!(gradients.linearLeft > gradients.linearRight + 35 && gradients.halfLinearLeft > gradients.baseValue + 10 && gradients.halfLinearLeft < gradients.linearLeft - 10 && gradients.hiddenDelta === 0 && gradients.radialCenter > gradients.radialCorner + 45)) failures.push('Linear/radial mask rendering, opacity, or visibility failed');
  if (!(engine.dodgeBurnState.dodge > engine.dodgeBurnState.base + 5 && engine.dodgeBurnState.burn < engine.dodgeBurnState.base - 5)) failures.push('Dodge and burn masks did not lighten and darken independently');
  const retouch = engine.retouchState;
  if (!(retouch.cloneTarget[2] > retouch.cloneTarget[0] * 2 && retouch.cloneTarget[2] > 170 && retouch.healAfter > retouch.healBefore + 40 && retouch.eyeAfter[0] < retouch.eyeBefore[0] - 40 && retouch.catchlightAfter[0] > 225 && retouch.catchlightAfter[1] > 225 && retouch.catchlightAfter[2] > 225)) failures.push('Clone, heal, or red-eye pixel behavior failed');
  if (engine.legacyRepairState.radiusPx !== null || engine.legacyRepairState.sourceX !== null || engine.legacyRepairState.after < engine.legacyRepairState.before + 40) failures.push('Legacy cleanup fallback compatibility failed');
  const anchoredFootprints = engine.radiusAnchoring;
  const expectedFootprintCases = (5 + 4 * 2 * 2) * 3;
  const invalidFootprints = anchoredFootprints.filter(item => item.count < 500 || item.width < 45 || item.width > 49 || item.height < 45 || item.height > 49 || item.centerError > 1.5 || item.kind === 'clone' && !(item.centerPixel[2] > 180 && item.centerPixel[2] > item.centerPixel[0] * 2) || item.kind === 'heal' && item.centerPixel[0] < 180 || item.kind === 'red-eye' && item.centerPixel[0] > 30);
  if (anchoredFootprints.length !== expectedFootprintCases || invalidFootprints.length || engine.halfResolutionFootprint.width < 23 || engine.halfResolutionFootprint.width > 25 || engine.halfResolutionFootprint.height < 23 || engine.halfResolutionFootprint.height > 25 || engine.halfResolutionFootprint.centerError > 1.5) failures.push('Source-pixel repair footprints detached or scaled incorrectly through crop, rotation, flip, or output resize');
  if (engine.sourceRoundTripError > 1e-9) failures.push('Source/output coordinate mapping did not round-trip');
  if (!linearArmed || linearUi.type !== 'linear' || linearUi.space !== 'source' || linearUi.distance < 0.2 || !linearUi.guideVisible || linearUi.history !== 'Set mask gradient') failures.push('Linear gradient UI gesture failed');
  if (!radialArmed || radialUi.type !== 'radial' || radialUi.distance < 0.1 || !radialUi.guideVisible) failures.push('Radial gradient UI gesture failed');
  if (!dodgeArmed || !burnArmed || stackBefore.dodge?.subjectExposure !== 0.35 || stackBefore.burn?.subjectExposure !== -0.35 || stackBefore.dodge?.toneRange !== 'midtones' || stackBefore.burn?.toneRange !== 'midtones' || !stackBefore.dodge?.protectTones || !stackBefore.burn?.protectTones || !stackBefore.dodge?.strokes.length || !stackBefore.burn?.strokes.length) failures.push('Consecutive Dodge/Burn creation or painting failed');
  if (stackBefore.names.join(',') !== 'Burn,Dodge,Radial gradient 1,Linear gradient 1' || stackBefore.types.join(',') !== 'brush,brush,radial,linear' || stackBefore.countLabel !== '4 / 8') failures.push('Mask stack create order or labels failed');
  if (beforeOrder.join(',') === afterOrder.join(',') || orderAfterUndo.join(',') !== beforeOrder.join(',') || orderAfterRedo.join(',') !== afterOrder.join(',') || stackAfter.active !== 'Burn shadows' || stackAfter.opacity !== 42 || stackAfter.enabled !== false) failures.push('Mask reorder, opacity, visibility, rename, undo, or redo failed');
  if (repairs.map(repair => repair.kind).join(',') !== 'heal,clone,red-eye' || repairs.some(repair => repair.space !== 'source' || !Number.isFinite(repair.radiusPx) || repair.radiusPx <= 0) || repairs[0].sourceX == null || repairs[0].sourceY == null || repairs[1].sourceX == null || repairs[1].sourceY == null || healSampleAnchor.error > 1e-9) failures.push('Heal, clone, or red-eye UI records are incomplete or not source anchored');
  if (!retouchCursor.visible || Math.abs(repairs[0].radiusPx - retouchCursor.expectedRadiusPx) > 0.5 || Math.abs(retouchCursor.canvasSize[0] / retouchCursor.canvasSize[1] - 1) < 0.2) failures.push('Stored repair radius does not match the visible retouch cursor on a non-square photo');
  if (remapMatrix.cases.length !== 32 || remapMatrix.maximumError > 1e-9 || remapMatrix.maximumRadiusError > 1e-9) failures.push('Mask, gradient, stroke, or repair remapping diverged from renderer orientation across rotate/flip combinations');
  if (rotation.rotation90 !== 90 || rotation.maximumError > 1e-9 || rotation.maximumRadiusError > 1e-9 || !undoRestoredRotation || !redoRestoredRotation) failures.push('Mask/repair rotation anchoring or history failed');
  if (!persistenceBefore.saved || !persistenceBefore.checksumValid || !persistenceAfter.exact || persistenceAfter.maskCount !== persistenceBefore.maskCount || persistenceAfter.cleanupCount !== persistenceBefore.cleanupCount || !persistenceAfter.activeValid || persistedUi.rows !== persistenceBefore.maskCount || persistedUi.countLabel !== `${persistenceBefore.maskCount} / 8`) failures.push('Layered edits did not persist exactly across a catalog reload');
  if (parity.previewSize.join(',') !== parity.exportSize.join(',') || parity.maximumDelta > 1 || parity.meanDelta > 0.02 || !parity.workerReleased) failures.push('Settled preview and lossless background export diverged');
  if (transformedParity.previewSize.join(',') !== transformedParity.exportSize.join(',') || transformedParity.maximumDelta > 1 || transformedParity.meanDelta > 0.02 || !transformedParity.workerReleased) failures.push('Crop/rotate/flip preview and lossless background export diverged');
  if (!transformedRetouchCursor.visible || transformedHeal.kind !== 'heal' || transformedHeal.sourceX == null || transformedHeal.sourceY == null || Math.abs(transformedHeal.radiusPx - transformedRetouchCursor.expectedRadiusPx) > 0.5 || transformedRetouchCursor.canvasSize[1] <= transformedRetouchCursor.canvasSize[0]) failures.push('Crop/rotate/aspect repair radius or explicit Heal sample is incorrect');
  if (errors.length) failures.push('Renderer emitted unexpected errors');

  const radiusSummary = {
    cases: anchoredFootprints.length,
    variants: [...new Set(anchoredFootprints.map(item => item.variant))],
    maximumCenterError: Math.max(...anchoredFootprints.map(item => item.centerError)),
    footprintWidths: [Math.min(...anchoredFootprints.map(item => item.width)), Math.max(...anchoredFootprints.map(item => item.width))],
    footprintHeights: [Math.min(...anchoredFootprints.map(item => item.height)), Math.max(...anchoredFootprints.map(item => item.height))],
    invalid: invalidFootprints,
    halfResolution: engine.halfResolutionFootprint,
  };
  const report = {
    engine: { ...engine, radiusAnchoring: radiusSummary },
    ui: {
      linearArmed,
      linearUi,
      radialArmed,
      radialUi,
      dodgeArmed,
      burnArmed,
      stackBefore: {
        names: stackBefore.names,
        types: stackBefore.types,
        countLabel: stackBefore.countLabel,
        dodge: stackBefore.dodge && { exposure: stackBefore.dodge.subjectExposure, toneRange: stackBefore.dodge.toneRange, protectTones: stackBefore.dodge.protectTones, strokes: stackBefore.dodge.strokes.length },
        burn: stackBefore.burn && { exposure: stackBefore.burn.subjectExposure, toneRange: stackBefore.burn.toneRange, protectTones: stackBefore.burn.protectTones, strokes: stackBefore.burn.strokes.length },
      },
      stackAfter,
      repairs,
      retouchCursor: { ...retouchCursor, radiusPx: repairs[0].radiusPx, sampleAnchor: healSampleAnchor },
      remapMatrix: { cases: remapMatrix.cases.length, maximumError: remapMatrix.maximumError, maximumRadiusError: remapMatrix.maximumRadiusError },
      rotation: { rotation90: rotation.rotation90, maximumError: rotation.maximumError, maximumRadiusError: rotation.maximumRadiusError, undoRestoredRotation, redoRestoredRotation },
      persistence: {
        before: { saved: persistenceBefore.saved, checksumValid: persistenceBefore.checksumValid, maskCount: persistenceBefore.maskCount, cleanupCount: persistenceBefore.cleanupCount },
        after: persistenceAfter,
        ui: persistedUi,
      },
    },
    parity,
    transformedParity,
    transformedRetouch: { cursor: transformedRetouchCursor, repair: transformedHeal },
    errors,
    failures,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await app.close();
  await fixtures.cleanup();
  if (failures.length) throw new Error(failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await app?.close(); } catch {}
  try { await fixtures?.cleanup(); } catch {}
  process.exitCode = 1;
});
