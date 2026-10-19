/** Page wiring: license gate → download → search (code or name) → render. User-facing text in pt-BR. */

import Combobox from "@github/combobox-nav";
import { html, nothing, render, type TemplateResult } from "lit-html";

import type { BrCode, Bridge, Lookup, Target } from "../bridge";
import { isSimple, kind10, normalize10, parse11 } from "../bridge";
import {
  ChecksumMismatch, LicenseNotAccepted, acceptLicense, clearCache, isCached, licenseAccepted,
  loadBridge, type Status,
} from "../data/load";
import {
  CITATION, DEFAULT_RELEASE, LICENSE_URL, browserUrl, codingToolUrl, downloadSizeLabel,
} from "../data/sources";
import { mountGlossary, term, type TermId } from "./glossary";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const panels = {
  license: $<HTMLElement>("license"),
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

function showError(message: string): void {
  panels.error.textContent = message;
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

async function start(): Promise<void> {
  show("loading");
  try {
    bridge = await loadBridge(release, onStatus);
    show("search");
    input.focus();
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) query(fromHash);
  } catch (e) {
    show("license");
    if (e instanceof LicenseNotAccepted) return;
    if (e instanceof ChecksumMismatch) {
      showError(
        "O arquivo baixado da OMS não confere com a versão esperada (talvez a OMS o tenha atualizado). " +
          "Nada foi salvo. Detalhe técnico: " + e.message,
      );
    } else {
      showError(`Não foi possível carregar as tabelas. Verifique a conexão e tente de novo. Detalhe técnico: ${(e as Error).message}`);
    }
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

/** Run a lookup for a code and show it. */
function query(code: string): void {
  if (!bridge) return;
  input.value = code;
  hideSuggestions();
  showLookup(bridge.lookup(code));
}

function hideSuggestions(): void {
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
  const text = input.value.trim();
  if (!text || looksLikeCode(text)) {
    query(text);
    return;
  }
  suggest(text);
  combobox.navigate(1);
}

let suggestTimer: number | undefined;

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

const extLink = (href: string, text: string): TemplateResult =>
  html`<a href=${href} target="_blank" rel="noopener">${text}</a>`;

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

const ICON = { warn: "!", bad: "✕", ok: "✓" } as const;

const notice = (kind: keyof typeof ICON, body: unknown): TemplateResult => html`
  <div class="notice ${kind}"><span class="icon" aria-hidden="true">${ICON[kind]}</span><p>${body}</p></div>
`;

function targetCard(t: Target, b: Bridge): TemplateResult {
  const parsed = parse11(t.code);
  const composite = parsed && !isSimple(parsed) ? parsed : null;
  const part = (c: string): string => {
    const e = b.entityOf(c);
    return `${c} — ${e?.title ?? e?.titleEn ?? "sem título"}`;
  };
  const link = browserUrl(b.release, t.foundationUri);
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
            <ul class="parts">
              ${composite.stems.map((s) => html`<li>${part(s)}</li>`)}
              ${composite.extensions.map((x) => html`<li>${part(x)} (${term("extensao", "detalhe extra")})</li>`)}
            </ul>
          `
        : nothing}
      ${b.entityOf(t.code)?.isResidual
        ? notice("warn", html`<strong>${term("residual")}</strong> (“outros” ou “não especificado”). A CID-11 pode ter um código mais específico para o caso.`)
        : nothing}
      <p class="meta">
        ${link ? extLink(link, "Definição") : nothing}
        ${up ? html`<span>correspondência definida para um código mais geral (${up} ${up === 1 ? "nível" : "níveis"} acima)</span>` : nothing}
      </p>
    </article>
  `;
}

/** The notice for why the code maps the way it does, if any. */
function reasonNotice(lk: Lookup, codingTool: TemplateResult): TemplateResult | typeof nothing {
  const mapa = term("mapa", "mapa da OMS");
  switch (lk.reason) {
    case "empty":
      return notice("bad", "Digite um código ou um nome da CID-10.");
    case "unknown":
      return notice("bad", html`Código não encontrado na CID-10 brasileira nem no ${mapa}. Confira a digitação.`);
    case "no_br_path":
      return notice("bad", html`<strong>Sem correspondente no ${mapa}.</strong> Este código existe na CID-10 brasileira, mas nem ele nem a categoria dele constam no mapa. Codifique a partir do diagnóstico na ${codingTool}.`);
    case "no_mapping":
      return notice("bad", html`<strong>A OMS não indica um correspondente direto</strong> para este código. Codifique a partir do diagnóstico na ${codingTool}.`);
    case "parent_category":
      return notice("warn", html`O 4º caractere indica o <strong>${term("local", "local da ocorrência")}</strong> (residência, escola, rua etc.), que o mapa da OMS não cobre. O resultado abaixo é da categoria <code>${lk.effectiveCode}</code>; na CID-11, o local entra como ${term("extensao", "detalhe extra")}.`);
    case "mapped":
      return nothing;
  }
}

/** The notice for how many targets there are and how they relate, if any. */
function cardinalityNotice(lk: Lookup, main: Target[], alternatives: Target[], codingTool: TemplateResult): TemplateResult | typeof nothing {
  const first = main[0];
  if (first?.cardinality === "1:N") {
    return notice("warn", html`<strong>Há ${1 + alternatives.length} opções na CID-11.</strong> A primeira é a ${term("principal", "indicada pela OMS")}; as outras são ${term("alternativo", "alternativas")}. Escolha conforme o caso clínico.`);
  }
  if (first?.cardinality === "block") {
    return notice("warn", html`<strong>A OMS aponta para um ${term("bloco", "grupo")}</strong> da CID-11, não para um código. Escolha um código dentro do grupo na ${codingTool}.`);
  }
  if (first?.cardinality === "1:1" && lk.reason === "mapped" && first.relation === "Equivalent") {
    return notice("ok", html`<strong>${term("equivalente", "Correspondência direta")}</strong>: segundo a OMS, os dois códigos têm o mesmo significado.`);
  }
  return nothing;
}

function showLookup(lk: Lookup): void {
  const b = bridge!;
  panels.error.hidden = true;
  history.replaceState(null, "", lk.code ? `#${encodeURIComponent(lk.code)}` : location.pathname);

  const main = lk.targets.filter((t) => t.table === "one");
  const alternatives = lk.targets.filter((t) => t.table === "multiple");
  const toolUrl = codingToolUrl(b.release);
  const codingTool = extLink(toolUrl, "ferramenta de codificação da OMS");
  // A category result is generic; its subcategories often map to something more specific.
  const subs = lk.code && kind10(lk.code) === "category" ? b.subcategoriesBr(lk.code) : [];

  render(
    html`
      <h2 id="result-title" class="sr-only">${lk.code ? `Resultado para ${lk.code}` : "Resultado"}</h2>
      <div class="origin panel" tabindex="-1">
        <div>
          <span class="code">${lk.code || "—"}</span>
          ${lk.existsInBr && !lk.active2019 ? tag("fora-de-uso", "fora de uso no Brasil") : nothing}
          ${!lk.existsInBr && lk.code ? html`<span class="tag">não consta na CID-10 brasileira</span>` : nothing}
        </div>
        ${lk.brTitle ? html`<p class="title">${lk.brTitle}</p>` : nothing}
        ${reasonNotice(lk, codingTool)}
        ${cardinalityNotice(lk, main, alternatives, codingTool)}
      </div>
      ${main.map((t) => targetCard(t, b))}
      ${alternatives.length
        ? html`<div class="alternatives"><h3>Outras opções</h3>${alternatives.map((t) => targetCard(t, b))}</div>`
        : nothing}
      ${subs.length
        ? html`
            <div class="alternatives">
              <h3>Subcategorias de ${lk.code} na CID-10</h3>
              <div class="suggestions">${subs.map((s) => codeButton(s))}</div>
            </div>
          `
        : nothing}
      ${lk.code ? html`<p class="hint">${extLink(toolUrl, "Detalhar o código na ferramenta de codificação da OMS")}</p>` : nothing}
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
  $<HTMLElement>("download-size").textContent = downloadSizeLabel(release);
  $<HTMLElement>("citation").textContent = CITATION;
  $<HTMLElement>("release").textContent = release;
  mountGlossary($<HTMLElement>("glossary"));

  $<HTMLButtonElement>("license-accept").addEventListener("click", async () => {
    await acceptLicense();
    await start();
  });

  $<HTMLFormElement>("form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    submit();
  });
  input.addEventListener("input", onInput);
  // Escape closes the suggestions (Combobox only clears the highlighted one).
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideSuggestions();
  });
  for (const chip of document.querySelectorAll<HTMLButtonElement>(".chip")) {
    chip.addEventListener("click", () => query(chip.dataset["code"] ?? ""));
  }
  $<HTMLButtonElement>("clear-cache").addEventListener("click", async () => {
    await clearCache();
    location.hash = "";
    location.reload();
  });

  if ((await licenseAccepted()) || (await isCached(release))) await start();
  else show("license");
}

boot().catch((e: Error) => showError(e.message));
