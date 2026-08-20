'use strict';

const { _electron: electron } = require('playwright-core');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MODEL_MANIFEST } = require('../electron/model-manager');

const root = path.resolve(__dirname, '..');
const probes = path.join(root, 'work', 'model-probes');
const localModels = {
  'object-efficient-sam-ti': path.join(probes, 'object-efficient-sam.onnx'),
  'people-pphumanseg': path.join(probes, 'people-pphumanseg.onnx'),
};
const userData = path.join(root, 'work', `ai-segmentation-user-data-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
const modelDirectory = path.join(userData, 'ai-models');

const sha256 = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

let runningApp;

async function livePage(app) {
  let page = await app.firstWindow();
  await page.waitForTimeout(900);
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  await page.waitForSelector('body', { timeout: 15_000 });
  return page;
}

(async () => {
  const requestedModels = new Set(String(process.env.LUMA_AI_TEST_MODELS || '').split(',').map(value => value.trim()).filter(Boolean));
  const available = Object.fromEntries(Object.entries(localModels).map(([id, filePath]) => [id, fs.existsSync(filePath) && (!requestedModels.size || requestedModels.has(id))]));
  const probeContract = {};
  for (const [id, filePath] of Object.entries(localModels)) {
    if (!available[id]) continue;
    const manifest = MODEL_MANIFEST[id];
    const stat = fs.statSync(filePath);
    probeContract[id] = { size: stat.size, sha256: sha256(filePath), expectedSize: manifest.size, expectedSha256: manifest.sha256 };
    if (stat.size !== manifest.size || probeContract[id].sha256 !== manifest.sha256) {
      throw new Error(`Local ${id} probe does not match the pinned model-manager contract`);
    }
  }

  await fs.promises.mkdir(runtimeCwd, { recursive: true });
  await fs.promises.mkdir(modelDirectory, { recursive: true });
  for (const [id, filePath] of Object.entries(localModels)) {
    if (!available[id]) continue;
    await fs.promises.copyFile(filePath, path.join(modelDirectory, MODEL_MANIFEST[id].filename));
  }

  const rendererErrors = [];
  runningApp = await electron.launch({
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
    timeout: 30_000,
  });
  const page = await livePage(runningApp);
  page.on('pageerror', error => rendererErrors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error') rendererErrors.push(`CONSOLE: ${message.text()}`);
  });
  if (await page.locator('#tutorialDialog[open]').count()) {
    await page.click('#tutorialSkip');
    await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
  }

  const report = await page.evaluate(async ({ available }) => {
    const failures = [];
    const progress = [];
    const modelList = await desktop.aiModels.list();
    const modelIds = modelList.map(model => model.id);
    if (JSON.stringify(modelIds) !== JSON.stringify(['object-efficient-sam-ti', 'people-pphumanseg'])) {
      failures.push(`Renderer model list does not match the Worker allowlist: ${JSON.stringify(modelIds)}`);
    }
    for (const model of modelList) {
      if (available[model.id] && (model.state !== 'available' || !model.installed || !model.verified)) {
        failures.push(`Pinned local model was not accepted by the model manager: ${model.id}=${model.state}`);
      }
      const serialized = JSON.stringify(model);
      if (/url|filename|file:\/|\\\\|:\\/.test(serialized)) failures.push(`Model status leaked a URL or filesystem path: ${model.id}`);
    }

    const bitCount = buffer => {
      let count = 0;
      for (const byte of new Uint8Array(buffer)) {
        let value = byte;
        while (value) { value &= value - 1; count++; }
      }
      return count;
    };
    const checksum = buffer => {
      let hash = 2166136261;
      for (const byte of new Uint8Array(buffer)) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const sameBytes = (left, right) => {
      const a = new Uint8Array(left), b = new Uint8Array(right);
      if (a.byteLength !== b.byteLength) return false;
      for (let index = 0; index < a.byteLength; index++) if (a[index] !== b[index]) return false;
      return true;
    };
    const selectedFraction = (result, yStart, yEnd) => {
      const bytes = new Uint8Array(result.bits);
      let selected = 0;
      let total = 0;
      const firstY = Math.max(0, Math.floor(result.height * yStart));
      const lastY = Math.min(result.height, Math.ceil(result.height * yEnd));
      for (let y = firstY; y < lastY; y++) for (let x = 0; x < result.width; x++) {
        const index = y * result.width + x;
        if (bytes[index >> 3] & (1 << (index & 7))) selected++;
        total++;
      }
      return selected / Math.max(1, total);
    };
    const makeScene = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      const context = canvas.getContext('2d');
      const sky = context.createLinearGradient(0, 0, 0, 245);
      sky.addColorStop(0, '#4a91df');
      sky.addColorStop(1, '#a8d5f3');
      context.fillStyle = sky;
      context.fillRect(0, 0, 640, 245);
      context.fillStyle = '#43733c';
      context.fillRect(0, 245, 640, 155);
      context.fillStyle = '#ffffffcc';
      context.beginPath();
      context.ellipse(110, 80, 60, 22, 0, 0, Math.PI * 2);
      context.ellipse(160, 72, 48, 30, 0, 0, Math.PI * 2);
      context.fill();
      // A high-contrast portrait-like foreground gives PP-HumanSeg a stable,
      // entirely synthetic offline input (there are no test-photo licenses).
      context.fillStyle = '#27384a';
      context.beginPath();
      context.ellipse(340, 203, 118, 151, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#d79a71';
      context.beginPath();
      context.ellipse(340, 128, 50, 61, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#26313d';
      context.beginPath();
      context.arc(340, 112, 51, Math.PI, Math.PI * 2);
      context.fill();
      context.fillStyle = '#b8424f';
      context.beginPath();
      context.moveTo(275, 190);
      context.quadraticCurveTo(340, 160, 405, 190);
      context.lineTo(442, 370);
      context.lineTo(238, 370);
      context.closePath();
      context.fill();
      return canvas;
    };

    const client = new LumaAI.LocalSegmentationClient();
    const scene = makeScene();
    let object = { skipped: !available['object-efficient-sam-ti'] };
    if (available['object-efficient-sam-ti']) {
      const stages = [];
      const strokes = [{ kind: 'path', mode: 'add', size: 12, feather: 20, flow: 100, points: [[340 / 640, 220 / 400, 1, 12]] }];
      const first = await client.segmentObject(scene, 'synthetic-portrait', strokes, { threshold: 50, onProgress: stage => { stages.push(stage); progress.push(`object:${stage}`); } });
      const second = await client.segmentObject(scene, 'synthetic-portrait-repeat', strokes, { threshold: 50, onProgress: stage => progress.push(`object-repeat:${stage}`) });
      const selected = bitCount(first.bits);
      object = {
        skipped: false,
        dimensions: [first.width, first.height],
        byteLength: first.bits.byteLength,
        selected,
        checksum: checksum(first.bits),
        repeatChecksum: checksum(second.bits),
        deterministic: sameBytes(first.bits, second.bits),
        elapsed: Math.round(first.elapsed),
        stages,
      };
      if (first.modelId !== 'object-efficient-sam-ti' || first.width !== 1024 || first.height !== 1024 || first.bits.byteLength !== 1024 * 1024 / 8) failures.push(`EfficientSAM returned an invalid result contract: ${JSON.stringify(object)}`);
      if (!object.deterministic) failures.push(`EfficientSAM protobuf repair/inference was not deterministic: ${JSON.stringify(object)}`);
      if (selected < 1_000 || selected > 1024 * 1024 * 0.95) failures.push(`EfficientSAM returned a trivial mask: ${selected} pixels`);
      if (!stages.includes('initializing') || !stages.includes('preparing-image') || !stages.includes('selecting-object')) failures.push(`EfficientSAM progress stages were incomplete: ${JSON.stringify(stages)}`);
    }

    let people = { skipped: !available['people-pphumanseg'] };
    if (available['people-pphumanseg']) {
      const stages = [];
      const first = await client.segmentPeople(scene, { onProgress: stage => { stages.push(stage); progress.push(`people:${stage}`); } });
      const second = await client.segmentPeople(scene, { onProgress: stage => progress.push(`people-repeat:${stage}`) });
      const selected = bitCount(first.bits);
      people = {
        skipped: false,
        dimensions: [first.width, first.height],
        byteLength: first.bits.byteLength,
        selected,
        checksum: checksum(first.bits),
        repeatChecksum: checksum(second.bits),
        deterministic: sameBytes(first.bits, second.bits),
        elapsed: Math.round(first.elapsed),
        labels: first.labels,
        categories: first.categories,
        stages,
      };
      if (first.modelId !== 'people-pphumanseg' || first.width !== 192 || first.height !== 192 || first.bits.byteLength !== 192 * 192 / 8 || JSON.stringify(first.labels) !== '["background","person"]' || JSON.stringify(first.categories) !== '[1]') failures.push(`PP-HumanSeg returned an invalid result contract: ${JSON.stringify(people)}`);
      if (!people.deterministic) failures.push(`PP-HumanSeg inference was not deterministic: ${JSON.stringify(people)}`);
      if (selected < 500 || selected > 192 * 192 * 0.75) failures.push(`PP-HumanSeg returned a trivial mask: ${selected} pixels`);
      if (!stages.includes('initializing') || !stages.includes('finding-people')) failures.push(`PP-HumanSeg progress stages were incomplete: ${JSON.stringify(stages)}`);
    }

    const skyStages = [];
    const firstSkyPromise = client.segmentSky(scene, { onProgress: stage => skyStages.push(stage) });
    const concurrentOutcome = await client.segmentSky(scene).then(
      () => ({ state: 'resolved' }),
      error => ({ state: 'rejected', code: error?.code, message: error?.message })
    );
    const firstSky = await firstSkyPromise;
    const secondSky = await client.segmentSky(scene);
    const sky = {
      dimensions: [firstSky.width, firstSky.height],
      byteLength: firstSky.bits.byteLength,
      selected: bitCount(firstSky.bits),
      checksum: checksum(firstSky.bits),
      repeatChecksum: checksum(secondSky.bits),
      deterministic: sameBytes(firstSky.bits, secondSky.bits),
      topFraction: selectedFraction(firstSky, 0, 0.3),
      bottomFraction: selectedFraction(firstSky, 0.75, 1),
      labels: firstSky.labels,
      source: [firstSky.sourceWidth, firstSky.sourceHeight],
      stages: skyStages,
      concurrentOutcome,
    };
    const expectedSkyBytes = Math.ceil(firstSky.width * firstSky.height / 8);
    if (firstSky.modelId !== 'smart-sky-v1' || firstSky.width !== 512 || firstSky.height !== 320 || firstSky.bits.byteLength !== expectedSkyBytes || JSON.stringify(firstSky.labels) !== '["sky"]') failures.push(`Smart-sky returned an invalid result contract: ${JSON.stringify(sky)}`);
    if (!sky.deterministic || sky.topFraction < 0.7 || sky.bottomFraction > 0.1) failures.push(`Smart-sky did not isolate the connected sky deterministically: ${JSON.stringify(sky)}`);
    if (concurrentOutcome.state !== 'rejected' || concurrentOutcome.code !== 'MODEL_BUSY') failures.push(`Concurrent inference was not rejected safely: ${JSON.stringify(concurrentOutcome)}`);

    const retrieved = {};
    for (const model of modelList) {
      if (!available[model.id]) continue;
      const value = await desktop.aiModels.get(model.id);
      retrieved[model.id] = {
        byteLength: value.buffer?.byteLength,
        keys: Object.keys(value).sort(),
        labels: value.labels,
      };
      if (!(value.buffer instanceof ArrayBuffer) || value.buffer.byteLength !== model.size || Object.hasOwn(value, 'path') || Object.hasOwn(value, 'url') || Object.hasOwn(value, 'filename')) {
        failures.push(`Model get() violated the redacted transferable-buffer contract: ${model.id}`);
      }
    }

    client.close();
    scene.width = scene.height = 1;
    return { modelList, retrieved, object, people, sky, progress, failures };
  }, { available });

  // ORT may emit informational warnings, but renderer errors are regressions.
  if (rendererErrors.length) report.failures.push('Renderer emitted unexpected errors during local inference');
  report.rendererErrors = rendererErrors;
  report.probeContract = probeContract;
  report.available = available;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await runningApp.close();
  await fs.promises.rm(userData, { recursive: true, force: true });
  if (report.failures.length) throw new Error(report.failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await runningApp?.close(); } catch {}
  await fs.promises.rm(userData, { recursive: true, force: true }).catch(() => {});
  process.exitCode = 1;
});
