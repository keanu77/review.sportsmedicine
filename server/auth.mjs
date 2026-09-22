import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApiError } from './errors.mjs';

const keySets = new Map();
export function ownerConfig(env) {
  if (typeof env.OWNER_EMAIL !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL.trim()) || typeof env.ACCESS_AUD !== 'string' || !env.ACCESS_AUD.trim() || typeof env.ACCESS_TEAM_DOMAIN !== 'string' || !env.ACCESS_TEAM_DOMAIN.trim()) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Owner authentication is not configured');
  let issuer;
  try {
    const domain = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
    const url = new URL(domain.startsWith('https://') ? domain : `https://${domain}`);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname) || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error();
    issuer = url.origin;
  } catch { throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Access team domain is invalid'); }
  return { issuer, audience: env.ACCESS_AUD, email: env.OWNER_EMAIL.trim().toLowerCase() };
}
// keyResolver is injectable only through module calls in tests, never environment/request data.
export async function authenticateOwner(request, env, keyResolver) {
  const config = ownerConfig(env);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw new ApiError(401, 'UNAUTHORIZED', 'A valid Cloudflare Access session is required');
  try {
    if (!keyResolver) {
      if (!keySets.has(config.issuer)) keySets.set(config.issuer, createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`)));
      keyResolver = keySets.get(config.issuer);
    }
    const { payload } = await jwtVerify(token, keyResolver, { issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email'] });
    if (typeof payload.email !== 'string' || payload.email.trim().toLowerCase() !== config.email) throw new ApiError(403, 'FORBIDDEN', 'This account is not the configured owner');
    return { email: config.email };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'UNAUTHORIZED', 'The Access session is invalid or expired');
  }
}
export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function workerCredentials(env) {
  const invalid = () => new ApiError(503, 'WORKER_NOT_CONFIGURED', 'Worker credential lifecycle is not configured');
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? Date.parse(value) : NaN;
  const secret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,512}$/.test(value);
  const issued = timestamp(env.WORKER_TOKEN_ISSUED_AT), expires = timestamp(env.WORKER_TOKEN_EXPIRES_AT);
  if (!secret(env.WORKER_TOKEN) || !Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 90 * 86400000) throw invalid();
  const credentials = [{ token: env.WORKER_TOKEN, issued, expires, expiresAt: env.WORKER_TOKEN_EXPIRES_AT }];
  if (env.WORKER_PREVIOUS_TOKEN || env.WORKER_PREVIOUS_TOKEN_EXPIRES_AT) {
    const previousExpires = timestamp(env.WORKER_PREVIOUS_TOKEN_EXPIRES_AT);
    if (!secret(env.WORKER_PREVIOUS_TOKEN) || env.WORKER_PREVIOUS_TOKEN === env.WORKER_TOKEN || !Number.isFinite(previousExpires)
      || previousExpires <= issued || previousExpires > Math.min(expires, issued + 3600000)) throw invalid();
    credentials.push({ token: env.WORKER_PREVIOUS_TOKEN, issued, expires: previousExpires, expiresAt: env.WORKER_PREVIOUS_TOKEN_EXPIRES_AT });
  }
  return credentials;
}
export async function authenticateWorker(request, env, now = Date.now()) {
  const credentials = workerCredentials(env);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 4096) throw new ApiError(401, 'UNAUTHORIZED', 'A worker credential is required');
  const [actual, ...expected] = await Promise.all([sha256(authorization.slice(7)), ...credentials.map(value => sha256(value.token))]);
  let accepted;
  for (let slot = 0; slot < credentials.length; slot++) {
    let difference = 0;
    for (let index = 0; index < expected[slot].length; index++) difference |= actual.charCodeAt(index) ^ expected[slot].charCodeAt(index);
    const credential = credentials[slot];
    if (difference === 0 && now >= credential.issued && now < credential.expires) accepted = { expiresAt: credential.expiresAt };
  }
  if (!accepted) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired worker credential');
  return accepted;
}
export function requireOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const expected = env.APP_ORIGIN || new URL(request.url).origin;
  if (!origin || origin === 'null' || origin !== expected) throw new ApiError(403, 'CSRF_REJECTED', 'A same-origin request is required');
}
