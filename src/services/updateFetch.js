/**
 * UPDATE FETCHER — updateFetch.js
 *
 * HTTP client for the updater built on Electron's `net` module (Chromium's network stack).
 * Unlike Node's https it honours the browser's proxy settings (system / PAC / manual), the
 * OS certificate store and the user's TLS policy, so update traffic does not bypass a proxy.
 *
 * Redirects are followed manually so that EVERY hop can be checked against an allow-list
 * (GitHub release downloads redirect to a CDN host).
 *
 * Interface (also implemented by the fakes in tests):
 *   get(url, { headers, validateUrl, maxRedirects, timeoutMs, idleTimeoutMs })
 *     → Promise<{ statusCode, headers, stream, abort }>
 *   `stream` is a Node Readable of the response body; `headers` has lower-case keys / string values.
 */

'use strict';

const { PassThrough } = require('stream');

function createElectronFetcher(electron = require('electron')) {
  const { net, session } = electron;
  if (!net || !session) throw new Error('Electron net/session modules are not available');

  return {
    get(url, { headers = {}, validateUrl, maxRedirects = 5, timeoutMs = 30000, idleTimeoutMs = 30000 } = {}) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let redirects = 0;
        const fail = (err) => { if (!settled) { settled = true; reject(err); } };

        try { if (validateUrl) validateUrl(url); } catch (err) { return fail(err); }

        const req = net.request({
          url,
          method: 'GET',
          session: session.defaultSession,
          redirect: 'manual',
          useSessionCookies: false
        });
        for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);

        const connectTimer = setTimeout(() => { try { req.abort(); } catch (_) { /* ignore */ } fail(new Error('Request timed out')); }, timeoutMs);

        req.on('redirect', (statusCode, method, redirectUrl) => {
          try {
            if (++redirects > maxRedirects) throw new Error('Too many redirects');
            if (validateUrl) validateUrl(redirectUrl);
          } catch (err) {
            try { req.abort(); } catch (_) { /* ignore */ }
            clearTimeout(connectTimer);
            return fail(err);
          }
          req.followRedirect();
        });

        req.on('error', (err) => { clearTimeout(connectTimer); fail(err); });

        req.on('response', (res) => {
          clearTimeout(connectTimer);
          if (settled) return;
          settled = true;

          const out = new PassThrough();
          let idleTimer = null;
          const arm = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              try { req.abort(); } catch (_) { /* ignore */ }
              out.destroy(new Error('Download stalled'));
            }, idleTimeoutMs);
          };
          arm();

          res.on('data', (chunk) => {
            arm();
            if (!out.write(chunk) && typeof res.pause === 'function') res.pause();
          });
          out.on('drain', () => { if (typeof res.resume === 'function') res.resume(); });
          res.on('end', () => { clearTimeout(idleTimer); out.end(); });
          res.on('error', (err) => { clearTimeout(idleTimer); out.destroy(err); });
          res.on('aborted', () => { clearTimeout(idleTimer); out.destroy(new Error('Connection closed before the download finished')); });
          out.on('close', () => clearTimeout(idleTimer));

          const flat = {};
          for (const [k, v] of Object.entries(res.headers || {})) flat[k.toLowerCase()] = Array.isArray(v) ? v[0] : String(v);

          resolve({
            statusCode: res.statusCode,
            headers: flat,
            stream: out,
            abort: () => { try { req.abort(); } catch (_) { /* ignore */ } out.destroy(); }
          });
        });

        req.end();
      });
    }
  };
}

module.exports = { createElectronFetcher };
