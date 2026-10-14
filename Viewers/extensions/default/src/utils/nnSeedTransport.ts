/** Lossless native seed transport; old deployments and browsers keep raw bytes. */
export async function encodeNnSeed(
  seed: Uint8Array,
  gzipSupported: boolean
): Promise<{ blob: Blob; encoding: 'raw' | 'gzip' }> {
  const raw = new Blob([seed], { type: 'application/octet-stream' });
  const Compression = (globalThis as any).CompressionStream;
  if (!gzipSupported || typeof Compression !== 'function' || seed.byteLength < 64 * 1024) {
    return { blob: raw, encoding: 'raw' };
  }
  // Browser streams compress off the JS loop; do not base64-encode or change voxels.
  const compressed = await new Response(raw.stream().pipeThrough(new Compression('gzip'))).blob();
  return compressed.size < raw.size
    ? { blob: compressed, encoding: 'gzip' }
    : { blob: raw, encoding: 'raw' };
}
