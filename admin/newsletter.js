(function () {
  'use strict';

  function plain(value) {
    if (value == null) return null;
    if (typeof value.toJS === 'function') return value.toJS();
    return value;
  }

  function buildConfirmation(subject, count) {
    return `Ämnesrad: ${subject}\nMottagare: ${count} prenumeranter\n\nUtskicket kan inte återkallas.`;
  }

  function formatResult(result, mode) {
    if (mode === 'production' && result.ok) return `Nyhetsbrevet skickades till ${result.sent} prenumeranter.`;
    if (mode === 'test' && result.ok) return 'Provet skickades till elisa@tradgardsfloristen.se.';
    return result.message || result.error || 'Utskicket misslyckades.';
  }

  window.__newsletterTest = { buildConfirmation, formatResult };

  function init() {
    const CMS = window.CMS;
    const h = window.h;
    const createClass = window.createClass;
    const identity = window.netlifyIdentity;
    if (!CMS || !h || !createClass || !identity) return false;

    async function authenticatedRequest(entry, mode) {
      const user = identity.currentUser();
      if (!user) {
        identity.open();
        throw new Error('Logga in igen innan du skickar.');
      }
      const token = await user.jwt();
      const response = await fetch('/.netlify/functions/send-newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ entry, mode }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || (mode !== 'count' && !result.ok)) {
        throw new Error(result.message || result.error || `Begäran misslyckades (${response.status}).`);
      }
      return result;
    }

    const NewsletterPreview = createClass({
      getInitialState: function () {
        return { status: 'Spara när du vill. Inget skickas automatiskt.', busy: false, confirmation: null };
      },

      sendTest: async function () {
        const entry = plain(this.props.entry.get('data')) || {};
        this.setState({ busy: true, status: 'Skickar prov endast till Elisa …' });
        try {
          const result = await authenticatedRequest(entry, 'test');
          this.setState({ status: formatResult(result, 'test') });
        } catch (error) {
          this.setState({ status: `Fel: ${error.message}` });
        } finally {
          this.setState({ busy: false });
        }
      },

      prepareProduction: async function () {
        const entry = plain(this.props.entry.get('data')) || {};
        this.setState({ busy: true, status: 'Hämtar aktuellt antal prenumeranter …' });
        try {
          const result = await authenticatedRequest(entry, 'count');
          this.setState({
            confirmation: { subject: entry.subject || 'Ämnesrad saknas', count: result.count },
            status: 'Kontrollera uppgifterna innan du skickar.',
          });
        } catch (error) {
          this.setState({ status: `Fel: ${error.message}` });
        } finally {
          this.setState({ busy: false });
        }
      },

      confirmProduction: async function () {
        const entry = plain(this.props.entry.get('data')) || {};
        this.setState({ busy: true, confirmation: null, status: 'Skickar till prenumeranterna …' });
        try {
          const result = await authenticatedRequest(entry, 'production');
          this.setState({ status: formatResult(result, 'production') });
        } catch (error) {
          this.setState({ status: `Fel: ${error.message}` });
        } finally {
          this.setState({ busy: false });
        }
      },

      render: function () {
        const entry = plain(this.props.entry.get('data')) || {};
        const sections = Array.isArray(entry.sections) ? entry.sections : [];
        const confirmation = this.state.confirmation;

        const panel = h('div', { style: panelStyle },
          h('strong', null, '📬 Förhandsvisning och utskick'),
          h('p', { style: { margin: '8px 0 12px', fontSize: 14 } }, this.state.status),
          h('button', { disabled: this.state.busy, onClick: this.sendTest, style: buttonStyle('#4a7c59') }, 'Skicka prov till mig'),
          h('button', { disabled: this.state.busy, onClick: this.prepareProduction, style: Object.assign({}, buttonStyle('#a93226'), { marginLeft: 8 }) }, 'Skicka till prenumeranter')
        );

        const confirmationBox = confirmation ? h('div', { role: 'dialog', 'aria-modal': 'true', style: overlayStyle },
          h('div', { style: dialogStyle },
            h('h2', { style: { marginTop: 0, color: '#3b5c46' } }, 'Bekräfta utskick'),
            h('p', { style: { whiteSpace: 'pre-line', lineHeight: 1.7 } }, buildConfirmation(confirmation.subject, confirmation.count)),
            h('button', { disabled: this.state.busy, onClick: () => this.setState({ confirmation: null }), style: buttonStyle('#777') }, 'Avbryt'),
            h('button', { disabled: this.state.busy || confirmation.count === 0, onClick: this.confirmProduction, style: Object.assign({}, buttonStyle('#a93226'), { marginLeft: 8 }) }, `Ja, skicka till ${confirmation.count}`)
          )
        ) : null;

        return h('div', { style: { fontFamily: 'Arial, sans-serif', background: '#f5f0ea', padding: 24, color: '#2d2d2d' } },
          panel,
          confirmationBox,
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
                section.image ? h('img', { src: section.image, alt: section.title || '', style: { maxWidth: '100%', borderRadius: 6 } }) : null,
                section.body ? h('p', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6 } }, section.body) : null,
                section.cta_text && /^https?:\/\//i.test(section.cta_url || '') ? h('a', { href: section.cta_url, target: '_blank', rel: 'noopener', style: buttonStyle('#4a7c59') }, section.cta_text) : null
              )),
              h('p', { style: { fontStyle: 'italic', marginTop: 24 } }, entry.outro || '')
            )
          )
        );
      },
    });

    CMS.registerPreviewTemplate('nyhetsbrev', NewsletterPreview);
    return true;
  }

  function showLoadError() {
    const warning = document.createElement('div');
    warning.textContent = 'Nyhetsbrevets förhandsvisning kunde inte laddas. Ladda om sidan. Om felet kvarstår, kontakta support.';
    warning.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:99999;padding:14px;background:#a93226;color:white;font:16px Arial;border-radius:6px;';
    document.body.appendChild(warning);
  }

  let attempts = 0;
  function boot() {
    if (init()) return;
    attempts += 1;
    if (attempts >= 100) return showLoadError();
    setTimeout(boot, 100);
  }

  const panelStyle = { position: 'sticky', top: 0, zIndex: 2, background: '#fff', padding: 16, borderRadius: 8, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,.12)' };
  const overlayStyle = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
  const dialogStyle = { width: '100%', maxWidth: 480, background: '#fff', borderRadius: 8, padding: 28, boxShadow: '0 8px 30px rgba(0,0,0,.25)' };
  function buttonStyle(color) {
    return { display: 'inline-block', border: 0, borderRadius: 5, background: color, color: '#fff', padding: '9px 16px', fontWeight: 700, cursor: 'pointer', textDecoration: 'none' };
  }

  boot();
})();
