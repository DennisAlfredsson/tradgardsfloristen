'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/newsletter.js', 'utf8');

function loadAdminScript() {
  const registrations = { previews: [], events: [] };
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const context = {
    console,
    setTimeout: (fn) => fn(),
    window: {
      h,
      createClass: (spec) => spec,
      CMS: {
        registerPreviewTemplate: (...args) => registrations.previews.push(args),
        registerEventListener: (...args) => registrations.events.push(args),
      },
      netlifyIdentity: { currentUser: () => null, open: () => {} },
      addEventListener: () => {},
    },
  };
  vm.runInNewContext(source, context, { filename: 'newsletter.js' });
  return { context, registrations };
}

test('registers the newsletter preview and no automatic publish sender', () => {
  const { registrations } = loadAdminScript();
  assert.equal(registrations.previews.length, 1);
  assert.equal(registrations.previews[0][0], 'nyhetsbrev');
  assert.equal(registrations.events.length, 0, 'saving or publishing must never send email');
});

test('builds a clear irreversible confirmation with subject and recipient count', () => {
  const { context } = loadAdminScript();
  const message = context.window.__newsletterTest.buildConfirmation('Höstens nyheter', 24);
  assert.match(message, /Höstens nyheter/);
  assert.match(message, /24 prenumeranter/);
  assert.match(message, /inte återkallas/);
});

test('formats successful production result clearly', () => {
  const { context } = loadAdminScript();
  assert.equal(
    context.window.__newsletterTest.formatResult({ ok: true, sent: 24 }, 'production'),
    'Nyhetsbrevet skickades till 24 prenumeranter.'
  );
});

test('renders the live draft preview and both manual send buttons', () => {
  const { registrations } = loadAdminScript();
  const component = registrations.previews[0][1];
  const instance = {
    props: {
      entry: {
        get: () => ({
          toJS: () => ({
            subject: 'Höstens nyheter',
            greeting: 'Hej!',
            intro: 'Aktuell osparad text',
            sections: [{ title: 'Workshop', body: 'Välkommen' }],
            outro: 'Hälsningar Elisa',
          }),
        }),
      },
    },
    state: component.getInitialState(),
    setState(update) { this.state = Object.assign({}, this.state, update); },
    sendTest() {},
    prepareProduction() {},
    confirmProduction() {},
  };
  const tree = component.render.call(instance);
  const text = JSON.stringify(tree);
  assert.match(text, /Höstens nyheter/);
  assert.match(text, /Aktuell osparad text/);
  assert.match(text, /Skicka prov till mig/);
  assert.match(text, /Skicka till prenumeranter/);
});
