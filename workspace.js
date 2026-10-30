// Mox workspace — a small IDE that runs next to the chat.
//
// • Files live in IndexedDB, never on a server.
// • The editor is a plain textarea (reliable, no dependencies) with line numbers.
// • The preview is a sandboxed iframe built from the workspace files, with a
//   console bridge so runtime errors land in the panel.
// • The AI gets the same files: chat answers can carry ```mox:write path=…```
//   blocks that are applied here, and the workspace has its own "Ask Mox" box.
//
// This module knows nothing about wllama. app.js hands it a `complete()` hook
// that runs the loaded model.

const DB_NAME = 'mox-workspace';
const DB_VERSION = 1;
const SNAPSHOT_KEY = 'snapshot';
const PREVIEW_DEBOUNCE = 420;

const STARTER_FILES = [
  {
    path: 'index.html',
    content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Mox page</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="card">
    <p class="eyebrow">Built in the Mox workspace</p>
    <h1>Hello from your browser</h1>
    <p>Edit any file on the left — the preview updates as you type.</p>
    <button id="counter" type="button">Clicked 0 times</button>
  </main>
  <script src="script.js"><\/script>
</body>
</html>
`
  },
  {
    path: 'styles.css',
    content: `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #0d0d0d;
  color: #f5f5f5;
  padding: 24px;
}
.card {
  max-width: 420px;
  padding: 32px;
  border: 1px solid #ffffff40;
  border-radius: 16px;
  background: #161616;
}
.eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; color: #bdbdbd; }
h1 { margin: 8px 0 12px; font-size: 28px; letter-spacing: -.02em; }
p { line-height: 1.6; color: #dddddd; }
button {
  margin-top: 12px;
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #000000;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
button:active { transform: translateY(1px); }
`
  },
  {
    path: 'script.js',
    content: `const button = document.querySelector('#counter');
let clicks = 0;
button.addEventListener('click', () => {
  clicks += 1;
  button.textContent = \`Clicked \${clicks} time\${clicks === 1 ? '' : 's'}\`;
  console.log('clicks', clicks);
});
console.log('Workspace preview is running');
`
  }
];

/* ------------------------------------------------------------------ storage */

let database = null;
function openWorkspaceDatabase() {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
    };
    request.onsuccess = () => { database = request.result; resolve(database); };
    request.onerror = () => reject(request.error);
  });
}

function readSnapshotRecord() {
  return new Promise((resolve) => {
    if (!database) return resolve(null);
    try {
      const request = database.transaction('meta', 'readonly').objectStore('meta').get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function writeSnapshotRecord(value) {
  return new Promise((resolve) => {
    if (!database) return resolve();
    try {
      const request = database.transaction('meta', 'readwrite').objectStore('meta').put({ key: SNAPSHOT_KEY, value });
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch { resolve(); }
  });
}

/* ------------------------------------------------------------------- state */

const state = {
  files: [],
  activePath: 'index.html',
  entryPath: 'index.html',   // the HTML file the preview renders
  autoApply: true,
  logs: [],
  undo: [],
  panel: null,
  hooks: { complete: null, isReady: () => false, toast: () => {} },
  ready: false,
  aiBusy: false,
  proposals: [],
  aiAbort: null,
  savedAt: 0
};

const $ = (selector) => document.querySelector(selector);

/* ----------------------------------------------------------------- helpers */

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function normalizePath(path) {
  return String(path || '')
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\\/g, '/')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]/g, '')
    .replace(/\/{2,}/g, '/');
}

function guessLanguage(path) {
  const extension = String(path).toLowerCase().split('.').pop();
  return { html: 'html', htm: 'html', css: 'css', js: 'javascript', mjs: 'javascript',
    json: 'json', svg: 'svg', md: 'markdown', txt: 'text' }[extension] || 'text';
}

function findFile(path) {
  return state.files.find((file) => file.path === path) || null;
}

function isMarkup(path) {
  return /\.(html?|svg)$/i.test(path);
}

function defaultPathFor(extension) {
  const existing = state.files.map((file) => file.path.toLowerCase());
  const base = { html: 'page', css: 'styles', js: 'script', json: 'data', tsv: 'data' }[extension] || 'file';
  let index = 1;
  let candidate = `${base}.${extension}`;
  while (existing.includes(candidate.toLowerCase())) candidate = `${base}-${++index}.${extension}`;
  return candidate;
}

/* ------------------------------------------------------------------ render */

function renderFileList() {
  const list = $('#wsFileList');
  if (!list) return;
  if (!state.files.length) {
    list.innerHTML = '<div class="ws-empty">No files yet. Add one to start.</div>';
    return;
  }
  list.innerHTML = '';
  const sorted = [...state.files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    const row = document.createElement('div');
    row.className = `ws-file${file.path === state.activePath ? ' active' : ''}`;
    row.innerHTML = `
      <button type="button" class="ws-file-open" title="${escapeHTML(file.path)}">
        <span class="ws-file-icon">${iconFor(file.path)}</span>
        <span class="ws-file-name" title="${escapeHTML(file.path)} · double-click to rename">${escapeHTML(file.path)}</span>
      </button>
      <button type="button" class="ws-file-remove" title="Delete ${escapeHTML(file.path)}" aria-label="Delete ${escapeHTML(file.path)}">×</button>`;
    row.querySelector('.ws-file-open').addEventListener('click', () => openFile(file.path));
    row.querySelector('.ws-file-open').addEventListener('dblclick', () => renameFile(file.path));
    row.querySelector('.ws-file-remove').addEventListener('click', (event) => {
      event.stopPropagation();
      deleteFile(file.path);
    });
    list.append(row);
  }
}

function iconFor(path) {
  if (/\.html?$/i.test(path)) return '⟨⟩';
  if (/\.css$/i.test(path)) return '#'; 
  if (/\.m?js$/i.test(path)) return '⌁';
  if (/\.svg$/i.test(path)) return '◇';
  if (/\.json$/i.test(path)) return '{}';
  return '▤';
}

function renderTabs() {
  const tabs = $('#wsTabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  for (const file of state.files) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `ws-tab${file.path === state.activePath ? ' active' : ''}`;
    tab.textContent = file.path;
    tab.addEventListener('click', () => openFile(file.path));
    tabs.append(tab);
  }
}

function renderEditor() {
  const editor = $('#wsEditor');
  const file = findFile(state.activePath) || state.files[0];
  if (!editor) return;
  if (!file) {
    editor.value = '';
    editor.disabled = true;
    renderGutter('');
    return;
  }
  state.activePath = file.path;
  editor.disabled = false;
  editor.value = file.content;
  editor.dataset.path = file.path;
  renderGutter(file.content);
  updateEditorStatus();
}

function renderGutter(text) {
  const gutter = $('#wsGutter');
  if (!gutter) return;
  const lines = String(text).split('\n').length;
  gutter.innerHTML = Array.from({ length: Math.max(lines, 1) }, (_, index) => `<span>${index + 1}</span>`).join('');
  gutter.scrollTop = $('#wsEditor')?.scrollTop || 0;
}

function updateEditorStatus() {
  const label = $('#wsStatus');
  const file = findFile(state.activePath);
  if (!label) return;
  if (!file) { label.textContent = 'No file open'; return; }
  const lines = file.content.split('\n').length;
  const characters = file.content.length;
  label.textContent = `${guessLanguage(file.path)} · ${lines} line${lines === 1 ? '' : 's'} · ${characters} chars${state.savedAt ? ' · saved' : ''}`;
}

function updateWorkspaceBadge() {
  const badge = $('#workspaceCount');
  if (badge) badge.textContent = state.files.length ? `${state.files.length} file${state.files.length === 1 ? '' : 's'}` : 'empty';
}

/* ------------------------------------------------------------------ preview */

function buildDocument() {
  const entry = (isMarkup(state.entryPath) && findFile(state.entryPath))
    || findFile('index.html')
    || state.files.find((file) => /\.html?$/i.test(file.path))
    || state.files.find((file) => file.path === state.activePath);
  if (!entry) {
    return '<!doctype html><html><body style="font:14px system-ui;background:#111;color:#ddd;padding:24px">No HTML file yet. Add index.html to see a preview.</body></html>';
  }

  let html = entry.content;
  const inline = (path) => {
    const target = findFile(path) || findFile(path.replace(/^\.\//, ''));
    return target || null;
  };

  // Inline local stylesheets.
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || /^(https?:|\/\/|data:)/i.test(href)) return tag;
    const file = inline(href.split('?')[0]);
    if (file && /\.css$/i.test(file.path)) {
      return `<style data-mox-file="${escapeHTML(file.path)}">\n${file.content.replace(/<\/style/gi, '<\\/style')}\n</style>`;
    }
    return tag;
  });

  // Inline local scripts (external ones stay as-is).
  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attributes) => {
    const src = (attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src || /^(https?:|\/\/|data:)/i.test(src)) return tag;
    const file = inline(src.split('?')[0]);
    if (file && /\.m?js$/i.test(file.path)) {
      return `<script data-mox-file="${escapeHTML(file.path)}">\n${file.content.replace(/<\/script/gi, '<\\/script')}\n<\/script>`;
    }
    return tag;
  });

  return injectBridge(html);
}

// Console bridge + a couple of small shims so ordinary demo code runs inside a
// sandboxed, opaque-origin iframe (where localStorage would otherwise throw).
function injectBridge(html) {
  const bridge = `<script>
(function () {
  var send = function (type, args) {
    var text = args.map(function (value) {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.name + ': ' + value.message;
      try { return JSON.stringify(value); } catch (error) { return String(value); }
    }).join(' ');
    try { parent.postMessage({ __moxConsole: true, type: type, text: text }, '*'); } catch (error) {}
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      send(level === 'debug' ? 'log' : level, args);
      original.apply(console, args);
    };
  });
  window.addEventListener('error', function (event) {
    send('error', [event.message + ' (line ' + event.lineno + ')']);
  });
  window.addEventListener('unhandledrejection', function (event) {
    send('error', ['Unhandled promise: ' + (event.reason && event.reason.message ? event.reason.message : event.reason)]);
  });
  // Sandboxed frames cannot use localStorage; give demos an in-memory stand-in.
  try { void window.localStorage; } catch (error) {
    var memory = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: function (key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
        setItem: function (key, value) { memory[key] = String(value); },
        removeItem: function (key) { delete memory[key]; },
        clear: function () { memory = {}; },
        key: function (index) { return Object.keys(memory)[index] || null; },
        get length() { return Object.keys(memory).length; }
      },
      configurable: true
    });
  }
})();
<\/script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, (match) => `${match}\n${bridge}`);
  return `${bridge}\n${html}`;
}

let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, PREVIEW_DEBOUNCE);
}

function refreshPreview({ quiet = true } = {}) {
  const frame = $('#wsPreview');
  if (!frame || !state.ready) return;
  frame.srcdoc = buildDocument();
  if (!quiet) clearConsole();
}

function setDevice(device) {
  const shell = $('.ws-preview-shell');
  if (!shell) return;
  shell.dataset.device = device;
  document.querySelectorAll('[data-device]').forEach((button) => {
    if (button.classList.contains('ws-device')) button.classList.toggle('active', button.dataset.device === device);
  });
}

/* ------------------------------------------------------------------ console */

function clearConsole() {
  state.logs = [];
  renderConsole();
  const box = $('#wsConsole');
  if (box) box.hidden = true;
}

function addLog(type, text) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.logs.push({ type, text, time });
  if (state.logs.length > 200) state.logs.shift();
  const box = $('#wsConsole');
  if (box) box.hidden = false;
  renderConsole();
}

function renderConsole() {
  const box = $('#wsConsole');
  if (!box) return;
  if (!state.logs.length) {
    box.innerHTML = '<div class="ws-console-empty">Console output and runtime errors appear here.</div>';
    return;
  }
  box.innerHTML = `<div class="ws-console-head">Console <button type="button" id="wsConsoleClear">Clear</button></div>` +
    state.logs.map((entry) => `<div class="ws-log ws-log-${entry.type}"><span>${entry.time}</span>${escapeHTML(entry.text)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
  box.querySelector('#wsConsoleClear')?.addEventListener('click', () => { state.logs = []; renderConsole(); });
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.__moxConsole) return;
  const frame = $('#wsPreview');
  if (frame && event.source && event.source !== frame.contentWindow) return;
  const type = ['log', 'warn', 'error', 'info'].includes(data.type) ? data.type : 'log';
  addLog(type, String(data.text).slice(0, 2000));
});

/* -------------------------------------------------------------------- files */

async function persist() {
  if (!database) return;
  state.savedAt = Date.now();
  updateEditorStatus();
  await writeSnapshotRecord({
    files: state.files.map((file) => ({ path: file.path, content: file.content })),
    activePath: state.activePath,
    entryPath: state.entryPath,
    autoApply: state.autoApply,
    updatedAt: state.savedAt
  });
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

function openFile(path) {
  if (!findFile(path)) return;
  state.activePath = path;
  if (isMarkup(path)) state.entryPath = path;
  renderFileList();
  renderTabs();
  renderEditor();
  refreshPreview();
}

function updateActiveContent(content) {
  const file = findFile(state.activePath);
  if (!file) return;
  file.content = content;
  file.updatedAt = Date.now();
  renderGutter(content);
  updateEditorStatus();
  renderTabs();
  updateWorkspaceBadge();
  scheduleSave();
  schedulePreview();
}

function createFile(path = defaultPathFor('html'), content = '') {
  const normalized = normalizePath(path);
  if (!normalized) { toast('Give the file a name.'); return null; }
  if (findFile(normalized)) { openFile(normalized); return findFile(normalized); }
  const file = { path: normalized, content: String(content), updatedAt: Date.now() };
  state.files.push(file);
  state.activePath = file.path;
  if (isMarkup(file.path)) state.entryPath = file.path;
  renderFileList();
  renderTabs();
  renderEditor();
  refreshPreview();
  scheduleSave();
  updateWorkspaceBadge();
  return file;
}

function deleteFile(path) {
  const file = findFile(path);
  if (!file) return;
  if (!window.confirm(`Delete ${path}? This cannot be undone.`)) return;
  state.files = state.files.filter((entry) => entry.path !== path);
  if (state.activePath === path) state.activePath = state.files[0]?.path || '';
  if (state.entryPath === path) {
    state.entryPath = state.files.find((entry) => /\.html?$/i.test(entry.path))?.path || '';
  }
  renderFileList();
  renderTabs();
  renderEditor();
  refreshPreview();
  scheduleSave();
  updateWorkspaceBadge();
  toast(`${path} deleted.`);
}

function renameFile(path) {
  const file = findFile(path);
  if (!file) return;
  const next = window.prompt('Rename file', path);
  if (!next) return;
  const normalized = normalizePath(next);
  if (!normalized || findFile(normalized)) { toast('That name is taken or invalid.'); return; }
  file.path = normalized;
  if (state.activePath === path) state.activePath = normalized;
  renderFileList();
  renderTabs();
  renderEditor();
  refreshPreview();
  scheduleSave();
}

function undo() {
  const last = state.undo.pop();
  if (!last) { toast('Nothing to undo in the workspace.'); return; }
  state.files = last.files.map((file) => ({ ...file }));
  state.activePath = last.activePath;
  state.entryPath = last.entryPath || 'index.html';
  renderFileList();
  renderTabs();
  renderEditor();
  refreshPreview();
  scheduleSave();
  updateWorkspaceBadge();
  toast('Workspace restored.');
}

function snapshot() {
  state.undo.push({
    files: state.files.map((file) => ({ path: file.path, content: file.content, updatedAt: file.updatedAt })),
    activePath: state.activePath,
    entryPath: state.entryPath
  });
  if (state.undo.length > 12) state.undo.shift();
}

/* --------------------------------------------------------------- tool bridge */

/**
 * Find file writes in model output. Understands:
 *   ```mox:write path=index.html …```
 *   ```html path=index.html …```
 *   <mox:write path="app.js">…</mox:write>
 * With infer=true, a plain ```html / ```css / ```js fence is treated as a write
 * to index.html / styles.css / script.js (used by the workspace AI box only).
 */
export function extractFileWrites(text, { infer = false } = {}) {
  const source = String(text || '');
  const writes = [];
  const seen = new Set();
  const push = (path, content) => {
    const normalized = normalizePath(path);
    if (!normalized || !content?.trim()) return;
    const key = `${normalized}\u0000${content}`;
    if (seen.has(key)) return;
    seen.add(key);
    writes.push({ path: normalized, content: content.replace(/\s+$/, '') + '\n' });
  };

  // XML-ish tool tag.
  for (const match of source.matchAll(/<mox:write\s+path\s*=\s*["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/mox:write>/gi)) {
    push(match[1], match[2].replace(/^\n+/, ''));
  }

  // Fenced blocks, with any info string that names a path.
  for (const match of source.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    const info = match[1].trim();
    const content = match[2];
    if (!info && !infer) continue;

    const pathMatch = info.match(/(?:path|file|filename)\s*=\s*["']?([^\s"']+)/i);
    const barePath = info.match(/(?:^|\s)([\w./-]+\.(?:html?|css|m?js|json|svg|md|txt))(?:\s|$)/i);
    const explicit = /mox:(?:write|file|create)/i.test(info);

    let target = pathMatch?.[1] || barePath?.[1];
    if (!target && infer) {
      const language = info.toLowerCase().split(/\s+/)[0];
      if (['html', 'htm'].includes(language)) target = 'index.html';
      else if (language === 'css') target = 'styles.css';
      else if (['js', 'javascript', 'mjs'].includes(language)) target = 'script.js';
      else if (language === 'json') target = 'data.json';
      else if (language === 'svg') target = 'image.svg';
    }
    if (!target || !/\.(html?|css|m?js|json|svg|md|txt)$/i.test(target)) continue;
    if (!explicit && !pathMatch && !barePath && !infer) continue;
    push(target, content);
  }

  return writes;
}

/** Remove the tool blocks from text so the chat shows prose, not raw file dumps. */
export function stripFileWrites(text) {
  return String(text || '')
    .replace(/<mox:write\s+path\s*=\s*["']?[^"'>\s]+["']?\s*>[\s\S]*?<\/mox:write>/gi, '')
    .replace(/```[^\n`]*\b(?:mox:(?:write|file|create)|(?:path|file|filename)\s*=)[^\n`]*\n[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Whether the chat is allowed to apply mox:write blocks (workspace toggle). */
export function autoApplyEnabled() {
  return state.autoApply;
}

/** Apply writes to the workspace; returns {applied, created, skipped}. */
export function applyFileWrites(writes, { source = 'Mox' } = {}) {
  if (!writes?.length) return { applied: 0, created: 0, skipped: 0, paths: [] };
  snapshot();
  let applied = 0, created = 0, skipped = 0;
  const paths = [];
  for (const write of writes) {
    const path = normalizePath(write.path);
    if (!path || !write.content) { skipped++; continue; }
    const file = findFile(path);
    if (file) {
      if (file.content === write.content) { skipped++; continue; }
      file.content = write.content;
      file.updatedAt = Date.now();
      applied++;
    } else {
      state.files.push({ path, content: write.content, updatedAt: Date.now() });
      created++;
      applied++;
    }
    paths.push(path);
  }
  if (applied) {
    if (!findFile(state.activePath)) state.activePath = paths[0] || state.files[0]?.path || '';
    renderFileList();
    renderTabs();
    renderEditor();
    refreshPreview();
    scheduleSave();
    updateWorkspaceBadge();
    toast(`${source} ${created ? 'added' : 'updated'} ${applied} file${applied === 1 ? '' : 's'}.`);
  } else {
    toast('Those files are already up to date.');
  }
  return { applied, created, skipped, paths };
}

export function workspaceFiles() {
  return state.files.map((file) => ({ path: file.path, bytes: file.content.length }));
}

export function workspaceFile(path) {
  return findFile(path);
}

/** File names and sizes, for prompts. */
export function workspaceManifest() {
  if (!state.files.length) return 'The workspace is empty.';
  return state.files
    .map((file) => `- ${file.path} (${file.content.length} characters)`)
    .join('\n');
}

/** File contents, capped so the model's 8k context still has room to answer. */
export function workspaceContext(budget = 6000) {
  if (!state.files.length) return '';
  let remaining = budget;
  const blocks = [];
  for (const file of state.files) {
    if (remaining <= 120) break;
    const slice = file.content.slice(0, Math.min(remaining, 3500));
    remaining -= slice.length;
    blocks.push(`--- ${file.path} ---\n${slice}${slice.length < file.content.length ? '\n… (truncated)' : ''}`);
  }
  return blocks.join('\n\n');
}

/** True when a question is about code, so the chat can attach the files. */
export function questionNeedsWorkspace(question) {
  const text = String(question || '').toLowerCase();
  if (!state.files.length) return false;
  if (/workspace|my (?:page|site|code|files?)|index\.html|styles?\.css|script\.js|the (?:html|css|javascript|js|code)\b/.test(text)) return true;
  if (/\.(html?|css|m?js)\b/.test(text)) return true;
  if (/\b(edit|change|update|fix|add|build|make|style|preview|render|debug)\b/.test(text)
    && /\b(page|button|layout|color|colour|font|background|responsive|click|form|dark mode|navbar|header|footer|card|site)\b/.test(text)
    && /\b(html|css|javascript|js|code|workspace)\b/.test(text)) return true;
  return false;
}

export const WORKSPACE_TOOL_INSTRUCTIONS = [
  'You can read and edit the user\'s workspace (the files listed under WORKSPACE).',
  'To change a file, write one fenced block per file, exactly like this:',
  '```mox:write path=index.html',
  '<the complete new file contents>',
  '```',
  'Use the full file, never a fragment or "…". You may write several such blocks.',
  'When the user names a site to base the design on ("like Hacker News", "a Stripe-style landing page"), follow the matching layout in the website design references — the same bones, never the brand: no logos, no copied text, no imitation of the name.',
  'Only use mox:write when the user asked you to change their workspace; use ordinary code blocks for examples.'
].join('\n');

/* ---------------------------------------------------------------- workspace UI */

function toast(message) {
  state.hooks.toast?.(message);
}

let loadPromise = null;
function loadWorkspace() {
  if (loadPromise) return loadPromise;
  loadPromise = doLoadWorkspace();
  return loadPromise;
}

async function doLoadWorkspace() {
  try {
    await openWorkspaceDatabase();
    const snapshotRecord = await readSnapshotRecord();
    if (snapshotRecord?.files?.length) {
      state.files = snapshotRecord.files
        .filter((file) => file && typeof file.path === 'string' && typeof file.content === 'string')
        .map((file) => ({ path: normalizePath(file.path), content: file.content, updatedAt: Date.now() }));
      state.activePath = findFile(snapshotRecord.activePath) ? snapshotRecord.activePath : state.files[0]?.path || '';
      state.entryPath = findFile(snapshotRecord.entryPath) ? snapshotRecord.entryPath : 'index.html';
      state.autoApply = snapshotRecord.autoApply !== false;
    } else {
      state.files = STARTER_FILES.map((file) => ({ ...file, updatedAt: Date.now() }));
      state.activePath = 'index.html';
      await persist();
    }
  } catch (error) {
    console.warn('Workspace storage unavailable:', error);
    state.files = STARTER_FILES.map((file) => ({ ...file, updatedAt: Date.now() }));
    state.activePath = 'index.html';
  }
  state.ready = true;
  renderFileList();
  renderTabs();
  renderEditor();
  renderConsole();
  updateWorkspaceBadge();
  const toggle = $('#wsAutoApply');
  if (toggle) toggle.checked = state.autoApply;
}

/* ------------------------------------------------------------------ AI panel */

function aiLog(role, text) {
  const log = $('#wsAiLog');
  if (!log) return null;
  const entry = document.createElement('div');
  entry.className = `ws-ai-msg ${role}`;
  entry.textContent = text;
  log.append(entry);
  log.scrollTop = log.scrollHeight;
  return entry;
}

function setProposals(writes, rawText) {
  state.proposals = writes;
  const actions = $('#wsAiActions');
  const summary = $('#wsAiSummary');
  if (!actions) return;
  if (!writes.length) {
    actions.hidden = true;
    if (summary) {
      summary.hidden = false;
      summary.textContent = 'No file changes were found. Rephrase the request, or ask Mox to show the code.';
    }
    if (rawText) aiLog('mox', rawText.slice(0, 1600));
    return;
  }
  actions.hidden = false;
  if (summary) {
    summary.hidden = false;
    summary.textContent = `${writes.length} file${writes.length === 1 ? '' : 's'} ready to change: ${writes.map((write) => write.path).join(', ')}`;
  }
}

async function askWorkspace(instruction) {
  if (state.aiBusy) return;
  if (!state.hooks.isReady()) {
    aiLog('mox', 'The model is not running yet. Open Model & settings to load it, then ask again.');
    return;
  }
  const prompt = String(instruction || '').trim();
  if (!prompt) return;

  state.aiBusy = true;
  const send = $('#wsAiSend');
  if (send) { send.disabled = true; send.textContent = 'Thinking…'; }
  aiLog('you', prompt);
  const reply = aiLog('mox', '…');
  const summary = $('#wsAiSummary');
  if (summary) summary.hidden = true;
  const actions = $('#wsAiActions');
  if (actions) actions.hidden = true;

  const errorLog = state.logs.filter((entry) => entry.type === 'error').slice(-3).map((entry) => entry.text).join('\n');

  // The built-in HTML/CSS/JavaScript references are retrieved for the request,
  // so the model works from the site's own documentation rather than memory.
  let reference = '';
  try {
    const passages = state.hooks.retrieve?.(prompt, 2) || [];
    if (passages.length) {
      reference = passages
        .map((item, index) => `[${index + 1}] ${item.doc.name}\n${item.text.slice(0, 850).trim()}`)
        .join('\n\n')
        .slice(0, 2000);
    }
  } catch { /* retrieval is optional */ }

  const messages = [
    {
      role: 'system',
      content: [
        'You are Mox, a coding assistant working inside a browser workspace.',
        'The user sees three panes: files, an editor, and a live preview of index.html.',
        'Change files only through mox:write blocks; always return the complete file.',
        'Never write placeholders such as "// rest of the code" or "<!-- more -->": the whole file must be runnable.',
        'Keep the existing design and working code; make the smallest set of changes that fulfils the request.',
        'Reply with the file blocks and at most two sentences of explanation.',
        WORKSPACE_TOOL_INSTRUCTIONS,
        '',
        'WORKSPACE FILES:',
        workspaceManifest(),
        '',
        'FILE CONTENTS:',
        workspaceContext(5600),
        ...(reference ? ['', 'REFERENCE PASSAGES (this site\'s documentation):', reference] : []),
        ...(errorLog ? ['', 'RECENT CONSOLE ERRORS:', errorLog] : [])
      ].join('\n')
    },
    { role: 'user', content: prompt }
  ];

  let streamed = '';
  try {
    state.aiAbort = new AbortController();
    const result = await state.hooks.complete(messages, {
      maxTokens: 1000,
      temperature: 0.25,
      signal: state.aiAbort.signal,
      onToken: (token) => {
        streamed += token;
        if (reply) {
          reply.textContent = streamed.replace(/```[\s\S]*$/m, '…writing code…');
          const log = $('#wsAiLog');
          if (log) log.scrollTop = log.scrollHeight;
        }
      }
    });
    const final = String(result || streamed || '').trim();
    if (reply) reply.textContent = final.replace(/```mox:write[\s\S]*?```/g, '(file written below)');
    const writes = extractFileWrites(final, { infer: true });
    setProposals(writes, final);
  } catch (error) {
    const aborted = /abort/i.test(error?.message || '') || error?.name === 'WllamaAbortError';
    if (reply) reply.textContent = aborted ? 'Stopped.' : `That failed: ${error.message || error}`;
  } finally {
    state.aiBusy = false;
    state.aiAbort = null;
    if (send) { send.disabled = false; send.textContent = 'Ask'; }
  }
}

/* -------------------------------------------------------------------- panel */

function syncAppInert() {
  const shell = document.querySelector('.app-shell');
  if (!shell) return;
  const anotherPanelOpen = [...document.querySelectorAll('.workspace-panel, .calc-panel')]
    .some((node) => node.hidden === false);
  shell.inert = anotherPanelOpen;
}

export function openWorkspace({ focus = true } = {}) {
  const panel = $('#workspacePanel');
  if (!panel) return;
  panel.hidden = false;
  document.body.classList.add('workspace-open');
  document.body.classList.remove('panel-open');
  const calc = $('#calculatorPanel');
  if (calc) calc.hidden = true;
  syncAppInert();
  if (focus) setTimeout(() => $('#wsEditor')?.focus(), 40);
  if (!state.ready) loadWorkspace().then(() => refreshPreview());
  else refreshPreview();
  renderFileList();
  renderTabs();
  updateWorkspaceBadge();
}

export function closeWorkspace() {
  const panel = $('#workspacePanel');
  if (panel) panel.hidden = true;
  document.body.classList.remove('workspace-open');
  syncAppInert();
}

export function isWorkspaceOpen() {
  return $('#workspacePanel')?.hidden === false;
}

/** Open the workspace with code lifted from a chat answer. */
export function openWorkspaceWithCode({ html = '', css = '', js = '', title = 'preview' } = {}) {
  if (!html && !css && !js) { openWorkspace(); return; }
  snapshot();

  // Use preview.* files so a snippet never overwrites the user's project.
  const HTML_PATH = 'preview.html';
  const CSS_PATH = 'preview.css';
  const JS_PATH = 'preview.js';

  if (html && (css || js)) {
    // Make sure the pasted markup actually loads the preview stylesheet/script.
    if (css && !/\.css/i.test(html) && !/<style/i.test(html)) {
      const link = `<link rel="stylesheet" href="${CSS_PATH}">`;
      html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `  ${link}\n</head>`) : `${link}\n${html}`;
    }
    if (js && !/\.js/i.test(html) && !/<script(?![^>]*src=)/i.test(html)) {
      const tag = `<script src="${JS_PATH}"><\/script>`;
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `  ${tag}\n</body>`) : `${html}\n${tag}`;
    }
  }
  if (!html) {
    html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHTML(title)}</title>${css ? `<link rel="stylesheet" href="${CSS_PATH}">` : ''}</head>
<body>
<h1>Preview</h1>
${js ? `<script src="${JS_PATH}"><\/script>` : ''}
</body>
</html>`;
  }

  const put = (path, content) => {
    const file = findFile(path);
    if (file) file.content = content;
    else state.files.push({ path, content, updatedAt: Date.now() });
  };
  if (css) put(CSS_PATH, css);
  if (js) put(JS_PATH, js);
  put(HTML_PATH, html);

  state.entryPath = HTML_PATH;
  state.activePath = HTML_PATH;
  renderFileList();
  renderTabs();
  renderEditor();
  scheduleSave();
  updateWorkspaceBadge();
  openWorkspace();
  refreshPreview();
  toast('Code opened in the workspace preview. Edit it and the preview updates live.');
}

/* --------------------------------------------------------------------- init */

export function initWorkspace(hooks = {}) {
  state.hooks = { ...state.hooks, ...hooks };
  const panel = $('#workspacePanel');
  if (!panel || panel.dataset.ready === 'true') {
    if (panel && !state.ready) loadWorkspace().then(() => refreshPreview());
    return;
  }
  panel.dataset.ready = 'true';
  state.panel = panel;

  loadWorkspace().then(() => refreshPreview());

  $('#wsClose')?.addEventListener('click', closeWorkspace);
  $('#wsRefresh')?.addEventListener('click', () => refreshPreview({ quiet: false }));
  $('#wsUndo')?.addEventListener('click', undo);
  $('#wsNewFile')?.addEventListener('click', addFilePrompt);
  $('#wsNewFile2')?.addEventListener('click', addFilePrompt);
  $('#wsSave')?.addEventListener('click', () => { persist(); refreshPreview(); toast('Workspace saved in this browser.'); });
  $('#wsPopout')?.addEventListener('click', () => {
    const blob = new Blob([buildDocument()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  $('#wsExport')?.addEventListener('click', exportFile);
  $('#wsImport')?.addEventListener('click', () => $('#wsFilePicker')?.click());
  $('#wsConsoleToggle')?.addEventListener('click', () => {
    const box = $('#wsConsole');
    if (box) box.hidden = !box.hidden;
  });
  $('#wsAutoApply')?.addEventListener('change', (event) => {
    state.autoApply = event.target.checked;
    persist();
    toast(state.autoApply ? 'Mox may edit files from chat.' : 'Chat can no longer edit files.');
  });

  document.querySelectorAll('.ws-device').forEach((button) => {
    button.addEventListener('click', () => setDevice(button.dataset.device));
  });

  $('#wsFilePicker')?.addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length) snapshot();
    for (const file of files) {
      if (!/\.(html?|css|m?js|json|svg|md|txt)$/i.test(file.name)) continue;
      const text = await file.text();
      const existing = findFile(file.name);
      if (existing) existing.content = text;
      else state.files.push({ path: file.name, content: text, updatedAt: Date.now() });
    }
    renderFileList();
    renderTabs();
    renderEditor();
    refreshPreview();
    scheduleSave();
    updateWorkspaceBadge();
    toast(files.length ? `Imported ${files.length} file${files.length === 1 ? '' : 's'} into the workspace.` : 'Those files are not supported.');
  });

  const editor = $('#wsEditor');
  editor?.addEventListener('input', () => updateActiveContent(editor.value));
  editor?.addEventListener('scroll', () => {
    const gutter = $('#wsGutter');
    if (gutter) gutter.scrollTop = editor.scrollTop;
  });
  editor?.addEventListener('keydown', (event) => {
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 's') {
      event.preventDefault();
      persist();
      refreshPreview();
      toast('Saved.');
      return;
    }
    if (command && event.key === 'Enter') {
      event.preventDefault();
      refreshPreview({ quiet: false });
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const indent = '  ';
      const value = editor.value;
      if (start !== end && value.slice(start, end).includes('\n')) {
        const lineStart = value.lastIndexOf('\n', start) + 1;
        const block = value.slice(lineStart, end);
        const shifted = event.shiftKey
          ? block.replace(/^  /gm, '')
          : block.replace(/^/gm, indent);
        editor.value = value.slice(0, lineStart) + shifted + value.slice(end);
        editor.setSelectionRange(lineStart, lineStart + shifted.length);
      } else {
        editor.value = value.slice(0, start) + indent + value.slice(end);
        editor.setSelectionRange(start + indent.length, start + indent.length);
      }
      updateActiveContent(editor.value);
    }
    if (event.key === 'Escape') closeWorkspace();
  });

  $('#wsAiForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#wsAiPrompt');
    const prompt = input.value.trim();
    if (!prompt) return;
    input.value = '';
    askWorkspace(prompt);
  });
  $('#wsAiSend')?.addEventListener('click', (event) => {
    event.preventDefault();
    $('#wsAiForm')?.requestSubmit();
  });
  $('#wsAiApply')?.addEventListener('click', () => {
    const writes = state.proposals;
    if (!writes.length) return;
    applyFileWrites(writes, { source: 'Mox' });
    state.proposals = [];
    const actions = $('#wsAiActions');
    if (actions) actions.hidden = true;
    const summary = $('#wsAiSummary');
    if (summary) { summary.hidden = false; summary.textContent = 'Applied. The preview shows the new version.'; }
    aiLog('mox', 'Applied your changes.');
  });
  $('#wsAiDiscard')?.addEventListener('click', () => {
    state.proposals = [];
    const actions = $('#wsAiActions');
    if (actions) actions.hidden = true;
    const summary = $('#wsAiSummary');
    if (summary) { summary.hidden = false; summary.textContent = 'Discarded. Nothing changed.'; }
  });
  $('#wsAiClear')?.addEventListener('click', () => {
    const log = $('#wsAiLog');
    if (log) log.innerHTML = '';
    const summary = $('#wsAiSummary');
    if (summary) summary.hidden = true;
    const actions = $('#wsAiActions');
    if (actions) actions.hidden = true;
  });
  document.querySelectorAll('[data-ws-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $('#wsAiPrompt');
      if (input) { input.value = button.dataset.wsPrompt; input.focus(); }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isWorkspaceOpen()) return;
    // Dialogs (and the calculator) take Escape first.
    if (document.querySelector('.modal-backdrop:not([hidden])')) return;
    if (document.getElementById('calculatorPanel')?.hidden === false) return;
    if (document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.id === 'wsAiPrompt') return;
    closeWorkspace();
  });

  // Warn before losing unsaved edits is unnecessary: every keystroke is saved.
}

function addFilePrompt() {
  const suggestion = defaultPathFor('html');
  const name = window.prompt('New file name (index.html, styles.css, script.js, data.json…)', suggestion);
  if (!name) return;
  const path = normalizePath(name);
  if (!path) { toast('That file name is not valid.'); return; }
  if (!/\.[a-z0-9]+$/i.test(path)) { createFile(`${path}.html`); return; }
  createFile(path);
}

function exportFile() {
  const file = findFile(state.activePath) || state.files[0];
  if (!file) { toast('The workspace is empty.'); return; }
  const isHtml = /\.html?$/i.test(file.path);
  const content = isHtml ? buildDocument() : file.content;
  const blob = new Blob([content], { type: isHtml ? 'text/html' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = isHtml ? 'mox-preview.html' : file.path.split('/').pop();
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(isHtml ? 'Preview downloaded as one self-contained HTML file.' : `${file.path} downloaded.`);
}

/* Workspace actions that are also available from the chat (window.__mox). */
export const workspaceApi = {
  open: openWorkspace,
  close: closeWorkspace,
  files: workspaceFiles,
  read: workspaceFile,
  writesFrom: extractFileWrites,
  apply: applyFileWrites,
  refresh: refreshPreview,
  previewDocument: buildDocument,
  openCode: openWorkspaceWithCode,
  state: () => ({
    files: workspaceFiles(),
    activePath: state.activePath,
    autoApply: state.autoApply,
    logs: state.logs.length
  })
};
