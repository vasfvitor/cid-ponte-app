/** Small page helpers shared by main.ts and detail.ts. */

import { html, nothing, type TemplateResult } from "lit-html";

import type { Target11 } from "../bridge";
import { term } from "./glossary";

export const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export const extLink = (href: string, text: string): TemplateResult =>
  html`<a href=${href} target="_blank" rel="noopener">${text}</a>`;

/** A notice; its kind shows in its colours and a faint corner icon (style.css). */
export const notice = (kind: "warn" | "bad" | "ok", body: unknown): TemplateResult => html`
  <div class="notice ${kind}"><p>${body}</p></div>
`;

/** "XE266 — Casa": an ICD-11 code with its Portuguese title. */
export const partLabel = (c: string, titleOf: (code: string) => string | null): string =>
  `${c} — ${titleOf(c) ?? "sem título"}`;

/**
 * The parts of a composite ICD-11 code, each with its Portuguese title: stems ("/"), then
 * extensions ("&"). Parts in `added` are tagged (detail the doctor added to WHO's mapping).
 */
export function partsList(p: Target11, titleOf: (code: string) => string | null, added?: ReadonlySet<string>): TemplateResult {
  const part = (c: string, note: unknown = nothing): TemplateResult =>
    html`<li>${partLabel(c, titleOf)}${note}${added?.has(c) ? html` <span class="tag">acrescentado</span>` : nothing}</li>`;
  return html`
    <ul class="parts">
      ${p.stems.map((s) => part(s))}
      ${p.extensions.map((x) => part(x, html` (${term("extensao", "detalhe extra")})`))}
    </ul>
  `;
}
