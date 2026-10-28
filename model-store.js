// Uploaded GGUF models live in IndexedDB so they behave like the bundled ones:
// selectable in the model screen, remembered across reloads, and removable.
//
// The blob is stored once and streamed into the engine on demand. Nothing is
// uploaded anywhere — "upload" here means from your disk into this browser.

const DB_NAME = 'mox-model-library';
const DB_VERSION = 1;
const STORE = 'uploads';

let database = null;

function openDatabase() {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => { database = request.result; resolve(database); };
    request.onerror = () => reject(request.error);
  });
}

function guessDetails(filename) {
  const base = filename.replace(/\.gguf$/i, '');
  const billions = (base.match(/(\d+(?:\.\d+)?)\s*b(?![a-zA-Z])/i) || [])[1];
  const millions = (base.match(/(\d+(?:\.\d+)?)\s*m(?![a-zA-Z])/i) || [])[1];
  const parameters = billions ? `${billions}B` : millions ? `${millions}M` : '';
  const quantization = (base.match(/((?:i?q\d+(?:[_a-zA-Z0-9]+)?)|f16|f32|bf16)/i) || [])[1];
  const pretty = base
    .replace(/\bgguf\b/gi, ' ')
    .replace(/[-_.]?\b(?:i?q\d+(?:_[a-z0-9]+)*|f16|f32|bf16)\b/gi, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*b\b/gi, (match, number) => `${number}B`)
    .replace(/(\d+(?:\.\d+)?)\s*m\b/gi, (match, number) => `${number}M`)
    // Keep version numbers (3.2, v1.0) intact while turning separators into spaces.
    .replace(/(\d)\.(\d)/g, '$1\u0001$2')
    .replace(/[-_]+/g, ' ')
    .replace(/\./g, ' ')
    .replace(/\u0001/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    parameters,
    quantization: quantization ? quantization.toUpperCase() : '',
    name: pretty ? pretty.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : base
  };
}

/** Metadata for every stored model, newest first. Blobs are not read. */
export async function listUploadedModels() {
  try {
    const db = await openDatabase();
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    return records
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      .map((record) => ({
        id: `upload-${record.id}`,
        uploadId: record.id,
        name: record.name,
        file: record.fileName,
        bytes: record.bytes,
        parameters: record.parameters || '',
        quantization: record.quantization || '',
        license: 'your file',
        note: 'Uploaded from this computer and kept in this browser.',
        uploaded: true,
        bundled: false,
        addedAt: record.addedAt || 0
      }));
  } catch (error) {
    console.warn('Could not read uploaded models:', error);
    return [];
  }
}

/** Store a File/Blob and return the manifest-shaped entry the app can select. */
export async function saveUploadedModel(file) {
  if (!file) throw new Error('No file chosen');
  if (!/\.gguf$/i.test(file.name)) throw new Error('Choose a .gguf file');
  const db = await openDatabase();
  const details = guessDetails(file.name);
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName: file.name,
    name: details.name,
    bytes: file.size,
    parameters: details.parameters,
    quantization: details.quantization,
    blob: file,
    addedAt: Date.now()
  };
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Could not save the model in this browser (storage may be full).'));
  });
  return {
    id: `upload-${record.id}`,
    uploadId: record.id,
    name: record.name,
    file: record.fileName,
    bytes: record.bytes,
    parameters: record.parameters,
    quantization: record.quantization,
    license: 'your file',
    note: 'Uploaded from this computer and kept in this browser.',
    uploaded: true,
    bundled: false,
    addedAt: record.addedAt
  };
}

/** The stored Blob for an upload entry id (`upload-…`). */
export async function getUploadedModel(manifestId) {
  const recordId = String(manifestId).replace(/^upload-/, '');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(recordId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteUploadedModel(manifestId) {
  const recordId = String(manifestId).replace(/^upload-/, '');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(recordId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** How much room is left for more models, when the browser reports it. */
export async function storageQuota() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return null;
    return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
  } catch { return null; }
}
