import { getItem, setItem, deleteItem } from './db';

const DIR_HANDLE_KEY = 'libraryDirHandle';

export const SUPPORTED_ENCODINGS = [
  { value: 'auto', label: '自动' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gb18030', label: 'GB18030' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
];

export function isFsAccessSupported() {
  return 'showDirectoryPicker' in window;
}

export async function pickLibraryDirectory() {
  const dirHandle = await window.showDirectoryPicker({
    id: 'txt-reader-library',
    mode: 'read',
  });
  await setItem(DIR_HANDLE_KEY, dirHandle);
  return dirHandle;
}

export async function getSavedDirectoryHandle() {
  return getItem(DIR_HANDLE_KEY);
}

export async function clearSavedDirectoryHandle() {
  return deleteItem(DIR_HANDLE_KEY);
}

export async function ensureReadPermission(handle) {
  if (!handle) return false;

  const options = { mode: 'read' };

  const current = await handle.queryPermission(options);
  if (current === 'granted') return true;

  const requested = await handle.requestPermission(options);
  return requested === 'granted';
}

export async function listTxtFiles(dirHandle) {
  const files = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.txt')) {
      files.push(entry);
    }
  }

  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin'));
  return files;
}

function scoreDecodedText(text) {
  if (!text) return -999999;

  const replacementCount = (text.match(/�/g) || []).length;
  const nullCount = (text.match(/\u0000/g) || []).length;

  const commonChineseCount =
    (text.match(/[的一是在不了有人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等]/g) || []).length;

  const weirdSymbolCount =
    (text.match(/[ÃÐØÝÊËÔÕÑÅÆÏÐÒÓÙÛÜ¤§¿¡]/g) || []).length;

  let score = 0;
  score += commonChineseCount * 3;
  score -= replacementCount * 20;
  score -= nullCount * 15;
  score -= weirdSymbolCount * 3;

  return score;
}

function detectBom(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return 'utf-8';
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le';
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be';
  }

  return null;
}

function tryDecode(buffer, encoding, fatal = true) {
  const text = new TextDecoder(encoding, { fatal }).decode(buffer);
  return { text, encoding, score: scoreDecodedText(text) };
}

function autoDecode(buffer) {
  const bytes = new Uint8Array(buffer);
  const bomEncoding = detectBom(bytes);

  if (bomEncoding) {
    const text = new TextDecoder(bomEncoding).decode(buffer);
    return {
      text,
      encoding: bomEncoding,
      score: scoreDecodedText(text),
    };
  }

  const candidates = ['utf-8', 'gb18030', 'utf-16le', 'utf-16be'];
  const results = [];

  for (const encoding of candidates) {
    try {
      results.push(tryDecode(buffer, encoding, true));
    } catch {
      // ignore
    }
  }

  if (results.length > 0) {
    results.sort((a, b) => b.score - a.score);
    return results[0];
  }

  const fallbackText = new TextDecoder('gb18030').decode(buffer);
  return {
    text: fallbackText,
    encoding: 'gb18030',
    score: scoreDecodedText(fallbackText),
  };
}

export async function readTxtFile(fileHandle, selectedEncoding = 'auto') {
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();

  let decoded;

  if (selectedEncoding === 'auto') {
    decoded = autoDecode(buffer);
  } else {
    decoded = tryDecode(buffer, selectedEncoding, false);
  }

  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    text: decoded.text,
    encoding: decoded.encoding,
  };
}