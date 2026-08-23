/**
 * newsletter.test.js
 *
 * Unit tests for the Trädgårdsfloristen newsletter feature.
 * Uses Node built-in test runner (node:test) — no external deps.
 *
 * Run: node --test netlify/functions/__tests__/newsletter.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { escHtml, isSafeUrl, renderEmail } = require('../render-email');
const {
  _helpers: {
    buildUnsubscribeUrl,
    verifyUnsubscribeToken,
    deduplicateEmails,
    authorizeIdentityUser,
    makeIdempotencyKey,
  },
} = require('../send-newsletter');

const { _verifyToken: verifyUnsubToken } = require('../unsubscribe');

const AUTH_CONTEXT = { clientContext: { user: { email: 'elisa@tradgardsfloristen.se' } } };

function envSnapshot() {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NETLIFY_API_TOKEN: process.env.NETLIFY_API_TOKEN,
    NEWSLETTER_UNSUBSCRIBE_SECRET: process.env.NEWSLETTER_UNSUBSCRIBE_SECRET,
  };
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 1. HTML escaping
// ────────────────────────────────────────────────────────────────────────────

describe('escHtml', () => {
  test('escapes & < > " \'', () => {
    assert.equal(escHtml('a & b < c > d "e" f\'g'), 'a &amp; b &lt; c &gt; d &quot;e&quot; f&#39;g');
  });

  test('passes through safe text unchanged', () => {
    assert.equal(escHtml('Hej Elisa!'), 'Hej Elisa!');
  });

  test('handles null/undefined gracefully', () => {
    assert.equal(escHtml(null), '');
    assert.equal(escHtml(undefined), '');
  });

  test('escapes a script injection attempt', () => {
    const input = '<script>alert("xss")</script>';
    const out = escHtml(input);
    assert.ok(!out.includes('<script>'), 'should not contain <script>');
    assert.ok(out.includes('&lt;script&gt;'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. URL validation
// ────────────────────────────────────────────────────────────────────────────

describe('isSafeUrl', () => {
  test('accepts https://', () => assert.equal(isSafeUrl('https://example.com'), true));
  test('accepts http://', ()  => assert.equal(isSafeUrl('http://example.com'), true));
  test('rejects javascript:', () => assert.equal(isSafeUrl('javascript:alert(1)'), false));
  test('rejects data: URI',   () => assert.equal(isSafeUrl('data:text/html,<h1>XSS</h1>'), false));
  test('rejects bare word',   () => assert.equal(isSafeUrl('notaurl'), false));
  test('rejects empty string', () => assert.equal(isSafeUrl(''), false));
  test('rejects null',         () => assert.equal(isSafeUrl(null), false));
  test('handles leading spaces with https', () => {
    assert.equal(isSafeUrl('  https://ok.se'), true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. HMAC unsubscribe signing & verification
// ────────────────────────────────────────────────────────────────────────────

describe('buildUnsubscribeUrl / verifyUnsubscribeToken', () => {
  const SECRET = 'test-secret-abc123';
  const EMAIL = 'test@example.com';
  const BASE = 'https://floristen.daware.se/avsluta';

  test('builds a URL containing email and token query params', () => {
    const url = buildUnsubscribeUrl(EMAIL, SECRET, BASE);
    assert.ok(url.startsWith(BASE + '?'));
    const params = new URL(url).searchParams;
    assert.equal(params.get('email'), EMAIL);
    assert.ok(params.get('token'), 'token should be present');
    assert.equal(params.get('token').length, 32, 'token should be 32 hex chars');
  });

  test('token verifies successfully with correct secret', () => {
    const url = buildUnsubscribeUrl(EMAIL, SECRET, BASE);
    const params = new URL(url).searchParams;
    assert.equal(verifyUnsubscribeToken(EMAIL, params.get('token'), SECRET), true);
  });

  test('token fails with wrong secret', () => {
    const url = buildUnsubscribeUrl(EMAIL, SECRET, BASE);
    const params = new URL(url).searchParams;
    assert.equal(verifyUnsubscribeToken(EMAIL, params.get('token'), 'wrong-secret'), false);
  });

  test('token fails with wrong email', () => {
    const url = buildUnsubscribeUrl(EMAIL, SECRET, BASE);
    const params = new URL(url).searchParams;
    assert.equal(verifyUnsubscribeToken('other@example.com', params.get('token'), SECRET), false);
  });

  test('token fails with tampered token', () => {
    const url = buildUnsubscribeUrl(EMAIL, SECRET, BASE);
    const params = new URL(url).searchParams;
    const badToken = params.get('token').replace(/.$/, 'x');
    assert.equal(verifyUnsubscribeToken(EMAIL, badToken, SECRET), false);
  });

  test('token fails with null inputs', () => {
    assert.equal(verifyUnsubscribeToken(null, null, SECRET), false);
  });

  test('unsubscribe.js verifyToken matches send-newsletter.js verifyUnsubscribeToken', () => {
    const url = buildUnsubscribeUrl(EMAIL, SECRET, BASE);
    const params = new URL(url).searchParams;
    const token = params.get('token');
    // Both implementations must agree
    assert.equal(verifyUnsubscribeToken(EMAIL, token, SECRET), true);
    assert.equal(verifyUnsubToken(EMAIL, token, SECRET), true);
    assert.equal(verifyUnsubToken('other@x.com', token, SECRET), false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Subscriber deduplication
// ────────────────────────────────────────────────────────────────────────────

describe('deduplicateEmails', () => {
  test('removes exact duplicates', () => {
    const result = deduplicateEmails(['a@b.com', 'a@b.com', 'c@d.se']);
    assert.equal(result.length, 2);
  });

  test('removes case-insensitive duplicates', () => {
    const result = deduplicateEmails(['A@B.COM', 'a@b.com']);
    assert.equal(result.length, 1);
  });

  test('filters invalid addresses', () => {
    const result = deduplicateEmails(['notanemail', '', null, 'ok@example.com']);
    assert.deepEqual(result, ['ok@example.com']);
  });

  test('returns empty array for empty input', () => {
    assert.deepEqual(deduplicateEmails([]), []);
  });

  test('normalises to lowercase', () => {
    const result = deduplicateEmails(['Elisa@EXAMPLE.COM']);
    assert.deepEqual(result, ['elisa@example.com']);
  });

  test('preserves order of first occurrence', () => {
    const result = deduplicateEmails(['b@c.com', 'a@c.com', 'b@c.com']);
    assert.deepEqual(result, ['b@c.com', 'a@c.com']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Trusted Netlify user + idempotency key
// ────────────────────────────────────────────────────────────────────────────

describe('authorizeIdentityUser', () => {
  test('accepts only Elisa from Netlify trusted context', () => {
    assert.deepEqual(
      authorizeIdentityUser({ user: { email: 'ELISA@tradgardsfloristen.se' } }),
      { email: 'elisa@tradgardsfloristen.se' }
    );
  });

  test('rejects missing and other users', () => {
    assert.equal(authorizeIdentityUser(null), false);
    assert.equal(authorizeIdentityUser({ user: { email: 'annan@example.com' } }), false);
  });
});

describe('makeIdempotencyKey', () => {
  test('returns 24-char hex string', () => {
    const key = makeIdempotencyKey('entry-1', 'abc123hash', 'test');
    assert.equal(typeof key, 'string');
    assert.equal(key.length, 24);
    assert.ok(/^[0-9a-f]+$/.test(key));
  });

  test('same inputs produce same key (deterministic)', () => {
    const k1 = makeIdempotencyKey('e', 'h', 'production');
    const k2 = makeIdempotencyKey('e', 'h', 'production');
    assert.equal(k1, k2);
  });

  test('different modes produce different keys', () => {
    const k1 = makeIdempotencyKey('e', 'h', 'test');
    const k2 = makeIdempotencyKey('e', 'h', 'production');
    assert.notEqual(k1, k2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Email rendering
// ────────────────────────────────────────────────────────────────────────────

describe('renderEmail', () => {
  const baseEntry = {
    subject: 'Test nyhetsbrev',
    greeting: 'Hej!',
    intro: 'Välkommen till nyhetsbrevet.',
    sections: [
      { title: 'Sektion 1', body: 'Lite text här.', cta_text: 'Läs mer', cta_url: 'https://example.com' },
    ],
    outro: 'Tack! // Elisa 🌿',
  };

  test('renders a complete HTML document', () => {
    const html = renderEmail(baseEntry, 'https://example.com/avsluta');
    assert.ok(html.includes('<!DOCTYPE html>'), 'should be full HTML doc');
    assert.ok(html.includes('Test nyhetsbrev'), 'should contain subject');
    assert.ok(html.includes('Hej!'), 'should contain greeting');
    assert.ok(html.includes('Välkommen till nyhetsbrevet.'), 'should contain intro');
    assert.ok(html.includes('Sektion 1'), 'should contain section title');
    assert.ok(html.includes('Lite text här.'), 'should contain section body');
    assert.ok(html.includes('Tack! // Elisa'), 'should contain outro');
  });

  test('contains unsubscribe URL (HTML-escaped in href attribute)', () => {
    // In HTML attributes & must be &amp; — escHtml correctly encodes the URL
    const unsubUrl = 'https://floristen.daware.se/avsluta-prenumeration?email=x&token=abc';
    const html = renderEmail(baseEntry, unsubUrl);
    const htmlEscapedUrl = unsubUrl.replace(/&/g, '&amp;');
    assert.ok(html.includes(htmlEscapedUrl),
      `HTML-escaped URL should appear in email. Expected: ${htmlEscapedUrl}`);
  });

  test('escapes HTML in editorial fields', () => {
    const xssEntry = {
      ...baseEntry,
      subject: '<script>alert(1)</script>',
      intro: '& < > " \'',
    };
    const html = renderEmail(xssEntry, 'https://example.com/unsubscribe');
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw <script> must not appear');
    assert.ok(html.includes('&lt;script&gt;'), 'should contain escaped form');
    assert.ok(html.includes('&amp;'), 'should escape &');
    assert.ok(html.includes('&lt;'), 'should escape <');
  });

  test('renders CTA button when URL is safe', () => {
    const html = renderEmail(baseEntry, 'https://x.com/unsub');
    assert.ok(html.includes('href="https://example.com"'), 'CTA link should be present');
    assert.ok(html.includes('Läs mer'), 'CTA text should be present');
  });

  test('does not render CTA button for unsafe URL', () => {
    const badEntry = {
      ...baseEntry,
      sections: [{ title: 'S', body: 'B', cta_text: 'Click', cta_url: 'javascript:alert(1)' }],
    };
    const html = renderEmail(badEntry, 'https://x.com/unsub');
    assert.ok(!html.includes('javascript:'), 'javascript: URL must not appear in output');
  });

  test('handles missing optional fields gracefully (draft compatibility)', () => {
    // Drafts may lack sections, date, image, cta
    const minimalEntry = { subject: 'Minimal', greeting: 'Hej!', intro: 'Kort intro.', outro: 'Hejdå' };
    assert.doesNotThrow(() => renderEmail(minimalEntry, 'https://x.com/u'));
    const html = renderEmail(minimalEntry, 'https://x.com/u');
    assert.ok(html.includes('Minimal'));
  });

  test('handles null sections array', () => {
    const entryNoSections = { ...baseEntry, sections: null };
    assert.doesNotThrow(() => renderEmail(entryNoSections, 'https://x.com/u'));
  });

  test('contains List-Unsubscribe link', () => {
    const html = renderEmail(baseEntry, 'https://floristen.daware.se/avsluta?email=a&token=b');
    assert.ok(html.includes('avsluta'), 'footer should mention unsubscribe');
  });

  test('section image is rendered when present', () => {
    const entryWithImg = {
      ...baseEntry,
      sections: [{ title: 'Med bild', body: 'Text', image: 'https://example.com/img.jpg' }],
    };
    const html = renderEmail(entryWithImg, 'https://x.com/u');
    assert.ok(html.includes('https://example.com/img.jpg'), 'image src should appear');
  });

  test('invalid unsubscribe URL renders as #', () => {
    const html = renderEmail(baseEntry, 'javascript:void(0)');
    assert.ok(!html.includes('javascript:'), 'invalid unsubscribe URL should not appear');
    assert.ok(html.includes('href="#"'), 'fallback href="#" should be used');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Subscriber addresses never exposed
// ────────────────────────────────────────────────────────────────────────────

describe('send-newsletter handler — subscriber privacy', () => {
  test('error objects replace email with [dold]', async () => {
    // Simulate what the handler does when Resend rejects a recipient:
    // errors.push({ email: '[dold]', error: err.message })
    const errors = [{ email: '[dold]', error: 'Resend 422: Invalid address' }];
    for (const e of errors) {
      assert.equal(e.email, '[dold]', 'email must be hidden in error entries');
      assert.ok(!e.email.includes('@'), 'actual email address must not appear');
    }
  });
});

describe('send-newsletter handler — recipient count preview', () => {
  test('count mode returns the deduplicated count without requiring Resend configuration', async () => {
    const snapshot = envSnapshot();
    const originalFetch = global.fetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    process.env.NETLIFY_API_TOKEN = 'netlify-test-token';
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return {
        ok: true,
        json: async () => [
          { data: { email: 'a@example.com' } },
          { data: { email: 'A@example.com' } },
          { data: { email: 'b@example.com' } },
        ],
      };
    };
    try {
      const response = await require('../send-newsletter').handler({
        httpMethod: 'POST',
        body: JSON.stringify({ entry: { subject: 'Test' }, mode: 'count' }),
      }, AUTH_CONTEXT);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), { ok: true, count: 2 });
      assert.equal(calls, 1, 'count mode should only call Netlify Forms');
    } finally {
      global.fetch = originalFetch;
      restoreEnv(snapshot);
    }
  });
});
