/** Download (with SHA-256 check and best-effort IndexedDB cache), unzip, and build a `Bridge`. */

import { unzipSync } from "fflate";

import { Bridge, BrTable, MAPPING_FILES, simpleTabulationFile } from "../bridge";
import {
  MAPPING_SHA256, MAPPING_ZIP, SIMPLE_TABULATION_PT_SHA256, mappingUrl, simpleTabulationUrl,
  simpleTabulationZip,
} from "./sources";
import * as store from "./store";

export class ChecksumMismatch extends Error {
  constructor(url: string, expected: string, got: string) {
    super(`${url}: expected sha256 ${expected.slice(0, 12)}…, got ${got.slice(0, 12)}…`);
    this.name = "ChecksumMismatch";
  }
}

export type Status =
  | { phase: "cache" | "verify" | "parse"; file: string }
  | { phase: "download"; file: string; received: number; total: number | null }
  | { phase: "ready" };

export type OnStatus = (s: Status) => void;

/** The two WHO files a release needs. One description drives download, cache and checks. */
interface WhoFile {
  name: string;
  url: string;
  cacheKey: string;
  sha256: string | undefined;
}

function whoFiles(release: string): { mapping: WhoFile; titles: WhoFile } {
  const titlesZip = simpleTabulationZip("pt");
  return {
    mapping: {
      name: MAPPING_ZIP,
      url: mappingUrl(release),
      cacheKey: `${release}/${MAPPING_ZIP}/${MAPPING_SHA256[release] ?? "unpinned"}`,
      sha256: MAPPING_SHA256[release],
    },
    titles: {
      name: titlesZip,
      url: simpleTabulationUrl(release, "pt"),
      cacheKey: `${release}/${titlesZip}/${SIMPLE_TABULATION_PT_SHA256[release] ?? "unpinned"}`,
      sha256: SIMPLE_TABULATION_PT_SHA256[release],
    },
  };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function clearCache(): Promise<void> {
  await store.clearAll();
}

async function fetchOk(url: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function download(f: WhoFile, onStatus: OnStatus, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetchOk(f.url, signal);
  if (!res.body) throw new Error(`${f.url}: empty body`);
  const total = Number(res.headers.get("content-length")) || null;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    received += value.byteLength;
    onStatus({ phase: "download", file: f.name, received, total });
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

/**
 * Bytes of a WHO file: from the cache when present (files are only cached after their hash
 * was verified, and the key carries that hash, so they are trusted on read), otherwise
 * downloaded, verified and cached. The cache is best-effort: with IndexedDB unavailable or
 * full (private mode, low storage) the verified bytes are still used.
 */
async function obtain(f: WhoFile, onStatus: OnStatus, signal: AbortSignal): Promise<Uint8Array> {
  const cached = await store.get<Uint8Array | ArrayBuffer>(f.cacheKey).catch(() => undefined);
  if (cached) {
    onStatus({ phase: "cache", file: f.name });
    return cached instanceof Uint8Array ? cached : new Uint8Array(cached);
  }
  const bytes = await download(f, onStatus, signal);
  if (f.sha256) {
    onStatus({ phase: "verify", file: f.name });
    const got = await sha256Hex(bytes);
    if (got !== f.sha256) throw new ChecksumMismatch(f.url, f.sha256, got);
  }
  await store.put(f.cacheKey, bytes).catch(() => {});
  return bytes;
}

/** Drop cache entries that are not the current files (older releases or hashes, old flags). */
async function pruneCache(current: string[]): Promise<void> {
  for (const k of await store.keys()) if (!current.includes(k)) await store.remove(k);
}

/** Decode the wanted .txt members of a zip as UTF-8 text, keyed by member name. */
export function extractTexts(zip: Uint8Array, wanted: readonly string[]): Record<string, string> {
  const want = new Set(wanted);
  const files = unzipSync(zip, { filter: (f) => want.has(f.name) });
  const dec = new TextDecoder("utf-8");
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) out[name] = dec.decode(data);
  for (const w of wanted) if (!(w in out)) throw new Error(`zip is missing ${w}`);
  return out;
}

/** Pure assembly step shared by the browser and the live test: zips in, Bridge out. */
export function bridgeFromZips(
  release: string, mappingZip: Uint8Array, titlesZip: Uint8Array, br: BrTable,
): Bridge {
  const texts = extractTexts(mappingZip, Object.values(MAPPING_FILES));
  Object.assign(texts, extractTexts(titlesZip, [simpleTabulationFile("pt")]));
  return Bridge.fromTexts(release, texts, br);
}

async function loadBrTable(signal: AbortSignal): Promise<BrTable> {
  const res = await fetchOk(`${import.meta.env.BASE_URL}data/cid10_v2019.csv`, signal);
  return BrTable.parseCsv(await res.text());
}

/** Fetch (or read from cache), verify, unzip and index everything for a release. */
export async function loadBridge(release: string, onStatus: OnStatus = () => {}): Promise<Bridge> {
  const f = whoFiles(release);
  // If one part fails, cancel the others: a retry must not run two downloads of the same file.
  const ctrl = new AbortController();
  const [mapping, titles, br] = await Promise.all([
    obtain(f.mapping, onStatus, ctrl.signal),
    obtain(f.titles, onStatus, ctrl.signal),
    loadBrTable(ctrl.signal),
  ]).catch((e: unknown) => {
    ctrl.abort();
    throw e;
  });
  onStatus({ phase: "parse", file: f.mapping.name });
  // Let the browser paint "Organizando as tabelas…" before the synchronous work below.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
  const bridge = bridgeFromZips(release, mapping, titles, br);
  pruneCache([f.mapping.cacheKey, f.titles.cacheKey]).catch(() => {});
  onStatus({ phase: "ready" });
  return bridge;
}
