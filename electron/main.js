const { app, BrowserWindow, dialog, ipcMain, shell, protocol, crashReporter } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const sharp = require('sharp');
const INDEX_PATH = path.join(__dirname, '..', 'src', 'index.html');
const APP_PAGE_URL = pathToFileURL(INDEX_PATH).toString();

// The renderer can only request this main-process-owned, allowlisted guide URL;
// it cannot provide an arbitrary external destination.
const HELP_GUIDE_URL = 'https://lumadarkroom.com/';
const HELP_GUIDE_ALLOWED_URLS = new Set(HELP_GUIDE_URL ? [HELP_GUIDE_URL] : []);

crashReporter.start({ uploadToServer: false, compress: true });
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
process.on('unhandledRejection', (reason) => console.error('Unhandled main-process rejection', reason));

protocol.registerSchemesAsPrivileged([{ scheme: 'local-image', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const imageUrl = filePath => `local-image://load?path=${encodeURIComponent(filePath)}`;
const directImageTypes = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp' };
const convertedImageTypes = new Set(['.tif','.tiff','.avif','.heif','.heic','.dng','.cr2','.cr3','.nef','.nrw','.arw','.srf','.sr2','.raf','.rw2','.orf','.pef','.x3f']);
const decodedCache = new Map();
let decodedCacheBytes = 0;
const safeName = (value, fallback) => path.basename(String(value || fallback)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || fallback;
const cacheDecoded = (key, buffer) => {
  if (buffer.byteLength > 128_000_000) return;
  decodedCache.set(key, buffer);
  decodedCacheBytes += buffer.byteLength;
  while (decodedCache.size > 3 || decodedCacheBytes > 256_000_000) {
    const oldestKey = decodedCache.keys().next().value;
    const oldest = decodedCache.get(oldestKey);
    decodedCache.delete(oldestKey);
    decodedCacheBytes -= oldest?.byteLength || 0;
  }
};
const atomicWrite = async (destination, data, encoding) => {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${Date.now()}.luma-tmp`);
  try {
    const handle = await fs.promises.open(temporary, 'wx');
    try {
      await handle.writeFile(data, encoding);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporary, destination);
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
};
const atomicCopy = async (source, destination) => {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${Date.now()}.luma-tmp`);
  try {
    await fs.promises.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    const handle = await fs.promises.open(temporary, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await fs.promises.rename(temporary, destination);
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
};
let sandboxFallbackUsed = false;
const gpuCompatibilityMarker = path.join(app.getPath('userData'), 'gpu-compatibility-v1');
let gpuCompatibilityApplied = process.platform === 'win32' && fs.existsSync(gpuCompatibilityMarker);
if (gpuCompatibilityApplied) app.commandLine.appendSwitch('disable-gpu-sandbox');

app.on('child-process-gone', (_event, details) => {
  if (process.platform === 'win32' && details.type === 'GPU' && !gpuCompatibilityApplied) {
    gpuCompatibilityApplied = true;
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    try {
      fs.mkdirSync(path.dirname(gpuCompatibilityMarker), { recursive: true });
      fs.writeFileSync(gpuCompatibilityMarker, 'GPU compatibility mode enabled after a helper launch failure.\n');
    } catch (error) {
      console.warn('Could not persist GPU compatibility setting', error.message);
    }
    console.warn('GPU helper failed; enabling the Windows compatibility mode for its retry');
  }
});

function createWindow(useSandbox = true) {
  const win = new BrowserWindow({
    width: 1540, height: 980, minWidth: 900, minHeight: 640,
    backgroundColor: '#111315', autoHideMenuBar: true, icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: useSandbox, webSecurity: true, allowRunningInsecureContent: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== APP_PAGE_URL) event.preventDefault(); });
  win.webContents.on('render-process-gone', (_event, details) => {
    if (useSandbox && details.reason === 'launch-failed' && !sandboxFallbackUsed) {
      sandboxFallbackUsed = true;
      console.warn('Renderer sandbox unavailable; retrying with the isolated compatibility renderer');
      createWindow(false);
      if (!win.isDestroyed()) win.destroy();
      return;
    }
    console.error('Renderer process ended', details.reason, details.exitCode);
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => console.error('Preload failed', preloadPath, error));
  win.webContents.on('did-fail-load', (_event, code, description) => console.error('Page load failed', code, description));
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.loadFile(INDEX_PATH);
}

app.whenReady().then(() => {
  const assertTrustedIpc = event => {
    if (event.senderFrame?.url !== APP_PAGE_URL) throw new Error('Untrusted IPC sender');
  };
  ipcMain.handle('pick-images', async event => {
    assertTrustedIpc(event);
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Photos and camera RAW', extensions: ['jpg','jpeg','png','webp','bmp','gif','tif','tiff','avif','heif','heic','dng','cr2','cr3','nef','nrw','arw','srf','sr2','raf','rw2','orf','pef','x3f'] }] });
    return result.canceled ? [] : result.filePaths.map(filePath => ({ filePath, name: path.basename(filePath), url: imageUrl(filePath) }));
  });
  ipcMain.handle('export-image', async (event, payload = {}) => {
    assertTrustedIpc(event);
    const { dataUrl, bytes, mime, suggestedName, format, quality } = payload && typeof payload === 'object' ? payload : {};
    const allowedMime = new Set(['image/jpeg','image/png','image/webp']);
    let input;
    if (bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes)) {
      const byteLength=bytes.byteLength;
      if (!allowedMime.has(mime) || byteLength < 1 || byteLength > 350_000_000) throw new Error('Invalid binary export payload');
      input = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    } else {
      if (typeof dataUrl !== 'string' || dataUrl.length > 350_000_000 || !/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) throw new Error('Invalid export payload');
      input = Buffer.from(dataUrl.split(',')[1], 'base64');
    }
    const ext = ['png','webp','tiff'].includes(format) ? format : 'jpg';
    const metadata = await sharp(input, { failOn:'warning', limitInputPixels:50_000_000 }).metadata();
    const decodedPixels = Number(metadata.width || 0) * Number(metadata.height || 0) * Math.max(1, Number(metadata.pages || 1));
    const expectedInput = { jpg:'jpeg', png:'png', webp:'webp', tiff:'png' }[ext];
    if (!Number.isSafeInteger(decodedPixels) || decodedPixels < 1 || decodedPixels > 50_000_000 || metadata.format !== expectedInput) throw new Error('Encoded export format or dimensions are invalid');
    const result = await dialog.showSaveDialog({ defaultPath: `${safeName(suggestedName,'edited')}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (result.canceled) return null;
    const output = ext === 'tiff' ? await sharp(input).tiff({ compression:'lzw', quality:Math.max(1,Math.min(100,+quality||92)) }).toBuffer() : input;
    await atomicWrite(result.filePath, output);
    return result.filePath;
  });
  ipcMain.handle('copy-original', async (event, payload = {}) => {
    assertTrustedIpc(event);
    const { filePath, suggestedName } = payload && typeof payload === 'object' ? payload : {};
    if (typeof filePath !== 'string' || !fs.existsSync(filePath) || (!directImageTypes[path.extname(filePath).toLowerCase()] && !convertedImageTypes.has(path.extname(filePath).toLowerCase()))) throw new Error('Original is unavailable');
    const ext = path.extname(filePath).slice(1) || 'img';
    const result = await dialog.showSaveDialog({ defaultPath: safeName(suggestedName,path.basename(filePath)), filters: [{ name: 'Original', extensions: [ext] }] });
    if (result.canceled) return null;
    await atomicCopy(filePath, result.filePath);
    return result.filePath;
  });
  ipcMain.handle('save-catalog', async (event, text) => {
    assertTrustedIpc(event);
    if (typeof text !== 'string' || text.length > 50_000_000) throw new Error('Catalog is too large');
    const result = await dialog.showSaveDialog({ defaultPath: 'Luma-Catalog.json', filters: [{ name: 'Luma Catalog', extensions: ['json'] }] });
    if (result.canceled) return null;
    await atomicWrite(result.filePath, text, 'utf8');
    return result.filePath;
  });
  ipcMain.handle('open-catalog', async event => {
    assertTrustedIpc(event);
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Luma Catalog', extensions: ['json'] }] });
    if (result.canceled) return null;
    const stat = await fs.promises.stat(result.filePaths[0]);
    if (!stat.isFile() || stat.size > 50_000_000) throw new Error('Catalog file is too large');
    return fs.promises.readFile(result.filePaths[0], 'utf8');
  });
  ipcMain.handle('open-help-guide', async event => {
    assertTrustedIpc(event);
    if (!HELP_GUIDE_URL) return { opened: false, reason: 'not-configured' };
    if (!HELP_GUIDE_ALLOWED_URLS.has(HELP_GUIDE_URL)) return { opened: false, reason: 'not-allowed' };
    try {
      const guideUrl = new URL(HELP_GUIDE_URL);
      if (guideUrl.protocol !== 'https:' || guideUrl.username || guideUrl.password) return { opened: false, reason: 'not-allowed' };
      await shell.openExternal(guideUrl.href, { activate: true });
      return { opened: true };
    } catch (error) {
      console.warn('Help guide could not be opened', error.message);
      return { opened: false, reason: 'open-failed' };
    }
  });
  ipcMain.handle('reveal-file', (event, filePath) => {
    assertTrustedIpc(event);
    const ext = typeof filePath === 'string' ? path.extname(filePath).toLowerCase() : '';
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || (!directImageTypes[ext] && !convertedImageTypes.has(ext) && ext !== '.json') || !fs.existsSync(filePath)) return false;
    shell.showItemInFolder(filePath);
    return true;
  });
  protocol.handle('local-image', async request => {
    try {
      const filePath = new URL(request.url).searchParams.get('path');
      if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) return new Response('Not found', { status: 404 });
      const ext = path.extname(filePath).toLowerCase();
      const stat = await fs.promises.stat(filePath);
      let file,type=directImageTypes[ext];
      const maxInputBytes = type ? 256_000_000 : 2_000_000_000;
      if ((!type && !convertedImageTypes.has(ext)) || !stat.isFile() || stat.size > maxInputBytes) return new Response('Unsupported', { status: 403 });
      if (type) {
        const metadata = await sharp(filePath, { failOn:'warning', limitInputPixels:100_000_000, animated:true }).metadata();
        const decodedPixels = Number(metadata.width || 0) * Number(metadata.height || 0) * Math.max(1, Number(metadata.pages || 1));
        if (!Number.isSafeInteger(decodedPixels) || decodedPixels <= 0 || decodedPixels > 100_000_000) {
          return new Response('Image dimensions are too large', { status: 413, headers: { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' } });
        }
        file=await fs.promises.readFile(filePath);
      }
      else {
        const cacheKey=`${filePath}:${stat.mtimeMs}:${stat.size}`;
        file=decodedCache.get(cacheKey);
        if(!file){
          file=await sharp(filePath,{failOn:'warning',limitInputPixels:150_000_000}).rotate().jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
          cacheDecoded(cacheKey,file);
        }
        type='image/jpeg';
      }
      const body = new Uint8Array(file.byteLength);
      body.set(file);
      return new Response(body, { headers: { 'Content-Type': type, 'Access-Control-Allow-Origin':'*', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'private, max-age=3600' } });
    } catch (error) {
      console.error('Image decode failed', error.message);
      return new Response('Image could not be decoded', { status: 422, headers: { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' } });
    }
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(!sandboxFallbackUsed); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
