importScripts('engine.js');

self.onmessage = async event => {
  const { id, bitmap, edits, maxEdge, watermark, mime, quality } = event.data || {};
  if (!id || !bitmap) return;
  try {
    self.postMessage({ id, progress: 'rendering' });
    const canvas = LumaEngine.render(bitmap, edits, { maxEdge, watermark });
    self.postMessage({ id, progress: 'encoding' });
    const blob = await canvas.convertToBlob({ type: mime, quality });
    if (!blob.size || blob.size > 350_000_000) throw new RangeError('The encoded export is too large. Choose a smaller output size.');
    const bytes = await blob.arrayBuffer();
    self.postMessage({ id, bytes, mime: blob.type || mime, width: canvas.width, height: canvas.height }, [bytes]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error || 'Export render failed') });
  } finally {
    bitmap.close?.();
  }
};
