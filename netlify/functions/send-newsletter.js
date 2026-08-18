/**
 * send-newsletter.js — Netlify Function for authenticated newsletter dispatch.
 *
 * POST /.netlify/functions/send-newsletter
 * Body (JSON): { entry, mode }
 *   entry: CMS newsletter entry object
 *   mode: "test" | "production"
 * Headers: Authorization: Bearer <netlify-identity-jwt>
 *
 * Reads subscribers from Netlify Forms (form: newsletter-top).
 * Sends via Resend REST API (no npm dependency — plain fetch).
 * Signs unsubscribe links with HMAC-SHA256.
 *
 * Fail-closed: missing env vars return 503 with setup instructions.
 * Subscriber addresses are never returned to the browser.
 */

'use strict';

const { createHmac, createHash } = require('crypto');
const { renderEmail } = require('./render-email');

const ELISA_EMAIL = 'elisa@tradgardsfloristen.se';
const FROM_ADDRESS = 'Trädgårdsfloristen <nyhetsbrev@tradgardsfloristen.se>';
const REPLY_TO = 'elisa@tradgardsfloristen.se';
const MAX_RECIPIENTS = 50;

// --- Env validation helpers -------------------------------------------------

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Miljövariabel saknas: ${name}. Lägg till den i Netlify → Site configuration → Environment variables.`);
  return val;
}

// --- HMAC unsubscribe signature ---------------------------------------------

/**
 * Build a signed unsubscribe URL for one email address.
 * token = HMAC-SHA256(secret, email), hex-encoded (first 32 chars = 128 bits).
 */
function buildUnsubscribeUrl(email, secret, endpointUrl) {
  const token = createHmac('sha256', secret).update(email).digest('hex').slice(0, 32);
  const params = new URLSearchParams({ email, token });
  return `${endpointUrl}?${params}`;
}

/** Verify an unsubscribe token. Returns true if valid. */
function verifyUnsubscribeToken(email, token, secret) {
  if (typeof email !== 'string' || typeof token !== 'string') return false;
  const expected = createHmac('sha256', secret).update(email).digest('hex').slice(0, 32);
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

// --- Netlify Identity authorization ----------------------------------------
// Netlify validates the bearer token before invoking a function and exposes
// the trusted result in context.clientContext.user. Never decode an unsigned
// browser-supplied JWT here: that would let anyone forge an admin identity.

function authorizeIdentityUser(clientContext) {
  const user = clientContext && clientContext.user;
  if (!user || !user.email) return false;
  if (user.email.trim().toLowerCase() !== ELISA_EMAIL) return false;
  return { email: ELISA_EMAIL };
}

// --- Subscriber deduplication & validation ----------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function deduplicateEmails(emails) {
  const seen = new Set();
  const result = [];
  for (const raw of emails) {
    const addr = String(raw || '').trim().toLowerCase();
    if (EMAIL_RE.test(addr) && !seen.has(addr)) {
      seen.add(addr);
      result.push(addr);
    }
  }
  return result;
}

// --- Idempotency key --------------------------------------------------------

function makeIdempotencyKey(entryId, contentHash, mode) {
  return createHash('sha256').update(`${entryId}:${contentHash}:${mode}`).digest('hex').slice(0, 24);
}

// --- Netlify Forms subscriber fetch ----------------------------------------

async function fetchSubscribers(netlifyApiToken, siteId) {
  const url = `https://api.netlify.com/api/v1/sites/${siteId}/submissions?form_name=newsletter-top&per_page=100`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${netlifyApiToken}`,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Netlify Forms API svarade ${resp.status}: ${body.slice(0, 200)}`);
  }
  const submissions = await resp.json();
  // Each submission has data.email
  return submissions
    .map((s) => s.data?.email || s.email)
    .filter(Boolean);
}

// --- Resend send (single recipient) ----------------------------------------

async function sendViaResend(apiKey, { to, subject, html, listUnsubscribeUrl, idempotencyKey }) {
  const body = {
    from: FROM_ADDRESS,
    reply_to: REPLY_TO,
    to: [to],
    subject,
    html,
    headers: {
      'List-Unsubscribe': `<${listUnsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(`Resend ${resp.status}: ${err.message || JSON.stringify(err)}`);
  }
  return await resp.json();
}

// --- Main handler -----------------------------------------------------------

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1. Auth check
  const user = authorizeIdentityUser(context?.clientContext);
  if (!user) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Ej inloggad — logga in via Netlify Identity.' }),
    };
  }

  // 2. Parse body before mode-specific configuration checks.
  // Test sends do not need Forms API access; production broadcasts do.
  // The unsubscribe secret is still required in both modes because every
  // delivered message contains signed opt-out links.
  let entry, mode;
  try {
    const parsed = JSON.parse(event.body || '{}');
    entry = parsed.entry;
    mode = parsed.mode; // "test" | "production"
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Ogiltig JSON i request body.' }),
    };
  }

  // 3. Mode-specific env check (fail closed with useful messages)
  let RESEND_API_KEY, NETLIFY_API_TOKEN, NEWSLETTER_UNSUBSCRIBE_SECRET;
  try {
    RESEND_API_KEY = requireEnv('RESEND_API_KEY');
    NEWSLETTER_UNSUBSCRIBE_SECRET = requireEnv('NEWSLETTER_UNSUBSCRIBE_SECRET');
    if (mode === 'production') NETLIFY_API_TOKEN = requireEnv('NETLIFY_API_TOKEN');
  } catch (err) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Konfigurationsfel: ${err.message}` }),
    };
  }

  // 4. Validate body
  if (!entry || !entry.subject) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'entry.subject saknas.' }),
    };
  }

  if (mode !== 'test' && mode !== 'production') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'mode måste vara "test" eller "production".' }),
    };
  }

  // 4. Determine recipients
  const SITE_ID = process.env.NETLIFY_SITE_ID || '5ad5ca28-68dd-4ca5-866a-5a3f729e7863';
  const baseUrl = process.env.URL || 'https://www.tradgardsfloristen.se';

  let recipients;
  if (mode === 'test') {
    recipients = [ELISA_EMAIL];
  } else {
    // production — fetch from Netlify Forms
    let rawEmails;
    try {
      rawEmails = await fetchSubscribers(NETLIFY_API_TOKEN, SITE_ID);
    } catch (err) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Kunde inte hämta prenumeranter: ${err.message}` }),
      };
    }
    recipients = deduplicateEmails(rawEmails);
    if (recipients.length > MAX_RECIPIENTS) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Listan har ${recipients.length} prenumeranter. Säkerhetsgränsen är ${MAX_RECIPIENTS}; inget skickades.` }),
      };
    }
    if (recipients.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, sent: 0, message: 'Inga aktiva prenumeranter hittades.' }),
      };
    }
  }

  // 5. Send to each recipient individually
  const errors = [];
  let sent = 0;
  const contentHash = createHash('sha256').update(JSON.stringify(entry)).digest('hex');

  for (const email of recipients) {
    const unsubUrl = buildUnsubscribeUrl(email, NEWSLETTER_UNSUBSCRIBE_SECRET, `${baseUrl}/avsluta`);
    const oneClickUrl = buildUnsubscribeUrl(email, NEWSLETTER_UNSUBSCRIBE_SECRET, `${baseUrl}/avsluta-one-click`);
    const html = renderEmail(entry, unsubUrl);
    try {
      await sendViaResend(RESEND_API_KEY, {
        to: email,
        subject: entry.subject,
        html,
        listUnsubscribeUrl: oneClickUrl,
        idempotencyKey: makeIdempotencyKey(email, contentHash, mode),
      });
      sent++;
    } catch (err) {
      errors.push({ email: '[dold]', error: err.message });
    }
  }

  // 6. Honest status — never claim success if any failed
  if (errors.length > 0 && sent === 0) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Alla ${errors.length} utskick misslyckades. Första felet: ${errors[0].error}`,
      }),
    };
  }

  if (errors.length > 0) {
    return {
      statusCode: 207,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        sent,
        failed: errors.length,
        message: `${sent} utskick lyckades, ${errors.length} misslyckades. Kontrollera Resend-loggar.`,
      }),
    };
  }

  const message = mode === 'test'
    ? `Test skickat till ${ELISA_EMAIL}`
    : `Skickat till ${sent} prenumeranter`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, sent, message }),
  };
};

// Export helpers for testing
exports._helpers = {
  escHtml: require('./render-email').escHtml,
  isSafeUrl: require('./render-email').isSafeUrl,
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
  deduplicateEmails,
  authorizeIdentityUser,
  makeIdempotencyKey,
};
