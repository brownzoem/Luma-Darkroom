importScripts('engine.js');

let sourceBitmap = null;
let sourceToken = null;

function applyClipping(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const shadows = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) < 4;
    const highlights = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 251;
    if (shadows) {
      pixels[index] = 35;
      pixels[index + 1] = 95;
      pixels[index + 2] = 255;
    } else if (highlights) {
      pixels[index] = 255;
      pixels[index + 1] = 45;
      pixels[index + 2] = 38;
    }
  }
  context.putImageData(image, 0, 0);
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'init' && message.bitmap) {
    sourceBitmap?.close?.();
    sourceBitmap = message.bitmap;
    sourceToken = message.token;
    self.postMessage({ type: 'ready', token: sourceToken });
    return;
  }
  if (message.type === 'close') {
    sourceBitmap?.close?.();
    sourceBitmap = null;
    sourceToken = null;
    self.close();
    return;
  }
  if (message.type !== 'render' || !sourceBitmap || message.token !== sourceToken) return;
  try {
    const canvas = LumaEngine.render(sourceBitmap, message.edits, {
      maxEdge: message.maxEdge,
      visualizeMask: message.visualizeMask
    });
    if (message.clipping) applyClipping(canvas);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({
      type: 'rendered',
      token: sourceToken,
      id: message.id,
      draft: !!message.draft,
      preserveCanvas: !!message.preserveCanvas,
      width: canvas.width,
      height: canvas.height,
      bitmap
    }, [bitmap]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      token: sourceToken,
      id: message.id,
      error: String(error?.message || error || 'Preview render failed')
    });
  }
};
