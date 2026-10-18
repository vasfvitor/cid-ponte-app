/** Download (with SHA-256 check and IndexedDB cache), unzip, and build a `Bridge`. */

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

export class LicenseNotAccepted extends Error {
  constructor() {
    super("WHO license not accepted");
    this.name = "LicenseNotAccepted";
  }
}

export type Status =
  | { phase: "cache" | "verify" | "parse"; file: string }
  | { phase: "download"; file: string; received: number; total: number | null }
  | { phase: "ready" };

export type OnStatus = (s: Status) => void;

const LICENSE_KEY = "license-accepted";

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
      cacheKey: `${release}/${MAPPING_ZIP}`,
      sha256: MAPPING_SHA256[release],
    },
    titles: {
      name: titlesZip,
      url: simpleTabulationUrl(release, "pt"),
      cacheKey: `${release}/${titlesZip}`,
      sha256: SIMPLE_TABULATION_PT_SHA256[release],
    },
  };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function licenseAccepted(): Promise<boolean> {
  return store.has(LICENSE_KEY);
}

export async function acceptLicense(): Promise<void> {
  await store.put(LICENSE_KEY, new Date().toISOString());
}

export async function isCached(release: string): Promise<boolean> {
  const f = whoFiles(release);
  const [a, b] = await Promise.all([store.has(f.mapping.cacheKey), store.has(f.titles.cacheKey)]);
  return a && b;
}

export async function clearCache(): Promise<void> {
  await store.clearAll();
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function download(f: WhoFile, onStatus: OnStatus): Promise<Uint8Array> {
  const res = await fetchOk(f.url);
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
 * was verified, so they are trusted on read), otherwise downloaded, verified and cached.
 */
async function obtain(f: WhoFile, onStatus: OnStatus): Promise<Uint8Array> {
  const cached = await store.get<Uint8Array | ArrayBuffer>(f.cacheKey);
  if (cached) {
    onStatus({ phase: "cache", file: f.name });
    return cached instanceof Uint8Array ? cached : new Uint8Array(cached);
  }
  if (!(await licenseAccepted())) throw new LicenseNotAccepted();
  const bytes = await download(f, onStatus);
  if (f.sha256) {
    onStatus({ phase: "verify", file: f.name });
    const got = await sha256Hex(bytes);
    if (got !== f.sha256) throw new ChecksumMismatch(f.url, f.sha256, got);
  }
  await store.put(f.cacheKey, bytes);
  return bytes;
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

async function loadBrTable(): Promise<BrTable> {
  const res = await fetchOk(`${import.meta.env.BASE_URL}data/cid10_v2019.csv`);
  return BrTable.parseCsv(await res.text());
}

/** Fetch (or read from cache), verify, unzip and index everything for a release. */
export async function loadBridge(release: string, onStatus: OnStatus = () => {}): Promise<Bridge> {
  const f = whoFiles(release);
  // The BR table needs no license, so it loads alongside the WHO files.
  const [mapping, titles, br] = await Promise.all([
    obtain(f.mapping, onStatus),
    obtain(f.titles, onStatus),
    loadBrTable(),
  ]);
  onStatus({ phase: "parse", file: f.mapping.name });
  const bridge = bridgeFromZips(release, mapping, titles, br);
  onStatus({ phase: "ready" });
  return bridge;
}
