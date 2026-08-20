const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `legacy-edit-migration-${process.pid}`);
fs.mkdirSync(userData, { recursive: true });

let app;

(async () => {
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
    cwd: userData,
  });

  let page = await app.firstWindow();
  await page.waitForTimeout(800);
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  page.on('pageerror', error => errors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.waitForSelector('body');

  const result = await page.evaluate(() => {
    const clamp = value => Math.max(0, Math.min(1, value));
    const smooth = value => value * value * (3 - 2 * value);
    const imageData = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    const difference = (a, b) => {
      const left = imageData(a), right = imageData(b);
      let maximum = 0;
      let total = 0;
      let changed = 0;
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        const delta = Math.abs(left[index] - right[index]);
        maximum = Math.max(maximum, delta);
        total += delta;
        if (delta) changed += 1;
      }
      return { maximum, mean: total / Math.max(1, left.length), changed };
    };
    const surface = (width, height, fill = '#606060') => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = fill;
      context.fillRect(0, 0, width, height);
      return canvas;
    };

    // Frozen v2.1 Object-mask oracle. This intentionally does not call the
    // current migration or renderer for the local mask calculation.
    const legacyMaskSource = surface(240, 160);
    const legacyMaskSourceContext = legacyMaskSource.getContext('2d');
    legacyMaskSourceContext.fillStyle = '#df573f';
    legacyMaskSourceContext.fillRect(35, 35, 80, 90);
    legacyMaskSourceContext.fillStyle = '#3779ca';
    legacyMaskSourceContext.fillRect(145, 20, 70, 120);
    const legacyMask = {
      enabled: true,
      type: 'subject',
      x: 0.28,
      y: 0.5,
      size: 42,
      feather: 18,
      subjectExposure: 0.55,
      backgroundExposure: -0.15,
      show: false,
    };
    const expectedMask = surface(240, 160);
    const expectedMaskContext = expectedMask.getContext('2d', { willReadFrequently: true });
    expectedMaskContext.drawImage(legacyMaskSource, 0, 0);
    const expectedMaskImage = expectedMaskContext.getImageData(0, 0, expectedMask.width, expectedMask.height);
    for (let y = 0, pixel = 0; y < expectedMask.height; y += 1) {
      for (let x = 0; x < expectedMask.width; x += 1, pixel += 1) {
        const offset = pixel * 4;
        const dx = (x / expectedMask.width - legacyMask.x) / (legacyMask.size / 100);
        const dy = (y / expectedMask.height - legacyMask.y) / (legacyMask.size / 100 * 0.72);
        const distance = Math.hypot(dx, dy);
        const edge = Math.max(0.02, legacyMask.feather / 100);
        const weight = 1 - smooth(clamp((distance - (1 - edge)) / edge));
        const scale = Math.pow(2, legacyMask.subjectExposure * weight + legacyMask.backgroundExposure * (1 - weight));
        expectedMaskImage.data[offset] = clamp(expectedMaskImage.data[offset] / 255 * scale) * 255;
        expectedMaskImage.data[offset + 1] = clamp(expectedMaskImage.data[offset + 1] / 255 * scale) * 255;
        expectedMaskImage.data[offset + 2] = clamp(expectedMaskImage.data[offset + 2] / 255 * scale) * 255;
      }
    }
    expectedMaskContext.putImageData(expectedMaskImage, 0, 0);
    const legacyMaskEdits = { version: 2, mask: legacyMask };
    const migratedMask = E.migratedEdits(legacyMaskEdits);
    const actualMask = E.render(legacyMaskSource, migratedMask, { maxEdge: null });

    // Frozen v2.1 cleanup oracle.
    const cleanupSource = surface(240, 160, '#777');
    const cleanupSourceContext = cleanupSource.getContext('2d');
    cleanupSourceContext.fillStyle = 'rgb(20 80 230)';
    cleanupSourceContext.fillRect(195, 55, 40, 50);
    cleanupSourceContext.fillStyle = 'rgb(220 90 30)';
    cleanupSourceContext.fillRect(160, 60, 35, 40);
    const legacySpot = { x: 0.72, y: 0.5, size: 8 };
    const expectedCleanup = surface(240, 160);
    const expectedCleanupContext = expectedCleanup.getContext('2d');
    expectedCleanupContext.drawImage(cleanupSource, 0, 0);
    const cleanupX = legacySpot.x * expectedCleanup.width;
    const cleanupY = legacySpot.y * expectedCleanup.height;
    const cleanupRadius = Math.max(4, legacySpot.size / 100 * expectedCleanup.width);
    expectedCleanupContext.save();
    expectedCleanupContext.beginPath();
    expectedCleanupContext.arc(cleanupX, cleanupY, cleanupRadius, 0, Math.PI * 2);
    expectedCleanupContext.clip();
    expectedCleanupContext.globalAlpha = 0.88;
    expectedCleanupContext.drawImage(
      cleanupSource,
      cleanupX + cleanupRadius * 0.8,
      cleanupY - cleanupRadius,
      cleanupRadius * 2,
      cleanupRadius * 2,
      cleanupX - cleanupRadius,
      cleanupY - cleanupRadius,
      cleanupRadius * 2,
      cleanupRadius * 2,
    );
    expectedCleanupContext.restore();
    const migratedCleanup = E.migratedEdits({ version: 2, cleanup: [legacySpot] });
    const actualCleanup = E.render(cleanupSource, migratedCleanup, { maxEdge: null });

    // Track every temporary canvas allocation while rendering a hostile but
    // schema-valid radius. The main 300x300 transform should remain the peak;
    // the repair patch must be clipped to the 30x30 output intersection.
    const hostileSource = surface(300, 300, '#777');
    const hostileSourceContext = hostileSource.getContext('2d');
    hostileSourceContext.fillStyle = '#2874df';
    hostileSourceContext.fillRect(105, 135, 30, 30);
    const hostile = E.defaultEdits();
    hostile.geometry.scale = 400;
    hostile.geometry.cropZoom = 1000;
    hostile.cleanup = [{
      kind: 'clone',
      space: 'source',
      x: 0.5,
      y: 0.5,
      sourceX: 0.4,
      sourceY: 0.5,
      radiusPx: 100000,
      size: 25,
      feather: 65,
      opacity: 100,
    }];
    const prototype = HTMLCanvasElement.prototype;
    const widthDescriptor = Object.getOwnPropertyDescriptor(prototype, 'width');
    const heightDescriptor = Object.getOwnPropertyDescriptor(prototype, 'height');
    let peakPixels = 0;
    const observe = canvas => { peakPixels = Math.max(peakPixels, canvas.width * canvas.height); };
    Object.defineProperty(prototype, 'width', {
      configurable: true,
      enumerable: widthDescriptor.enumerable,
      get: widthDescriptor.get,
      set(value) { widthDescriptor.set.call(this, value); observe(this); },
    });
    Object.defineProperty(prototype, 'height', {
      configurable: true,
      enumerable: heightDescriptor.enumerable,
      get: heightDescriptor.get,
      set(value) { heightDescriptor.set.call(this, value); observe(this); },
    });
    let hostileRender;
    try {
      hostileRender = E.render(hostileSource, hostile, { maxEdge: null });
    } finally {
      Object.defineProperty(prototype, 'width', widthDescriptor);
      Object.defineProperty(prototype, 'height', heightDescriptor);
    }

    const modernKindless = E.migratedEdits({ version: 4, cleanup: [legacySpot] }).cleanup[0];
    return {
      mask: {
        migration: migratedMask.masks.layers[0],
        difference: difference(expectedMask, actualMask),
      },
      cleanup: {
        migration: migratedCleanup.cleanup[0],
        modernKindless,
        difference: difference(expectedCleanup, actualCleanup),
      },
      hostile: {
        output: [hostileRender.width, hostileRender.height],
        peakPixels,
      },
    };
  });

  const failures = [];
  if (result.mask.migration.legacyShape !== 'ellipse-v2' || result.mask.migration.space !== 'frame') failures.push('v2 Object mask did not retain its legacy frame-space shape');
  if (result.mask.difference.maximum > 1 || result.mask.difference.mean > 0.1) failures.push('v2 Object mask pixels diverged from the frozen renderer oracle');
  if (result.cleanup.migration.kind !== 'legacy-v2' || result.cleanup.migration.space !== 'frame' || result.cleanup.migration.feather !== 0 || result.cleanup.migration.opacity !== 88) failures.push('v2 cleanup spot did not retain its legacy renderer semantics');
  if (result.cleanup.difference.maximum !== 0 || result.cleanup.difference.changed !== 0) failures.push('v2 cleanup pixels diverged from the frozen renderer oracle');
  if (result.cleanup.modernKindless.kind !== 'heal') failures.push('v4 kindless cleanup fallback was incorrectly treated as a legacy repair');
  if (result.hostile.output.join(',') !== '30,30' || result.hostile.peakPixels > 90000) failures.push('Hostile repair radius caused an out-of-bounds temporary canvas allocation');
  if (errors.length) failures.push('Renderer emitted unexpected errors');

  const report = { ...result, errors, failures };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await app.close();
  if (failures.length) throw new Error(failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await app?.close(); } catch {}
  process.exitCode = 1;
});
