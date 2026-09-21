import https from 'node:https';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { retryTransfer } from './retry.mjs';

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export function validateRemoteURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('僅允許公開 HTTPS 來源');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (ipaddr.isValid(host) && !isPublicAddress(host))) throw new Error('拒絕本機或私人網路來源');
  return url;
}

// Resolve once per request and pin the validated address to the TLS connection.
export function remoteBytes(value, options = {}) {
  return retryTransfer(() => singleTransfer(value, options), { signal: options.signal });
}

async function singleTransfer(value, { maxBytes = 32 * 1024 * 1024, signal, redirects = 5 } = {}) {
  const url = validateRemoteURL(value);
  signal?.throwIfAborted();
  const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('來源 DNS 包含非公開位址');
  addresses.sort((a, b) => a.family - b.family);
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      signal, agent: false,
      headers: { 'User-Agent': 'sportsmedicine-review/1.0', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        if (!redirects || !response.headers.location) return reject(new Error('全文來源重新導向過多或缺少位置'));
        try { singleTransfer(new URL(response.headers.location, url), { maxBytes, signal, redirects: redirects - 1 }).then(resolve, reject); } catch (error) { reject(error); }
        return;
      }
      if (status !== 200) { response.resume(); return reject(Object.assign(new Error(`來源回應 HTTP ${status}`), { status })); }
      if (Number(response.headers['content-length']) > maxBytes) { response.destroy(); return reject(new Error('來源檔案超過大小限制')); }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > maxBytes) response.destroy(new Error('來源檔案超過大小限制')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), url: url.href, headers: response.headers }));
    });
    const deadline = setTimeout(() => request.destroy(Object.assign(new Error('來源連線逾時'), { code: 'ETIMEDOUT' })), 45000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
  });
}

export async function remoteJSON(url, options) {
  return JSON.parse((await remoteBytes(url, { maxBytes: 2 * 1024 * 1024, ...options })).bytes.toString('utf8'));
}
