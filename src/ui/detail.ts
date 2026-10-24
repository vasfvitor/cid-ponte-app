/**
 * "Detalhar aqui": WHO's Embedded Coding Tool (ECT) in the page, to postcoordinate (add "/" and
 * "&" codes) without leaving the app. The ECT searches WHO's cloud ICD-API with a token from our
 * proxy (worker/). It is WHO software (its license, clause 2.3, allows embedding it), bundled as
 * a chunk that loads, with its stylesheet, only when the panel is first opened. We only use its
 * documented settings and restyle it from our stylesheet; its code is not modified (clause 2.4).
 *
 * The panel's elements are static in index.html, outside #result: lit re-renders #result on
 * every lookup, and the ECT is bound once to elements that must stay.
 */

import { html, nothing, render, type TemplateResult } from "lit-html";

import type { Lookup, Target } from "../bridge";
import { isSimple, parse11 } from "../bridge";
import { DETAIL_TOKEN_URL, ICD_API_URL, browserUrl, codingToolUrl } from "../data/sources";
import { $, extLink, notice, partLabel, partsList } from "./dom";

/** `data-ctw-ino` of the panel's ECT instance (index.html). */
const INO = "1";
/** Right after initializing, the ECT still drops searches for a moment (~0.3 s measured, 1.8.0). */
const SETTLE_MS = 500;
/** After this long without results, the panel says WHO is slow. */
const SLOW_MS = 5000;
/** The phone layout, the same query as style.css and ect-theme.css (also at fractional widths). */
const PHONE = "(max-width: 640px)";

/** What the ECT hands back on a selection; `code` carries the whole postcoordinated expression. */
interface Selection {
  code: string;
  title: string;
  /** One URI, or several joined with " / " and " & " for a composite. */
  linearizationUri: string;
}

/** The part of the ECT API we use (the package ships no types). */
interface Ect {
  Handler: {
    configure(settings: Record<string, unknown>, callbacks: Record<string, unknown>): void;
    bind(iNo: string): void;
    search(iNo: string, query: string): void;
    clear(iNo: string): void;
  };
}

/** The lookup being detailed, from one of its ICD-11 cards (`target`) or from the ICD-10 code itself. */
export interface DetailContext {
  lk: Lookup;
  /** The card's target; null from the ICD-10 code (no OneCategory target: no mapping, no path). */
  target: Target | null;
  release: string;
  titleOf: (code: string) => string | null;
  /** The button that opened the panel: marked expanded while it is open, focused again on close. */
  opener: HTMLElement;
}

/**
 * What to start the ECT search with, in order, until one finds something. Text first: only text
 * results lead to the index terms whose "+" opens postcoordination (a code result does not).
 * - A target with one stem: its Portuguese title, then its code (residuals such as "Outras …
 *   especificadas" are not found by title; a whole "&" or "/" expression is not found at all).
 * - A cluster ("1C41/1G40…"): the Brazilian ICD-10 title, as the first stem can be much vaguer
 *   than the case (A41.3 → 1C41, "Infecção bacteriana de localização não especificada").
 * - A block (no code): its title (the English one: the bridge finds Portuguese titles by code),
 *   then the Brazilian title.
 * From the ICD-10 code itself, its first target (a MultipleCategories alternative) stands in: the
 * Brazilian titles, unaccented ("Afeccoes foliculares…"), often find nothing. No target at all:
 * the Brazilian title.
 */
export function initialTerms(lk: Lookup, target: Target | null, titleOf: (code: string) => string | null): string[] {
  const from = target ?? lk.targets[0] ?? null;
  const p = parse11(from?.code ?? null);
  let terms: (string | null | undefined)[];
  if (!p) terms = [from?.titlePt ?? from?.titleEn, lk.brTitle];
  else if (p.stems.length === 1) terms = [titleOf(p.stems[0]!), p.stems[0]];
  else terms = [lk.brTitle, p.stems[0]];
  return [...new Set(terms.filter((t): t is string => Boolean(t)))];
}

/** ECT settings for a release: Portuguese, WHO's cloud API, bound by us (`bind`) once rendered. */
export function ectSettings(release: string): Record<string, unknown> {
  return {
    apiServerUrl: ICD_API_URL,
    apiSecured: true,
    language: "pt",
    minorVersion: release,
    autoBind: false,
    searchByCodeOrURI: true,
    // Full postcoordination; not simplifiedMode, which WHO says is not for medical coding.
    otherPostcoordination: true,
  };
}

/** How a chosen code differs from WHO's mapped one, part by part (stems and extensions). */
export function compareToMapped(
  selected: string, mapped: string | null,
): { added: string[]; removed: string[]; sameStem: boolean } | null {
  const s = parse11(selected);
  const m = parse11(mapped);
  if (!s || !m) return null;
  const sParts = [...s.stems, ...s.extensions];
  const mParts = [...m.stems, ...m.extensions];
  return {
    added: sParts.filter((c) => !mParts.includes(c)),
    removed: mParts.filter((c) => !sParts.includes(c)),
    sameStem: s.stems[0] === m.stems[0],
  };
}

const panel = (): HTMLElement => $("detail");
const output = (): HTMLElement => $("detail-output");
const input = (): HTMLInputElement => panel().querySelector<HTMLInputElement>(".ctw-input")!;
const status = (text: string): void => {
  $("detail-status").textContent = text;
};
/** Whether the current history entry is the one opening the panel pushed. */
export const onDetailEntry = (): boolean => Boolean((history.state as { detail?: boolean } | null)?.detail);
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
/** The class of the notice saying WHO is slow, which its late answer clears. */
const WAIT = "detail-wait";

async function fetchToken(): Promise<string> {
  const res = await fetch(DETAIL_TOKEN_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`token: HTTP ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/** The lookup the panel is open for (null: closed); a new object per open, so a stale search can tell. */
let context: DetailContext | null = null;
/** WHO did not answer the open's search: the same card again retries instead of only scrolling. */
let unanswered = false;
/** The selection on the card (a late "Copiado" must not redraw an older one). */
let selected: Selection | null = null;
/** The ECT's search callbacks, routed to the search() in progress. */
let searchStarted: (() => void) | null = null;
let searchEnded: (() => void) | null = null;

/**
 * `make`'s promise, made on the first get() and shared by the next ones; made again if it failed.
 * `current` is the one made so far (null: none yet, or it failed).
 */
function retrying<A extends unknown[], T>(make: (...args: A) => Promise<T>) {
  let p: Promise<T> | null = null;
  return {
    get: (...args: A): Promise<T> =>
      (p ??= make(...args).catch((e: unknown) => {
        p = null;
        throw e;
      })),
    get current(): Promise<T> | null {
      return p;
    },
  };
}

/** The ECT's chunk with its stylesheet. */
const chunk = retrying(() =>
  Promise.all([import("@whoicd/icd11ect") as Promise<Ect>, import("./ect-theme.css")]).then(([mod]) => mod),
);

/**
 * The ECT configured and bound to the panel, once per page: binding again would add a second set
 * of listeners to the same elements. Only a failure before that (the chunk, the first token) is
 * tried again.
 */
const bound = retrying(async (release: string) => {
  const [mod, token] = await Promise.all([chunk.get(), fetchToken()]);
  let first: string | null = token;
  mod.Handler.configure(ectSettings(release), {
    getNewTokenFunction: async () => {
      const t = first ?? (await fetchToken());
      first = null;
      return t;
    },
    searchStartedFunction: () => searchStarted?.(),
    searchEndedFunction: () => {
      searchEnded?.();
      // WHO answered, if late: the notice that it is slow no longer holds.
      if (output().querySelector(`.${WAIT}`)) render(nothing, output());
    },
    selectedEntityFunction: showSelection,
  });
  mod.Handler.bind(INO);
  return mod;
});

/**
 * The bound ECT once it takes searches. If it does not initialize in time, the next open waits
 * for it again (the ECT keeps trying), without binding it again.
 */
const ect = retrying(async (release: string) => {
  const mod = await bound.get(release);
  await initialized(input());
  // Not needed for correctness (search() retries), but it saves a ~1 s retry on first open.
  await sleep(SETTLE_MS);
  return mod;
});

/**
 * Fetch the ECT's chunk when a "Detalhar" button is about to be used (pointer over it, or focus),
 * so opening the panel does not wait for it; not for every result, as it is ~220 kB gzipped. Only
 * the download: the ECT does not initialize in the hidden panel, and the token is fetched on open.
 * A failure is left to the open, which retries and tells.
 */
export function preloadDetail(): void {
  chunk.get().catch(() => {});
}

let controlsBound = false;

/** The panel's own controls, wired on the first open. */
function bindControls(): void {
  if (controlsBound) return;
  controlsBound = true;
  // Opening pushed a history entry: Fechar goes back, like the phone's back button.
  $("detail-close").addEventListener("click", () => (onDetailEntry() ? history.back() : closeDetail()));
  // Escape does what Fechar does, except while the ECT's postcoordination window is open (it is the
  // ECT's to close). In its field, Escape leaves the embedded results as they are (seen in 1.8.0).
  panel().addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || ev.defaultPrevented) return;
    const pcWindow = panel().querySelector(".browserContent");
    if (pcWindow && pcWindow.getBoundingClientRect().height > 0) return;
    $("detail-close").click();
  });
  const words = $("detail-words");
  words.addEventListener("click", () => {
    words.setAttribute("aria-expanded", String(panel().classList.toggle("show-words")));
  });
}

/**
 * Resolves once the ECT has initialized (it then marks its input `apiInitializationCompleted`,
 * observed in 1.8.0; there is no "ready" callback). Rejects after `timeoutMs` (a token the API
 * refuses, or the API down).
 */
function initialized(el: Element, timeoutMs = 20_000): Promise<void> {
  const done = (): boolean => el.classList.contains("apiInitializationCompleted");
  if (done()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!done()) return;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve();
    });
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error("ECT: not initialized"));
    }, timeoutMs);
  });
}

/** `p`, or undefined after `ms` (the timer cleared either way). */
async function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer = 0;
  try {
    return await Promise.race([p, new Promise<undefined>((r) => (timer = window.setTimeout(r, ms)))]);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Search for `term`, repeating until the ECT sends it (`searchStartedFunction`): one asked for
 * while it is still settling is dropped. Retries are spaced past its search debounce (~0.8 s in
 * 1.8.0), which each new call restarts. Then waits for the results (`searchEndedFunction`).
 * True if WHO answered and the panel is still open for `ctx`.
 */
async function search(mod: Ect, term: string, ctx: DetailContext, timeoutMs = 15_000): Promise<boolean> {
  const started = new Promise<true>((r) => (searchStarted = () => r(true)));
  const ended = new Promise<true>((r) => (searchEnded = () => r(true)));
  let sent: true | undefined;
  for (const end = Date.now() + timeoutMs; !sent && context === ctx && Date.now() < end; ) {
    mod.Handler.search(INO, term);
    sent = await within(started, 1000);
  }
  const answered = sent && (await within(ended, timeoutMs));
  return Boolean(answered) && context === ctx;
}

/**
 * Try each term until one has results (the ECT's result list, as rendered). False if WHO did not
 * answer (or the panel moved on): no use trying the next term.
 */
async function searchFirstFound(mod: Ect, terms: string[], ctx: DetailContext): Promise<boolean> {
  // Another card's results may still be listed: they would read as this search's.
  mod.Handler.clear(INO);
  for (const term of terms) {
    if (!(await search(mod, term, ctx))) return false;
    if (panel().querySelector(".entitylist li")) return true;
  }
  return true;
}

type Comparison = ReturnType<typeof compareToMapped>;

/** How the chosen code compares with the card's (WHO's mapped one or an alternative), as a line for the card. */
function vsStartLine(cmp: Comparison, start: Target | null, titleOf: DetailContext["titleOf"]): TemplateResult | typeof nothing {
  if (!cmp || !start) return nothing;
  if (!cmp.sameStem) return html`<p class="hint">Diferente do código de partida (<code>${start.code}</code>).</p>`;
  if (!cmp.added.length && !cmp.removed.length) return html`<p class="hint">Igual ao código de partida (<code>${start.code}</code>).</p>`;
  const added = cmp.added.length === 1 ? "um detalhe" : `${cmp.added.length} detalhes`;
  return html`
    <p class="hint">
      ${start.table === "one" ? "Mapa da OMS" : "Alternativa da OMS"}: <code>${start.code}</code>.
      ${cmp.added.length ? `Você acrescentou ${added}.` : nothing}
      ${cmp.removed.length ? html`<strong>Ficou de fora:</strong> ${cmp.removed.map((c) => partLabel(c, titleOf)).join("; ")}.` : nothing}
    </p>
  `;
}

const COPY_LABEL = { idle: "Copiar código", done: "Copiado", failed: "Não foi possível copiar" } as const;

/** The chosen code as a card like the result's: parts, how it compares with the card's code, copy. */
function renderSelection(s: Selection, ctx: DetailContext, copied: keyof typeof COPY_LABEL = "idle"): void {
  const { target, release, titleOf } = ctx;
  const parsed = parse11(s.code);
  const cmp = compareToMapped(s.code, target?.code ?? null);
  const link = browserUrl(release, s.linearizationUri?.split(" ")[0] || null);
  const copy = async (): Promise<void> => {
    let result: keyof typeof COPY_LABEL = "done";
    try {
      await navigator.clipboard.writeText(s.code);
    } catch {
      result = "failed";
    }
    if (context === ctx && selected === s) renderSelection(s, ctx, result);
  };
  render(
    html`
      <article class="target detail-card">
        <div class="detail-pick">
          <span class="code">${s.code}</span>
          <button type="button" class="primary" @click=${copy}>${COPY_LABEL[copied]}</button>
        </div>
        <p class="title-pt">${s.title}</p>
        ${parsed && !isSimple(parsed) ? partsList(parsed, titleOf, cmp?.sameStem ? new Set(cmp.added) : undefined) : nothing}
        ${vsStartLine(cmp, target, titleOf)}
        ${link ? html`<p class="meta">${extLink(link, "Ver na CID-11")}</p>` : nothing}
      </article>
    `,
    output(),
  );
}

/** The ECT's selection callback. */
function showSelection(s: Selection): void {
  if (!context) return;
  selected = s;
  renderSelection(s, context);
  output().focus({ preventScroll: true });
}

/**
 * Open the panel for a card of a lookup (or the lookup itself) and search from it (nothing to
 * search: the empty tool). Another card while open searches again in the same panel.
 */
export async function openDetail(ctx: DetailContext): Promise<void> {
  // The same card again while open (or loading): bring the panel into view. After a failure (no
  // `ect.current`) or a search WHO did not answer, it opens again, which retries.
  if (context?.lk === ctx.lk && context.target === ctx.target && ect.current && !unanswered) {
    panel().scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  bindControls();
  // The opener's card shows which one is being detailed (style.css).
  context?.opener.setAttribute("aria-expanded", "false");
  ctx.opener.setAttribute("aria-expanded", "true");
  context = ctx;
  unanswered = false;
  const wide = !matchMedia(PHONE).matches;
  const { lk, target } = ctx;
  $("detail-context").textContent = target ? `${lk.code} → ${target.code ?? "grupo"}` : lk.code;
  ($("detail-who") as HTMLAnchorElement).href = codingToolUrl(ctx.release);
  panel().hidden = false;
  // On a phone the panel covers the page: focus goes into it, to its title (the field would open the keyboard).
  if (!wide) $("detail-title").focus({ preventScroll: true });
  if (!onDetailEntry()) history.pushState({ detail: true }, "", location.href);
  render(nothing, output());
  if (wide) panel().scrollIntoView({ behavior: "smooth", block: "start" });
  status("Carregando a ferramenta da OMS…");
  const terms = initialTerms(lk, target, ctx.titleOf);
  input().value = terms[0] ?? ""; // shown at once; the ECT's search sets it again
  const tool = extLink(codingToolUrl(ctx.release), "ferramenta de codificação da OMS");
  // WHO's API is at times slow to answer: say so, with the way out (cleared when it answers).
  const waiting = (body: TemplateResult): void => {
    render(html`<div class=${WAIT}>${notice("warn", body)}</div>`, output());
  };
  const slow = window.setTimeout(() => {
    if (context === ctx) waiting(html`A OMS está demorando a responder. Aguarde ou use a ${tool}.`);
  }, SLOW_MS);
  try {
    const answered = await searchFirstFound(await ect.get(ctx.release), terms, ctx);
    if (context !== ctx) return;
    status("");
    unanswered = !answered;
    if (!answered) waiting(html`A OMS não respondeu a tempo. Busque de novo no campo acima ou use a ${tool}.`);
    // Not on a phone: the keyboard would cover the results.
    if (wide) input().focus({ preventScroll: true });
  } catch {
    if (context !== ctx) return;
    status("");
    render(notice("bad", html`Não foi possível abrir a ferramenta da OMS agora. Tente de novo ou use a ${tool}.`), output());
  } finally {
    window.clearTimeout(slow);
  }
}

/** Hide the panel and clear the ECT (a new lookup, or going back); focus returns to the button that opened it. */
export function closeDetail(): void {
  if (panel().hidden) return;
  const hadFocus = panel().contains(document.activeElement);
  const opener = context?.opener;
  opener?.setAttribute("aria-expanded", "false");
  context = null;
  panel().hidden = true;
  status("");
  render(nothing, output());
  void ect.current?.then((mod) => mod.Handler.clear(INO), () => {});
  if (hadFocus && opener?.isConnected) opener.focus();
}
