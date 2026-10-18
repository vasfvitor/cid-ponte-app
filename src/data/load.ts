/** Download (with SHA-256 check and IndexedDB cache), unzip, and build a `Bridge`. */

import { unzipSync } from "fflate";

import { Bridge, BrTable, MAPPING_FILES, simpleTabulationFile } from "../bridge";
import {
  MAPPING_SHA256, SIMPLE_TABULATION_PT_SHA256, mappingUrl, simpleTabulationUrl,
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
  | { phase: "cache"; file: string }
  | { phase: "download"; file: string; received: number; total: number | null }
  | { phase: "verify"; file: string }
  | { phase: "parse"; file: string }
  | { phase: "ready" };

export type OnStatus = (s: Status) => void;

const LICENSE_KEY = "license-accepted";
const fileKey = (release: string, name: string): string => `${release}/${name}`;

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function licenseAccepted(): Promise<boolean> {
  return (await store.get<string>(LICENSE_KEY)) !== undefined;
}

export async function acceptLicense(): Promise<void> {
  await store.put(LICENSE_KEY, new Date().toISOString());
}

export async function isCached(release: string): Promise<boolean> {
  const a = await store.get<ArrayBuffer>(fileKey(release, "mapping.zip"));
  const b = await store.get<ArrayBuffer>(fileKey(release, "simpletab-pt.zip"));
  return a !== undefined && b !== undefined;
}

export async function clearCache(): Promise<void> {
  await store.clearAll();
}

async function download(url: string, file: string, onStatus: OnStatus): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onStatus({ phase: "download", file, received, total });
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Return the file bytes from cache if present and valid; otherwise download, verify, cache. */
async function obtain(
  url: string, key: string, file: string, expected: string | undefined, onStatus: OnStatus,
): Promise<Uint8Array> {
  const cached = await store.get<ArrayBuffer>(key);
  if (cached) {
    onStatus({ phase: "cache", file });
    const bytes = new Uint8Array(cached);
    if (!expected || (await sha256Hex(bytes)) === expected) return bytes;
    await store.remove(key);
  }
  if (!(await licenseAccepted())) throw new LicenseNotAccepted();
  const bytes = await download(url, file, onStatus);
  if (expected) {
    onStatus({ phase: "verify", file });
    const got = await sha256Hex(bytes);
    if (got !== expected) throw new ChecksumMismatch(url, expected, got);
  }
  await store.put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
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

async function loadBrTable(): Promise<BrTable> {
  const url = `${import.meta.env.BASE_URL}data/cid10_v2019.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return BrTable.parseCsv(await res.text());
}

/** Fetch (or read from cache), verify, unzip and index everything for a release. */
export async function loadBridge(release: string, onStatus: OnStatus = () => {}): Promise<Bridge> {
  const mappingZip = await obtain(
    mappingUrl(release), fileKey(release, "mapping.zip"), "mapping.zip",
    MAPPING_SHA256[release], onStatus,
  );
  const stZip = await obtain(
    simpleTabulationUrl(release, "pt"), fileKey(release, "simpletab-pt.zip"),
    "SimpleTabulation-ICD-11-MMS-pt.zip", SIMPLE_TABULATION_PT_SHA256[release], onStatus,
  );
  onStatus({ phase: "parse", file: "mapping.zip" });
  const texts = extractTexts(mappingZip, [
    MAPPING_FILES.one, MAPPING_FILES.multiple, MAPPING_FILES.rev, MAPPING_FILES.foundationOne,
  ]);
  onStatus({ phase: "parse", file: "SimpleTabulation-ICD-11-MMS-pt.zip" });
  Object.assign(texts, extractTexts(stZip, [simpleTabulationFile("pt")]));
  const br = await loadBrTable();
  const bridge = Bridge.fromTexts(release, texts, br);
  onStatus({ phase: "ready" });
  return bridge;
}
