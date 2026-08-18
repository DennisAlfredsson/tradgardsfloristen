/**
 * unsubscribe.js — Netlify Function for HMAC-verified newsletter unsubscription.
 *
 * GET  /.netlify/functions/unsubscribe?email=...&token=...
 *   Verifies HMAC, deletes matching submissions from Netlify Forms,
 *   redirects to /avsluta-prenumeration?status=ok (or ?status=fel).
 *
 * Subscriber email is never logged or returned in the response body.
 */

'use strict';

const { createHmac } = require('crypto');

const SITE_ID = process.env.NETLIFY_SITE_ID || '5ad5ca28-68dd-4ca5-866a-5a3f729e7863';
const BASE_URL = process.env.URL || 'https://www.tradgardsfloristen.se';

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Miljövariabel saknas: ${name}`);
  return val;
}

function verifyToken(email, token, secret) {
  if (typeof email !== 'string' || typeof token !== 'string') return false;
  const expected = createHmac('sha256', secret).update(email).digest('hex').slice(0, 32);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

async function deleteSubmissions(netlifyApiToken, email) {
  // Fetch all newsletter-top submissions
  const listUrl = `https://api.netlify.com/api/v1/sites/${SITE_ID}/submissions?form_name=newsletter-top&per_page=100`;
  const resp = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${netlifyApiToken}` },
  });
  if (!resp.ok) throw new Error(`Netlify API ${resp.status}`);

  const submissions = await resp.json();
  const normalizedEmail = email.trim().toLowerCase();
  const toDelete = submissions.filter(
    (s) => (s.data?.email || s.email || '').trim().toLowerCase() === normalizedEmail
  );

  for (const sub of toDelete) {
    const deleteResp = await fetch(`https://api.netlify.com/api/v1/submissions/${sub.id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + netlifyApiToken },
    });
    if (!deleteResp.ok) throw new Error(`Netlify API ${deleteResp.status}`);
  }
  return toDelete.length;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const params = event.queryStringParameters || {};
  const email = params.email;
  const token = params.token;

  if (!email || !token) {
    return {
      statusCode: 302,
      headers: { Location: `${BASE_URL}/avsluta-prenumeration?status=ogiltig` },
      body: '',
    };
  }

  let secret;
  try {
    secret = requireEnv('NEWSLETTER_UNSUBSCRIBE_SECRET');
  } catch {
    return {
      statusCode: 302,
      headers: { Location: `${BASE_URL}/avsluta-prenumeration?status=fel` },
      body: '',
    };
  }

  if (!verifyToken(email, token, secret)) {
    return {
      statusCode: 302,
      headers: { Location: `${BASE_URL}/avsluta-prenumeration?status=ogiltig` },
      body: '',
    };
  }

  try {
    const netlifyApiToken = requireEnv('NETLIFY_API_TOKEN');
    await deleteSubmissions(netlifyApiToken, email);
  } catch {
    return {
      statusCode: 302,
      headers: { Location: `${BASE_URL}/avsluta-prenumeration?status=fel` },
      body: '',
    };
  }

  return {
    statusCode: 302,
    headers: { Location: `${BASE_URL}/avsluta-prenumeration?status=ok` },
    body: '',
  };
};

// Export for testing
exports._verifyToken = verifyToken;
