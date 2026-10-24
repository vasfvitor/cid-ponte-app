/** Page wiring: download → search (code or name) → render. User-facing text in pt-BR. */

import Combobox from "@github/combobox-nav";
import { html, nothing, render, type TemplateResult } from "lit-html";

import type { BrCode, Bridge, Lookup, Target } from "../bridge";
import { isSimple, kind10, normalize10, parse11 } from "../bridge";
import {
  ChecksumMismatch, clearCache, loadBridge, type Status,
} from "../data/load";
import {
  CITATION, DEFAULT_RELEASE, DETAIL_TOKEN_URL, LICENSE_URL, browserUrl, codingToolUrl,
} from "../data/sources";
import { closeDetail, onDetailEntry, openDetail, preloadDetail } from "./detail";
import { $, extLink, notice, partsList } from "./dom";
import { mountGlossary, term, type TermId } from "./glossary";

const panels = {
  loading: $<HTMLElement>("loading"),
  search: $<HTMLElement>("search"),
  result: $<HTMLElement>("result"),
  error: $<HTMLElement>("error"),
};

const release = DEFAULT_RELEASE;
let bridge: Bridge | null = null;

function show(...visible: (keyof typeof panels)[]): void {
  for (const [name, el] of Object.entries(panels)) el.hidden = !visible.includes(name as keyof typeof panels);
}

/** Show an error; with `retry`, a button to run it again (there may be no reload button in an installed app). */
function showError(message: string, retry?: () => void): void {
  render(
    html`${message}${retry ? html` <button type="button" class="link" @click=${retry}>Tentar de novo</button>` : nothing}`,
    panels.error,
  );
  panels.error.hidden = false;
}

// ---------------------------------------------------------------- progress

const PHASE_TEXT = {
  cache: "Lendo as tabelas salvas…",
  verify: "Conferindo os arquivos baixados…",
  parse: "Organizando as tabelas…",
} as const;
const downloads = new Map<string, { received: number; total: number | null }>();
const MB = 1_048_576;

function onStatus(s: Status): void {
  const status = $<HTMLElement>("status");
  const progress = $<HTMLProgressElement>("progress");
  if (s.phase === "download") {
    // Files download in parallel: show the sum.
    downloads.set(s.file, { received: s.received, total: s.total });
    let received = 0;
    let total: number | null = 0;
    for (const d of downloads.values()) {
      received += d.received;
      total = total === null || d.total === null ? null : total + d.total;
    }
    if (total) {
      progress.value = (100 * received) / total;
      status.textContent = `Baixando tabelas da OMS: ${(received / MB).toFixed(1)} de ${(total / MB).toFixed(1)} MB`;
    } else {
      progress.removeAttribute("value");
      status.textContent = `Baixando tabelas da OMS: ${(received / MB).toFixed(1)} MB`;
    }
    return;
  }
  if (s.phase === "ready") {
    status.textContent = "Pronto.";
    progress.value = 100;
    panels.loading.setAttribute("aria-busy", "false");
    return;
  }
  status.textContent = PHASE_TEXT[s.phase];
  progress.removeAttribute("value");
}

/** A load failure in Portuguese where it is a common one (the browser's own messages are in English). */
function loadErrorDetail(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  // fetch's network failure: "Failed to fetch" (Chrome), "NetworkError…" (Firefox), "Load failed" (Safari).
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return "sem resposta do servidor da OMS (icdcdn.who.int)";
  const status = /HTTP (\d{3})/.exec(message)?.[1];
  if (status) return `o servidor da OMS respondeu com erro ${status}`;
  if (e instanceof DOMException && e.name === "QuotaExceededError") return "sem espaço no navegador para guardar as tabelas";
  return message;
}

/** The code in the URL fragment, or "" (also for a malformed one like "#I21%"). */
function codeFromHash(): string {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return "";
  }
}

/** The "limpar dados baixados" button, while it exists (clicking replaces it with a note). */
const clearButton = (): HTMLButtonElement | null => document.getElementById("clear-cache") as HTMLButtonElement | null;

async function start(): Promise<void> {
  show("loading");
  downloads.clear();
  // Clearing while files download would let them be saved again right after.
  const clear = clearButton();
  if (clear) clear.disabled = true;
  try {
    bridge = await loadBridge(release, onStatus);
    show("search");
    $<HTMLElement>("guide").hidden = false;
    input.focus();
    const fromHash = codeFromHash();
    if (fromHash) query(fromHash, true);
  } catch (e) {
    show();
    if (e instanceof ChecksumMismatch) {
      showError(
        "O arquivo baixado da OMS não confere com a versão esperada (talvez a OMS o tenha atualizado). " +
          "O arquivo com problema não foi salvo. Detalhe técnico: " + e.message,
        start,
      );
    } else {
      showError(`Não foi possível carregar as tabelas. Verifique a conexão. Detalhe técnico: ${loadErrorDetail(e)}.`, start);
    }
  } finally {
    if (clear) clear.disabled = false;
  }
}

// ---------------------------------------------------------------- search: code or name

const input = $<HTMLInputElement>("code");
const box = $<HTMLElement>("suggestions");
// ARIA 1.2 combobox: focus stays in the field, arrows move aria-activedescendant, Enter picks.
const combobox = new Combobox(input, box);

/** "I219", "i21.9", "A00-A09", "IX" are codes; anything else is a name to search for. */
function looksLikeCode(text: string): boolean {
  const c = normalize10(text);
  return c !== null && kind10(c) !== "other";
}

/**
 * Run a lookup for a code and show it. Each new code is a history entry (#code), so the
 * phone's back button returns to the previous result or the empty search, not off the page.
 * `replace` is for the code the page was opened with (it may be written "#i219").
 */
function query(code: string, replace = false): void {
  if (!bridge) return;
  input.value = code;
  hideSuggestions();
  const lk = bridge.lookup(code);
  const url = lk.code ? `#${encodeURIComponent(lk.code)}` : location.pathname + location.search;
  if (onDetailEntry()) {
    // The "Detalhar aqui" entry: the same code just leaves it (detail.ts closes the panel, the
    // result stays); a new code takes its place.
    if (lk.code === shown) {
      history.back();
      return;
    }
    history.replaceState(null, "", url);
  } else if (lk.code && url !== location.hash && !replace) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  showLookup(lk);
}

/** Back/forward: show the code in the URL again, or the empty search screen. */
function onPopState(): void {
  if (!bridge) return;
  const code = codeFromHash();
  // Same code: Back only left the "Detalhar aqui" entry; the result stays.
  if (code && code === shown) {
    closeDetail();
    return;
  }
  input.value = code;
  hideSuggestions();
  if (code) {
    showLookup(bridge.lookup(code));
    return;
  }
  render(nothing, panels.result);
  panels.result.hidden = true;
  shown = "";
  closeDetail();
  panels.error.hidden = true;
  window.scrollTo({ top: 0 });
}

let suggestTimer: number | undefined;

/** Also cancels a pending suggest(), which would otherwise reopen the list after a pick. */
function hideSuggestions(): void {
  window.clearTimeout(suggestTimer);
  combobox.stop();
  box.hidden = true;
  render(nothing, box);
}

/** Show CID-10 codes whose title matches the typed text. */
function suggest(text: string): void {
  if (!bridge) return;
  const status = $<HTMLElement>("search-status");
  const hits = bridge.searchBr(text);
  render(
    hits.length
      ? hits.map((h) => codeButton(h, true))
      : html`<p class="empty">Nenhum código da CID-10 brasileira com esse nome.</p>`,
    box,
  );
  status.textContent = hits.length
    ? `${hits.length} ${hits.length === 1 ? "código encontrado" : "códigos encontrados"}. Use as setas para escolher e Enter para abrir.`
    : "Nenhum resultado.";
  box.hidden = false;
  combobox.start();
}

/** Submit: a code goes straight to the result; a name opens (or keeps) the suggestions. */
function submit(): void {
  window.clearTimeout(suggestTimer);
  const text = input.value.trim();
  if (!text) {
    // Nothing typed: no result card for it, only the field again (and a word for screen readers).
    $<HTMLElement>("search-status").textContent = "Digite um código ou um nome da CID-10.";
    input.focus();
    return;
  }
  if (looksLikeCode(text)) {
    query(text);
    return;
  }
  suggest(text);
  combobox.navigate(1);
}

function onInput(): void {
  const text = input.value.trim();
  window.clearTimeout(suggestTimer);
  if (text.length < 3 || looksLikeCode(text)) {
    hideSuggestions();
    return;
  }
  suggestTimer = window.setTimeout(() => suggest(text), 150);
}

// ---------------------------------------------------------------- rendering

/**
 * A Brazilian CID-10 code as a pickable row (suggestions, subcategories). As a suggestion
 * (`option`) it is a listbox option reached with the arrows from the field, not with Tab.
 */
const codeButton = (c: BrCode, option = false): TemplateResult => html`
  <button
    type="button"
    class="suggestion"
    role=${option ? "option" : nothing}
    tabindex=${option ? -1 : nothing}
    @click=${() => query(c.code)}
  >
    <span class="code">${c.code}</span><span>${c.title}</span>
    ${c.active ? nothing : html`<span class="inactive">fora de uso</span>`}
  </button>
`;

const tag = (id: TermId, label?: string): TemplateResult => term(id, label, "tag term");

function targetCard(t: Target, b: Bridge, lk: Lookup): TemplateResult {
  const parsed = parse11(t.code);
  const composite = parsed && !isSimple(parsed) ? parsed : null;
  // entityOf() of a composite is its first stem: that stem's residual flag is not the whole code's.
  const residual = !composite && b.entityOf(t.code)?.isResidual;
  const link = browserUrl(b.release, t.linearizationUri);
  const up = t.relationN !== null && t.relationN < 0 ? -t.relationN : 0;
  const relationTag = t.relation === "Equivalent" ? tag("equivalente", "equivalente") : t.relation ? tag("mais-ampla") : nothing;
  const compositeNote = !composite ? nothing : composite.stems.length > 1
    ? html`<strong>${term("cluster")}</strong> (cluster): a CID-11 representa este caso juntando mais de um código com “/”.`
    : html`<strong>${term("extensao", "Código com detalhe extra")}</strong> (extensão): a CID-11 acrescenta um código com “&amp;” para detalhar o caso (agente, local, lado do corpo etc.).`;

  return html`
    <article class="target">
      <div>
        <span class="code" aria-label=${t.code ? `Código CID-11 ${t.code}` : "Bloco sem código"}>${t.code ?? "(bloco sem código)"}</span>
        ${relationTag}
        ${t.table === "one" ? tag("principal", "principal") : tag("alternativo", "alternativo")}
      </div>
      ${t.titlePt ? html`<p class="title-pt">${t.titlePt}</p>` : nothing}
      ${t.titleEn ? html`<p class="title-en">${t.titleEn}</p>` : nothing}
      ${!t.titlePt && t.code ? notice("warn", "A OMS ainda não traduziu este título; acima, o original em inglês.") : nothing}
      ${composite
        ? html`
            ${notice("warn", compositeNote)}
            ${partsList(composite, (c) => b.titleOf(c))}
          `
        : nothing}
      ${residual
        ? notice("warn", html`<strong>${term("residual")}</strong> (“outros” ou “não especificado”). A CID-11 pode ter um código mais específico para o caso.`)
        : nothing}
      <p class="meta">
        ${link ? extLink(link, "Definição") : nothing}
        ${up ? html`<span>correspondência definida para um código mais geral (${up} ${up === 1 ? "nível" : "níveis"} acima)</span>` : nothing}
        ${detailButton(lk, t, b, "Detalhar")}
      </p>
    </article>
  `;
}

/**
 * The notice for why the code maps the way it does, if any. `codingTool` is the link to WHO's
 * site, or null where "Detalhar aqui" is in the page instead (its button follows the notices).
 */
function reasonNotice(lk: Lookup, codingTool: TemplateResult | null): TemplateResult | typeof nothing {
  const inTool = codingTool ? html` na ${codingTool}` : nothing;
  const mapa = term("mapa", "mapa da OMS");
  switch (lk.reason) {
    case "empty":
      return notice("bad", "Digite um código ou um nome da CID-10.");
    case "unknown":
      return notice("bad", html`Código não encontrado na CID-10 brasileira nem no ${mapa}. Confira a digitação.`);
    case "no_br_path":
      return notice("bad", html`<strong>Sem correspondente no ${mapa}.</strong> Este código existe na CID-10 brasileira, mas nem ele nem a categoria dele constam no mapa. Codifique a partir do diagnóstico${inTool}.`);
    case "no_mapping":
      return notice("bad", html`<strong>A OMS não indica um correspondente direto</strong> para este código. Codifique a partir do diagnóstico${inTool}.`);
    case "not_in_br":
      return notice("bad", html`<strong>${lk.code} não existe na CID-10 brasileira.</strong> Confira a digitação. Abaixo, o resultado da categoria <code>${lk.effectiveCode}</code>.`);
    case "place_of_occurrence":
      return notice("warn", html`O 4º caractere indica o <strong>${term("local", "local da ocorrência")}</strong> (residência, escola, rua etc.), que o mapa da OMS não cobre. O resultado abaixo é da categoria <code>${lk.effectiveCode}</code>; na CID-11, o local entra como ${term("extensao", "detalhe extra")}.`);
    case "parent_category":
      return notice("warn", html`Esta subcategoria não está no ${mapa}; o resultado abaixo é da categoria <code>${lk.effectiveCode}</code>, mais geral.`);
    case "mapped":
      return nothing;
  }
}

/**
 * Opens "Detalhar aqui" (WHO's tool in the page, src/ui/detail.ts) from a card's target, or from
 * the ICD-10 code (null). Nothing in a build without the token proxy: WHO's site is linked instead.
 */
const detailButton = (lk: Lookup, target: Target | null, b: Bridge, label: string): TemplateResult | typeof nothing => !DETAIL_TOKEN_URL ? nothing : html`
  <button
    type="button"
    class="secondary detail-open"
    aria-expanded="false"
    @pointerenter=${preloadDetail}
    @focus=${preloadDetail}
    @click=${(ev: Event) =>
      openDetail({ lk, target, release: b.release, titleOf: (c) => b.titleOf(c), opener: ev.currentTarget as HTMLElement })}
  >${label}</button>
`;

/** The notice for how many targets there are and how they relate, if any. */
function cardinalityNotice(lk: Lookup, main: Target[], alternatives: Target[], codingTool: TemplateResult | null): TemplateResult | typeof nothing {
  const first = main[0];
  if (first?.cardinality === "block") {
    const where = codingTool ? html`na ${codingTool}` : html`com “Detalhar”, no cartão abaixo`;
    return notice("warn", html`<strong>A OMS aponta para um ${term("bloco", "grupo")}</strong> da CID-11, não para um código. Escolha um código dentro do grupo ${where}.`);
  }
  if (first?.cardinality === "1:N") {
    return notice("warn", html`<strong>Há ${main.length + alternatives.length} opções na CID-11.</strong> A primeira é a ${term("principal", "indicada pela OMS")}; as outras são ${term("alternativo", "alternativas")}. Escolha conforme o caso clínico.`);
  }
  if (first?.cardinality === "1:1" && lk.reason === "mapped" && first.relation === "Equivalent") {
    return notice("ok", html`<strong>${term("equivalente", "Correspondência direta")}</strong>: segundo a OMS, os dois códigos têm o mesmo significado.`);
  }
  return nothing;
}

/** The code whose result is on screen. */
let shown = "";

function showLookup(lk: Lookup): void {
  const b = bridge!;
  shown = lk.code;
  panels.error.hidden = true;
  closeDetail();

  const main = lk.targets.filter((t) => t.table === "one");
  const alternatives = lk.targets.filter((t) => t.table === "multiple");
  const toolUrl = codingToolUrl(b.release);
  // With a token proxy, "Detalhar" is in the page (on each card, or on this one when there is no
  // main target); without one, WHO's own tool is linked.
  const codingTool = DETAIL_TOKEN_URL ? null : extLink(toolUrl, "ferramenta de codificação da OMS");
  const detailable = Boolean(lk.code) && lk.reason !== "unknown";
  // A category result is generic; its subcategories often map to something more specific.
  const subs = lk.code && kind10(lk.code) === "category" ? b.subcategoriesBr(lk.code) : [];

  render(
    html`
      <h2 id="result-title" class="sr-only">${lk.code ? `Resultado para ${lk.code}` : "Resultado"}</h2>
      <div class="origin panel" tabindex="-1">
        <div>
          <span class="code">${lk.code || "—"}</span>
          ${lk.existsInBr && !lk.active2019 ? tag("fora-de-uso", "fora de uso no Brasil") : nothing}
          ${!lk.existsInBr && lk.reason !== "not_in_br" && ["category", "subcategory"].includes(kind10(lk.code)) ? html`<span class="tag">não consta na CID-10 brasileira</span>` : nothing}
        </div>
        ${lk.brTitle ? html`<p class="title">${lk.brTitle}</p>` : nothing}
        ${reasonNotice(lk, codingTool)}
        ${cardinalityNotice(lk, main, alternatives, codingTool)}
        ${detailable && !main.length ? detailButton(lk, null, b, "Detalhar aqui") : nothing}
      </div>
      ${main.map((t) => targetCard(t, b, lk))}
      ${alternatives.length
        ? html`<div class="alternatives"><h3>Outras opções</h3>${alternatives.map((t) => targetCard(t, b, lk))}</div>`
        : nothing}
      ${subs.length
        ? html`
            <div class="alternatives">
              <h3>Subcategorias de ${lk.code} na CID-10</h3>
              <div class="suggestions">${subs.map((s) => codeButton(s))}</div>
            </div>
          `
        : nothing}
      ${!DETAIL_TOKEN_URL && detailable ? html`<p class="hint">${extLink(toolUrl, "Detalhar o código na ferramenta de codificação da OMS")}</p>` : nothing}
    `,
    panels.result,
  );
  panels.result.hidden = false;
  // Move focus to the result so keyboard and screen-reader users land on the answer.
  panels.result.querySelector<HTMLElement>(".origin")?.focus();
}

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  $<HTMLAnchorElement>("license-link").href = LICENSE_URL;
  $<HTMLElement>("citation").textContent = CITATION;
  $<HTMLElement>("release").textContent = release;
  mountGlossary($<HTMLElement>("glossary"));

  $<HTMLFormElement>("form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    submit();
  });
  input.addEventListener("input", onInput);
  window.addEventListener("popstate", onPopState);
  // Escape closes the suggestions (Combobox only clears the highlighted one).
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideSuggestions();
  });
  for (const chip of document.querySelectorAll<HTMLButtonElement>(".chip")) {
    chip.addEventListener("click", () => query(chip.dataset["code"] ?? ""));
  }
  // No reload: loading is automatic, so a reload would download everything again right away.
  const clear = $<HTMLButtonElement>("clear-cache");
  clear.addEventListener("click", async () => {
    await clearCache();
    clear.replaceWith("dados apagados (serão baixados de novo na próxima vez que abrir o app)");
  });

  await start();
}

boot().catch((e: Error) => showError(e.message));
