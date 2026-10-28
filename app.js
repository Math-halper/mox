// Mox — a local-first AI workspace.
// The model ships with this site (models/*.gguf) and runs in the browser through
// wllama (llama.cpp compiled to WebAssembly). The knowledge library in
// knowledge/ is indexed locally and retrieved for every question.

const WLLAMA_URL = new URL('vendor/wllama/wllama.js', import.meta.url).href;
const WLLAMA_WASM = new URL('vendor/wllama/wllama.wasm', import.meta.url).href;
const MODEL_MANIFEST = 'models/manifest.json';
const PDFJS_URL = new URL('vendor/pdfjs/pdf.min.js', import.meta.url).href;
const PDFJS_WORKER_URL = new URL('vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
const KNOWLEDGE_INDEX = 'knowledge/index.json';

const DB_NAME = 'mox-private-workspace';
const DB_VERSION = 2;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_EXCERPTS = 4;
const EXCERPT_CHARS = 700;
const MAX_NEW_TOKENS = 320;
const CONTEXT_SIZE = 4096;
const HISTORY_TURNS = 6;          // how many past messages the model sees
const CHAT_META_KEY = 'conversations';
const CHAT_LIMIT = 30;            // conversations kept in browser storage
const SAVED_TEXT_LIMIT = 6000;    // characters per saved message

const STOP_WORDS = new Set(
  ('a an the and or but if then else when where why how what who whom which this that these those is are was were be been ' +
   'being do does did have has had can could should would will may might must of to in on at by for from with about as ' +
   'into through during before after above below between out off over under again further once it its i me my we our you ' +
   'your he she they them his her their not no nor so than too very please tell explain describe give show define mean ' +
   'meaning some any more most other such only own same s t just between work works working used use using need needs ' +
   'want wants get gets make makes made thing things example examples question questions answer answers best better ' +
   'good way ways also like many much amount around instead').split(' ')
);

const $ = (selector) => document.querySelector(selector);
const elements = {
  welcome: $('#welcome'), messages: $('#messages'), conversation: $('#conversation'),
  input: $('#messageInput'), form: $('#chatForm'), send: $('#sendButton'),
  load: $('#loadModel'), modelTitle: $('#modelCardTitle'), modelDescription: $('#modelCardDescription'),
  modelSize: $('#modelSize'), modelName: $('#modelName'), progress: $('#downloadProgress'),
  progressBar: $('#progressBar'), progressLabel: $('#progressLabel'), progressPercent: $('#progressPercent'),
  modelFootnote: $('#modelFootnote'), sourceBadge: $('#sourceBadge'),
  filePicker: $('#filePicker'), folderPicker: $('#folderPicker'), modelPicker: $('#modelPicker'),
  sourceList: $('#sourceList'), typing: $('#typingIndicator'), hint: $('#composerHint'),
  modelDot: $('#modelDot'), sidebarStatus: $('#sidebarModelStatus'),
  libraryStatus: $('#libraryStatus'), librarySummary: $('#librarySummary'), libraryChips: $('#libraryChips'),
  libraryToggle: $('#libraryToggle'), quickStart: $('#quickStart'),
  chatList: $('#chatList'), chatEmpty: $('#chatEmpty'),
  sidebarToggle: $('#sidebarToggle'), sidebarScrim: $('#sidebarScrim'), srStatus: $('#srStatus'),
  modal: $('#modalBackdrop'), modalTitle: $('#modalTitle'),
  modalKicker: $('#modalKicker'), modalCopy: $('#modalCopy'), modalDone: $('#modalDone'), toast: $('#toast')
};

let db;
let userDocuments = [];
let libraryDocuments = [];
let libraryIndex = null;
let libraryEnabled = true;
let modelManifest = null;
let chosenModelId = null;
let llm = null;
let engine = null;               // 'webgpu' | 'wasm' (wllama reports its backend)
let modelReady = false;
let searchOnly = false;
let generating = false;
let modelOrigin = 'site';
let toastTimer;
let history = [];
const conversations = [];   // {id, records: [{role, text, excerpts, stats}], updatedAt}
let activeChatId = null;
let loadedModel = null;
let abortController = null;  // cancels the running generation
let saveTimer;
let lastFocused = null;      // element to focus after a modal closes

/* ------------------------------------------------------------------ storage */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('documents')) database.createObjectStore('documents', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function readAllDocuments() {
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readonly').objectStore('documents').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
function saveDocument(document) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readwrite').objectStore('documents').put(document);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
function deleteDocument(id) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readwrite').objectStore('documents').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
function readMeta(key) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    const request = db.transaction('meta', 'readonly').objectStore('meta').get(key);
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => resolve(null);
  });
}
function writeMeta(key, value) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const request = db.transaction('meta', 'readwrite').objectStore('meta').put({ key, value });
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

/* --------------------------------------------------------------- text tools */

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function tokenize(value) {
  return (value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [])
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}
function makeChunks(text) {
  const normalized = text.replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];
  const size = 800, overlap = 120, chunks = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf('\n', end),
        normalized.lastIndexOf('. ', end),
        normalized.lastIndexOf('? ', end),
        normalized.lastIndexOf('! ', end)
      );
      if (boundary > start + size * 0.55) end = boundary + 1;
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
function htmlToText(text) {
  const parsed = new DOMParser().parseFromString(text, 'text/html');
  parsed.querySelectorAll('script,style,noscript,svg').forEach((node) => node.remove());
  return parsed.body.innerText || parsed.body.textContent || '';
}
async function extractFile(file) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'pdf') {
    const pdfjs = await import(PDFJS_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    return pages.join('\n\n');
  }
  const raw = await file.text();
  if (extension === 'html' || extension === 'htm' || extension === 'xml') return htmlToText(raw);
  if (extension === 'json') {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  }
  return raw;
}
function displaySize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function renderRich(text) {
  const lines = escapeHTML(text).split('\n');
  const out = [];
  let fence = null;
  let list = null;             // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (fence === null) {
        closeList();
        fence = [];
        continue;
      }
      out.push(`<pre class="md-code"><code>${fence.join('\n')}</code></pre>`);
      fence = null;
      continue;
    }
    if (fence) { fence.push(line); continue; }

    let value = line
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    const heading = value.match(/^\s*#{1,6}\s+(.*)$/);
    const ordered = value.match(/^\s*(\d{1,3})[.)]\s+(.*)$/);
    const bullet = value.match(/^\s*[-*•]\s+(.*)$/);
    const quote = value.match(/^\s*(?:>|&gt;)\s?(.*)$/);

    if (heading) { closeList(); out.push(`<span class="md-heading">${heading[1]}</span>`); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(value)) { closeList(); out.push('<hr class="md-rule">'); continue; }
    if (quote) { closeList(); out.push(`<span class="md-quote">${quote[1]}</span>`); continue; }
    if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul class="md-list">'); list = 'ul'; }
      out.push(`<li>${bullet[1]}</li>`);
      continue;
    }
    if (ordered) {
      if (list !== 'ol') { closeList(); out.push('<ol class="md-list">'); list = 'ol'; }
      out.push(`<li value="${ordered[1]}">${ordered[2]}</li>`);
      continue;
    }
    closeList();
    out.push(value);
  }
  if (fence) out.push(`<pre class="md-code"><code>${fence.join('\n')}</code></pre>`);
  closeList();
  return out.join('\n');
}

/* ------------------------------------------------------------------ toasts */

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3800);
}

/* --------------------------------------------------------------- knowledge */

function allKnowledge() {
  return libraryEnabled ? [...libraryDocuments, ...userDocuments] : [...userDocuments];
}
function categoryName(id) {
  if (!id) return 'General';
  const category = libraryIndex?.categories?.find((item) => item.id === id);
  if (category) return category.name;
  return id.charAt(0).toUpperCase() + id.slice(1);
}
function localTitle(path) {
  const stem = path.split('/').pop().replace(/\.(md|markdown|txt|pdf|json|csv)$/i, '').replace(/[-_]/g, ' ');
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

async function loadKnowledgeLibrary() {
  try {
    const response = await fetch(KNOWLEDGE_INDEX, { cache: 'no-store' });
    if (!response.ok) throw new Error(`knowledge index ${response.status}`);
    libraryIndex = await response.json();
    const documents = libraryIndex.documents || [];

    const cached = await readMeta('libraryCache');
    let texts = cached && cached.generated === libraryIndex.generated ? cached.texts : null;

    if (!texts) {
      texts = {};
      const queue = [...documents];
      const workers = Array.from({ length: 5 }, async () => {
        while (queue.length) {
          const entry = queue.shift();
          try {
            const file = await fetch(`knowledge/${entry.path}`, { cache: 'no-store' });
            if (file.ok) texts[entry.path] = await file.text();
          } catch (error) {
            console.warn(`Could not load knowledge/${entry.path}`, error);
          }
        }
      });
      await Promise.all(workers);
      writeMeta('libraryCache', { generated: libraryIndex.generated, texts });
    }

    libraryDocuments = documents
      .filter((entry) => texts?.[entry.path])
      .map((entry) => ({
        id: `lib:${entry.path}`,
        name: entry.title || localTitle(entry.path),
        path: entry.path,
        category: entry.category,
        categoryLabel: categoryName(entry.category),
        bundled: true,
        bytes: entry.bytes || texts[entry.path].length,
        chunks: makeChunks(texts[entry.path])
      }));

    const words = (libraryIndex.documents || []).reduce((sum, doc) => sum + (doc.words || 0), 0);
    elements.libraryStatus.textContent = `${libraryDocuments.length} documents ready`;
    elements.librarySummary.textContent = `${Math.round(words / 1000)}k words · ${new Set(libraryDocuments.map((doc) => doc.categoryLabel)).size} topics`;
    renderLibraryChips();
    updateComposer();
  } catch (error) {
    console.warn('Knowledge library unavailable:', error);
    elements.libraryStatus.textContent = 'Library unavailable';
    elements.librarySummary.textContent = 'Add your own files to give Mox context';
    elements.libraryChips.innerHTML = '';
  }
}

function renderLibraryChips() {
  if (!libraryDocuments.length) { elements.libraryChips.innerHTML = ''; return; }
  const counts = new Map();
  for (const doc of libraryDocuments) counts.set(doc.category, (counts.get(doc.category) || 0) + 1);
  const order = (libraryIndex?.categories || []).map((category) => category.id);
  const entries = [...counts.entries()].sort((a, b) => {
    const first = order.indexOf(a[0]), second = order.indexOf(b[0]);
    return (first < 0 ? 99 : first) - (second < 0 ? 99 : second);
  });
  elements.libraryChips.innerHTML = entries.map(([id, count]) =>
    `<button class="library-chip" data-category="${escapeHTML(id)}">${escapeHTML(categoryName(id))}<b>${count}</b></button>`
  ).join('');
  elements.libraryChips.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => openModal('library', button.dataset.category));
  });
}

function renderSources() {
  if (!userDocuments.length) {
    elements.sourceList.innerHTML = '<div class="empty-sources"><span class="folder-art">▱</span><span>No files added yet</span><small>Add a folder to give Mox more context</small></div>';
    return;
  }
  elements.sourceList.innerHTML = userDocuments.map((doc) =>
    `<div class="source-item" title="${escapeHTML(doc.name)}">
      <span class="source-file-icon">${doc.name.toLowerCase().endsWith('.pdf') ? '▤' : '▧'}</span>
      <span class="source-item-name">${escapeHTML(doc.name)}</span>
      <span class="source-size">${displaySize(doc.bytes)}</span>
      <button class="source-remove" data-remove="${escapeHTML(doc.id)}" title="Remove ${escapeHTML(doc.name)}" aria-label="Remove ${escapeHTML(doc.name)}">×</button>
    </div>`
  ).join('');
  elements.sourceList.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      await deleteDocument(button.dataset.remove);
      userDocuments = userDocuments.filter((doc) => doc.id !== button.dataset.remove);
      renderSources(); updateComposer();
      showToast('File removed from this workspace.');
    });
  });
}

/* --------------------------------------------------------------- retrieval */

const chunkCache = new WeakMap();
function chunksFor(doc) {
  if (chunkCache.has(doc)) return chunkCache.get(doc);
  const entries = doc.chunks.map((text, index) => {
    const frequencies = new Map();
    const stems = new Map();
    for (const word of tokenize(text)) {
      frequencies.set(word, (frequencies.get(word) || 0) + 1);
      const key = stem(word);
      stems.set(key, (stems.get(key) || 0) + 1);
    }
    return { text, index, frequencies, stems, doc };
  });
  chunkCache.set(doc, entries);
  return entries;
}

// Crude suffix stripping: enough to match "fractions" with "fraction" and
// "computing" with "compute" without shipping a stemmer library.
const stemCache = new Map();
function stem(word) {
  if (stemCache.has(word)) return stemCache.get(word);
  let value = word;
  if (value.length > 4) {
    value = value
      .replace(/(ies)$/, 'y')
      .replace(/([^s])s$/, '$1')
      .replace(/(ing|edly|ed|ly)$/, '')
      .replace(/(t|e)$/, '');
  }
  if (value.length < 3) value = word;
  stemCache.set(word, value);
  return value;
}

function retrieve(query, limit = MAX_EXCERPTS) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const chunks = allKnowledge().flatMap((doc) => chunksFor(doc));
  if (!chunks.length) return [];

  const documentFrequency = new Map();
  for (const term of terms) {
    const key = stem(term);
    let count = 0;
    for (const chunk of chunks) if (chunk.frequencies.has(term) || chunk.stems.has(key)) count++;
    documentFrequency.set(term, count);
  }

  const phrase = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const scored = [];
  for (const chunk of chunks) {
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const frequency = Math.max(
        chunk.frequencies.get(term) || 0,
        chunk.stems.get(stem(term)) || 0
      );
      if (!frequency) continue;
      matched++;
      const idf = Math.log(1 + chunks.length / (1 + (documentFrequency.get(term) || 0)));
      score += (1 + Math.log(frequency)) * (0.35 + idf);
    }
    if (!score) continue;
    // Reward covering more of the question, not just one lucky keyword.
    score += matched * matched * 0.55;
    const title = `${chunk.doc.name} ${chunk.doc.path || ''} ${chunk.doc.categoryLabel || ''}`.toLowerCase();
    let titleMatch = false;
    for (const term of terms) {
      if (title.includes(term) || title.includes(stem(term))) { score += 1.6; titleMatch = true; }
    }
    // Only multi-word phrases get the phrase bonus: for a single word it would
    // just double-count the term and make "fraction"/"fractions" rank differently.
    const phraseMatch = phrase.includes(' ') && chunk.text.toLowerCase().includes(phrase);
    if (phraseMatch) score += 3.5;
    scored.push({ ...chunk, score, matched, titleMatch, phraseMatch });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return [];

  const distinctive = terms.filter((term) => (documentFrequency.get(term) || 0) / chunks.length < 0.45);
  const best = scored[0].score;
  const usable = scored.filter((item) => {
    if (item.score < best * 0.3) return false;
    if (distinctive.length && !distinctive.some((term) => item.frequencies.has(term) || item.stems.has(stem(term)))) return false;
    const needed = Math.min(2, terms.length);
    const strong = item.matched >= needed || item.titleMatch || item.phraseMatch;
    return strong || item.score >= best * 0.62;
  });

  const selected = [];
  const perSource = new Map();
  for (const item of usable) {
    if (selected.length >= limit) break;
    if ((perSource.get(item.doc.id) || 0) >= 2) continue;
    if (selected.some((other) => other.doc.id === item.doc.id && Math.abs(other.index - item.index) <= 1)) continue;
    selected.push(item);
    perSource.set(item.doc.id, (perSource.get(item.doc.id) || 0) + 1);
  }
  return selected.length ? selected : scored.slice(0, 1);
}

/* ------------------------------------------------------------------ models */

function setModelStatus(state, text) {
  elements.modelDot.className = `status-dot ${state}`;
  elements.sidebarStatus.textContent = text;
}
function setSourceBadge(kind, text) {
  elements.sourceBadge.className = `source-badge ${kind}`;
  elements.sourceBadge.textContent = text;
}

async function readModelManifest() {
  try {
    const response = await fetch(MODEL_MANIFEST, { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    modelManifest = await response.json();
    const available = [];
    for (const entry of modelManifest.models || []) {
      try {
        const head = await fetch(`models/${entry.file}`, { method: 'HEAD', cache: 'no-store' });
        if (head.ok) available.push(entry);
      } catch { /* ignore missing files */ }
    }
    modelManifest.available = available;
    return available;
  } catch (error) {
    console.warn('Model manifest unavailable:', error);
    modelManifest = { models: [], available: [] };
    return [];
  }
}

function activeModel() {
  const available = modelManifest?.available || [];
  return available.find((entry) => entry.id === chosenModelId) || available[0] || null;
}

function describeModel() {
  const model = activeModel();
  if (!model) return 'No model file found in models/.';
  const parts = [model.name];
  if (model.quantization) parts.push(model.quantization);
  if (model.parameters) parts.push(model.parameters);
  return parts.join(' · ');
}

const WLLAMA_COMPAT_JS = new URL('vendor/wllama/compat/wllama.js', import.meta.url).href;
const WLLAMA_COMPAT_WASM = new URL('vendor/wllama/compat/wllama.wasm', import.meta.url).href;

// Older browsers without JSPI or 64-bit memory need wllama's compatibility build.
// If those files are vendored, use them so nothing is fetched from a CDN.
async function vendoredCompat() {
  try {
    const head = await fetch(WLLAMA_COMPAT_WASM, { method: 'HEAD' });
    return head.ok ? { worker: WLLAMA_COMPAT_JS, wasm: WLLAMA_COMPAT_WASM } : null;
  } catch {
    return null;
  }
}

const NOOP_CACHE = {
  match: async () => null, put: async () => {}, getSize: async () => -1,
  list: async () => [], delete: async () => {}, getNameFromURL: async (url) => String(url)
};

async function createEngine() {
  const { Wllama } = await import(WLLAMA_URL);
  // wllama resolves `default` and the `wllama.wasm` key to the runtime binary.
  // Both point at the copy in this repository so no CDN is ever contacted.
  const config = { default: WLLAMA_WASM, 'wllama.wasm': WLLAMA_WASM };
  const options = {
    suppressNativeLog: true,
    logger: { debug() {}, log() {}, warn() {}, error: (...args) => console.warn('[wllama]', ...args) }
  };

  let instance;
  try {
    instance = new Wllama(config, options);
  } catch (error) {
    // Some browsers block the storage backend (private mode, older Safari).
    // A no-op cache keeps the engine usable: the model streams from this site.
    console.warn('Falling back to an in-memory model cache:', error);
    instance = new Wllama(config, { ...options, cacheManager: NOOP_CACHE });
  }
  const compat = await vendoredCompat();
  if (compat) instance.setCompat(compat);
  return instance;
}

async function startModel({ auto = false } = {}) {
  if (modelReady || generating || elements.load.disabled) return;
  elements.load.disabled = true;
  elements.load.innerHTML = '<span class="button-sparkle">✳</span> Loading model…';
  elements.progress.hidden = false;
  elements.progressBar.style.width = '0%';
  elements.progressPercent.textContent = '0%';
  elements.modelTitle.textContent = 'Loading the bundled model';
  elements.progressLabel.textContent = 'Reading models/manifest.json…';
  setModelStatus('loading', 'Loading model…');

  try {
    if (!modelManifest) await readModelManifest();
    const model = activeModel();
    if (!model) {
      throw new Error('No .gguf model found. Run `python3 tools/fetch_model.py` or reload this page.');
    }
    chosenModelId = model.id;
    loadedModel = model;
    elements.modelName.textContent = describeModel();
    elements.modelSize.textContent = displaySize(model.bytes);

    // 1. Fetch the weights from this site, with a real progress bar.
    elements.progressLabel.textContent = `Fetching ${model.file} from this site`;
    const response = await fetch(`models/${model.file}`);
    if (!response.ok) throw new Error(`models/${model.file} → HTTP ${response.status}`);
    const total = Number(response.headers.get('Content-Length')) || model.bytes;
    let blob;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const percent = Math.min(99, Math.round((received / total) * 100));
        elements.progressBar.style.width = `${percent}%`;
        elements.progressPercent.textContent = `${percent}%`;
        elements.progressLabel.textContent = `Fetching ${model.file} · ${displaySize(received)} of ${displaySize(total)}`;
        setSourceBadge('local', `◈ model ${percent}%`);
      }
      blob = new Blob(chunks);
    } else {
      blob = await response.blob();
    }

    // 2. Start llama.cpp in WebAssembly and load the weights.
    elements.progressLabel.textContent = 'Starting the inference engine…';
    elements.progressPercent.textContent = '…';
    engine = await createEngine();
    const threads = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2));
    elements.progressLabel.textContent = `Loading weights (${threads} thread${threads === 1 ? '' : 's'})…`;
    await engine.loadModel([blob], {
      n_ctx: CONTEXT_SIZE,
      n_threads: threads,
      n_batch: 256,
      jinja: true,
      seed: 42
    });

    modelReady = true;
    searchOnly = false;
    elements.progressBar.style.width = '100%';
    elements.progressPercent.textContent = 'Ready';
    elements.progressLabel.textContent = 'Model loaded on this device';
    elements.modelTitle.textContent = 'Mox is ready';
    elements.modelDescription.textContent = `${describeModel()} is running in this browser. Questions, your files, and the knowledge library stay on this device.`;
    elements.modelSize.textContent = 'Loaded';
    elements.modelFootnote.innerHTML = `<span>◉</span> Served by this site · ${threads} thread${threads === 1 ? '' : 's'} · works offline after the first load`;
    elements.load.innerHTML = '<span class="button-sparkle">✓</span> Model loaded';
    elements.load.classList.add('loaded');
    elements.load.disabled = true;
    setSourceBadge('local', '◈ model on this site');
    setModelStatus('ready', `${model.name} ready`);
    updateComposer();
    await writeMeta('modelChoice', model.id);
    if (!auto) showToast(`${model.name} loaded. Ask something about the knowledge library.`);
  } catch (error) {
    console.error('Model loading failed:', error);
    modelReady = false;
    searchOnly = true;
    elements.modelTitle.textContent = 'Search-only mode';
    elements.modelDescription.textContent = 'The model could not start, so answers show the matching passages directly. Reload to try again.';
    elements.progressLabel.textContent = (error.message || 'Model failed to load').slice(0, 150);
    elements.modelSize.textContent = 'Search only';
    elements.load.disabled = false;
    elements.load.innerHTML = '<span class="button-sparkle">↻</span> Retry the model <span class="button-arrow">↗</span>';
    setModelStatus('error', 'Model unavailable · search only');
    setSourceBadge('remote', '◈ search only');
    updateComposer();
    showToast('Model unavailable. Library search still works.');
  }
}

function buildMessages(question, excerpts) {
  const sources = excerpts.length
    ? excerpts.map((item, index) =>
        `[${index + 1}] ${item.doc.bundled ? `${item.doc.categoryLabel} › ${item.doc.name}` : item.doc.name}\n${item.text.slice(0, EXCERPT_CHARS).trim()}`
      ).join('\n\n')
    : 'No matching passages were found in the knowledge library or your files.';

  const system = [
    'You are Mox, a careful assistant running privately in the user\'s browser.',
    'Answer only from the SOURCES below, and cite the ones you use like [1] or [2].',
    'If the sources do not answer the question, say "I could not find that in the library." and name what would help.',
    'Be direct and specific: no preamble, no restating the question, no filler.',
    'Plain text, at most 120 words. Use short lists only when the question asks for steps or options.',
    '',
    'SOURCES:',
    sources
  ].join('\n');

  const messages = [{ role: 'system', content: system }];
  for (const turn of history.slice(-HISTORY_TURNS)) messages.push(turn);
  messages.push({ role: 'user', content: question });
  return messages;
}

// If the model's chat template cannot be applied by the Jinja engine (a GGUF
// without one, or an unsupported template), fall back to plain ChatML — the
// format used by SmolLM2, Qwen, and most other small instruct models.
function chatMLPrompt(messages) {
  return messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n') + '\n<|im_start|>assistant\n';
}

async function streamChatML(messages, onToken, abortSignal) {
  let streamed = '';
  await engine.createCompletion({
    prompt: chatMLPrompt(messages),
    stream: true,
    abortSignal,
    max_tokens: MAX_NEW_TOKENS,
    temp: 0.3,
    top_k: 40,
    top_p: 0.92,
    penalty_repeat: 1.15,
    penalty_last_n: 96,
    stop: ['<|im_end|>', '<|endoftext|>', '<|im_start|>'],
    onData: (chunk) => {
      const piece = chunk?.choices?.[0]?.text ?? chunk?.choices?.[0]?.delta?.content;
      if (!piece) return;
      streamed += piece;
      if (onToken) onToken(piece);
    }
  });
  return streamed;
}

function wasAborted(error) {
  return error?.name === 'WllamaAbortError' || error?.code === 'abort' || /abort/i.test(error?.message || '');
}

async function generateAnswer(question, excerpts, onToken, abortSignal) {
  const messages = buildMessages(question, excerpts);
  try {
    return await chatCompletion(messages, onToken, abortSignal);
  } catch (error) {
    if (wasAborted(error)) throw error;
    console.warn('Chat template failed, using ChatML instead:', error);
    return cleanupAnswer(await streamChatML(messages, onToken, abortSignal));
  }
}

async function chatCompletion(messages, onToken, abortSignal) {
  let streamed = '';
  const result = await engine.createChatCompletion({
    messages,
    stream: true,
    abortSignal,
    max_tokens: MAX_NEW_TOKENS,
    temp: 0.3,
    top_k: 40,
    top_p: 0.92,
    penalty_repeat: 1.15,
    penalty_last_n: 96,
    onData: (chunk) => {
      const piece = chunk?.choices?.[0]?.delta?.content;
      if (!piece) return;
      streamed += piece;
      if (onToken) onToken(piece);
    }
  });
  const complete = result?.choices?.[0]?.message?.content;
  return cleanupAnswer(complete || streamed);
}

function cleanupAnswer(text) {
  let value = String(text || '')
    .replace(/<\|im_end\|>[\s\S]*$/g, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/^\s*(?:assistant|mox|user)\s*[:\-]\s*/i, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Small models loop: drop a repeated trailing block.
  const lines = value.split('\n');
  const tail = lines.slice(-3).join('\n');
  if (tail.length > 40) {
    const earlier = value.slice(0, value.length - tail.length);
    if (earlier.includes(tail.trim())) value = earlier.trim();
  }
  // Stop mid-sentence tails from looking like broken output.
  if (value.length > 80 && !/[.!?…"')\]]$/.test(value)) {
    const lastStop = Math.max(value.lastIndexOf('. '), value.lastIndexOf('? '), value.lastIndexOf('! '));
    if (lastStop > value.length * 0.6) value = value.slice(0, lastStop + 1);
  }
  return value;
}

/* -------------------------------------------------------------------- chat */

function citationPills(excerpts, record) {
  const wrap = document.createElement('div');
  wrap.className = 'sources-cited';
  const label = document.createElement('span');
  label.textContent = 'Sources';
  wrap.append(label);

  const seen = new Set();
  excerpts.forEach((item, index) => {
    if (seen.has(item.doc.id)) return;
    seen.add(item.doc.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-pill';
    button.textContent = item.doc.bundled ? `${item.doc.categoryLabel} › ${item.doc.name}` : item.doc.name;
    button.title = 'Open the passage Mox used';
    button.addEventListener('click', () => openPassage(record, index));
    wrap.append(button);
  });
  return wrap;
}

function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try { document.execCommand?.('copy'); } finally { area.remove(); }
  return Promise.resolve();
}

function attachActions(body, record) {
  body.querySelector('.msg-actions')?.remove();
  if (!record) return;
  const row = document.createElement('div');
  row.className = 'msg-actions';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'msg-action';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    await copyText(record.text);
    copy.textContent = 'Copied';
    copy.classList.add('done');
    setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('done'); }, 1400);
  });
  row.append(copy);

  if (record.role === 'assistant') {
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'msg-action';
    again.textContent = 'Regenerate';
    again.disabled = false;
    again.addEventListener('click', () => regenerate(record));
    row.append(again);
  }

  if (record.stats) {
    const stats = document.createElement('span');
    stats.className = 'msg-stats';
    stats.textContent = record.stats;
    row.append(stats);
  }
  body.append(row);
}

function renderMessage(role, text, excerpts = [], record = null) {
  const row = document.createElement('article');
  row.className = `message ${role}`;
  const body = document.createElement('div');
  body.className = 'message-body';
  // Answers are stored as markdown-ish text, so reopening a chat looks exactly
  // like it did while the model was streaming.
  if (role === 'assistant' && text) body.innerHTML = renderRich(text);
  else body.textContent = text;
  row.append(body);
  if (excerpts?.length && text) body.append(citationPills(excerpts, record));
  elements.messages.append(row);
  if (record && text) attachActions(body, record);
  return body;
}

/* ---------- conversations (the sidebar list) ---------- */

function activeChat() {
  let chat = conversations.find((entry) => entry.id === activeChatId);
  if (!chat) {
    chat = { id: makeId(), records: [], updatedAt: Date.now() };
    conversations.push(chat);
    activeChatId = chat.id;
  }
  return chat;
}

/* Conversations live in IndexedDB so a reload keeps your history. */
function scheduleSaveChats() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveChats, 300);
}

async function saveChats() {
  try {
    const chats = conversations
      .filter((chat) => chat.records.length)
      .slice(-CHAT_LIMIT)
      .map((chat) => ({
        id: chat.id,
        updatedAt: chat.updatedAt || Date.now(),
        records: chat.records.map((record) => ({
          role: record.role,
          text: record.text.slice(0, SAVED_TEXT_LIMIT),
          stats: record.stats || '',
          excerpts: (record.excerpts || []).slice(0, MAX_EXCERPTS).map((item) => ({
            text: item.text.slice(0, EXCERPT_CHARS),
            doc: {
              id: item.doc.id, name: item.doc.name, path: item.doc.path || '',
              categoryLabel: item.doc.categoryLabel || '', bundled: Boolean(item.doc.bundled)
            }
          }))
        }))
      }));
    await writeMeta(CHAT_META_KEY, { activeChatId, chats });
  } catch (error) {
    console.warn('Could not save chats:', error);
  }
}

async function restoreChats() {
  const saved = await readMeta(CHAT_META_KEY);
  if (!saved?.chats?.length) return false;
  conversations.length = 0;
  for (const chat of saved.chats) {
    conversations.push({
      id: chat.id,
      updatedAt: chat.updatedAt || Date.now(),
      records: (chat.records || [])
        .filter((record) => record && (record.role === 'user' || record.role === 'assistant') && typeof record.text === 'string')
        .map((record) => ({
          role: record.role,
          text: record.text,
          stats: record.stats || '',
          excerpts: record.excerpts || []
        }))
    });
  }
  const target = conversations.find((chat) => chat.id === saved.activeChatId)
    || conversations.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  activeChatId = target?.id || null;
  return true;
}

function deleteChat(id) {
  const index = conversations.findIndex((chat) => chat.id === id);
  if (index < 0) return;
  conversations.splice(index, 1);
  if (activeChatId === id) {
    activeChatId = null;
    resetChat();
  } else {
    renderChatList();
  }
  scheduleSaveChats();
  showToast('Chat deleted.');
}

function chatTitle(chat) {
  const first = chat.records.find((record) => record.role === 'user');
  if (!first) return 'New chat';
  const text = first.text.replace(/\s+/g, ' ').trim();
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

function renderChatList() {
  elements.chatList.textContent = '';
  const started = conversations
    .filter((chat) => chat.records.length)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  elements.chatEmpty.hidden = started.length > 0;
  for (const chat of started.slice().reverse()) {
    const item = document.createElement('div');
    item.className = `chat-item${chat.id === activeChatId ? ' active' : ''}`;

    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'chat-entry';
    entry.textContent = chatTitle(chat);
    entry.title = chatTitle(chat);
    entry.setAttribute('aria-current', chat.id === activeChatId ? 'true' : 'false');
    entry.addEventListener('click', () => openConversation(chat.id));
    item.append(entry);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chat-delete';
    remove.textContent = '×';
    remove.title = 'Delete this chat';
    remove.setAttribute('aria-label', `Delete chat: ${chatTitle(chat)}`);
    remove.addEventListener('click', (event) => { event.stopPropagation(); deleteChat(chat.id); });
    item.append(remove);

    elements.chatList.append(item);
  }
}

function openConversation(id) {
  const chat = conversations.find((entry) => entry.id === id);
  if (!chat || generating) return;
  activeChatId = chat.id;
  elements.messages.textContent = '';
  for (const record of chat.records) renderMessage(record.role, record.text, record.excerpts || [], record);
  const empty = chat.records.length === 0;
  elements.welcome.hidden = !empty;
  elements.quickStart.hidden = !empty;
  history = chatRecordsToHistory(chat);
  renderChatList();
  updateComposer();
  scheduleSaveChats();
  closeDrawer();
  scrollToBottom(true);
}

function chatRecordsToHistory(chat) {
  return chat.records.slice(-4).map((record) => ({
    role: record.role,
    content: record.text.slice(0, 600)
  }));
}

function scrollToBottom(force = false) {
  const box = elements.conversation;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  if (force || nearBottom) box.scrollTop = box.scrollHeight;
}

function addRecord(role, text, excerpts = []) {
  const chat = activeChat();
  const record = { role, text, excerpts, stats: '', at: Date.now() };
  chat.records.push(record);
  chat.updatedAt = Date.now();
  const body = renderMessage(role, text, excerpts, record);
  body.__moxRecord = record;
  elements.welcome.hidden = true;
  elements.quickStart.hidden = true;
  renderChatList();
  scrollToBottom();
  scheduleSaveChats();
  return record;
}

function appendMessage(role, text, excerpts = []) {
  const record = addRecord(role, text, excerpts);
  return elements.messages.lastElementChild.querySelector('.message-body') || record;
}

function updateComposer() {
  const usable = modelReady || searchOnly;
  const streaming = generating && modelReady;
  elements.input.disabled = !usable || generating;
  elements.form.setAttribute('aria-busy', String(streaming));
  elements.send.classList.toggle('stop', streaming);
  elements.send.innerHTML = streaming ? '<span aria-hidden="true"></span>' : '↑';
  elements.send.setAttribute('aria-label', streaming ? 'Stop generating' : 'Send message');
  elements.send.title = streaming ? 'Stop generating' : 'Send message';
  elements.send.disabled = streaming ? false : (!usable || !elements.input.value.trim());
  const sources = allKnowledge().length;
  if (generating) elements.hint.textContent = 'Generating on this device…';
  else if (modelReady) elements.hint.textContent = `${sources} searchable document${sources === 1 ? '' : 's'} · ${loadedModel?.parameters || 'local model'}`;
  else if (searchOnly) elements.hint.textContent = 'Search-only mode — answers show matching passages';
  else elements.hint.textContent = 'Starting the local model…';
}

// Passages are cut at character boundaries, so they can begin mid-sentence or
// mid-word. Start at the first sentence break, or at least a word boundary.
function tidySnippet(text, maxLength = 430) {
  let value = text.replace(/\s+/g, ' ').trim();
  const boundary = value.search(/(?<=[.!?])\s/);
  if (boundary > 12 && boundary < 220) value = value.slice(boundary + 1).trim();
  else if (/^[a-z]/.test(value)) value = value.replace(/^\S+\s+/, '');
  if (value.length > maxLength) value = `${value.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function fallbackAnswer(excerpts) {
  if (!excerpts.length) {
    return 'The model is not available right now, and nothing in the knowledge library matched that question. Try adding your own files, or reload to retry the model.';
  }
  const header = modelReady
    ? 'The model could not produce an answer, so here are the closest passages from the library:'
    : 'The language model is not running, so here are the closest passages from the library:';
  return `${header}\n\n${excerpts.slice(0, 3).map((item, index) =>
    `${index + 1}. ${item.doc.bundled ? `${item.doc.categoryLabel} › ${item.doc.name}` : item.doc.name}\n“${tidySnippet(item.text)}”`
  ).join('\n\n')}`;
}

function announce(text) {
  if (!elements.srStatus) return;
  elements.srStatus.textContent = '';
  setTimeout(() => { elements.srStatus.textContent = text; }, 60);
}

function stopGeneration() {
  if (!abortController) return;
  abortController.abort();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (generating) { stopGeneration(); return; }
  const question = elements.input.value.trim();
  if (!question || !(modelReady || searchOnly)) return;

  elements.input.value = '';
  elements.input.style.height = 'auto';
  addRecord('user', question);
  const userRecord = activeChat().records[activeChat().records.length - 1];
  const excerpts = retrieve(question);
  updateComposer();

  if (!modelReady) {
    addRecord('assistant', fallbackAnswer(excerpts), excerpts);
    updateComposer();
    elements.input.focus();
    return;
  }
  await runGeneration(question, excerpts, userRecord);
}

async function runGeneration(question, excerpts, userRecord) {
  generating = true;
  abortController = new AbortController();
  updateComposer();
  elements.typing.hidden = false;

  const answer = addRecord('assistant', '', excerpts);
  const body = elements.messages.lastElementChild.querySelector('.message-body');
  const cursor = document.createElement('span');
  cursor.className = 'cursor-blink';
  body.append(cursor);

  let streamed = '';
  const started = performance.now();
  let stopped = false;

  try {
    const result = await generateAnswer(question, excerpts, (token) => {
      streamed += token;
      cursor.remove();
      body.textContent = streamed;
      body.append(cursor);
      scrollToBottom();
    }, abortController.signal);

    cursor.remove();
    const final = cleanupAnswer(result || streamed);
    if (!final || final.length < 2) throw new Error('Empty response');
    paintAnswer(answer, body, final, excerpts, started);
  } catch (error) {
    cursor.remove();
    if (wasAborted(error)) {
      stopped = true;
      const partial = cleanupAnswer(streamed);
      if (partial.length > 1) {
        paintAnswer(answer, body, `${partial} …`, excerpts, started);
        showToast('Stopped. The answer above is what the model had produced.');
      } else {
        body.closest('.message')?.remove();
        activeChat().records = activeChat().records.filter((record) => record !== answer);
        showToast('Stopped.');
      }
    } else {
      console.error('Inference failed:', error);
      body.closest('.message')?.remove();
      activeChat().records = activeChat().records.filter((record) => record !== answer);
      addRecord('assistant', fallbackAnswer(excerpts), excerpts);
      showToast('The model could not answer; showing matching passages instead.');
    }
  } finally {
    elements.typing.hidden = true;
    generating = false;
    abortController = null;
    if (!stopped) announce('Answer ready.');
    activeChat().updatedAt = Date.now();
    renderChatList();
    updateComposer();
    scheduleSaveChats();
    elements.input.focus();
  }
}

function paintAnswer(record, body, text, excerpts, started) {
  const seconds = Math.max(0.1, (performance.now() - started) / 1000);
  // Rough token estimate for a progress hint; exact counts are not exposed.
  const tokens = Math.max(1, Math.round(text.length / 4));
  record.text = text;
  record.excerpts = excerpts;
  record.stats = `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s · ${Math.round(tokens / seconds)} tok/s`;
  body.innerHTML = renderRich(text);
  if (excerpts?.length) body.append(citationPills(excerpts, record));
  attachActions(body, record);

  const chat = activeChat();
  chat.updatedAt = Date.now();
  history = chatRecordsToHistory(chat);
  renderChatList();
  scheduleSaveChats();
  scrollToBottom();
}

async function regenerate(record) {
  if (generating || !modelReady) {
    showToast(modelReady ? 'One answer at a time — wait for this one to finish.' : 'The model is not running.');
    return;
  }
  const chat = activeChat();
  const index = chat.records.indexOf(record);
  if (index < 0) return;
  const question = [...chat.records.slice(0, index)].reverse().find((entry) => entry.role === 'user');
  if (!question) return;

  chat.records.splice(index);
  elements.messages.textContent = '';
  history = chatRecordsToHistory(chat);
  for (const entry of chat.records) renderMessage(entry.role, entry.text, entry.excerpts || [], entry);
  const excerpts = record.excerpts?.length ? record.excerpts : retrieve(question.text);
  await runGeneration(question.text, excerpts, question);
}

function resetChat() {
  elements.messages.textContent = '';
  elements.welcome.hidden = false;
  elements.quickStart.hidden = false;
  elements.input.value = '';
  elements.input.style.height = 'auto';
  history = [];
  activeChatId = null;
  activeChat();
  renderChatList();
  updateComposer();
  scheduleSaveChats();
  elements.input.focus();
}

/* ------------------------------------------------------------------ import */

async function importFiles(fileList) {
  const allowed = /\.(txt|md|markdown|csv|json|html|htm|xml|yaml|yml|log|pdf)$/i;
  const files = Array.from(fileList).filter((file) => allowed.test(file.name) && file.size > 0);
  if (!files.length) {
    showToast('No supported files found. Try PDF, text, Markdown, CSV, JSON, HTML, YAML, or log files.');
    return;
  }
  let added = 0, skipped = 0;
  showToast(`Reading ${files.length} file${files.length === 1 ? '' : 's'} on this device…`);
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) { skipped++; continue; }
    const name = file.webkitRelativePath || file.name;
    if (userDocuments.some((doc) => doc.name === name && doc.bytes === file.size)) continue;
    try {
      const text = await extractFile(file);
      const chunks = makeChunks(text);
      if (!chunks.length) { skipped++; continue; }
      const doc = { id: makeId(), name, bytes: file.size, chunks, importedAt: Date.now() };
      await saveDocument(doc);
      userDocuments.push(doc);
      added++;
    } catch (error) {
      console.warn(`Could not read ${file.name}:`, error);
      skipped++;
    }
  }
  renderSources();
  updateComposer();
  if (added) showToast(`Added ${added} file${added === 1 ? '' : 's'} to your private knowledge${skipped ? ` · ${skipped} skipped` : ''}.`);
  else showToast(skipped ? 'Some files could not be read. PDFs may need a reload on first use.' : 'Those files are already in your workspace.');
}

function exportActiveChat() {
  const chat = conversations.find((entry) => entry.id === activeChatId);
  if (!chat?.records.length) { showToast('This chat is empty.'); return; }
  const lines = [`# ${chatTitle(chat)}`, '', `Saved from Mox · ${new Date().toLocaleString()}`, ''];
  for (const record of chat.records) {
    lines.push(record.role === 'user' ? `**You:** ${record.text}` : `**Mox:** ${record.text}`);
    const docs = (record.excerpts || []).map((item) => item.doc.name);
    if (docs.length) lines.push('', `Sources: ${[...new Set(docs)].join(', ')}`);
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${chatTitle(chat).replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'mox-chat'}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Chat exported as Markdown.');
}

/* ------------------------------------------------------------------ drawer */

function openDrawer() {
  document.body.classList.add('drawer-open');
  elements.sidebarScrim.hidden = false;
  elements.sidebarToggle.setAttribute('aria-expanded', 'true');
  const first = document.querySelector('.sidebar .chat-entry, .sidebar .side-row');
  first?.focus?.();
}

function closeDrawer() {
  if (!document.body.classList.contains('drawer-open')) return;
  document.body.classList.remove('drawer-open');
  elements.sidebarScrim.hidden = true;
  elements.sidebarToggle.setAttribute('aria-expanded', 'false');
}

/* ------------------------------------------------------------------- modal */

function revealModal() {
  lastFocused = document.activeElement;
  elements.modal.hidden = false;
  const target = elements.modal.querySelector('.modal-done, .modal-close, button');
  setTimeout(() => target?.focus?.(), 0);
}

function closeModal() {
  if (elements.modal.hidden) return;
  elements.modal.hidden = true;
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus?.();
  lastFocused = null;
}

function openPassage(record, index) {
  const item = record?.excerpts?.[index];
  if (!item) return;
  const name = item.doc.bundled ? `${item.doc.categoryLabel} › ${item.doc.name}` : item.doc.name;
  elements.modalKicker.textContent = 'PASSAGE MOX USED';
  elements.modalTitle.textContent = name;
  elements.modalCopy.innerHTML = `
    <p class="passage-meta">${escapeHTML(item.doc.bundled ? 'from the knowledge library' : 'from a file you added')}${item.doc.path ? ` · <code>${escapeHTML(item.doc.path)}</code>` : ''}</p>
    <div class="passage"></div>
    <div class="source-actions">
      <button class="modal-secondary" id="copyPassage">Copy passage</button>
      ${item.doc.bundled ? '<button class="modal-secondary" id="readWholeDoc">Read the whole document</button>' : ''}
    </div>`;
  const box = elements.modalCopy.querySelector('.passage');
  box.textContent = tidySnippet(item.text, 1600);
  elements.modalCopy.querySelector('#copyPassage').addEventListener('click', async (event) => {
    await copyText(box.textContent);
    event.target.textContent = 'Copied';
    setTimeout(() => { event.target.textContent = 'Copy passage'; }, 1400);
  });
  elements.modalCopy.querySelector('#readWholeDoc')?.addEventListener('click', () => {
    const doc = libraryDocuments.find((entry) => entry.path === item.doc.path);
    if (!doc) { showToast('That document is not loaded right now.'); return; }
    elements.modalTitle.textContent = doc.name;
    box.textContent = doc.chunks.join('\n\n');
    box.scrollTop = 0;
  });
  revealModal();
}

function modelListMarkup() {
  const available = modelManifest?.available || [];
  if (!available.length) {
    return '<p>No model files were found in <code>models/</code>. Run <code>python3 tools/fetch_model.py</code>, then reload.</p>';
  }
  return `<div class="model-choices">${available.map((entry) => `
    <button class="model-choice${entry.id === chosenModelId ? ' active' : ''}" data-model="${escapeHTML(entry.id)}">
      <span class="model-choice-name">${escapeHTML(entry.name)}${entry.bundled ? ' <em>bundled</em>' : ''}</span>
      <span class="model-choice-meta">${escapeHTML([entry.parameters, entry.quantization, displaySize(entry.bytes), entry.license].filter(Boolean).join(' · '))}</span>
    </button>`).join('')}</div>`;
}

function openModal(kind = 'privacy', category = null) {
  const header = {
    privacy: ['A NOTE ON PRIVACY', 'Everything stays with you.'],
    settings: ['MODEL & DEVICE', 'A real model, running here.'],
    library: ['KNOWLEDGE LIBRARY', `${libraryDocuments.length} documents, built in.`]
  }[kind] || ['A NOTE ON PRIVACY', 'Everything stays with you.'];

  elements.modalKicker.textContent = header[0];
  elements.modalTitle.textContent = header[1];

  if (kind === 'settings') {
    elements.modalCopy.innerHTML = `
      <p><strong>Running now:</strong> ${escapeHTML(modelReady ? describeModel() : 'no model loaded')} — llama.cpp compiled to WebAssembly, executing on this device.</p>
      <p><strong>Where the weights come from:</strong> <code>models/</code> on this site. ${loadedModel ? `${escapeHTML(displaySize(loadedModel.bytes))} ${loadedModel.quantization || ''} GGUF, ${escapeHTML(loadedModel.license || 'open license')}.` : ''} Nothing is fetched from Hugging Face at runtime.</p>
      <p><strong>Choose a model</strong></p>
      ${modelListMarkup()}
      <p><strong>Upgrade:</strong> run <code>python3 tools/fetch_model.py --preset qwen-0.5b</code> for a 0.5B model, or drop any <code>.gguf</code> file into <code>models/</code> and add it to <code>models/manifest.json</code>. Larger models are smarter but slower on a CPU.</p>
      <p><strong>Knowledge library:</strong> ${libraryDocuments.length} documents across ${new Set(libraryDocuments.map((doc) => doc.categoryLabel)).size} topics, indexed in your browser.<br>
      <strong>Your files:</strong> ${userDocuments.length} imported document${userDocuments.length === 1 ? '' : 's'} in IndexedDB.<br>
      <strong>Chats:</strong> ${conversations.filter((chat) => chat.records.length).length} saved in this browser.</p>
      <div class="source-actions">
        <button class="modal-secondary" id="modelUpload">Load a .gguf from this computer</button>
        <button class="modal-secondary" id="exportChat">Export this chat</button>
        <button class="modal-secondary" id="clearChats">Delete all chats</button>
      </div>
      <p style="margin-top:16px"><strong>Keyboard</strong><br>
      <code>⌘K</code> / <code>Ctrl K</code> new chat · <code>⌘/</code> focus the composer · <code>Enter</code> send · <code>Shift Enter</code> new line · <code>Esc</code> close.</p>`;
  } else if (kind === 'library') {
    const groups = new Map();
    for (const doc of libraryDocuments) {
      if (!groups.has(doc.category)) groups.set(doc.category, []);
      groups.get(doc.category).push(doc);
    }
    const order = (libraryIndex?.categories || []).map((entry) => entry.id);
    const sections = [...groups.entries()]
      .sort((a, b) => {
        const first = order.indexOf(a[0]), second = order.indexOf(b[0]);
        return (first < 0 ? 99 : first) - (second < 0 ? 99 : second);
      })
      .filter(([key]) => !category || key === category)
      .map(([key, docs]) => `
        <div class="library-group">
          <h3>${escapeHTML(categoryName(key))} · ${docs.length}</h3>
          ${docs.map((doc) => `<div class="library-doc">${escapeHTML(doc.name)}<span>${doc.chunks.length} passages</span></div>`).join('')}
        </div>`).join('');
    elements.modalCopy.innerHTML = `
      ${libraryDocuments.length ? '<input class="library-filter" id="libraryFilter" type="search" placeholder="Filter documents…" aria-label="Filter documents">' : ''}
      <div id="libraryBody">${sections || '<p>No documents loaded yet.</p>'}</div>
      <p>Ask a question and Mox retrieves the most relevant passages from these files. To add your own, use <strong>Add a folder</strong>, or drop files into <code>knowledge/</code> and run <code>python3 tools/build_knowledge_index.py</code>.</p>`;
    const filter = elements.modalCopy.querySelector('#libraryFilter');
    filter?.addEventListener('input', () => {
      const needle = filter.value.trim().toLowerCase();
      elements.modalCopy.querySelectorAll('.library-doc').forEach((row) => {
        row.style.display = !needle || row.textContent.toLowerCase().includes(needle) ? '' : 'none';
      });
      elements.modalCopy.querySelectorAll('.library-group').forEach((group) => {
        const visible = [...group.querySelectorAll('.library-doc')].some((row) => row.style.display !== 'none');
        group.style.display = visible ? '' : 'none';
      });
    });
  } else {
    elements.modalCopy.innerHTML = `
      <p>The model is a ${escapeHTML(describeModel())} GGUF file served by this website and executed in your browser by llama.cpp (WebAssembly). Your questions, your imported files, and the passages retrieved for them never leave this device.</p>
      <p><strong>The knowledge library</strong> is part of this site: ${libraryDocuments.length} documents covering mathematics, reading and writing, technology, science, humanities, and life skills. They are downloaded as text into your browser once, indexed locally, and searched for every question. They do not change the model's weights.</p>
      <p><strong>No third-party model host.</strong> The engine (<code>vendor/wllama</code>) and the weights (<code>models/</code>) sit next to the page, so once the model is loaded the app keeps working offline.</p>
      <p><strong>Storage:</strong> imported files, the library cache, and the browser's copy of the model live in IndexedDB. Clearing site data removes them.</p>`;
  }

  revealModal();
  const upload = $('#modelUpload');
  if (upload) upload.addEventListener('click', () => elements.modelPicker.click());

  const exportButton = $('#exportChat');
  if (exportButton) exportButton.addEventListener('click', exportActiveChat);

  const clearButton = $('#clearChats');
  if (clearButton) clearButton.addEventListener('click', async () => {
    if (!conversations.some((chat) => chat.records.length)) { showToast('There are no saved chats.'); return; }
    if (!window.confirm('Delete every chat in this browser? This cannot be undone.')) return;
    conversations.length = 0;
    activeChatId = null;
    await saveChats();
    closeModal();
    resetChat();
    showToast('All chats deleted.');
  });
  elements.modalCopy.querySelectorAll('[data-model]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.model;
      if (id === chosenModelId) return;
      chosenModelId = id;
      await writeMeta('modelChoice', id);
      closeModal();
      showToast('Reloading with the selected model…');
      location.reload();
    });
  });
}

/* ------------------------------------------------------------------ wiring */

$('#loadModel').addEventListener('click', () => startModel());
$('#sidebarToggle').addEventListener('click', () => {
  if (document.body.classList.contains('drawer-open')) closeDrawer();
  else openDrawer();
});
elements.sidebarScrim.addEventListener('click', closeDrawer);
const isNarrow = () => Boolean(window.matchMedia?.('(max-width: 700px)').matches);
document.querySelectorAll('.sidebar .side-row').forEach((row) => {
  row.addEventListener('click', () => { if (isNarrow()) closeDrawer(); });
});
$('#addFolder').addEventListener('click', () => elements.folderPicker.click());
$('#quickFolder').addEventListener('click', () => elements.folderPicker.click());
$('#addFiles').addEventListener('click', () => elements.filePicker.click());
$('#addFilesSmall').addEventListener('click', () => elements.filePicker.click());
$('#attachButton').addEventListener('click', () => elements.filePicker.click());
$('#quickLibrary').addEventListener('click', () => openModal('library'));
$('#libraryButton').addEventListener('click', () => openModal('library'));
$('#mobileLibrary').addEventListener('click', () => openModal('library'));
$('#mobileSettings').addEventListener('click', () => openModal('settings'));
$('#quickPrivacy').addEventListener('click', () => openModal('privacy'));
$('#settingsButton').addEventListener('click', () => openModal('settings'));
$('#helpButton').addEventListener('click', () => openModal('privacy'));
$('#privacyLink').addEventListener('click', () => openModal('privacy'));
$('#modalClose').addEventListener('click', closeModal);
$('#modalDone').addEventListener('click', closeModal);
elements.modal.addEventListener('click', (event) => { if (event.target === elements.modal) closeModal(); });
elements.modal.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusables = [...elements.modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.disabled && node.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

elements.filePicker.addEventListener('change', (event) => { importFiles(event.target.files); event.target.value = ''; });
elements.folderPicker.addEventListener('change', (event) => { importFiles(event.target.files); event.target.value = ''; });
elements.modelPicker.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!/\.gguf$/i.test(file.name)) { showToast('Choose a .gguf model file.'); return; }
  closeModal();
  await loadModelFile(file);
});
elements.form.addEventListener('submit', handleSubmit);
elements.input.addEventListener('input', () => {
  elements.input.style.height = 'auto';
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 132)}px`;
  updateComposer();
});
elements.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});
$('#newChat').addEventListener('click', resetChat);
$('#modelMenu').addEventListener('click', () => openModal('settings'));
$('#quickAsk').addEventListener('click', () => {
  elements.input.focus();
  if (!modelReady && !searchOnly) showToast('The model is still loading — one moment.');
});
elements.libraryToggle.addEventListener('change', async () => {
  libraryEnabled = elements.libraryToggle.checked;
  await writeMeta('libraryEnabled', libraryEnabled);
  updateComposer();
  showToast(libraryEnabled ? 'Knowledge library included in answers.' : 'Knowledge library excluded from answers.');
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    resetChat();
    closeDrawer();
    elements.input.focus();
  }
  if ((event.metaKey || event.ctrlKey) && event.key === '/') {
    event.preventDefault();
    elements.input.focus();
  }
  if (event.key === 'Escape') {
    if (!elements.modal.hidden) closeModal();
    else closeDrawer();
  }
});

// Drop files anywhere on the composer area to add them to this chat.
['dragenter', 'dragover'].forEach((type) => {
  elements.form.addEventListener(type, (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    elements.form.classList.add('dragging');
  });
});
['dragleave', 'dragend', 'drop'].forEach((type) => {
  elements.form.addEventListener(type, () => elements.form.classList.remove('dragging'));
});
elements.form.addEventListener('drop', (event) => {
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  event.preventDefault();
  importFiles(files);
});

// Paste a PDF or note straight into the composer.
document.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (files.length) importFiles(files);
});

window.addEventListener('offline', () => showToast('Offline. Mox keeps working from what is already on this device.'));
window.addEventListener('online', () => showToast('Back online.'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveChats();
});

async function loadModelFile(file) {
  try {
    elements.progress.hidden = false;
    elements.modelTitle.textContent = 'Loading your .gguf file';
    elements.progressLabel.textContent = `${file.name} · ${displaySize(file.size)}`;
    elements.progressBar.style.width = '35%';
    elements.progressPercent.textContent = '…';
    engine = await createEngine();
    const threads = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2));
    await engine.loadModel([file], { n_ctx: CONTEXT_SIZE, n_threads: threads, n_batch: 256, jinja: true });
    modelReady = true;
    searchOnly = false;
    loadedModel = { name: file.name, bytes: file.size, parameters: '', quantization: '', license: 'your file' };
    elements.progressBar.style.width = '100%';
    elements.progressPercent.textContent = 'Ready';
    elements.progressLabel.textContent = 'Model loaded on this device';
    elements.modelTitle.textContent = 'Mox is ready';
    elements.modelDescription.textContent = `${file.name} is running in this browser.`;
    elements.modelSize.textContent = displaySize(file.size);
    elements.load.innerHTML = '<span class="button-sparkle">✓</span> Model loaded';
    elements.load.classList.add('loaded');
    elements.load.disabled = true;
    setModelStatus('ready', 'Custom model ready');
    updateComposer();
    showToast(`${file.name} loaded. Ask away.`);
  } catch (error) {
    console.error(error);
    searchOnly = true;
    elements.modelTitle.textContent = 'Could not load that file';
    elements.modelDescription.textContent = 'The file may not be a supported GGUF chat model, or the browser ran out of memory.';
    elements.progressLabel.textContent = (error.message || '').slice(0, 140);
    setModelStatus('error', 'Model unavailable · search only');
    updateComposer();
  }
}

(async function initialize() {
  if (window.location.protocol === 'file:') {
    elements.modelTitle.textContent = 'This page needs to be served';
    elements.modelDescription.textContent = 'Browsers block WebAssembly and module loading from file:// URLs. Open the published Mox page, or run `python3 run.py` in the project folder and use the address it prints.';
    elements.progress.hidden = true;
    elements.load.disabled = true;
    elements.load.innerHTML = '<span class="button-sparkle">⚠</span> Needs a web address';
    setModelStatus('error', 'Open this page over http(s)');
    showToast('Open the published page, or run `python3 run.py` and use the printed address.');
    return;
  }
  try {
    if (!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
    db = await openDatabase();
    userDocuments = await readAllDocuments();
    if ((await readMeta('libraryEnabled')) === false) {
      libraryEnabled = false;
      elements.libraryToggle.checked = false;
    }
    chosenModelId = await readMeta('modelChoice');
    renderSources();
    if (await restoreChats()) {
      renderChatList();
      if (activeChatId) openConversation(activeChatId);
    }
  } catch (error) {
    console.error('Could not open local workspace:', error);
    showToast('Local browser storage is unavailable. Try a recent version of Chrome, Edge, or Firefox.');
  }
  updateComposer();
  setSourceBadge('', '◈ reading model manifest…');
  await readModelManifest();
  const model = activeModel();
  if (model) {
    chosenModelId = chosenModelId && (modelManifest.available || []).some((entry) => entry.id === chosenModelId) ? chosenModelId : model.id;
    elements.modelName.textContent = describeModel();
    elements.modelSize.textContent = displaySize(model.bytes);
    setSourceBadge('local', '◈ model on this site');
  } else {
    setSourceBadge('remote', '◈ no model file');
  }
  // A reload with no connection still works: the service worker keeps a copy of
// the shell. Browsers only allow this on https or localhost.
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !location.search.includes('nosw')) {
  const registerWorker = () => {
    navigator.serviceWorker.register(new URL('sw.js', import.meta.url).href, { scope: './' })
      .catch((error) => console.warn('Offline support unavailable:', error));
  };
  if (document.readyState === 'complete') registerWorker();
  else window.addEventListener('load', registerWorker, { once: true });
}

// The library index and the model download are independent: start both now.
  await Promise.all([loadKnowledgeLibrary(), startModel({ auto: true })]);
  renderChatList();
})();

// Exposed for debugging in the browser console and for automated smoke tests.
window.__mox = {
  retrieve, allKnowledge, renderRich, makeChunks, openModal, resetChat,
  openConversation, deleteChat, openPassage, saveChats, restoreChats, closeDrawer, openDrawer,
  conversations, get activeChatId() { return activeChatId; },
  state: () => ({
    modelReady, searchOnly, libraryEnabled, generating,
    libraryCount: libraryDocuments.length, userCount: userDocuments.length,
    availableModels: (modelManifest?.available || []).map((entry) => entry.id),
    chosenModelId, loadedModel: loadedModel?.id || null,
    chats: conversations.filter((chat) => chat.records.length).length,
    messages: conversations.reduce((sum, chat) => sum + chat.records.length, 0)
  })
};
