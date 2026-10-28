// UFY Dark — a local-first AI workspace.
// The model runtime is served by this site (vendor/), the model weights are
// served by this site too when models/<modelId>/ exists, with a Hugging Face
// fallback. The knowledge library in knowledge/ is indexed in the browser.

const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
const RUNTIME_URL = new URL('vendor/transformers/transformers.min.js', import.meta.url).href;
const ORT_PATH = new URL('vendor/ort/', import.meta.url).href;
const LOCAL_MODEL_PATH = new URL('models/', import.meta.url).href;
const PDFJS_URL = new URL('vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER_URL = new URL('vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const KNOWLEDGE_INDEX = 'knowledge/index.json';

const DB_NAME = 'ufy-private-workspace';
const DB_VERSION = 2;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_EXCERPTS = 5;
const MAX_TOKENS = 340;

const STOP_WORDS = new Set(
  ('a an the and or but if then else when where why how what who whom which this that these those is are was were be been ' +
   'being do does did have has had can could should would will may might must of to in on at by for from with about as ' +
   'into through during before after above below between out off over under again further once it its i me my we our you ' +
   'your he she they them his her their not no nor so than too very please tell explain describe give show define mean ' +
   'meaning some any more most other such only own same s t just difference differences between work works working used ' +
   'use using need needs want wants get gets make makes made thing things example examples question questions answer ' +
   'answers best better good important main kind kinds type types way ways also like many much amount around instead').split(' ')
);

const $ = (selector) => document.querySelector(selector);
const elements = {
  welcome: $('#welcome'), messages: $('#messages'), conversation: $('#conversation'),
  input: $('#messageInput'), form: $('#chatForm'), send: $('#sendButton'),
  load: $('#loadModel'), modelTitle: $('#modelCardTitle'), modelDescription: $('#modelCardDescription'),
  modelSize: $('#modelSize'), progress: $('#downloadProgress'), progressBar: $('#progressBar'),
  progressLabel: $('#progressLabel'), progressPercent: $('#progressPercent'), modelFootnote: $('#modelFootnote'),
  sourceBadge: $('#sourceBadge'), filePicker: $('#filePicker'), folderPicker: $('#folderPicker'),
  sourceList: $('#sourceList'), typing: $('#typingIndicator'), hint: $('#composerHint'),
  modelDot: $('#modelDot'), sidebarStatus: $('#sidebarModelStatus'),
  libraryStatus: $('#libraryStatus'), librarySummary: $('#librarySummary'), libraryChips: $('#libraryChips'),
  libraryToggle: $('#libraryToggle'), modal: $('#modalBackdrop'), modalTitle: $('#modalTitle'),
  modalKicker: $('#modalKicker'), modalCopy: $('#modalCopy'), modalDone: $('#modalDone'), toast: $('#toast')
};

let db;
let userDocuments = [];
let libraryDocuments = [];
let libraryIndex = null;
let libraryEnabled = true;
let textGenerator = null;
let streamerClass = null;
let modelReady = false;
let searchOnly = false;
let generating = false;
let deviceName = 'cpu';
let modelOrigin = 'unknown';
let toastTimer;
let history = [];

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
  const size = 1000, overlap = 140, chunks = [];
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
  return escapeHTML(text).split('\n').map((line) => {
    let value = line
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    if (/^\s*#{1,6}\s+/.test(value)) {
      return `<span class="md-heading">${value.replace(/^\s*#{1,6}\s+/, '')}</span>`;
    }
    if (/^\s*[-*•]\s+/.test(value)) {
      return `<span class="md-bullet">${value.replace(/^\s*[-*•]\s+/, '')}</span>`;
    }
    return value;
  }).join('\n');
}

/* ------------------------------------------------------------------ toasts */

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3600);
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
    elements.librarySummary.textContent = `${documents.length} documents bundled with this site`;

    const cached = await readMeta('libraryCache');
    let texts = null;
    if (cached && cached.generated === libraryIndex.generated) texts = cached.texts;

    if (!texts) {
      texts = {};
      // Small concurrency pool keeps the UI responsive on slow disks.
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
    elements.librarySummary.textContent = 'Add your own files to give UFY context';
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
    elements.sourceList.innerHTML = '<div class="empty-sources"><span class="folder-art">▱</span><span>No files added yet</span><small>Add a folder to give UFY more context</small></div>';
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
  const words = doc.chunks.map((text) => {
    const frequencies = new Map();
    for (const word of tokenize(text)) frequencies.set(word, (frequencies.get(word) || 0) + 1);
    return frequencies;
  });
  const entries = doc.chunks.map((text, index) => ({ text, index, frequencies: words[index], doc }));
  chunkCache.set(doc, entries);
  return entries;
}

function retrieve(query, limit = MAX_EXCERPTS) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const documents = allKnowledge();
  const chunks = documents.flatMap((doc) => chunksFor(doc));
  if (!chunks.length) return [];

  const documentFrequency = new Map();
  for (const term of terms) {
    let count = 0;
    for (const chunk of chunks) if (chunk.frequencies.has(term)) count++;
    documentFrequency.set(term, count);
  }

  const phrase = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const scored = [];
  for (const chunk of chunks) {
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const frequency = chunk.frequencies.get(term) || 0;
      if (!frequency) continue;
      matched++;
      const idf = Math.log(1 + chunks.length / (1 + (documentFrequency.get(term) || 0)));
      score += (1 + Math.log(frequency)) * (0.35 + idf);
    }
    if (!score) continue;
    // Titles and category names are strong signals of what a document covers.
    const title = `${chunk.doc.name} ${chunk.doc.path || ''} ${chunk.doc.categoryLabel || ''}`.toLowerCase();
    let titleMatch = false;
    for (const term of terms) if (title.includes(term)) { score += 1.6; titleMatch = true; }
    const phraseMatch = phrase.length > 4 && chunk.text.toLowerCase().includes(phrase);
    if (phraseMatch) score += 3.5;
    scored.push({ ...chunk, score, matched, titleMatch, phraseMatch });
  }
  scored.sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  // Ignore passages that only matched very common words: a chunk is only kept if
  // it matches a term that is rare enough to be informative, and if it scores a
  // reasonable fraction of the best passage. This keeps unrelated documents out
  // of the prompt when a question happens to share a common word with them.
  const distinctive = terms.filter((term) => (documentFrequency.get(term) || 0) / chunks.length < 0.45);
  const best = scored[0].score;
  const usable = scored.filter((item) => {
    if (item.score < best * 0.3) return false;
    if (distinctive.length && !distinctive.some((term) => item.frequencies.has(term))) return false;
    // A passage that matched several query terms, a document title, or the exact
    // phrase is trustworthy. A passage that matched one generic word has to be
    // nearly as good as the best hit to earn a place in the prompt.
    const strong = item.matched >= 2 || item.titleMatch || item.phraseMatch;
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

async function detectLocalModel() {
  try {
    const response = await fetch(`models/${MODEL_ID}/config.json`, { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

function trackProgress(event, progressState) {
  if (!event) return;
  const file = event.file || event.name || 'model files';
  if (event.status === 'progress' && typeof event.progress === 'number') {
    progressState.files.set(file, Math.max(0, Math.min(100, event.progress)));
    elements.progressLabel.textContent = `Loading ${file.replace(/^.*\//, '')}`;
  } else if (event.status === 'done') {
    progressState.files.set(file, 100);
    elements.progressLabel.textContent = `Ready: ${file.replace(/^.*\//, '')}`;
  } else if (event.status === 'initiate') {
    elements.progressLabel.textContent = `Fetching ${file.replace(/^.*\//, '')}`;
  }
  if (progressState.files.size) {
    let total = 0;
    for (const value of progressState.files.values()) total += value;
    const percent = Math.round(total / progressState.files.size);
    elements.progressBar.style.width = `${percent}%`;
    elements.progressPercent.textContent = `${percent}%`;
  }
}

async function startModel({ auto = false } = {}) {
  if (modelReady || generating || elements.load.disabled) return;
  elements.load.disabled = true;
  elements.load.innerHTML = '<span class="button-sparkle">✳</span> Starting…';
  elements.progress.hidden = false;
  elements.progressBar.style.width = '0%';
  elements.progressPercent.textContent = '0%';
  elements.modelTitle.textContent = 'Starting the engine';
  elements.modelDescription.textContent = 'Loading the model that ships with this site. It is cached by your browser after the first visit.';
  elements.progressLabel.textContent = 'Checking the model files on this site…';
  setModelStatus('loading', 'Starting model…');
  const progressState = { files: new Map() };

  try {
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
    const hasLocalModel = await detectLocalModel();
    const runtime = await import(RUNTIME_URL);
    const { pipeline, env, TextStreamer } = runtime;
    streamerClass = TextStreamer || null;

    // Everything the engine needs is served from this site: no CDN requests for
    // the runtime, the WASM binary, or (when present) the weights.
    env.useBrowserCache = true;
    env.allowLocalModels = true;
    env.allowRemoteModels = !hasLocalModel;
    env.localModelPath = LOCAL_MODEL_PATH;
    env.backends.onnx ??= {};
    env.backends.onnx.wasm ??= {};
    env.backends.onnx.wasm.wasmPaths = ORT_PATH;
    env.backends.onnx.wasm.proxy = false;
    const cores = Math.min(4, navigator.hardwareConcurrency || 1);
    env.backends.onnx.wasm.numThreads = (typeof self !== 'undefined' && self.crossOriginIsolated) ? cores : 1;

    deviceName = navigator.gpu ? 'webgpu' : 'wasm';
    modelOrigin = hasLocalModel ? 'site' : 'remote';
    setSourceBadge(hasLocalModel ? 'local' : 'remote', hasLocalModel ? '◈ model on this site' : '◈ weights via Hugging Face');

    if (!hasLocalModel) {
      elements.progressLabel.textContent = 'Model files are not in ./models — fetching weights from Hugging Face…';
      elements.modelDescription.textContent = 'No local weight files were found, so the model is fetched once from Hugging Face and cached. Run tools/fetch_model.py to serve it from this site instead.';
    }

    const options = {
      dtype: deviceName === 'webgpu' ? 'q4f16' : 'q4',
      device: deviceName,
      progress_callback: (event) => trackProgress(event, progressState)
    };

    try {
      textGenerator = await pipeline('text-generation', MODEL_ID, options);
    } catch (firstError) {
      if (deviceName !== 'webgpu') throw firstError;
      console.warn('WebGPU pipeline failed, falling back to WebAssembly:', firstError);
      deviceName = 'wasm';
      elements.progressLabel.textContent = 'GPU unavailable — using the CPU compatibility mode…';
      textGenerator = await pipeline('text-generation', MODEL_ID, { ...options, device: 'wasm', dtype: 'q4' });
    }

    modelReady = true;
    searchOnly = false;
    elements.progressBar.style.width = '100%';
    elements.progressPercent.textContent = 'Ready';
    elements.progressLabel.textContent = `Model loaded on this device (${deviceName === 'webgpu' ? 'WebGPU' : 'CPU'})`;
    elements.modelTitle.textContent = 'Your AI is ready';
    elements.modelDescription.textContent = 'The model is loaded in this browser. Your questions, files, and the knowledge library are processed on this device.';
    elements.modelSize.textContent = 'Loaded';
    elements.modelFootnote.innerHTML = `<span>◉</span> ${hasLocalModel ? 'Served by this site' : 'Cached from Hugging Face'} · ${deviceName === 'webgpu' ? 'WebGPU' : 'CPU'} · offline after first load`;
    elements.load.innerHTML = '<span class="button-sparkle">✓</span> Model loaded';
    elements.load.classList.add('loaded');
    elements.load.disabled = true;
    setModelStatus('ready', 'AI model ready');
    updateComposer();

    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.usage / estimate.quota > 0.9) {
        showToast('Browser storage is nearly full. The model cache may be cleared by the browser.');
      }
    }
    if (!auto) showToast('Your on-device model is ready. Ask something about the knowledge library.');
  } catch (error) {
    console.error('Model loading failed:', error);
    modelReady = false;
    searchOnly = true;
    elements.modelTitle.textContent = 'Search-only mode';
    elements.modelDescription.textContent = 'The model could not start — probably a blocked download or missing model files. The knowledge library still works: answers will show the matching passages.';
    elements.progressLabel.textContent = (error.message || 'Model failed to load').slice(0, 130);
    elements.modelSize.textContent = 'Search only';
    elements.load.disabled = false;
    elements.load.innerHTML = '<span class="button-sparkle">↻</span> Try starting again <span class="button-arrow">↗</span>';
    setModelStatus('error', 'Model unavailable · search only');
    setSourceBadge('remote', '◈ search only');
    updateComposer();
    showToast('Model unavailable. Library search still works.');
  }
}

async function generateAnswer(question, excerpts, onToken) {
  const messages = buildMessages(question, excerpts);
  let streamed = '';
  const streamer = streamerClass ? new streamerClass(textGenerator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (token) => {
      streamed += token;
      if (onToken) onToken(token);
    }
  }) : undefined;
  const output = await textGenerator(messages, {
    max_new_tokens: MAX_TOKENS,
    do_sample: false,
    repetition_penalty: 1.05,
    streamer
  });

  const generated = output?.[0]?.generated_text ?? output?.generated_text ?? output;
  if (Array.isArray(generated)) {
    const last = [...generated].reverse().find((message) => message.role === 'assistant');
    return String(last?.content || streamed || '').trim();
  }
  return String(generated || streamed || '').trim();
}

function buildMessages(question, excerpts) {
  const excerptText = excerpts.length
    ? excerpts.map((item, index) => `[${index + 1}] ${item.doc.bundled ? `${item.doc.categoryLabel} › ${item.doc.name}` : item.doc.name} (${item.doc.bundled ? item.doc.path : 'your file'})\n${item.text}`).join('\n\n')
    : 'No matching passages were found in the local knowledge library or your own files.';

  const system = [
    'You are UFY, a helpful assistant running privately in the user’s web browser.',
    'You have a built-in knowledge library covering mathematics, reading and writing, technology, science, humanities, and life skills, plus any files the user has added.',
    'Answer using the numbered source excerpts when they are relevant, and name the source file you used.',
    'If the excerpts do not contain the answer, say plainly that you could not find it in the library, then offer general knowledge clearly labelled as general knowledge.',
    'Never invent quotations, statistics, or source names.',
    'Write in short, clear paragraphs. Use "- " for bullets and **bold** sparingly. Keep replies under about 180 words unless the user asks for detail.',
    '',
    'SOURCE EXCERPTS:',
    excerptText
  ].join('\n');

  const messages = [{ role: 'system', content: system }];
  for (const turn of history.slice(-4)) messages.push(turn);
  messages.push({ role: 'user', content: question });
  return messages;
}

/* -------------------------------------------------------------------- chat */

function appendMessage(role, text, excerpts = []) {
  const row = document.createElement('article');
  row.className = `message ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'Y' : '✳';
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = text;
  row.append(avatar, body);

  if (excerpts.length) {
    const seen = new Map();
    for (const item of excerpts) {
      const label = item.doc.bundled ? `${item.doc.categoryLabel} › ${item.doc.name}` : item.doc.name;
      seen.set(item.doc.id, label);
    }
    const citations = document.createElement('div');
    citations.className = 'sources-cited';
    citations.innerHTML = `<span>Sources</span>${[...seen.values()].map((label) => `<span class="source-pill">${escapeHTML(label)}</span>`).join('')}`;
    body.append(citations);
  }

  elements.messages.append(row);
  elements.welcome.hidden = true;
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
  return body;
}

function updateComposer() {
  const usable = modelReady || searchOnly;
  elements.input.disabled = !usable || generating;
  elements.send.disabled = !usable || generating || !elements.input.value.trim();
  const sources = allKnowledge().length;
  if (generating) elements.hint.textContent = 'Generating on this device…';
  else if (modelReady) elements.hint.textContent = `${sources} searchable document${sources === 1 ? '' : 's'} · ${deviceName === 'webgpu' ? 'WebGPU' : 'CPU'}`;
  else if (searchOnly) elements.hint.textContent = 'Search-only mode — answers show matching passages';
  else elements.hint.textContent = 'Starting the local model…';
}

// Passages are cut at character boundaries, so they can begin mid-sentence.
// Start the visible snippet at a sentence break when one appears early on.
function tidySnippet(text, maxLength = 430) {
  let value = text.replace(/\s+/g, ' ').trim();
  const boundary = value.search(/(?<=[.!?])\s/);
  if (boundary > 15 && boundary < 200) value = value.slice(boundary + 1).trim();
  if (value.length > maxLength) value = `${value.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
  return value;
}

function fallbackAnswer(question, excerpts) {
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

async function handleSubmit(event) {
  event.preventDefault();
  const question = elements.input.value.trim();
  if (!question || generating || !(modelReady || searchOnly)) return;

  appendMessage('user', question);
  elements.input.value = '';
  elements.input.style.height = 'auto';
  generating = true;
  updateComposer();
  const excerpts = retrieve(question);

  let body = null;
  if (modelReady) {
    elements.typing.hidden = false;
    body = appendMessage('assistant', '');
    const cursor = document.createElement('span');
    cursor.className = 'cursor-blink';
    body.append(cursor);
    let streamed = '';
    try {
      const answer = await generateAnswer(question, excerpts, (token) => {
        streamed += token;
        cursor.remove();
        body.textContent = streamed;
        body.append(cursor);
        elements.conversation.scrollTop = elements.conversation.scrollHeight;
      });
      cursor.remove();
      const final = (answer || streamed || '').replace(/^\s*(?:assistant|ufy)\s*[:\-]\s*/i, '').trim();
      if (!final) throw new Error('Empty response');
      body.innerHTML = renderRich(final);
      if (excerpts.length) {
        const citations = document.createElement('div');
        citations.className = 'sources-cited';
        const labels = new Map();
        for (const item of excerpts) labels.set(item.doc.id, item.doc.bundled ? `${item.doc.categoryLabel} › ${item.doc.name}` : item.doc.name);
        citations.innerHTML = `<span>Sources</span>${[...labels.values()].map((label) => `<span class="source-pill">${escapeHTML(label)}</span>`).join('')}`;
        body.append(citations);
      }
      history.push({ role: 'user', content: question.slice(0, 900) });
      history.push({ role: 'assistant', content: final.slice(0, 900) });
      history = history.slice(-6);
    } catch (error) {
      console.error('Inference failed:', error);
      cursor.remove();
      body.remove();
      appendMessage('assistant', fallbackAnswer(question, excerpts), excerpts);
      showToast('The model could not answer; showing matching passages instead.');
    } finally {
      elements.typing.hidden = true;
    }
  } else {
    elements.typing.hidden = true;
    appendMessage('assistant', fallbackAnswer(question, excerpts), excerpts);
  }

  generating = false;
  updateComposer();
  elements.input.focus();
}

function resetChat() {
  elements.messages.innerHTML = '';
  elements.welcome.hidden = false;
  elements.input.value = '';
  elements.input.style.height = 'auto';
  history = [];
  updateComposer();
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

/* ------------------------------------------------------------------- modal */

function openModal(kind = 'privacy', category = null) {
  const header = {
    privacy: ['A NOTE ON PRIVACY', 'Everything stays with you.'],
    settings: ['MODEL & DEVICE', 'Your AI, running locally.'],
    library: ['KNOWLEDGE LIBRARY', String(libraryDocuments.length) + ' documents, built in.']
  }[kind] || ['A NOTE ON PRIVACY', 'Everything stays with you.'];

  elements.modalKicker.textContent = header[0];
  elements.modalTitle.textContent = header[1];

  if (kind === 'settings') {
    elements.modalCopy.innerHTML = `
      <p><strong>Model:</strong> Qwen2.5 0.5B Instruct, a compact open-weight language model, running as ONNX in this browser.</p>
      <p><strong>Engine source:</strong> ${modelOrigin === 'site'
        ? 'the weights are served from <code>models/</code> on this site.'
        : modelOrigin === 'remote'
          ? 'the weights are fetched from the Hugging Face CDN and cached in this browser.'
          : 'not loaded yet.'}</p>
      <p><strong>Device:</strong> ${deviceName === 'webgpu' ? 'WebGPU (graphics card)' : 'WebAssembly (CPU)'} · runtime served from <code>vendor/</code>, not a CDN.</p>
      <p><strong>Library:</strong> ${libraryDocuments.length} bundled documents across ${new Set(libraryDocuments.map((doc) => doc.categoryLabel)).size} topics, indexed in your browser.</p>
      <p><strong>Your files:</strong> ${userDocuments.length} imported document${userDocuments.length === 1 ? '' : 's'}, stored in this browser’s IndexedDB.</p>
      <p><strong>To serve the model from this site:</strong> run <code>python3 tools/fetch_model.py</code>, then reload. Weights are ignored by git so the repository stays small.</p>`;
  } else if (kind === 'library') {
    const groups = new Map();
    for (const doc of libraryDocuments) {
      const key = doc.category;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(doc);
    }
    const categoryOrder = (libraryIndex?.categories || []).map((entry) => entry.id);
    const groupEntries = [...groups.entries()].sort((a, b) => {
      const first = categoryOrder.indexOf(a[0]), second = categoryOrder.indexOf(b[0]);
      return (first < 0 ? 99 : first) - (second < 0 ? 99 : second);
    });
    const sections = groupEntries
      .filter(([key]) => !category || key === category)
      .map(([key, docs]) => `
        <div class="library-group">
          <h3>${escapeHTML(categoryName(key))} · ${docs.length}</h3>
          ${docs.map((doc) => `<div class="library-doc">${escapeHTML(doc.name)}<span>${doc.chunks.length} passages</span></div>`).join('')}
        </div>`).join('');
    elements.modalCopy.innerHTML = `${sections || '<p>No documents loaded yet.</p>'}
      <p>Ask a question and UFY retrieves the most relevant passages from these files. To add your own, use <strong>Add a folder</strong> or drop files into <code>knowledge/</code> and run <code>python3 tools/build_knowledge_index.py</code>.</p>`;
  } else {
    elements.modalCopy.innerHTML = `
      <p>The language model runs in this browser using your device’s processor or graphics card. Your questions, your imported files, and the matching passages are never sent to an AI server.</p>
      <p><strong>The knowledge library</strong> is part of this website: ${libraryDocuments.length} documents covering mathematics, reading and writing, technology, science, humanities, and life skills. They are downloaded as text into your browser once, indexed locally, and searched for every question. Nothing in the library changes the model’s weights.</p>
      <p><strong>Downloads:</strong> the runtime (<code>vendor/</code>) and the library are served by this site. The model weights come from <code>models/</code> when present; otherwise they are fetched once from Hugging Face and cached by your browser.</p>
      <p><strong>Storage:</strong> imported files and the library cache live in IndexedDB. Clearing site data removes them.</p>`;
  }
  elements.modal.hidden = false;
}

/* ------------------------------------------------------------------ wiring */

$('#loadModel').addEventListener('click', () => startModel());
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
$('#modalClose').addEventListener('click', () => { elements.modal.hidden = true; });
$('#modalDone').addEventListener('click', () => { elements.modal.hidden = true; });
elements.modal.addEventListener('click', (event) => { if (event.target === elements.modal) elements.modal.hidden = true; });

elements.filePicker.addEventListener('change', (event) => { importFiles(event.target.files); event.target.value = ''; });
elements.folderPicker.addEventListener('change', (event) => { importFiles(event.target.files); event.target.value = ''; });
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
$('#quickAsk').addEventListener('click', () => {
  elements.input.focus();
  if (!modelReady && !searchOnly) showToast('The model is still starting — one moment.');
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
    elements.input.focus();
  }
  if (event.key === 'Escape') elements.modal.hidden = true;
});

// Exposed for debugging in the browser console and for automated smoke tests.
window.__ufy = {
  retrieve, allKnowledge, renderRich, makeChunks, openModal, resetChat,
  state: () => ({ modelReady, searchOnly, deviceName, modelOrigin, libraryEnabled, libraryCount: libraryDocuments.length, userCount: userDocuments.length })
};

(async function initialize() {
  if (window.location.protocol === 'file:') {
    elements.modelTitle.textContent = 'Start the local server first';
    elements.modelDescription.textContent = 'Browsers block WebAssembly and module loading from file:// URLs. Run `python3 run.py` in the project folder, then open the address it prints.';
    elements.progress.hidden = true;
    elements.load.disabled = true;
    elements.load.innerHTML = '<span class="button-sparkle">⚠</span> Needs the local server';
    setModelStatus('error', 'Open this page through run.py');
    showToast('Run `python3 run.py` and open the printed http:// address.');
    return;
  }
  try {
    if (!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
    db = await openDatabase();
    userDocuments = await readAllDocuments();
    const storedToggle = await readMeta('libraryEnabled');
    if (storedToggle === false) {
      libraryEnabled = false;
      elements.libraryToggle.checked = false;
    }
    renderSources();
  } catch (error) {
    console.error('Could not open local workspace:', error);
    showToast('Local browser storage is unavailable. Try a recent version of Chrome, Edge, or Firefox.');
  }
  updateComposer();
  setSourceBadge('', '◈ loading engine…');
  await loadKnowledgeLibrary();
  await startModel({ auto: true });
})();
