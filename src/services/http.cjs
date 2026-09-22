const ALLOWED_HOSTS = new Set(['snap.fan', 'game-assets.snap.fan']);

// Do not trust Content-Length: cap the decompressed body as it arrives.
async function fetchBytes(url, { maxBytes, contentType, timeout = 12000 }) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    !ALLOWED_HOSTS.has(parsed.hostname)
  )
    throw new Error('Untrusted download URL');
  const response = await fetch(parsed.href, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  });
  try {
    if (!response.ok) throw new Error('Download unavailable');
    if (
      !response.headers.get('content-type')?.split(';')[0].trim().toLowerCase().match(contentType)
    )
      throw new Error('Unexpected content type');
    if (Number(response.headers.get('content-length')) > maxBytes)
      throw new Error('Download too large');
    const chunks = [];
    let size = 0;
    if (!response.body) throw new Error('Empty response');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Download too large');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, size);
  } finally {
    if (response.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
const fetchPage = async (url) =>
  (await fetchBytes(url, { maxBytes: 2 * 1024 * 1024, contentType: /^text\/html$/ })).toString(
    'utf8',
  );
module.exports = { fetchBytes, fetchPage };
