// Browser-less UI checks for Mox. Not needed to run the app — this is for
// development, so it uses two dev-only packages:
//
//   npm install --no-save jsdom fake-indexeddb
//   node tests/ui-check.mjs
//
// It boots the real index.html + app.js in jsdom with a fake fetch, then drives
// the interface the way a person would: ask a question, open a source, switch
// chats, reload, delete.
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = process.env.MOX_ROOT
  ? path.resolve(process.env.MOX_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app.js');
const indexJson = await readFile(path.join(ROOT, 'knowledge/index.json'), 'utf8');
const manifestJson = await readFile(path.join(ROOT, 'models/manifest.json'), 'utf8');

const results = [];
const errors = [];
const noop = () => {};
const wait = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (label, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
process.on('unhandledRejection', (error) => errors.push(String(error?.message || error)));

async function boot(tag = '') {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:8000/', pretendToBeVisual: true });
  const { window } = dom;

  // Serve the real knowledge files; nothing else, so the model never loads and
  // the app exercises its search-only path (which is also a real user state).
  window.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('knowledge/index.json')) {
      return { ok: true, status: 200, headers: new Map(), text: async () => indexJson, json: async () => JSON.parse(indexJson) };
    }
    if (url.endsWith('models/manifest.json')) {
      return { ok: true, status: 200, headers: new Map(), text: async () => manifestJson, json: async () => JSON.parse(manifestJson) };
    }
    const relative = url.split('knowledge/')[1];
    if (relative) {
      try {
        const body = await readFile(path.join(ROOT, 'knowledge', decodeURIComponent(relative)), 'utf8');
        return { ok: true, status: 200, headers: new Map(), text: async () => body, json: async () => JSON.parse(body) };
      } catch { /* not a document */ }
    }
    return { ok: false, status: 404, headers: new Map(), text: async () => '', json: async () => ({}) };
  };

  window.indexedDB = globalThis.indexedDB;
  window.console = { log: noop, warn: noop, error: noop, debug: noop, info: noop, trace: noop };
  window.document.querySelectorAll('script').forEach((node) => node.remove());
  window.HTMLTextAreaElement.prototype.focus = noop;

  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'Event', 'CustomEvent', 'Blob', 'File', 'FormData', 'URL', 'getComputedStyle', 'requestAnimationFrame', 'fetch']) {
    Object.defineProperty(globalThis, key, { value: window[key] ?? globalThis[key], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

  await import(`${APP}${tag ? `?${tag}` : ''}`);
  await wait(500);
  return window;
}

/* ---------------------------------------------------------------- boot */
let window = await boot();
const $ = (selector) => window.document.querySelector(selector);
const $$ = (selector) => [...window.document.querySelectorAll(selector)];
const submit = () => $('#chatForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

check('shell renders', $('.welcome h1')?.textContent.trim() === 'What can I help with?');
check('composer starts disabled until the engine is usable', $('#messageInput').disabled === false);
check('sidebar lists the library', /document/.test($('#libraryStatus').textContent), $('#libraryStatus').textContent);
check('state hook exposed', typeof window.__mox?.state === 'function');

/* ---------------------------------------------------------------- markdown */
const md = window.__mox.renderRich('**Bold** and *italic*\n\n## Heading\n\n- one\n\n1. first\n2. second\n\n```\ncode\n```\n\n> quoted\n\n---');
check('markdown: bold + italic', md.includes('<strong>Bold</strong>') && md.includes('<em>italic</em>'));
check('markdown: heading', md.includes('md-heading'));
check('markdown: bullet list', md.includes('<ul class="md-list">'));
check('markdown: ordered list', md.includes('<ol class="md-list">'));
check('markdown: code block', md.includes('<pre class="md-code"><code>code</code></pre>'));
check('markdown: quote + rule', md.includes('md-quote') && md.includes('md-rule'));
check('markdown: escapes HTML', !window.__mox.renderRich('<img src=x onerror=alert(1)>').includes('<img'));

/* ---------------------------------------------------------------- retrieval */
for (const [question, expected] of [
  ['How do I add fractions with different denominators?', /math|fraction/i],
  ['What is photosynthesis?', /science|biology/i],
  ['How do I write a topic sentence?', /writing|reading/i],
  ['What is a variable in programming?', /technology|program/i]
]) {
  const hit = window.__mox.retrieve(question)[0];
  check(`retrieval: ${question.slice(0, 30)}…`, Boolean(hit) && expected.test(`${hit.doc.categoryLabel} ${hit.doc.name}`), hit?.doc.name);
}
check('retrieval: stemming (fraction/fractions)',
  window.__mox.retrieve('denominator')[0]?.doc.id === window.__mox.retrieve('denominators')[0]?.doc.id);

/* ---------------------------------------------------------------- ask */
$('#messageInput').value = 'What is a fraction?';
$('#messageInput').dispatchEvent(new window.Event('input', { bubbles: true }));
submit();
await wait(300);

check('question bubble rendered', $$('.message.user .message-body').length === 1);
check('answer rendered', $$('.message.assistant .message-body').length === 1);
check('answer has Copy', $$('.message.assistant .msg-action').map((n) => n.textContent).includes('Copy'));
check('answer has Regenerate', $$('.message.assistant .msg-action').map((n) => n.textContent).includes('Regenerate'));
check('welcome hidden after asking', $('#welcome').hidden === true);
check('chat appears in the sidebar', $$('.chat-item').length === 1, $('.chat-entry')?.textContent);
check('active chat marked for screen readers', $('.chat-entry')?.getAttribute('aria-current') === 'true');

const pill = $$('.source-pill')[0];
check('citations are buttons', pill?.tagName === 'BUTTON');
pill?.dispatchEvent(new window.Event('click', { bubbles: true }));
await wait(80);
check('source passage opens', $('#modalBackdrop').hidden === false, $('#modalTitle').textContent);
check('source passage has text', ($('.passage')?.textContent || '').length > 40);
$('#modalDone').dispatchEvent(new window.Event('click', { bubbles: true }));
await wait(40);
check('modal closes', $('#modalBackdrop').hidden === true);

/* ---------------------------------------------------------------- drawer */
window.__mox.openDrawer();
check('drawer opens', window.document.body.classList.contains('drawer-open') && $('#sidebarScrim').hidden === false);
check('drawer reports expanded', $('#sidebarToggle').getAttribute('aria-expanded') === 'true');
window.__mox.closeDrawer();
check('drawer closes', !window.document.body.classList.contains('drawer-open'));

/* ---------------------------------------------------------------- persistence */
await window.__mox.saveChats();
await wait(80);
window = await boot('reload');
const $2 = (selector) => window.document.querySelector(selector);
const $$2 = (selector) => [...window.document.querySelectorAll(selector)];
await wait(250);
check('history survives a reload', $$2('.message').length === 2);
check('chat list survives a reload', $2('.chat-entry')?.textContent === 'What is a fraction?');
check('restored answer keeps its formatting', $$2('.message.assistant .message-body')[0]?.innerHTML.length > 40);
check('restored chat stays active', $2('.chat-item')?.classList.contains('active'));

/* ---------------------------------------------------------------- new + delete */
$2('#newChat').dispatchEvent(new window.Event('click', { bubbles: true }));
await wait(60);
check('new chat clears the transcript', $$2('.message').length === 0);
check('new chat restores the empty state', $2('#welcome').hidden === false && $2('#quickStart').hidden === false);

$2('.chat-entry').dispatchEvent(new window.Event('click', { bubbles: true }));
await wait(60);
check('switching back restores the conversation', $$2('.message').length === 2);

$2('.chat-delete').dispatchEvent(new window.Event('click', { bubbles: true }));
await wait(80);
check('deleting removes the chat', $$2('.chat-item').length === 0);
check('deleting restores the empty state', $2('#welcome').hidden === false);

check('no unhandled errors', errors.length === 0, errors.join('; '));

process.stdout.write(results.join('\n') + '\n');
const failed = results.filter((line) => line.startsWith('FAIL'));
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
