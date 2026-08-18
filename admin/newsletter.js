(function () {
  'use strict';

  const h = window.React.createElement;

  function plain(value) {
    if (value == null) return null;
    if (typeof value.toJS === 'function') return value.toJS();
    return value;
  }

  function NewsletterPreview(props) {
    const entry = plain(props.entry.get('data')) || {};
    const [status, setStatus] = window.React.useState('Redo');
    const [busy, setBusy] = window.React.useState(false);

    async function send(mode) {
      if (mode === 'production') {
        const answer = window.prompt('Skriv SKICKA för att skicka till alla aktiva prenumeranter. Det går inte att ångra.');
        if (answer !== 'SKICKA') return;
      }
      const user = window.netlifyIdentity.currentUser();
      if (!user) {
        setStatus('Logga in igen innan du skickar.');
        window.netlifyIdentity.open();
        return;
      }
      setBusy(true);
      setStatus('Skickar …');
      try {
        const token = await user.jwt();
        const response = await fetch('/.netlify/functions/send-newsletter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ entry, mode }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.ok) setStatus(result.message || 'Utskicket är klart.');
        else setStatus(result.message || result.error || `Utskicket misslyckades (${response.status}).`);
      } catch (error) {
        setStatus(`Nätverksfel: ${error.message}`);
      } finally {
        setBusy(false);
      }
    }

    const sections = Array.isArray(entry.sections) ? entry.sections : [];
    return h('div', { style: { fontFamily: 'Arial, sans-serif', background: '#f5f0ea', padding: 24, color: '#2d2d2d' } },
      h('div', { style: { position: 'sticky', top: 0, zIndex: 2, background: '#fff', padding: 16, borderRadius: 8, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,.12)' } },
        h('strong', null, '📬 Utskick'),
        h('p', { style: { margin: '8px 0', fontSize: 14 } }, status),
        h('button', { disabled: busy, onClick: () => send('test'), style: buttonStyle('#4a7c59') }, 'Skicka test till mig'),
        h('button', { disabled: busy, onClick: () => send('production'), style: Object.assign({}, buttonStyle('#a93226'), { marginLeft: 8 }) }, 'Skicka till prenumeranter')
      ),
      h('div', { style: { maxWidth: 600, margin: '0 auto', background: '#fff', borderRadius: 8, overflow: 'hidden' } },
        h('div', { style: { background: '#4a7c59', color: '#fff', textAlign: 'center', padding: 28 } },
          h('small', null, 'TRÄDGÅRDSFLORISTEN'),
          h('h1', { style: { fontSize: 22, fontWeight: 400 } }, entry.subject || 'Ämnesrad saknas')
        ),
        h('div', { style: { padding: 32 } },
          h('p', { style: { fontSize: 18 } }, entry.greeting || 'Hej!'),
          h('p', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6 } }, entry.intro || ''),
          ...sections.map((section, index) => h('section', { key: index, style: { borderTop: '1px solid #e8dfd4', marginTop: 20, paddingTop: 20 } },
            section.title ? h('h2', { style: { color: '#3b5c46' } }, section.title) : null,
            section.image ? h('img', { src: section.image, alt: '', style: { maxWidth: '100%', borderRadius: 6 } }) : null,
            section.body ? h('p', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6 } }, section.body) : null,
            section.cta_text && /^https?:\/\//i.test(section.cta_url || '') ? h('a', { href: section.cta_url, target: '_blank', rel: 'noopener', style: buttonStyle('#4a7c59') }, section.cta_text) : null
          )),
          h('p', { style: { fontStyle: 'italic', marginTop: 24 } }, entry.outro || '')
        )
      )
    );
  }

  function buttonStyle(color) {
    return { display: 'inline-block', border: 0, borderRadius: 5, background: color, color: '#fff', padding: '9px 16px', fontWeight: 700, cursor: 'pointer', textDecoration: 'none' };
  }

  window.CMS.registerPreviewTemplate('nyhetsbrev', NewsletterPreview);
})();