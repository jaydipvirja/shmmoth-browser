/**
 * CONTENT SECURITY POLICY — csp.js
 *
 * mtc:// pages hold the privileged window.mtcAPI, and they render data that comes
 * from untrusted websites (titles, URLs, cookie names, …). Even if an escaping bug
 * slips in, this policy stops injected markup from executing: no inline scripts,
 * no inline event-handler attributes, scripts only from our own scheme.
 *
 * Sent as an HTTP header on every mtc:// .html response (see setupProtocol in main.js).
 * The browser chrome (file://) carries an equivalent <meta> policy in renderer/index.html.
 */

'use strict';

const MTC_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: http: https: file:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'"
].join('; ');

module.exports = { MTC_PAGE_CSP };
