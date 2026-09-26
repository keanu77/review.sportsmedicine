import { ApiError } from './errors.mjs';
import { sha256 } from './auth.mjs';

const MB = 1024 * 1024;
const types = {
  'application/pdf': { extensions: ['pdf'], limit: 32 * MB },
  'application/zip': { extensions: ['zip'], limit: 64 * MB },
  'image/png': { extensions: ['png'], limit: 16 * MB },
  'image/jpeg': { extensions: ['jpg', 'jpeg'], limit: 16 * MB },
  'video/mp4': { extensions: ['mp4'], limit: 64 * MB },
  'text/plain': { extensions: ['txt'], limit: 2 * MB },
  'text/markdown': { extensions: ['md'], limit: 2 * MB },
  'application/json': { extensions: ['json'], limit: 2 * MB },
  'application/xml': { extensions: ['xml'], limit: 8 * MB },
};
export async function readLimited(request, limit) {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body is too large');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function validateUpload(request) {
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const type = types[contentType];
  if (!type) throw new ApiError(415, 'UNSUPPORTED_FILE', 'Unsupported artifact content type');
  let name;
  try { name = decodeURIComponent(request.headers.get('X-File-Name') || '').normalize('NFC'); }
  catch { throw new ApiError(400, 'INVALID_FILENAME', 'Invalid file name encoding'); }
  if (!name || name.length > 180 || /[\\/\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name) || name.startsWith('.') || !type.extensions.includes(name.split('.').at(-1).toLowerCase())) throw new ApiError(400, 'INVALID_FILENAME', 'Provide a safe file name with an extension matching its content type');
  const bytes = await readLimited(request, type.limit);
  const start = (...signature) => signature.every((value, index) => bytes[index] === value);
  let valid = bytes.length > 0;
  if (contentType === 'application/pdf') valid &&= start(0x25, 0x50, 0x44, 0x46, 0x2d);
  if (contentType === 'image/png') valid &&= start(137, 80, 78, 71, 13, 10, 26, 10);
  if (contentType === 'image/jpeg') valid &&= start(255, 216, 255);
  // ISO base media: bytes 4-7 are the "ftyp" box type.
  if (contentType === 'video/mp4') valid &&= bytes.length > 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp';
  if (contentType === 'application/zip') valid &&= start(80, 75, 3, 4) || start(80, 75, 5, 6);
  if (contentType.startsWith('text/') || ['application/json', 'application/xml'].includes(contentType)) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      valid &&= !decoded.includes('\0');
      if (contentType === 'application/json') JSON.parse(decoded);
      // Archive only; never resolve entities or interpret XML on the edge.
      if (contentType === 'application/xml') valid &&= /<article(?:\s|>)/.test(decoded.slice(0, 8192)) && !/<(?:html|svg)(?:\s|>)/i.test(decoded.slice(0, 8192));
    } catch { valid = false; }
  }
  if (!valid) throw new ApiError(400, 'INVALID_FILE_CONTENT', 'The artifact content does not match its declared type');
  const digest = await sha256(bytes);
  const declaredHash = request.headers.get('X-Content-SHA256');
  if (declaredHash && declaredHash.toLowerCase() !== digest) throw new ApiError(400, 'CHECKSUM_MISMATCH', 'Artifact SHA-256 does not match');
  return { name, contentType, size: bytes.length, sha256: digest, bytes };
}
export function downloadHeaders(artifact, inline = false) {
  const encodedName = encodeURIComponent(artifact.name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    'Content-Type': artifact.content_type,
    'Content-Length': String(artifact.size),
    'Content-Disposition': `${inline && artifact.content_type.startsWith('image/') ? 'inline' : 'attachment'}; filename="artifact.${artifact.name.split('.').at(-1)}"; filename*=UTF-8''${encodedName}`,
    'X-Content-SHA256': artifact.sha256,
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}
