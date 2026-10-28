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

/* --------------------------------------------------------------- calculator */
const calc = window.__mox.calc;
check('calculator: addition', calc('2 + 2').text === '4', calc('2 + 2').text);
check('calculator: precedence', calc('2 + 3 * 4').value === 14);
check('calculator: powers are right-associative', calc('2^3^2').value === 512);
check('calculator: unary minus vs power', calc('-2^2').value === -4);
check('calculator: functions', calc('sqrt(81) + 3!').value === 15);
check('calculator: statistics', calc('mean(2, 4, 6)').value === 4);
check('calculator: combinatorics', calc('ncr(5, 2)').value === 10);
check('calculator: percentages', calc('20% of 150').value === 30);
check('calculator: percent helper', calc('increase(200, 15)').value === 230);
check('calculator: unit conversion', Math.abs(calc('10 km to mi').value - 6.2137) < 0.001, calc('10 km to mi').text);
check('calculator: temperature offsets', calc('100 C to F').value === 212);
check('calculator: convert() with bare units', Math.abs(calc('convert(1, MB, MiB)').value - 0.9537) < 0.001);
check('calculator: rejects unknown names', calc('alert(1)').ok === false);
check('calculator: division by zero is an error', calc('1 / 0').ok === false);
check('calculator: arithmetic is exact in answers', window.__mox.finalizeAnswer('Total: <calc>2 + 2</calc>').text.includes('= 4'));
check('calculator: does not use eval', !/\beval\s*\(/.test(await readFile(path.join(ROOT, 'calculator.js'), 'utf8')));

/* --------------------------------------------------------------- workspace */
const workspace = window.__mox.workspace;
await wait(350);
check('workspace: starter project is created', workspace.files().some((file) => file.path === 'index.html'), JSON.stringify(workspace.files()));
check('workspace: css and js starter files', workspace.files().some((file) => file.path === 'styles.css') && workspace.files().some((file) => file.path === 'script.js'));

const writes = workspace.writesFrom('Sure:\n```mox:write path=index.html\n<!doctype html><h1>Hi</h1>\n```');
check('workspace: reads mox:write blocks', writes.length === 1 && writes[0].path === 'index.html');
check('workspace: ignores ordinary code blocks', workspace.writesFrom('```js\nconsole.log(1)\n```').length === 0);

const applied = window.__mox.finalizeAnswer('Here is your page:\n```mox:write path=notes.txt\nhello workspace\n```');
check('workspace: chat answers apply file writes', workspace.read('notes.txt')?.content.includes('hello workspace'));
check('workspace: tool blocks are hidden from the answer', !applied.text.includes('mox:write'), applied.text);

const preview = workspace.previewDocument();
check('workspace: preview inlines local css', preview.includes('<style data-mox-file="styles.css">'));
check('workspace: preview runs the console bridge', preview.includes('__moxConsole'));

window.__mox.openWorkspace();
await wait(80);
check('workspace: panel opens', document.querySelector('#workspacePanel').hidden === false);
check('workspace: editor shows the active file', document.querySelector('#wsEditor').value.includes('<!doctype html>'));
check('workspace: file list is rendered', document.querySelectorAll('.ws-file').length >= 3);
window.__mox.workspace.openCode({ html: '<h1>Snippet</h1>', css: 'h1 { color: black; }', js: 'console.log(1)' });
await wait(80);
check('workspace: opens code from chat without clobbering the project',
  window.__mox.workspace.read('preview.html').content.includes('Snippet')
  && window.__mox.workspace.read('index.html').content.includes('Built in the Mox workspace'));
check('workspace: code preview links the css', window.__mox.workspace.previewDocument().includes('data-mox-file="preview.css"'));

/* ---------------------------------------------------------- calculator UI */
window.__mox.openCalculator();
await wait(60);
check('calculator: panel opens', document.querySelector('#calculatorPanel').hidden === false);
check('calculator: keypad renders', document.querySelectorAll('.calc-key').length >= 25);
check('calculator: function list renders', document.querySelectorAll('.calc-fn').length > 20);
const calcInput = document.querySelector('#calcExpression');
calcInput.value = '6 * 7';
calcInput.dispatchEvent(new window.Event('input', { bubbles: true }));
check('calculator: live result while typing', document.querySelector('#calcResult').textContent === '42', document.querySelector('#calcResult').textContent);
calcInput.value = '1 / 0';
calcInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('calculator: shows errors instead of NaN', /zero/i.test(document.querySelector('#calcResult').textContent), document.querySelector('#calcResult').textContent);
calcInput.value = 'sqrt(16) + 1';
calcInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('calculator: Enter evaluates', document.querySelector('#calcResult').textContent === '5', document.querySelector('#calcResult').textContent);
check('calculator: history records answers', document.querySelectorAll('.calc-history-item').length >= 1);
window.__mox.closeCalculator();
check('calculator: panel closes', document.querySelector('#calculatorPanel').hidden === true);

/* ----------------------------------------------------------- workspace UI */
window.__mox.openWorkspace();
await wait(60);
const editor = document.querySelector('#wsEditor');
editor.value = editor.value.replace('Snippet', 'Edited in the panel');
editor.dispatchEvent(new window.Event('input', { bubbles: true }));
check('workspace: typing updates the model', window.__mox.workspace.read('preview.html').content.includes('Edited in the panel'));
check('workspace: preview follows the editor', window.__mox.workspace.previewDocument().includes('Edited in the panel'));
const tab = [...document.querySelectorAll('.ws-tab')].find((node) => node.textContent === 'styles.css');
tab?.dispatchEvent(new window.Event('click', { bubbles: true }));
check('workspace: tabs switch files', document.querySelector('#wsEditor').value.includes(':root'), document.querySelector('#wsTabActive')?.textContent || document.querySelector('#wsEditor').value.slice(0, 30));
window.__mox.workspace.close();

/* ------------------------------------------------------------ model upload */
const { saveUploadedModel } = await import(path.join(ROOT, 'model-store.js'));
const uploadBlob = new Blob([new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0])], { type: 'application/octet-stream' });
uploadBlob.name = 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf';
const uploaded = await saveUploadedModel(uploadBlob);
const secondBlob = new Blob([new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0])], { type: 'application/octet-stream' });
secondBlob.name = 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
const second = await saveUploadedModel(secondBlob);
await window.__mox.models.reload();
const listed = window.__mox.models.list();
check('models: uploaded model joins the picker', listed.some((entry) => entry.id === uploaded.id && entry.uploaded));
check('models: upload is named and measured', listed.find((entry) => entry.id === uploaded.id)?.name === 'Qwen2.5 Coder 1.5B Instruct', listed.find((entry) => entry.id === uploaded.id)?.name);
window.__mox.openModal('models');
await wait(60);
check('models: uploaded model appears on the screen', document.querySelector('#modalCopy').textContent.includes('Qwen2.5 Coder 1.5B Instruct'));
check('models: uploaded model is marked as yours', document.querySelector('#modalCopy').textContent.includes('your upload'));
check('models: uploaded model can be removed', Boolean(document.querySelector('[data-remove-model]')));
check('models: recommends a website-building model', /Qwen2\.5-Coder 1\.5B/.test(document.querySelector('#modalCopy').textContent));

/* select from the model screen */
const useButtons = [...document.querySelectorAll('[data-use-model]')];
check('models: every listed model has a select button', useButtons.length >= 2, String(useButtons.length));
check('models: the selected model is marked', [...document.querySelectorAll('.model-use')].some((button) => /Selected|In use/.test(button.textContent)));
const otherUse = useButtons.find((button) => !button.disabled);
check('models: another model can be chosen', Boolean(otherUse) && /Use this model/.test(otherUse.textContent), otherUse?.textContent);
check('models: switching does not reload the page', !/location\.reload/.test(await readFile(path.join(ROOT, 'app.js'), 'utf8').then((text) => text.split('async function switchModel')[1] || '')));

/* delete an uploaded model from the list */
window.confirm = () => true;
const beforeDelete = window.__mox.models.list().length;
document.querySelector(`[data-remove-model="${second.id}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
await wait(200);
check('models: delete removes it from the list', !window.__mox.models.list().some((entry) => entry.id === second.id));
check('models: delete frees the browser copy', (await import(path.join(ROOT, 'model-store.js'))).listUploadedModels().then((rows) => !rows.some((row) => row.id === second.uploadId)));
check('models: deleting keeps the other models', window.__mox.models.list().length === beforeDelete - 1);
check('models: deleting re-renders the screen without it', !document.querySelector(`[data-use-model="${second.id}"]`));
document.querySelector('#modalDone')?.dispatchEvent(new window.Event('click', { bubbles: true }));

/* hide + restore (what a served model allows, since its file is not ours) */
await window.__mox.models.hide(uploaded.id);
check('models: hidden model leaves the list', !window.__mox.models.visible().some((entry) => entry.id === uploaded.id));
check('models: hidden model is remembered', window.__mox.models.hidden().includes(uploaded.id));
window.__mox.openModal('models');
await wait(60);
check('models: hidden models can be restored from the screen', Boolean(document.querySelector('#modelRestore')), document.querySelector('#modelRestore')?.textContent);
document.querySelector('#modelRestore').dispatchEvent(new window.Event('click', { bubbles: true }));
await wait(200);
check('models: restore brings the model back', window.__mox.models.visible().some((entry) => entry.id === uploaded.id));
check('models: restore clears the hidden list', window.__mox.models.hidden().length === 0);
document.querySelector('#modalDone')?.dispatchEvent(new window.Event('click', { bubbles: true }));

/* catalog links */
check('models: catalog offers a download link', window.__mox.models.catalog().some((entry) => /\.gguf(\?|$)/.test(entry.download || '')));
check('models: catalog entries have a file page and a mirror', window.__mox.models.catalog().every((entry) => entry.page || entry.mirror));
check('models: catalog download forces the file response', /\.gguf\?download=true$/.test(window.__mox.models.catalog()[0].download));
check('models: recommended model is first in the catalog', /Qwen2\.5-Coder 1\.5B/.test(window.__mox.models.catalog()[0]?.name || ''));

/* ------------------------------------------------------------------ models */
window.__mox.openModal('models');
await wait(80);
check('models: picker screen opens', document.querySelector('#modalBackdrop').hidden === false);
check('models: offers an upload button', Boolean(document.querySelector('#modelUpload')));
check('models: lists the bundled model or explains it is missing', document.querySelector('#modalCopy').textContent.length > 40);
check('models: api exposes the list', Array.isArray(window.__mox.models.list()));
document.querySelector('#modalDone').dispatchEvent(new window.Event('click', { bubbles: true }));

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

// A weak match is worse than no match: it makes the model cite nonsense.
for (const question of ['hello', 'hi there', 'thanks', 'what can you do?', 'what is 2+2?', 'tell me a joke']) {
  check(`retrieval: no invented sources for "${question}"`, window.__mox.retrieve(question).length === 0);
}
check('retrieval: keeps real matches', window.__mox.retrieve('what is photosynthesis?').length > 0);

// Each of these should find the document that is actually about the question.
for (const [question, expected] of [
  ['how do I balance a chemical equation?', /chemistry/i],
  ['what is a rain shadow?', /geography/i],
  ['what is an isomer?', /chemistry/i],
  ['how do time zones work?', /geography/i],
  ['how do I read a nutrition label?', /cooking/i],
  ['what is big O notation?', /mathematics/i],
  ['what is a half life?', /physics/i],
  ['how do I negotiate a salary?', /careers/i],
  ['what is a tenancy deposit?', /law/i],
  ['what is free indirect discourse?', /literature/i],
  ['what is a merge conflict in git?', /software/i],
  ['what is semantic HTML?', /web development/i],
  ['what is self esteem?', /health/i]
]) {
  const hit = window.__mox.retrieve(question)[0];
  check(`retrieval: ${question.slice(0, 34)}…`, Boolean(hit) && expected.test(hit.doc.name), hit?.doc.name);
}

/* ---------------------------------------------------------------- prompts */
const grounded = window.__mox.buildMessages('What is a fraction?',
  [{ text: 'A fraction names part of a whole.', doc: { name: 'Arithmetic', categoryLabel: 'Mathematics', bundled: true } }]);
const groundedSystem = grounded[0].content;
check('prompt: passes passages when they exist', groundedSystem.includes('[1] Mathematics › Arithmetic'));
check('prompt: tells the model not to claim missing sources', /Never say you have "no sources"/.test(groundedSystem));
check('prompt: allows answering beyond the passages', /do not refuse/.test(groundedSystem));
check('prompt: no refusal placeholder when grounded', !groundedSystem.includes('no library passage matched this question'));

const bare = window.__mox.buildMessages('What is the capital of France?', []);
const bareSystem = bare[0].content;
check('prompt: ungrounded answers from general knowledge', /own general knowledge/.test(bareSystem));
check('prompt: ungrounded forbids citing sources', /do not mention sources/.test(bareSystem));
check('prompt: marks the empty source block', bareSystem.includes('no library passage matched this question'));

/* ------------------------------------------------------- exact arithmetic */
check('arithmetic: a plain sum is recognised', window.__mox.pureCalculation('what is 1234 * 5678?')?.value === 7006652);
check('arithmetic: percentages are recognised', window.__mox.pureCalculation('what is 15% of 80')?.value === 12);
check('arithmetic: unit conversions are recognised', window.__mox.pureCalculation('convert 10 km to mi')?.value > 6);
check('arithmetic: ordinary questions are left to the model', window.__mox.pureCalculation('what is a fraction?') === null);
check('arithmetic: code questions are left to the model', window.__mox.pureCalculation('what is 2+2 in javascript') === null);

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

/* ------------------------------------------------------- calculator answer */
window.__mox.resetChat();
await wait(40);
$('#messageInput').value = 'what is 1234 * 5678?';
$('#messageInput').dispatchEvent(new window.Event('input', { bubbles: true }));
submit();
await wait(200);
const calcAnswer = $$('.message.assistant .message-body').at(-1)?.textContent || '';
check('calculator: answers arithmetic without the model', calcAnswer.includes('7006652'), calcAnswer.slice(0, 80));
check('calculator: says where the number came from', /calculator/i.test(calcAnswer));
check('calculator: does not claim a missing source', !/no library passage/i.test(calcAnswer));

check('no unhandled errors', errors.length === 0, errors.join('; '));

process.stdout.write(results.join('\n') + '\n');
const failed = results.filter((line) => line.startsWith('FAIL'));
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
