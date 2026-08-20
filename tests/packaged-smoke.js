const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

(async () => {
  const root = path.resolve(__dirname, '..');
  const packagedAsarMode = process.env.LUMA_PACKAGED_ASAR === '1';
  const executablePath = process.env.LUMA_EXECUTABLE_PATH
    ? path.resolve(process.env.LUMA_EXECUTABLE_PATH)
    : packagedAsarMode
      ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
      : path.join(root, 'outputs', 'release', 'win-unpacked', 'Luma Darkroom.exe');
  const userData = path.join(root, 'work', `packaged-data-${process.pid}`);
  const runtimeCwd = path.join(userData, 'cwd');
  fs.mkdirSync(runtimeCwd, { recursive: true });
  const fixtures = await createPhotoFixtures(1);
  const [sample] = fixtures.paths;
  const gpuArgs = process.env.LUMA_GPU_SANDBOX_OFF ? ['--disable-gpu-sandbox'] : process.env.LUMA_NORMAL_GPU ? [] : [
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-software-rasterizer',
    '--in-process-gpu',
  ];
  const errors = [];
  const launchOptions = {
    args: [...gpuArgs, `--user-data-dir=${userData}`],
    cwd: runtimeCwd,
  };
  if (process.env.LUMA_SOURCE) launchOptions.args.push(root);
  else {
    launchOptions.executablePath = executablePath;
    if (packagedAsarMode) launchOptions.args.push(path.join(root, 'outputs', 'release', 'win-unpacked', 'resources', 'app.asar'));
  }
  const app = await electron.launch(launchOptions);
  app.process().stdout?.on('data', (chunk) => console.log(`stdout: ${chunk}`));
  app.process().stderr?.on('data', (chunk) => console.error(`stderr: ${chunk}`));

  try {
    let page = await app.firstWindow();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const liveWindows = app.windows().filter((window) => !window.isClosed());
    page = liveWindows.at(-1) || page;
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.waitForTimeout(2500);
    const initial = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      body: document.body?.innerText?.slice(0, 500),
      html: document.documentElement?.outerHTML?.slice(0, 1000),
    }));
    console.log(JSON.stringify({ initial }, null, 2));
    await page.waitForSelector('main', { timeout: 10000 });
    if (await page.locator('#tutorialDialog[open]').count()) {
      await page.click('#tutorialSkip');
      await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
    }
    const appPath = await app.evaluate(({ app: electronApp }) => electronApp.getAppPath());
    await page.evaluate((filePath) => {
      const photo = E.migratePhoto({ id: 'packaged-probe', filePath, name: 'sample.jpg', edits: null });
      photos = [photo];
      selectPhoto(photo);
    }, sample);
    await page.waitForFunction(() => canvas.width > 500 && canvas.height > 300, null, { timeout: 15000 });
    await page.click('#exportBtn');
    await page.waitForSelector('#exportDialog[open]');
    const state = await page.evaluate(() => ({
      title: document.title,
      canvas: [canvas.width, canvas.height],
      panels: document.querySelectorAll('.panel').length,
      formats: [...document.querySelectorAll('#exportFormat option')].map((option) => option.textContent.trim()),
      bridge: typeof window.desktop,
      requireType: typeof window.require,
      processType: typeof window.process,
    }));
    console.log(JSON.stringify({ appPath, state, errors }, null, 2));
    if (errors.length || state.bridge !== 'object' || state.requireType !== 'undefined' || state.processType !== 'undefined') {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
    await fixtures.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
