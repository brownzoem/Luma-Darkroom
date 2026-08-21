importScripts('engine.js');

self.onmessage = async event => {
  const { id, bitmap, edits, maxEdge, watermark, mime, quality } = event.data || {};
  if (!id || !bitmap) return;
  try {
    self.postMessage({ id, progress: 'rendering' });
    let canvas = LumaEngine.render(bitmap, edits, { maxEdge, watermark });
    if (mime === 'image/jpeg' && edits?.geometry?.cropShapeKind) {
      const flattened = new OffscreenCanvas(canvas.width, canvas.height);
      const context = flattened.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, flattened.width, flattened.height);
      context.drawImage(canvas, 0, 0);
      canvas = flattened;
    }
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
