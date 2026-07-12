// utils/safeHttp.js — outbound HTTP for URLs we do not control (crawled pages, user-supplied
// links). Guards against SSRF: only http(s), never resolves to a private/internal address,
// and follows redirects manually so every hop is re-validated.
//
// Validation is pinned to the address the socket actually connects to (via a custom `lookup`),
// not to the hostname. Checking the hostname up front and letting the client re-resolve later
// leaves a DNS-rebinding window: the first lookup answers with a public IP, the second with
// 127.0.0.1. Here the check runs inside the resolution the connection uses.

const axios = require('axios');
const dns = require('dns');
const net = require('net');

const DEFAULT_MAX_REDIRECTS = 3;

// Ranges that must never be reachable from a crawl: loopback, link-local (incl. cloud
// instance metadata at 169.254.169.254), RFC1918, CGNAT, multicast, reserved.
function isBlockedIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;              // link-local + IMDS
  if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16/12
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;                // 192.0.0/24 protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true;    // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true;                            // multicast + reserved
  return false;
}

function isBlockedIPv6(ip) {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms defer to the v4 rules.
  const mapped = v.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (/^f[cd]/.test(v)) return true;                    // fc00::/7 unique-local
  if (/^fe[89ab]/.test(v)) return true;                 // fe80::/10 link-local
  return false;
}

function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true; // unparseable — refuse
}

// A dns.lookup drop-in that rejects private destinations. axios forwards `lookup` to
// http.request, so this runs for the connection actually being opened.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const blocked = list.find((a) => isBlockedAddress(a.address));
    if (blocked) {
      return callback(new Error(`blocked internal address ${blocked.address} for host ${hostname}`));
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function assertSafeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`malformed url: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`blocked protocol: ${url.protocol}`);
  }
  // A literal IP in the URL never reaches DNS, so check it here too.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new Error(`blocked internal address ${host}`);
  }
  return url;
}

/**
 * GET a URL we do not control. Redirects are followed manually, re-validating each hop.
 * `allowedContentTypes` (substring match) rejects non-document responses before we read them.
 * Returns the axios response of the final hop.
 */
async function safeGet(rawUrl, { maxRedirects = DEFAULT_MAX_REDIRECTS, allowedContentTypes, ...axiosOptions } = {}) {
  let target = assertSafeUrl(rawUrl).href;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await axios.get(target, {
      ...axiosOptions,
      maxRedirects: 0, // we follow them ourselves so each hop is re-validated
      lookup: guardedLookup,
      validateStatus: (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers?.location;
      if (!location) throw new Error(`redirect with no location from ${target}`);
      target = assertSafeUrl(new URL(location, target).href).href;
      continue;
    }

    if (allowedContentTypes?.length) {
      const ct = String(res.headers?.['content-type'] || '').toLowerCase();
      if (!allowedContentTypes.some((t) => ct.includes(t))) {
        throw new Error(`unexpected content-type "${ct}" from ${target}`);
      }
    }
    return res;
  }

  throw new Error(`too many redirects (>${maxRedirects}) starting at ${rawUrl}`);
}

module.exports = { safeGet, assertSafeUrl, isBlockedAddress };
