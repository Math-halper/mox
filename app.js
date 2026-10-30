// Mox — a local-first AI workspace.
// The model ships with this site (models/*.gguf) and runs in the browser through
// wllama (llama.cpp compiled to WebAssembly). The knowledge library in
// knowledge/ is indexed locally and retrieved for every question.

import { evaluate as evaluateExpression, resolveCalcTags, initCalculator, openCalculator, closeCalculator } from './calculator.js';
import {
  initWorkspace, openWorkspace, closeWorkspace, isWorkspaceOpen, openWorkspaceWithCode,
  extractFileWrites, stripFileWrites, applyFileWrites, workspaceManifest, workspaceContext,
  questionNeedsWorkspace, workspaceApi, WORKSPACE_TOOL_INSTRUCTIONS, autoApplyEnabled
} from './workspace.js';
import {
  listUploadedModels, saveUploadedModel, getUploadedModel, deleteUploadedModel, storageQuota
} from './model-store.js';
import {
  drawingIntent, drawingAnswer, drawSVG, resolveDrawTags, hydrateSVGFigures, svgAPI,
  DRAWABLE, DRAW_EXAMPLES
} from './svg.js';

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
const CONTEXT_SIZE = 8192;   // the bundled model supports 8k; code needs the room
const HISTORY_TURNS = 6;          // how many past messages the model sees
const CHAT_META_KEY = 'conversations';
const CHAT_LIMIT = 30;            // conversations kept in browser storage
const SAVED_TEXT_LIMIT = 6000;    // characters per saved message

// Question words that mean the same thing in the library's vocabulary. A match
// on one of these counts at half weight: it widens recall without letting a
// synonym outrank the word the person actually typed.
const QUERY_ALIASES = {
  website: ['web', 'site', 'html', 'browser'],
  websites: ['web', 'site', 'browser'],
  site: ['website', 'web', 'page'],
  internet: ['network', 'web', 'online', 'http'],
  online: ['internet', 'web'],
  browser: ['web', 'html', 'javascript'],
  webpage: ['html', 'web', 'site'],
  app: ['application', 'software', 'programming'],
  code: ['programming', 'program', 'source'],
  coding: ['programming', 'code'],
  bug: ['debug', 'error', 'testing'],
  api: ['http', 'json', 'request', 'endpoint'],
  database: ['sql', 'table', 'query', 'storage'],
  data: ['statistics', 'dataset', 'chart'],
  chart: ['graph', 'plot', 'visualization', 'data'],
  graph: ['chart', 'plot', 'visualization'],
  drawing: ['svg', 'vector', 'art', 'illustration'],
  draw: ['svg', 'vector', 'illustration'],
  image: ['picture', 'svg', 'graphics', 'photo'],
  logo: ['svg', 'vector', 'design', 'icon'],
  icon: ['svg', 'symbol', 'vector'],
  design: ['layout', 'css', 'typography', 'color'],
  colour: ['color', 'palette', 'contrast'],
  color: ['colour', 'palette', 'contrast'],
  font: ['typography', 'text', 'typeface'],
  responsive: ['layout', 'mobile', 'css', 'media'],
  ai: ['machine learning', 'model', 'neural'],
  llm: ['language model', 'ai', 'transformer'],
  model: ['machine learning', 'neural', 'training'],
  computer: ['hardware', 'cpu', 'memory', 'software'],
  laptop: ['computer', 'hardware', 'battery'],
  phone: ['mobile', 'android', 'ios'],
  security: ['password', 'encryption', 'phishing', 'privacy'],
  privacy: ['security', 'tracking', 'data'],
  password: ['security', 'login', 'authentication'],
  scam: ['phishing', 'fraud', 'security'],
  money: ['finance', 'budget', 'saving', 'interest'],
  finance: ['money', 'budget', 'investing', 'loan'],
  debt: ['loan', 'interest', 'credit'],
  salary: ['income', 'job', 'pay', 'career'],
  job: ['career', 'interview', 'resume', 'work'],
  interview: ['job', 'career', 'hiring'],
  resume: ['job', 'cv', 'career'],
  study: ['learning', 'memory', 'revision', 'exam'],
  learn: ['study', 'learning', 'practice'],
  exam: ['test', 'study', 'revision'],
  memorise: ['memory', 'study', 'recall'],
  write: ['writing', 'essay', 'draft', 'grammar'],
  writing: ['essay', 'grammar', 'style', 'draft'],
  essay: ['writing', 'argument', 'thesis', 'paragraph'],
  grammar: ['punctuation', 'sentence', 'writing'],
  book: ['literature', 'novel', 'reading'],
  poem: ['poetry', 'literature', 'metre', 'rhyme'],
  meaning: ['definition', 'vocabulary', 'word'],
  word: ['vocabulary', 'etymology', 'definition'],
  health: ['nutrition', 'exercise', 'sleep', 'wellbeing'],
  sick: ['illness', 'symptom', 'health', 'fever'],
  food: ['cooking', 'nutrition', 'recipe', 'safety'],
  cook: ['recipe', 'cooking', 'food', 'oven'],
  exercise: ['fitness', 'health', 'training'],
  sleep: ['health', 'rest', 'wellbeing'],
  climate: ['weather', 'atmosphere', 'temperature', 'carbon'],
  weather: ['climate', 'atmosphere', 'storm'],
  energy: ['power', 'electricity', 'physics'],
  electricity: ['circuit', 'voltage', 'current', 'energy'],
  atom: ['chemistry', 'electron', 'molecule'],
  cell: ['biology', 'dna', 'organelle'],
  dna: ['genetics', 'biology', 'gene'],
  space: ['astronomy', 'planet', 'star', 'orbit'],
  planet: ['space', 'astronomy', 'orbit'],
  star: ['astronomy', 'space', 'sun'],
  earth: ['geology', 'planet', 'climate'],
  history: ['historical', 'century', 'war', 'timeline'],
  war: ['history', 'conflict', 'battle'],
  government: ['politics', 'law', 'civics', 'election'],
  law: ['legal', 'rights', 'civics', 'court'],
  geography: ['country', 'map', 'climate', 'region'],
  country: ['nation', 'geography', 'capital'],
  math: ['mathematics', 'arithmetic', 'algebra'],
  maths: ['mathematics', 'arithmetic', 'algebra'],
  percent: ['percentage', 'proportion', 'fraction'],
  percentage: ['percent', 'proportion', 'fraction'],
  average: ['mean', 'median', 'statistics'],
  chance: ['probability', 'odds', 'random'],
  odds: ['probability', 'chance'],
  slope: ['gradient', 'derivative', 'rate'],
  area: ['geometry', 'square', 'region'],
  volume: ['geometry', 'capacity', 'litre'],
  speed: ['velocity', 'rate', 'distance'],
  force: ['newton', 'physics', 'motion'],
  light: ['optics', 'wave', 'photon'],
  sound: ['wave', 'frequency', 'decibel'],
  philosophy: ['ethics', 'argument', 'logic', 'reasoning'],
  ethics: ['morality', 'philosophy', 'right'],
  logic: ['reasoning', 'argument', 'fallacy'],
  bias: ['fallacy', 'thinking', 'reasoning'],
  agent: ['tool', 'model', 'loop', 'automation'],
  agents: ['tool', 'model', 'loop', 'automation'],
  tool: ['tools', 'function', 'agent'],
  tools: ['tool', 'agent', 'function'],
  ollama: ['local model', 'gguf', 'model server'],
  gguf: ['model file', 'quantized', 'llama'],
  llama: ['gguf', 'model server', 'quantized'],
  python: ['script', 'programming', 'code'],
  javascript: ['browser', 'code', 'dom'],
  desktop: ['window', 'shell', 'browser', 'icons'],
  filesystem: ['files', 'paths', 'storage', 'directories'],
  storage: ['files', 'database', 'browser', 'memory'],
  window: ['desktop', 'browser', 'layout'],
  git: ['version control', 'commit', 'branch', 'github'],
  github: ['git', 'repository', 'pull request'],
  repo: ['repository', 'git', 'project'],
  token: ['password', 'security', 'authentication'],
  search: ['index', 'query', 'find'],
  audio: ['sound', 'playback', 'browser'],
  video: ['media', 'playback', 'player']
};

const STOP_WORDS = new Set(
  ('a an the and or but if then else when where why how what who whom which this that these those is are was were be been ' +
   'being do does did have has had can could should would will may might must of to in on at by for from with about as ' +
   'into through during before after above below between out off over under again further once it its i me my we our you ' +
   'your he she they them his her their not no nor so than too very please tell explain describe give show define mean ' +
   'meaning some any more most other such only own same s t just between work works working used use using need needs ' +
   'want wants get gets make makes made thing things example examples question questions answer answers best better ' +
   'good way ways also like many much amount around instead simple words word ' +
   'hi hello hey thanks thank ok okay sure yeah yep nope hmm lol please kindly anyone ' +
   'something anything everything understand understood tell me us there here ' +
   'someone somebody anybody everyone thing things').split(' ')
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
  // Hyphens are separators (so "half-life" matches "half life"), apostrophes are not.
  return (value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) || [])
    .map((word) => word.replace(/['’]s$/, ''))
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
  let fenceLang = '';
  let list = null;             // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (fence === null) {
        closeList();
        fence = [];
        fenceLang = line.replace(/^\s*```\s*/, '').split(/\s+/)[0].toLowerCase();
        continue;
      }
      out.push(`<pre class="md-code"${fenceLang ? ` data-lang="${fenceLang}"` : ''}><code>${fence.join('\n')}</code></pre>`);
      fence = null;
      fenceLang = '';
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
  if (fence) out.push(`<pre class="md-code"${fenceLang ? ` data-lang="${fenceLang}"` : ''}><code>${fence.join('\n')}</code></pre>`);
  closeList();
  return out.join('\n');
}

// Drawing blocks (```svg) become real pictures with download/copy buttons, and
// <draw>…</draw> in a model answer is turned into a drawing of that request.
function renderDrawingFigures(container) {
  if (!container) return 0;
  return hydrateSVGFigures(container, {
    toast: showToast,
    copy: copyText,
    openInWorkspace: (svg) => openWorkspaceWithCode({
      html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mox drawing</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111; padding: 24px; }
    svg { width: min(100%, 640px); height: auto; display: block; }
  </style>
</head>
<body>
${svg}
</body>
</html>`,
      title: 'Mox drawing'
    })
  });
}

// One place for the text → HTML path, so reopened chats and streamed answers
// render exactly the same drawings.
function answerHTML(text) {
  return renderRich(resolveDrawTags(resolveCalcTags(text)));
}

function paintBody(body, text) {
  body.innerHTML = answerHTML(text);
  renderDrawingFigures(body);
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
      .replace(/(ivity|iveness)$/, 'ive')
      .replace(/(ication)$/, 'ify')
      .replace(/(ing|edly|ed|ly)$/, '')
      .replace(/(t|e)$/, '');
  }
  if (value.length < 3) value = word;
  stemCache.set(word, value);
  return value;
}

// Related words the library is likely to use for this question: one level of
// synonyms from QUERY_ALIASES, e.g. "website" also searches "web", "site", "html".
// They add recall only — the words the person typed still carry full weight.
function expandTerms(terms) {
  const related = new Map();
  for (const term of terms) {
    const entries = QUERY_ALIASES[term] || QUERY_ALIASES[stem(term)] || [];
    for (const entry of entries) {
      for (const word of tokenize(entry)) {
        if (terms.includes(word) || related.has(word)) continue;
        related.set(word, 0.5);
      }
    }
  }
  return related;
}

function retrieve(query, limit = MAX_EXCERPTS) {
  const words = tokenize(query);
  const terms = [...new Set(words)];
  if (!terms.length) return [];
  // Consecutive content words, e.g. "unit test" or "rain shadow", are worth
  // more than their parts appearing separately.
  const bigrams = [];
  for (let index = 0; index < words.length - 1; index++) {
    if (words[index] !== words[index + 1]) bigrams.push(`${words[index]} ${words[index + 1]}`);
  }
  const chunks = allKnowledge().flatMap((doc) => chunksFor(doc));
  if (!chunks.length) return [];

  const documentFrequency = new Map();
  const informativeness = new Map();   // idf per term: how much a match is worth
  for (const term of terms) {
    const key = stem(term);
    let count = 0;
    for (const chunk of chunks) if (chunk.frequencies.has(term) || chunk.stems.has(key)) count++;
    documentFrequency.set(term, count);
    informativeness.set(term, Math.log(1 + chunks.length / (1 + count)));
  }

  // How often each term appears across a whole document: a tie in one passage is
  // broken by whichever document is actually about the topic.
  const docTotals = new Map();
  for (const chunk of chunks) {
    const key = chunk.doc.id;
    if (!docTotals.has(key)) docTotals.set(key, 0);
    let count = docTotals.get(key);
    for (const term of terms) count += chunk.frequencies.get(term) || chunk.stems.get(stem(term)) || 0;
    docTotals.set(key, count);
  }

  // Synonym terms score at half weight (see expandTerms), so they need an idf
  // of their own rather than being skipped in the loop below.
  const relatedTerms = expandTerms(terms);
  for (const [term] of relatedTerms) {
    if (informativeness.has(term)) continue;
    let count = 0;
    const key = stem(term);
    for (const chunk of chunks) if (chunk.frequencies.has(term) || chunk.stems.has(key)) count++;
    informativeness.set(term, Math.log(1 + chunks.length / (1 + count)));
  }

  const total = terms.reduce((sum, term) => sum + informativeness.get(term), 0) || 1;
  const scored = [];
  for (const chunk of chunks) {
    let score = 0;
    let matched = 0;
    let coverage = 0;                  // idf of the terms this chunk covers
    for (const term of terms) {
      const frequency = Math.max(
        chunk.frequencies.get(term) || 0,
        chunk.stems.get(stem(term)) || 0
      );
      if (!frequency) continue;
      matched++;
      const idf = informativeness.get(term);
      coverage += idf;
      score += (1 + Math.log(frequency)) * (0.35 + idf);
    }
    if (!score) continue;
    // Reward covering the informative parts of the question, not just one word.
    score += 0.7 * coverage;
    // Related words help only when the passage already matched something real.
    if (relatedTerms.size) {
      let related = 0;
      for (const [term, weight] of relatedTerms) {
        const frequency = Math.max(
          chunk.frequencies.get(term) || 0,
          chunk.stems.get(stem(term)) || 0
        );
        if (!frequency) continue;
        related += (1 + Math.log(frequency)) * (0.35 + (informativeness.get(term) || 0)) * weight;
      }
      if (related) score += Math.min(related, score * 0.6);
    }
    const title = `${chunk.doc.name} ${chunk.doc.path || ''} ${chunk.doc.categoryLabel || ''}`.toLowerCase();
    let titleMatch = false;
    for (const term of terms) {
      // A term that shows up in half the library says nothing about this chunk.
      const distinctive = (documentFrequency.get(term) || 0) / chunks.length < 0.3;
      if (!distinctive) continue;
      if (title.includes(term) || title.includes(stem(term))) { score += 1.6; titleMatch = true; }
    }
    // Only multi-word phrases get the phrase bonus: for a single word it would
    // just double-count the term and make "fraction"/"fractions" rank differently.
    // Match on stemmed words too, so "water cycle" finds "water cycles".
    const lower = chunk.text.toLowerCase();
    const stemmedWords = tokenize(chunk.text).map((word) => stem(word));
    let phraseMatch = false;
    for (const bigram of bigrams) {
      const [first, second] = bigram.split(' ');
      let hit = lower.includes(bigram);
      if (!hit) {
        for (let i = 0; i < stemmedWords.length - 1; i++) {
          if (stemmedWords[i] === first && stemmedWords[i + 1] === second) { hit = true; break; }
        }
      }
      if (hit) { score += 2.5; phraseMatch = true; }
    }
    scored.push({ ...chunk, score, matched, coverage: coverage / total, titleMatch, phraseMatch,
      docTotal: docTotals.get(chunk.doc.id) || 0 });
  }
  scored.sort((a, b) => b.score - a.score || b.docTotal - a.docTotal || a.index - b.index);
  if (!scored.length) return [];

  // A weak match is worse than no match: it makes the model cite an irrelevant
  // passage. Require real evidence before anything is offered as a source.
  const needed = Math.min(2, terms.length);
  const evidence = (item) => item.phraseMatch
    || item.titleMatch
    || item.matched >= needed
    || item.coverage >= 0.34;
  // One common word ("name", "there") matches something in any 18,000-word
  // library. A single-word question only counts if that word is distinctive.
  if (terms.length === 1 && (documentFrequency.get(terms[0]) || 0) / chunks.length >= 0.22) return [];

  // The rarest word in a question is usually its subject ("nutrition" in "how do
  // I read a nutrition label"). A passage that misses it is answering something
  // else, even if it collects more common words.
  const maxIdf = Math.max(...terms.map((term) => informativeness.get(term) || 0));
  const subjects = terms.filter((term) => (informativeness.get(term) || 0) >= maxIdf * 0.8);
  const onSubject = scored.filter((item) => subjects.some((term) =>
    item.frequencies.has(term) || item.stems.has(stem(term))));
  // The rarest words are usually the subject ("nutrition" in "how do I read a
  // nutrition label"). Passages covering them rank first, but an absent subject
  // word alone must not kill every match — the evidence floor above already
  // keeps weak guesses from surfacing as sources.
  if (onSubject.length) scored.splice(0, scored.length, ...onSubject);

  const best = scored[0];
  if (!evidence(best)) return [];
  const floor = Math.max(2.4, best.score * 0.34);
  scored.forEach((item) => { item.strong = evidence(item); });

  const distinctive = terms.filter((term) => (documentFrequency.get(term) || 0) / chunks.length < 0.45);
  const bestScore = scored[0].score;
  const usable = scored.filter((item) => {
    if (item.score < floor) return false;
    const hasDistinctive = distinctive.length === 0
      || distinctive.some((term) => item.frequencies.has(term) || item.stems.has(stem(term)));
    const coversEnough = item.matched >= Math.min(2, terms.length) && item.score >= bestScore * 0.62;
    return hasDistinctive || coversEnough;
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
  return selected.length ? selected : (best.strong ? [best] : []);
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
  let base = { version: 1, default: null, models: [] };
  try {
    const response = await fetch(MODEL_MANIFEST, { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    base = await response.json();
  } catch (error) {
    console.warn('Model manifest unavailable:', error);
  }

  // Bundled/served models are listed only if the file is actually reachable.
  const available = [];
  for (const entry of base.models || []) {
    try {
      const head = await fetch(`models/${entry.file}`, { method: 'HEAD', cache: 'no-store' });
      if (head.ok) available.push(entry);
    } catch { /* ignore missing files */ }
  }

  // Models the user uploaded earlier live in IndexedDB and are always offered.
  const uploads = await listUploadedModels();

  modelManifest = {
    ...base,
    models: [...(base.models || []), ...uploads],
    available: [...available, ...uploads]
  };
  updateUploadBadge(uploads.length);
  return modelManifest.available;
}

function updateUploadBadge(count) {
  const label = document.getElementById('uploadCount');
  if (!label) return;
  label.textContent = count ? `${count} uploaded` : 'none uploaded';
}

function activeModel() {
  const available = typeof visibleModels === 'function' ? visibleModels() : (modelManifest?.available || []);
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
    if (model.bytes > 1.5e9) {
      showToast(`${model.name} is ${displaySize(model.bytes)} — large for a browser tab. If it fails to load, try Qwen2.5-Coder 1.5B.`);
    }

    // 1. Get the weights: from this site, or from the model you uploaded.
    let blob;
    if (model.uploaded) {
      elements.progressLabel.textContent = `Reading ${model.name} from this browser`;
      const record = await getUploadedModel(model.id);
      if (!record?.blob) throw new Error(`${model.name} is no longer in this browser. Upload it again.`);
      blob = record.blob;
      elements.progressBar.style.width = '60%';
      elements.progressPercent.textContent = '…';
      setSourceBadge('local', '◈ your model');
    } else {
      elements.progressLabel.textContent = `Fetching ${model.file} from this site`;
      const response = await fetch(`models/${model.file}`);
      if (!response.ok) throw new Error(`models/${model.file} → HTTP ${response.status}`);
      const total = Number(response.headers.get('Content-Length')) || model.bytes;
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
    updateModelMenu();
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
  const grounded = excerpts.length > 0;
  const sources = grounded
    ? excerpts.map((item, index) =>
        `[${index + 1}] ${item.doc.bundled ? `${item.doc.categoryLabel} › ${item.doc.name}` : item.doc.name}\n${item.text.slice(0, EXCERPT_CHARS).trim()}`
      ).join('\n\n')
    : '(no library passage matched this question)';

  // The workspace is the user's live code. Only attach the file bodies when the
  // question looks like it is about that code, so ordinary questions stay small.
  const manifest = workspaceManifest();
  const usesWorkspace = questionNeedsWorkspace(question);
  const workspaceBlock = [
    '',
    'WORKSPACE FILES (the user\'s live code in the Workspace panel):',
    manifest,
    ...(usesWorkspace ? ['', WORKSPACE_TOOL_INSTRUCTIONS, '', 'FILE CONTENTS:', workspaceContext(5000)] : [])
  ].join('\n');

  // Tone is shared by both branches: warm and human in manner, honest in fact.
  const voice = [
    'Sound like a thoughtful friend who happens to know a lot, not a manual: warm, plain, first person, no corporate throat-clearing.',
    'If someone sounds worried, tired, upset or stuck, name it in one short sentence before you help, then actually help. Never lecture them about their feelings.',
    'Match their energy: one line in return for a one-line message, more depth only when the problem is hard. Ask a question only when the answer really changes your advice.',
    'Be encouraging without flattery, and never make someone feel slow for asking.',
    'Do not keep announcing that you are software, but never claim to be a human being: no body, no childhood, no invented memories, no feelings stated as facts. If asked directly, say what you are in one plain sentence and carry on helping.'
  ];

  const common = [
    ...voice,
    'For any arithmetic, write <calc>expression</calc> and the app will compute it exactly — never guess a number.',
    'Code is welcome when it helps: a fenced block with the language name works, and the app can preview it.',
    'To draw something, write <draw>a short description</draw> on its own line; the app turns it into real SVG. Never hand-write SVG markup yourself.'
  ];

  const rules = grounded
    ? [
        'You are Mox, a careful assistant running privately in the user\'s browser.',
        'Never claim to be another assistant, model, or company, and do not roleplay as the user.',
        'The numbered passages after SOURCES are reference material, not the whole world.',
        'If they answer the question, ground your reply in them and cite like [1].',
        'If they only partly help, use them, then add what you know — do not refuse.',
        'Never say you have "no sources" when passages are listed below.',
        'Be direct and specific: no preamble, no restating the question, no filler.',
        ...common,
        'Plain text, at most 120 words. Use a short list only for steps or options.'
      ]
    : [
        'You are Mox, a helpful assistant running privately in the user\'s browser.',
        'Never claim to be another assistant, model, or company, and do not roleplay as the user.',
        'No library passage matched this question, so answer from your own general knowledge.',
        'Answer the question directly and briefly; do not mention sources, passages or a library.',
        'If you genuinely do not know, say so in one short sentence.',
        'Be direct and specific: no preamble, no restating the question, no filler.',
        ...common,
        'Plain text, at most 120 words. Use a short list only for steps or options.'
      ];

  const system = [...rules, '', 'SOURCES:', sources, workspaceBlock].join('\n');

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

async function streamChatML(messages, onToken, abortSignal, maxTokens = MAX_NEW_TOKENS, temperature = 0.3) {
  let streamed = '';
  await engine.createCompletion({
    prompt: chatMLPrompt(messages),
    stream: true,
    abortSignal,
    max_tokens: maxTokens,
    temp: temperature,
    top_k: 40,
    top_p: 0.92,
    // Small models loop on short outputs: a stronger, wider repetition penalty
    // keeps the model from hammering the same phrase over and over.
    penalty_repeat: 1.25,
    penalty_last_n: 256,
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

// Raw model call with options — used by the workspace AI panel, which must not
// have its code truncated by the chat answer cleaner.
function stripChatTokens(text) {
  return String(text || '')
    .replace(/<\|im_end\|>[\s\S]*$/g, '')
    .replace(/<\|.*?\|>/g, '')
    .trim();
}

async function modelComplete(messages, { maxTokens = MAX_NEW_TOKENS, temperature = 0.3, onToken, signal } = {}) {
  if (!engine) throw new Error('The model is not loaded yet');
  let streamed = '';
  const onData = (chunk) => {
    const piece = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.text;
    if (!piece) return;
    streamed += piece;
    if (onToken) onToken(piece);
  };
  try {
    const result = await engine.createChatCompletion({
      messages, stream: true, abortSignal: signal,
      max_tokens: maxTokens, temp: temperature, top_k: 40, top_p: 0.92,
      penalty_repeat: 1.25, penalty_last_n: 256, onData
    });
    return stripChatTokens(result?.choices?.[0]?.message?.content || streamed);
  } catch (error) {
    if (wasAborted(error)) throw error;
    console.warn('Chat template failed, using ChatML instead:', error);
    return stripChatTokens(await streamChatML(messages, onToken, signal, maxTokens, temperature));
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
    penalty_repeat: 1.25,
    penalty_last_n: 256,
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
  // Code fences and drawings are kept byte-for-byte: the prose tidy-up below
  // re-flows sentences and would otherwise break SVG or code.
  const fences = [];
  const guarded = String(text || '').replace(/```[\s\S]*?```/g, (block) => {
    fences.push(block);
    return `\u0000fence${fences.length - 1}\u0000`;
  });
  let value = guarded
    .replace(/<\|im_end\|>[\s\S]*$/g, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/^\s*(?:assistant|mox|user)\s*[:\-]\s*/i, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // If the model hallucinated a fresh turn (user/assistant/mox/system),
  // cut everything from there so it can't argue with itself or drift identity.
  const lines = value.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (/^(?:user|assistant|mox|system)\b[:\s\-]*$/i.test(lines[index].trim())) {
      value = lines.slice(0, index).join('\n').trim();
      break;
    }
  }
  // Collapse immediate sentence-level echoes ("Yes. Yes. Yes.").
  const sentences = value.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const deduped = [];
  for (const sentence of sentences) {
    const last = deduped[deduped.length - 1];
    if (last && sentence.toLowerCase() === last.toLowerCase()) continue;
    deduped.push(sentence);
  }
  value = deduped.join(' ');

  // Small models loop: drop a repeated trailing block.
  const keptLines = value.split('\n');
  const tail = keptLines.slice(-3).join('\n');
  if (tail.length > 40) {
    const earlier = value.slice(0, value.length - tail.length);
    if (earlier.includes(tail.trim())) value = earlier.trim();
  }
  // Stop mid-sentence tails from looking like broken output. Code and drawings
  // held aside above must survive the cut — an answer that ends in a code block
  // would otherwise lose it to a trailing-comma trim.
  if (value.length > 80 && !/[.!?…"')\]]$/.test(value)) {
    const lastStop = Math.max(value.lastIndexOf('. '), value.lastIndexOf('? '), value.lastIndexOf('! '));
    if (lastStop > value.length * 0.6) {
      const kept = value.slice(0, lastStop + 1);
      const dropped = [...value.slice(lastStop + 1).matchAll(/\u0000fence\d+\u0000/g)].map((match) => match[0]);
      value = dropped.length ? `${kept}\n\n${dropped.join('\n\n')}` : kept;
    }
  }
  return value.replace(/\u0000fence(\d+)\u0000/g, (match, index) => fences[Number(index)] ?? '');
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

// When nothing in the library matched, say so once under the answer instead of
// letting the model apologise for "missing sources".
function noSourcesNote() {
  const note = document.createElement('div');
  note.className = 'sources-cited no-match';
  note.textContent = 'Answered from the model — no library passage matched this question.';
  return note;
}

// Pull HTML/CSS/JS out of a chat answer so it can be previewed and edited.
function codeBundleFromText(text) {
  const blocks = [...String(text || '').matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)]
    .map((match) => ({ info: match[1].trim().toLowerCase().split(/\s+/)[0], body: match[2] }));
  if (!blocks.length) return null;
  const pick = (names) => blocks.filter((block) => names.includes(block.info)).map((block) => block.body).join('\n');
  const html = pick(['html', 'htm']);
  const css = pick(['css']);
  const js = pick(['js', 'javascript', 'mjs']);
  if (!html && !css && !js) return null;
  return { html, css, js, title: 'code from Mox' };
}

/**
 * Turn raw model output into what the chat shows:
 *  • mox:write blocks are applied to the workspace (when the toggle allows it)
 *  • <calc>…</calc> tags become exact results
 * Returns the display text and the files that changed.
 */
function finalizeAnswer(text, { apply = true } = {}) {
  let value = String(text || '');
  const writes = extractFileWrites(value).filter((write) => write.content.trim().length > 1);
  let applied = false;
  let paths = [];

  if (writes.length) {
    value = stripFileWrites(value);
    if (apply && autoApplyEnabled()) {
      const result = applyFileWrites(writes, { source: 'Mox' });
      applied = result.applied > 0;
      paths = result.paths;
      value = [value, applied
        ? `**Workspace updated:** ${result.paths.join(', ')}. Open the workspace to see the preview.`
        : '**Workspace checked:** the files already match this answer.'
      ].filter(Boolean).join('\n\n');
    } else {
      value = [value, `**Workspace changes ready:** ${writes.map((write) => write.path).join(', ')}. File editing is off, so nothing was written.`].filter(Boolean).join('\n\n');
    }
  }

  return { text: resolveCalcTags(value).trim(), writes, applied, paths };
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

    // Code in an answer can be visualised in the workspace preview.
    const bundle = codeBundleFromText(record.text);
    if (bundle) {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'msg-action';
      preview.textContent = 'Preview code';
      preview.title = 'Open this code in the workspace with a live preview';
      preview.addEventListener('click', () => openWorkspaceWithCode(bundle));
      row.append(preview);
    }
    if (record.files?.length || bundle) {
      const workspace = document.createElement('button');
      workspace.type = 'button';
      workspace.className = 'msg-action';
      workspace.textContent = 'Workspace';
      workspace.title = 'Open the code workspace';
      workspace.addEventListener('click', () => openWorkspace());
      row.append(workspace);
    }
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
  if (role === 'assistant' && text) paintBody(body, text);
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
          files: record.files || [],
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
          files: record.files || [],
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

// A question that is really a calculation should not depend on the model
// guessing. "what is 1234 * 5678?" is answered by the calculator, exactly.
function pureCalculation(question) {
  let expression = String(question || '').trim()
    .replace(/^(?:what(?:'s| is)|whats|calculate|compute|evaluate|solve|convert|how much is|how many)\s+/i, '')
    .replace(/[?=\s]+$/g, '')
    .trim();
  if (!expression || expression.length > 140) return null;
  if (!/[0-9]/.test(expression)) return null;
  if (/[\u0000-\u001f]/.test(expression)) return null;
  if (!/^[\s0-9A-Za-zπφ°µ²³.,+\-*/^%!()]+$/.test(expression)) return null;
  // Require an actual operation or function call, not just a number.
  if (!/[+\-*/^%!(]|\b(?:to|in|of|sqrt|sin|cos|tan|log|ln|round|mean|median|convert|abs)\b/i.test(expression)) return null;
  const result = evaluateExpression(expression);
  if (!result.ok) return null;
  return { ...result, expression };
}

/**
 * Answer a drawing request locally. `ask` adds the user's message first; the
 * composer path has already done that, the example chips have not.
 */
function askDrawing(prompt, { ask = true } = {}) {
  const question = String(prompt || '').trim();
  if (!question) return null;
  if (ask && !generating) {
    elements.input.value = '';
    elements.input.style.height = 'auto';
    addRecord('user', question);
  }
  const result = drawingAnswer(question);
  if (!result.svg) {
    const record = addRecord('assistant', `${result.text}`);
    record.drawing = 'menu';
    showToast('Mox draws shapes, charts and simple scenes — the list above is what works.');
    announce('Answer ready.');
    elements.input.focus();
    return record;
  }
  const record = addRecord('assistant', result.text);
  record.drawing = result.kind;
  showToast('Drawing ready — save the SVG, copy the code, or open it in the workspace.');
  announce('Drawing ready.');
  elements.input.focus();
  return record;
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

  const calculation = pureCalculation(question);
  if (calculation) {
    const body = [
      `\`${calculation.expression}\` = **${calculation.text}**`,
      calculation.conversion && calculation.conversion !== `${calculation.text}` ? calculation.conversion : '',
      '',
      '_Computed by the calculator in this browser — no model guesswork._'
    ].filter(Boolean).join('\n');
    const record = addRecord('assistant', body);
    record.calculated = calculation.expression;
    const calcBody = elements.messages.lastElementChild.querySelector('.message-body');
    attachActions(calcBody, record);
    announce('Answer ready.');
    updateComposer();
    elements.input.focus();
    return;
  }

  // A request to draw is answered by the drawing engine, not the model: a
  // 135M model cannot produce trustworthy SVG, but svg.js can produce exact
  // shapes, charts and scenes. This also works in search-only mode.
  if (drawingIntent(question)) {
    askDrawing(question, { ask: false });
    return;
  }

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
        paintAnswer(answer, body, `${partial} …`, excerpts, started, { apply: false });
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

function paintAnswer(record, body, text, excerpts, started, { apply = true } = {}) {
  const seconds = Math.max(0.1, (performance.now() - started) / 1000);
  const prepared = finalizeAnswer(text, { apply });
  // Rough token estimate for a progress hint; exact counts are not exposed.
  const tokens = Math.max(1, Math.round(text.length / 4));
  record.text = prepared.text;
  record.excerpts = excerpts;
  record.files = [...new Set([...(record.files || []), ...prepared.paths])];
  record.stats = `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s · ${Math.round(tokens / seconds)} tok/s`;
  paintBody(body, prepared.text);
  if (excerpts?.length) body.append(citationPills(excerpts, record));
  else body.append(noSourcesNote());
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

// Models removed from the picker. Uploads are deleted outright; models served
// from models/ can only be hidden, because the file belongs to the site.
let hiddenModels = [];

function visibleModels() {
  return (modelManifest?.available || []).filter((entry) => !hiddenModels.includes(entry.id));
}

async function hideModel(id) {
  if (!hiddenModels.includes(id)) hiddenModels.push(id);
  await writeMeta('hiddenModels', hiddenModels);
  if (chosenModelId === id) {
    chosenModelId = null;
    await writeMeta('modelChoice', null);
  }
  await readModelManifest();
}

async function unhideModels() {
  hiddenModels = [];
  await writeMeta('hiddenModels', hiddenModels);
  await readModelManifest();
}

function updateModelMenu() {
  const nameEl = document.querySelector('.model-menu-name');
  const subEl = document.querySelector('.model-menu-sub');
  const model = loadedModel || activeModel();
  if (!nameEl) return;
  if (!model) { nameEl.textContent = 'Mox'; if (subEl) subEl.textContent = ''; return; }
  const short = model.name.split(/\s+/)[0];
  nameEl.textContent = short || model.name;
  if (subEl) subEl.textContent = model.parameters || (model.quantization || '');
}

// Drop the loaded weights so the app falls back to search-only until another
// model is picked. Used when the selected model is deleted or hidden.
function unloadEngine(reason = '') {
  if (generating) stopGeneration();
  try { engine?.exit?.(); } catch (error) { console.warn('Could not unload the model:', error); }
  engine = null;
  llm = null;
  loadedModel = null;
  modelReady = false;
  searchOnly = true;
  elements.progress.hidden = true;
  elements.load.disabled = false;
  elements.load.classList.remove('loaded');
  elements.load.innerHTML = '<span class="button-sparkle">✳</span> Start a model';
  elements.modelTitle.textContent = 'Search-only mode';
  elements.modelDescription.textContent = 'No model is loaded. Pick one in Model & settings, or upload a .gguf.';
  elements.modelSize.textContent = 'Search only';
  setModelStatus('idle', 'No model loaded');
  setSourceBadge('remote', '◈ search only');
  updateComposer();
  updateModelMenu();
  if (reason) showToast(reason);
}

// Switch models without reloading the page: unload the current weights, then
// load the chosen ones through the same progress path as the start card.
async function switchModel(id) {
  const entry = visibleModels().find((model) => model.id === id);
  if (!entry) return false;
  if (generating) stopGeneration();

  chosenModelId = id;
  await writeMeta('modelChoice', id);

  modelReady = false;
  searchOnly = false;
  loadedModel = null;
  llm = null;
  if (engine) {
    try { await engine.exit?.(); } catch (error) { console.warn('Could not unload the previous model:', error); }
    engine = null;
  }

  // startModel refuses to run when the button is disabled or marked loaded.
  elements.load.disabled = false;
  elements.load.classList.remove('loaded');
  elements.load.innerHTML = '<span class="button-sparkle">✳</span> Start the model';
  elements.progress.hidden = false;
  elements.progressBar.style.width = '0%';
  elements.progressPercent.textContent = '0%';
  elements.modelSize.textContent = displaySize(entry.bytes);
  updateComposer();
  updateModelMenu();

  await startModel({ auto: true });
  if (!modelReady) {
    showToast(`${entry.name} could not start in this tab. Reload the page to try again.`);
    return false;
  }
  updateModelMenu();
  showToast(`${entry.name} is ready.`);
  return true;
}

function modelListMarkup({ manage = false } = {}) {
  const available = visibleModels();
  if (!available.length) {
    return `<p>No models are available. Upload a <code>.gguf</code> below${hiddenModels.length ? ', or restore the hidden ones' : ', or run <code>python3 tools/fetch_model.py</code>'}.</p>`;
  }
  return `<div class="model-choices">${available.map((entry) => {
    const inUse = entry.id === chosenModelId;
    return `
    <div class="model-choice${inUse ? ' active' : ''}">
      <div class="model-choice-head">
        <span class="model-choice-name">${escapeHTML(entry.name)}${entry.bundled ? ' <em>bundled</em>' : ''}${entry.uploaded ? ' <em>your upload</em>' : ''}</span>
        ${inUse ? `<span class="model-choice-badge">${modelReady ? 'In use' : 'Selected'}</span>` : ''}
      </div>
      <span class="model-choice-meta">${escapeHTML([entry.parameters, entry.quantization, displaySize(entry.bytes), entry.license].filter(Boolean).join(' · '))}${entry.bytes > 1.5e9 ? ' · heavy for a tab' : ''}</span>
      ${entry.note ? `<span class="model-choice-note">${escapeHTML(entry.note)}</span>` : ''}
      ${manage ? `<div class="model-choice-actions">
        <button type="button" class="model-use${inUse ? ' current' : ''}" data-use-model="${escapeHTML(entry.id)}"${inUse ? ' disabled' : ''}>${inUse ? (modelReady ? 'In use' : 'Selected') : 'Use this model'}</button>
        <button type="button" class="model-delete" data-remove-model="${escapeHTML(entry.id)}" title="${entry.uploaded ? `Delete ${escapeHTML(entry.name)} from this browser` : `Remove ${escapeHTML(entry.name)} from this list`}">${entry.uploaded ? 'Delete' : 'Remove from list'}</button>
      </div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// Models this site knows about but that are not on disk yet. Downloading is a
// plain link the visitor clicks; the page itself never fetches model weights
// from anywhere but this site.
function catalogMarkup() {
  const available = new Set((modelManifest?.available || []).map((entry) => entry.file));
  const hidden = new Set(hiddenModels);
  const entries = (modelManifest?.catalog || []).filter((entry) => !available.has(entry.file) && !hidden.has(entry.id));
  if (!entries.length) return '';
  return `
    <div class="model-catalog">
      <div class="model-catalog-head"><span>Get a better model</span><span>download, then upload here</span></div>
      ${entries.map((entry) => `
        <div class="model-catalog-row">
          <div class="model-catalog-text">
            <strong>${escapeHTML(entry.name)}</strong>
            <span>${escapeHTML([entry.parameters, entry.quantization, displaySize(entry.bytes), entry.license].filter(Boolean).join(' · '))}</span>
            ${entry.note ? `<em>${escapeHTML(entry.note)}</em>` : ''}
            ${entry.sha256 ? `<em class="model-catalog-sha" title="SHA-256 of the file">sha256 ${escapeHTML(entry.sha256.slice(0, 16))}…</em>` : ''}
          </div>
          <div class="model-catalog-actions">
            ${entry.download ? `<a class="model-catalog-link" href="${escapeHTML(entry.download)}" target="_blank" rel="noopener noreferrer">Download .gguf ↗</a>` : ''}
            ${entry.page ? `<a class="model-catalog-secondary" href="${escapeHTML(entry.page)}" target="_blank" rel="noopener noreferrer">File page ↗</a>` : ''}
            ${entry.mirror ? `<a class="model-catalog-secondary" href="${escapeHTML(entry.mirror)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(entry.mirrorName || 'Mirror download')}">Mirror ↗</a>` : ''}
            ${entry.download ? `<button type="button" class="model-catalog-secondary" data-copy-link="${escapeHTML(entry.download)}" title="Copy the download link">Copy link</button>` : ''}
          </div>
        </div>`).join('')}
      <p class="model-catalog-foot">If a download fails, the network is usually blocking <code>huggingface.co</code> or its CDN. Try the mirror, the file page, or <code>HF_ENDPOINT=https://hf-mirror.com python3 tools/fetch_model.py --preset qwen-coder-1.5b</code>.</p>
    </div>`;
}

function modelScreenMarkup() {
  return `
    <p><strong>Running now:</strong> ${escapeHTML(modelReady ? describeModel() : 'no model loaded')} — llama.cpp compiled to WebAssembly, executing on this device.</p>
    <p><strong>Choose a model.</strong> Pick one and it loads in place; the page does not reload. Anything you upload is stored in this browser, listed here, and offered on the start screen from then on.</p>
    ${modelListMarkup({ manage: true })}
    <p class="model-switch-status" id="modelSwitchStatus" role="status" aria-live="polite"></p>
    <div class="source-actions">
      <button class="modal-secondary" id="modelUpload">Upload a .gguf</button>
      <button class="modal-secondary" id="modelRefresh">Rescan</button>
      ${hiddenModels.length ? `<button class="modal-secondary" id="modelRestore">Restore ${hiddenModels.length} hidden model${hiddenModels.length === 1 ? '' : 's'}</button>` : ''}
    </div>
    <p class="model-storage-line" id="modelStorage">Models are stored on this device only.</p>
    <p class="model-tip"><strong>Building websites?</strong> Start with <code>Qwen2.5-Coder 1.5B</code> (about 1.1 GB): download it below, then upload it here. <code>Qwen3 4B Instruct</code> writes better code but needs about 2.5 GB of browser memory.</p>
    ${catalogMarkup()}
    <p><strong>Deleting:</strong> an uploaded model is deleted from this browser (its storage is freed). A model served from <code>models/</code> can only be hidden from this list, because the file belongs to the site; <strong>Rescan</strong> and <strong>Restore</strong> bring hidden ones back.</p>
    <p><strong>Knowledge library:</strong> ${libraryDocuments.length} documents across ${new Set(libraryDocuments.map((doc) => doc.categoryLabel)).size} topics, indexed in your browser.<br>
    <strong>Your files:</strong> ${userDocuments.length} imported document${userDocuments.length === 1 ? '' : 's'} in IndexedDB.<br>
    <strong>Chats:</strong> ${conversations.filter((chat) => chat.records.length).length} saved in this browser.</p>
    <div class="source-actions">
      <button class="modal-secondary" id="exportChat">Export this chat</button>
      <button class="modal-secondary" id="clearChats">Delete all chats</button>
    </div>
    <p style="margin-top:16px"><strong>Keyboard</strong><br>
    <code>⌘K</code> / <code>Ctrl K</code> new chat · <code>⌘/</code> focus the composer · <code>⌘J</code> calculator · <code>⌘⇧E</code> workspace · <code>Enter</code> send · <code>Shift Enter</code> new line · <code>Esc</code> close.</p>`;
}

function openModal(kind = 'privacy', category = null) {
  const header = {
    privacy: ['A NOTE ON PRIVACY', 'Everything stays with you.'],
    models: ['MODEL LIBRARY', `${(modelManifest?.available || []).length} models available.`],
    settings: ['MODEL & DEVICE', 'A real model, running here.'],
    library: ['KNOWLEDGE LIBRARY', `${libraryDocuments.length} documents, built in.`],
    draw: ['DRAWING', 'Pictures built from geometry.']
  }[kind] || ['A NOTE ON PRIVACY', 'Everything stays with you.'];

  elements.modalKicker.textContent = header[0];
  elements.modalTitle.textContent = header[1];

  if (kind === 'settings' || kind === 'models') {
    if (!chosenModelId) chosenModelId = activeModel()?.id || null;
    elements.modalCopy.innerHTML = modelScreenMarkup();
  } else if (kind === 'draw') {
    elements.modalCopy.innerHTML = `
      <p>Mox draws with <strong>SVG</strong> — shapes, charts and simple scenes built from coordinates, not pixels. Nothing is generated by an image model and nothing leaves this device: the markup is written here, and you can keep it.</p>
      <div class="draw-chips">${DRAWABLE.map((item) => `<button type="button" class="draw-chip" data-draw-prompt="draw a ${escapeHTML(item)}">${escapeHTML(item)}</button>`).join('')}</div>
      <h3 class="draw-sub">Charts and diagrams</h3>
      <div class="draw-chips">${DRAW_EXAMPLES.map((example) => `<button type="button" class="draw-chip" data-draw-prompt="${escapeHTML(example)}">${escapeHTML(example)}</button>`).join('')}</div>
      <form class="draw-form" id="drawForm">
        <input id="drawPrompt" class="draw-input" type="text" placeholder="Describe a drawing — e.g. a blue star, bar chart of 3, 8, 5" aria-label="Describe a drawing">
        <button type="submit" class="draw-send">Draw it</button>
      </form>
      <p>Every drawing arrives with <strong>Download</strong>, <strong>PNG</strong>, <strong>Copy</strong> and <strong>Open in workspace</strong>. Say “bar chart of 4, 9, 2” or “flowchart: plan, build, ship” for diagrams, and “draw a red heart” for shapes.</p>`;
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
      <p><strong>Your workspace</strong> is the same story: files you write, import, or ask Mox to edit are saved in this browser's IndexedDB, previewed in a sandboxed frame, and never uploaded. The calculator runs locally and keeps its history in local storage.</p>
      <p><strong>Storage:</strong> imported files, the library cache, uploaded models, your workspace, and the browser's copy of the model live in IndexedDB. Clearing site data removes them.</p>`;
  }

  revealModal();

  elements.modalCopy.querySelectorAll('[data-draw-prompt]').forEach((chip) => {
    chip.addEventListener('click', () => {
      closeModal();
      askDrawing(chip.dataset.drawPrompt);
    });
  });

  const drawForm = $('#drawForm');
  if (drawForm) {
    drawForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const field = $('#drawPrompt');
      const prompt = field?.value.trim();
      if (!prompt) { field?.focus(); return; }
      closeModal();
      askDrawing(/^(?:draw|sketch|make|create|paint|illustrate)\b/i.test(prompt) ? prompt : `draw ${prompt}`);
    });
  }

  const upload = $('#modelUpload');
  if (upload) upload.addEventListener('click', () => elements.modelPicker.click());

  const refreshModels = $('#modelRefresh');
  if (refreshModels) refreshModels.addEventListener('click', async () => {
    refreshModels.disabled = true;
    await readModelManifest();
    openModal(kind, category);
    showToast(hiddenModels.length
      ? `Model list refreshed · ${hiddenModels.length} hidden model${hiddenModels.length === 1 ? '' : 's'} still hidden`
      : 'Model list refreshed.');
  });

  const restoreModels = $('#modelRestore');
  if (restoreModels) restoreModels.addEventListener('click', async () => {
    restoreModels.disabled = true;
    await unhideModels();
    openModal(kind, category);
    showToast('Hidden models restored.');
  });

  elements.modalCopy.querySelectorAll('[data-copy-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      const link = button.dataset.copyLink;
      let copied = false;
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {
        const area = document.createElement('textarea');
        area.value = link;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        try { copied = document.execCommand?.('copy') !== false; } catch { copied = false; }
        area.remove();
      }
      button.textContent = copied ? 'Copied' : 'Copy failed';
      setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
    });
  });

  // Pick a model: loads in place, no page reload.
  elements.modalCopy.querySelectorAll('[data-use-model]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.useModel;
      const entry = visibleModels().find((model) => model.id === id);
      if (!entry) return;
      const status = $('#modelSwitchStatus');
      elements.modalCopy.querySelectorAll('[data-use-model], [data-remove-model]').forEach((node) => { node.disabled = true; });
      if (status) status.textContent = `Loading ${entry.name} (${displaySize(entry.bytes)})… this can take a few seconds.`;
      button.textContent = 'Loading…';
      const ok = await switchModel(id);
      openModal(kind, category);
      const after = $('#modelSwitchStatus');
      if (after) after.textContent = ok ? `${entry.name} is ready.` : `${entry.name} could not start here; reload the page and try again.`;
    });
  });

  storageQuota().then((estimate) => {
    const line = $('#modelStorage');
    if (!line || !estimate) return;
    const used = displaySize(estimate.usage);
    const quota = displaySize(estimate.quota);
    line.textContent = `Browser storage used: ${used} of ${quota}. Uploaded models take up most of it when present.`;
  });

  elements.modalCopy.querySelectorAll('[data-remove-model]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = button.dataset.removeModel;
      const entry = (modelManifest?.available || []).find((model) => model.id === id);
      const name = entry?.name || 'this model';
      const selected = id === chosenModelId;

      if (entry?.uploaded) {
        if (!window.confirm(`Delete ${name} from this browser? The file is removed and its storage is freed.${selected ? ' It is loaded right now, so Mox will stop until you pick another model.' : ''}`)) return;
        await deleteUploadedModel(id);
        hiddenModels = hiddenModels.filter((hidden) => hidden !== id);
        await writeMeta('hiddenModels', hiddenModels);
        if (selected) chosenModelId = null;
        await writeMeta('modelChoice', chosenModelId);
        if (selected) unloadEngine('That model was deleted.');
      } else {
        if (!window.confirm(`Remove ${name} from the model list? The file stays in models/ on the site, so Restore can bring it back.${selected ? ' It is selected, so Mox will switch to the next available model.' : ''}`)) return;
        await hideModel(id);
        if (selected) unloadEngine('That model was removed from the list.');
      }

      await readModelManifest();
      openModal(kind, category);
      showToast(entry?.uploaded ? 'Model deleted from this browser.' : 'Model removed from the list.');
    });
  });

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
}

/* ------------------------------------------------------------------ wiring */

$('#loadModel').addEventListener('click', () => startModel());
$('#modelChoose').addEventListener('click', () => openModal('models'));
$('#modelCardUpload').addEventListener('click', () => elements.modelPicker.click());
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
$('#modelMenu').addEventListener('click', () => openModal('models'));
$('#workspaceButton').addEventListener('click', () => { closeDrawer(); openWorkspace(); });
$('#workspaceTop').addEventListener('click', () => openWorkspace());
$('#quickWorkspace').addEventListener('click', () => openWorkspace());
$('#calculatorButton').addEventListener('click', () => { closeDrawer(); openCalculator(); });
$('#calcTop').addEventListener('click', () => openCalculator());
$('#quickCalculator').addEventListener('click', () => openCalculator());
$('#quickDraw').addEventListener('click', () => { closeDrawer(); openModal('draw'); });
$('#mobileWorkspace').addEventListener('click', () => openWorkspace());
$('#mobileCalc').addEventListener('click', () => openCalculator());
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
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'j') {
    event.preventDefault();
    openCalculator();
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    openWorkspace();
  }
  if (event.key === 'Escape') {
    const calculator = document.getElementById('calculatorPanel');
    if (!elements.modal.hidden) closeModal();
    else if (calculator && calculator.hidden === false) closeCalculator();
    else if (isWorkspaceOpen()) closeWorkspace();
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
    // Keep the file in the model library first, so it is listed on the model
    // screen and still there after a reload (pick "your upload" to load it).
    let stored = null;
    try {
      stored = await saveUploadedModel(file);
    } catch (error) {
      console.warn('Could not keep this model in the browser:', error);
      showToast('This model works for now, but could not be stored for next time.');
    }

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
    loadedModel = stored || { name: file.name, bytes: file.size, parameters: '', quantization: '', license: 'your file' };
    if (stored) {
      chosenModelId = stored.id;
      await writeMeta('modelChoice', stored.id);
      await readModelManifest();
    }
    elements.progressBar.style.width = '100%';
    elements.progressPercent.textContent = 'Ready';
    elements.progressLabel.textContent = 'Model loaded on this device';
    elements.modelTitle.textContent = 'Mox is ready';
    elements.modelDescription.textContent = `${file.name} is running in this browser.`;
    elements.modelSize.textContent = displaySize(file.size);
    elements.load.innerHTML = '<span class="button-sparkle">✓</span> Model loaded';
    elements.load.classList.add('loaded');
    elements.load.disabled = true;
    setModelStatus('ready', `${loadedModel.name} ready`);
    setSourceBadge('local', '◈ your model');
    updateModelMenu();
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

  // The calculator and workspace are independent of the model: both initialise
  // now and get the engine hooks they need for their AI panels.
  initCalculator();
  initWorkspace({
    complete: modelComplete,
    isReady: () => modelReady,
    toast: showToast,
    retrieve: (query, limit) => retrieve(query, limit || 2)
  });

  try {
    if (!('indexedDB' in window)) throw new Error('IndexedDB is not available in this browser.');
    db = await openDatabase();
    userDocuments = await readAllDocuments();
    if ((await readMeta('libraryEnabled')) === false) {
      libraryEnabled = false;
      elements.libraryToggle.checked = false;
    }
    chosenModelId = await readMeta('modelChoice');
    const savedHidden = await readMeta('hiddenModels');
    if (Array.isArray(savedHidden)) hiddenModels = savedHidden.filter((id) => typeof id === 'string');
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
    const menuSub = document.querySelector('.model-menu-sub');
    if (menuSub && model.parameters) menuSub.textContent = model.parameters;
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
  retrieve, allKnowledge, renderRich, makeChunks, openModal, resetChat, buildMessages,
  openConversation, deleteChat, openPassage, saveChats, restoreChats, closeDrawer, openDrawer,
  conversations, get activeChatId() { return activeChatId; },
  // Calculator API: __mox.calc('sqrt(2)') → {ok, value, text}
  calc: evaluateExpression,
  openCalculator, closeCalculator,
  // Drawing API: __mox.draw.draw('a red heart') → {svg, caption, kind}
  draw: svgAPI,
  // Workspace API: files(), read(path), writesFrom(text), apply(writes), open()
  workspace: workspaceApi,
  openWorkspace, openWorkspaceWithCode, finalizeAnswer, codeBundleFromText, pureCalculation,
  models: {
    list: () => modelManifest?.available || [],
    visible: visibleModels,
    hidden: () => [...hiddenModels],
    catalog: () => modelManifest?.catalog || [],
    reload: readModelManifest,
    uploaded: listUploadedModels,
    hide: hideModel,
    restore: unhideModels,
    switch: switchModel
  },
  state: () => ({
    modelReady, searchOnly, libraryEnabled, generating,
    libraryCount: libraryDocuments.length, userCount: userDocuments.length,
    availableModels: (modelManifest?.available || []).map((entry) => entry.id),
    chosenModelId, loadedModel: loadedModel?.id || null,
    chats: conversations.filter((chat) => chat.records.length).length,
    messages: conversations.reduce((sum, chat) => sum + chat.records.length, 0)
  })
};
