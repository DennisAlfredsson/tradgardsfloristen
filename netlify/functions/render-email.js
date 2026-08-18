/**
 * render-email.js — HTML email renderer for Trädgårdsfloristen newsletter.
 *
 * No external dependencies — uses only Node built-ins.
 * All editorial text is HTML-escaped. CTAs accept only http:// or https://.
 */

'use strict';

/** Escape HTML special chars in a string (never returns undefined). */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Return true only if the URL starts with http:// or https://. */
function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  return /^https?:\/\//i.test(url.trim());
}

function publicImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  const value = url.trim();
  if (isSafeUrl(value)) return value;
  if (value.startsWith('/')) return `https://www.tradgardsfloristen.se${value}`;
  return '';
}

/**
 * Build the full HTML email string.
 *
 * @param {object} entry   — CMS entry fields (subject, greeting, intro, sections, outro)
 * @param {string} unsubscribeUrl — signed unsubscribe URL for this recipient
 * @returns {string} full HTML email
 */
function renderEmail(entry, unsubscribeUrl) {
  const subject = escHtml(entry.subject || '');
  const greeting = escHtml(entry.greeting || 'Hej!');
  const intro = escHtml(entry.intro || '');
  const outro = escHtml(entry.outro || '');

  const sections = (Array.isArray(entry.sections) ? entry.sections : []).map((sec) => {
    const title = escHtml(sec.title || '');
    const body = escHtml(sec.body || '');
    const imageUrl = publicImageUrl(sec.image);
    const image = imageUrl
      ? `<img src="${escHtml(imageUrl)}" alt="${title}" style="max-width:100%;border-radius:6px;margin-bottom:12px;">`
      : '';

    let ctaHtml = '';
    if (sec.cta_text && sec.cta_url) {
      if (isSafeUrl(sec.cta_url)) {
        ctaHtml = `
          <p style="text-align:center;margin:16px 0;">
            <a href="${escHtml(sec.cta_url)}"
               style="background:#4a7c59;color:#fff;text-decoration:none;padding:10px 24px;border-radius:4px;font-weight:bold;display:inline-block;">
              ${escHtml(sec.cta_text)}
            </a>
          </p>`;
      } else {
        ctaHtml = `<p><em>(Knapp-länk saknas eller är ogiltig)</em></p>`;
      }
    }

    return `
      <div style="margin-bottom:28px;border-top:1px solid #e8dfd4;padding-top:20px;">
        ${title ? `<h2 style="font-size:20px;color:#3b5c46;margin:0 0 10px;">${title}</h2>` : ''}
        ${image}
        ${body ? `<p style="margin:0 0 8px;line-height:1.6;white-space:pre-wrap;">${body}</p>` : ''}
        ${ctaHtml}
      </div>`;
  }).join('');

  const safeUnsubscribe = isSafeUrl(unsubscribeUrl) ? escHtml(unsubscribeUrl) : '#';

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:Georgia,serif;color:#2d2d2d;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0ea;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

          <!-- Header -->
          <tr>
            <td style="background:#4a7c59;padding:28px 32px;text-align:center;">
              <p style="margin:0;color:#fff;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Trädgårdsfloristen</p>
              <h1 style="margin:8px 0 0;color:#fff;font-size:22px;font-weight:normal;">${subject}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="font-size:18px;margin:0 0 20px;">${greeting}</p>
              ${intro ? `<p style="line-height:1.7;white-space:pre-wrap;margin:0 0 24px;">${intro}</p>` : ''}
              ${sections}
              ${outro ? `<p style="margin:24px 0 0;line-height:1.6;font-style:italic;">${outro}</p>` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f5f0ea;padding:20px 32px;text-align:center;font-size:12px;color:#888;">
              <p style="margin:0 0 8px;">Trädgårdsfloristen · Munkedal, Bohuslän</p>
              <p style="margin:0;">
                Vill du avsluta din prenumeration?
                <a href="${safeUnsubscribe}" style="color:#4a7c59;">Klicka här</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderEmail, escHtml, isSafeUrl, publicImageUrl };
