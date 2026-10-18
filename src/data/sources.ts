/**
 * Where the WHO data lives, which releases we know, and the hashes we pin.
 *
 * Nothing from WHO ships with this app (terms of use, clause 1.2.4, and project decision):
 * the browser downloads from icdcdn.who.int at run time, checks the SHA-256 pinned per
 * release, and caches in IndexedDB. CORS on the CDN is open (checked 2026-10-16).
 */

export const CDN = "https://icdcdn.who.int/static/releasefiles";
export const LICENSE_URL = "https://icd.who.int/en/docs/icd11-license.pdf";
export const CITATION =
  "International Classification of Diseases, Eleventh Revision (ICD-11), " +
  "World Health Organization (WHO) 2019. https://icd.who.int/browse11. " +
  "Licensed under CC BY-ND 3.0 IGO.";

// sha256 per release, checked on 2026-10-16 (cid-ponte data/SHA256SUMS).
export const MAPPING_SHA256: Record<string, string> = {
  "2024-01": "ef1370361a3fe5e414e6f1c75b84a8aa04f4d937744c429ce51e9728a81445e2",
  "2025-01": "7f6d05c0a7d15a0ed55f456741b9828c58f00aa7d1f3d6c01bc9d66990f5a7a0",
  "2026-01": "2eb158cf2a0d53690d6e9baf0956f7617e1315e4f2a44dfc3db3be8f49193a1d",
};
export const SIMPLE_TABULATION_PT_SHA256: Record<string, string> = {
  "2026-01": "ba9f9a79eea89e57319eaf59757af8638286545ad4b3ba8fa5cbce11d6857422",
};

/** Releases with both hashes pinned (mapping + pt titles). */
export const RELEASES: string[] = Object.keys(MAPPING_SHA256)
  .filter((r) => r in SIMPLE_TABULATION_PT_SHA256)
  .sort();
export const DEFAULT_RELEASE = RELEASES[RELEASES.length - 1]!;

export const MAPPING_ZIP = "mapping.zip";
export const simpleTabulationZip = (lang = "pt"): string => `SimpleTabulation-ICD-11-MMS-${lang}.zip`;

export const mappingUrl = (release: string): string => `${CDN}/${release}/${MAPPING_ZIP}`;
export const simpleTabulationUrl = (release: string, lang = "pt"): string =>
  `${CDN}/${release}/${simpleTabulationZip(lang)}`;

/** Approximate download size shown before the user accepts (mapping ≈ 6.8 MB + pt ≈ 3 MB). */
export const APPROX_DOWNLOAD_MB = 10;

/** WHO's ICD-11 Coding Tool (Portuguese) for a release, e.g. https://icd.who.int/ct/icd11_mms/pt/2026-01 */
export function codingToolUrl(release: string, lang = "pt"): string {
  return `https://icd.who.int/ct/icd11_mms/${lang}/${release}`;
}

/** Link to the entity in WHO's ICD-11 browser (Portuguese), from its Foundation URI. */
export function browserUrl(release: string, foundationUri: string | null): string | null {
  if (!foundationUri) return null;
  const id = foundationUri.split("/").pop();
  return id ? `https://icd.who.int/browse/${release}/mms/pt#${id}` : null;
}
