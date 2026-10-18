/** Page wiring: license gate → download → search (code or name) → render. User-facing text in pt-BR. */

import type { Bridge, Lookup, Target } from "../bridge";
import { isSimple, kind10, normalize10, parse11 } from "../bridge";
import {
  ChecksumMismatch, LicenseNotAccepted, acceptLicense, clearCache, isCached, licenseAccepted,
  loadBridge, type Status,
} from "../data/load";
import {
  CITATION, DEFAULT_RELEASE, LICENSE_URL, browserUrl, codingToolUrl, downloadSizeLabel,
} from "../data/sources";

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

const PHASE_VERB = { cache: "Lendo", verify: "Verificando integridade de", parse: "Indexando" } as const;
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
  status.textContent = `${PHASE_VERB[s.phase]} ${s.file}…`;
  progress.removeAttribute("value");
}

async function start(): Promise<void> {
  show("loading");
  try {
    bridge = await loadBridge(release, onStatus);
    show("search");
    input().focus();
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) query(fromHash);
  } catch (e) {
    show("license");
    if (e instanceof LicenseNotAccepted) return;
    if (e instanceof ChecksumMismatch) {
      showError(
        "O arquivo baixado da OMS não bate com o hash esperado para esta release. " +
          "Pode ter sido atualizado pela OMS; nada foi guardado. Detalhe: " + e.message,
      );
    } else {
      showError(`Não foi possível carregar as tabelas: ${(e as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------- search: code or name

const input = (): HTMLInputElement => $<HTMLInputElement>("code");

/** "I219", "i21.9", "A00-A09", "IX" are codes; anything else is a name to search for. */
function looksLikeCode(text: string): boolean {
  const c = normalize10(text);
  return c !== null && kind10(c) !== "other";
}

/** Run a lookup for a code and show it. */
function query(code: string): void {
  if (!bridge) return;
  input().value = code;
  hideSuggestions();
  render(bridge.lookup(code));
}

function hideSuggestions(): void {
  const box = $<HTMLElement>("suggestions");
  box.hidden = true;
  box.replaceChildren();
  input().setAttribute("aria-expanded", "false");
}

/** Show CID-10 codes whose title matches the typed text. */
function suggest(text: string): void {
  if (!bridge) return;
  const box = $<HTMLElement>("suggestions");
  const status = $<HTMLElement>("search-status");
  const hits = bridge.searchBr(text);
  box.replaceChildren();
  if (hits.length === 0) {
    box.append(el("p", "empty", "Nenhum código da CID-10 brasileira com esse nome."));
    status.textContent = "Nenhum resultado.";
  } else {
    for (const h of hits) {
      const b = el("button", "suggestion");
      b.type = "button";
      b.setAttribute("role", "option");
      b.append(el("span", "code", h.code), el("span", undefined, h.title));
      if (!h.active) b.append(el("span", "inactive", "inativo"));
      b.addEventListener("click", () => query(h.code));
      box.append(b);
    }
    status.textContent = `${hits.length} ${hits.length === 1 ? "código encontrado" : "códigos encontrados"}. Use Tab ou as setas para escolher.`;
  }
  box.hidden = false;
  input().setAttribute("aria-expanded", "true");
}

/** Submit: a code goes straight to the result; a name opens (or keeps) the suggestions. */
function submit(): void {
  const text = input().value.trim();
  if (!text || looksLikeCode(text)) {
    query(text);
    return;
  }
  suggest(text);
  $<HTMLElement>("suggestions").querySelector<HTMLButtonElement>(".suggestion")?.focus();
}

let suggestTimer: number | undefined;

function onInput(): void {
  const text = input().value.trim();
  window.clearTimeout(suggestTimer);
  if (text.length < 3 || looksLikeCode(text)) {
    hideSuggestions();
    return;
  }
  suggestTimer = window.setTimeout(() => suggest(text), 150);
}

/** Arrow keys move between the field and the suggestions; Escape closes them. */
function onKeydown(ev: KeyboardEvent): void {
  const box = $<HTMLElement>("suggestions");
  if (box.hidden) return;
  const items = [...box.querySelectorAll<HTMLButtonElement>(".suggestion")];
  if (items.length === 0) return;
  const idx = items.findIndex((b) => b === document.activeElement);
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    items[Math.min(idx + 1, items.length - 1)]!.focus();
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    if (idx <= 0) input().focus();
    else items[idx - 1]!.focus();
  } else if (ev.key === "Escape") {
    hideSuggestions();
    input().focus();
  }
}

// ---------------------------------------------------------------- rendering

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function extLink(href: string, text: string): HTMLAnchorElement {
  const a = el("a", undefined, text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

function notice(kind: "warn" | "bad" | "ok", html: string): HTMLElement {
  const n = el("div", `notice ${kind}`);
  const icon = el("span", "icon", kind === "ok" ? "✓" : kind === "bad" ? "✕" : "!");
  icon.setAttribute("aria-hidden", "true");
  const p = el("p");
  p.innerHTML = html;
  n.append(icon, p);
  return n;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function renderTarget(t: Target, b: Bridge): HTMLElement {
  const card = el("article", "target");
  const head = el("div");
  const codeEl = el("span", "code", t.code ?? "(bloco sem código)");
  codeEl.setAttribute("aria-label", t.code ? `Código CID-11 ${t.code}` : "Bloco sem código");
  head.append(codeEl);
  if (t.relation) head.append(el("span", "tag", t.relation === "Equivalent" ? "equivalente" : "subclasse"));
  head.append(el("span", "tag", t.table === "one" ? "principal" : "alternativo"));
  card.append(head);

  if (t.titlePt) card.append(el("p", "title-pt", t.titlePt));
  if (t.titleEn) card.append(el("p", "title-en", t.titleEn));
  if (!t.titlePt && t.code) card.append(notice("warn", "Sem título em português na release oficial; título em inglês acima."));

  const parsed = parse11(t.code);
  if (parsed && !isSimple(parsed)) {
    const ul = el("ul", "parts");
    for (const s of parsed.stems) {
      const e = b.entityOf(s);
      ul.append(el("li", undefined, `${s} — ${e?.title ?? e?.titleEn ?? "tronco"}`));
    }
    for (const x of parsed.extensions) {
      const e = b.entityOf(x);
      ul.append(el("li", undefined, `${x} — ${e?.title ?? e?.titleEn ?? "código de extensão"} (extensão)`));
    }
    card.append(
      notice(
        "warn",
        parsed.stems.length > 1
          ? "Alvo em <strong>cluster</strong>: mais de um código-tronco ligado por “/”. Não cabe em campos de 4 caracteres do SUS."
          : "Alvo com <strong>extensão</strong> (“&amp;”): código-tronco mais código de extensão. Não cabe em campos de 4 caracteres do SUS.",
      ),
      ul,
    );
  }

  if (b.entityOf(t.code)?.isResidual) {
    card.append(notice("warn", "Categoria <strong>residual</strong> (outros/não especificado). Provavelmente há código mais específico."));
  }

  const meta = el("p", "meta");
  const link = browserUrl(b.release, t.foundationUri);
  if (link) meta.append(extLink(link, "ver no Browser da CID-11"));
  if (t.relationN !== null && t.relationN < 0) {
    meta.append(el("span", undefined, `relação herdada de ${-t.relationN} nível(is) acima`));
  }
  card.append(meta);
  return card;
}

function render(lk: Lookup): void {
  const b = bridge!;
  const out = panels.result;
  const heading = $<HTMLElement>("result-title");
  out.replaceChildren(heading);
  heading.textContent = lk.code ? `Resultado para ${lk.code}` : "Resultado";
  panels.error.hidden = true;
  history.replaceState(null, "", lk.code ? `#${encodeURIComponent(lk.code)}` : location.pathname);

  const origin = el("div", "origin panel");
  origin.tabIndex = -1;
  const h = el("div");
  h.append(el("span", "code", lk.code || "—"));
  if (lk.existsInBr && !lk.active2019) h.append(el("span", "tag", "inativo na v2019"));
  if (!lk.existsInBr && lk.code) h.append(el("span", "tag", "não consta na CID-10 brasileira"));
  origin.append(h);
  if (lk.brTitle) origin.append(el("p", "title", lk.brTitle));

  switch (lk.reason) {
    case "empty":
      origin.append(notice("bad", "Digite um código ou um nome da CID-10."));
      break;
    case "unknown":
      origin.append(notice("bad", "Código não encontrado no mapa da OMS nem na CID-10 brasileira. Confira a digitação."));
      break;
    case "no_br_path":
      origin.append(
        notice("bad", "<strong>Código nacional sem correspondente.</strong> Existe na CID-10 brasileira, mas nem ele nem a categoria aparecem no mapa da OMS. Codifique pelo diagnóstico no Coding Tool."),
      );
      break;
    case "no_mapping":
      origin.append(notice("bad", "<strong>A OMS declara “sem mapeamento”</strong> para este código. Codifique pelo diagnóstico no Coding Tool."));
      break;
    case "parent_category":
      origin.append(
        notice("warn", `O 4º caractere é <strong>local de ocorrência</strong>, que a CID-11 trata por extensão. Resultado da categoria <code>${esc(lk.effectiveCode ?? "")}</code>.`),
      );
      break;
    case "mapped":
      break;
  }

  const main = lk.targets.filter((t) => t.table === "one");
  const alternatives = lk.targets.filter((t) => t.table === "multiple");
  const card0 = main[0];
  if (card0?.cardinality === "1:N") {
    origin.append(
      notice("warn", `<strong>Mais de um código possível</strong> (${1 + alternatives.length} opções). O primeiro é o principal da OMS; a escolha depende do caso clínico.`),
    );
  } else if (card0?.cardinality === "block") {
    origin.append(notice("warn", "O alvo é um <strong>bloco</strong> (agrupamento) da CID-11, sem código próprio. Escolha uma categoria dentro dele."));
  } else if (card0?.cardinality === "1:1" && lk.reason === "mapped" && card0.relation === "Equivalent") {
    origin.append(notice("ok", "Correspondência <strong>equivalente</strong> declarada pela OMS."));
  }

  out.append(origin);
  for (const t of main) out.append(renderTarget(t, b));
  if (alternatives.length) {
    const sec = el("div", "alternatives");
    sec.append(el("h3", undefined, "Alternativas (tabela “múltiplas categorias”)"));
    for (const t of alternatives) sec.append(renderTarget(t, b));
    out.append(sec);
  }

  if (lk.code) {
    const ct = el("p", "hint");
    ct.append(extLink(codingToolUrl(b.release), "Refinar ou pós-coordenar no Coding Tool da OMS"));
    out.append(ct);
  }
  out.hidden = false;
  // Move focus to the result so keyboard and screen-reader users land on the answer.
  origin.focus();
}

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  $<HTMLAnchorElement>("license-link").href = LICENSE_URL;
  $<HTMLElement>("download-size").textContent = downloadSizeLabel(release);
  $<HTMLElement>("citation").textContent = CITATION;
  $<HTMLElement>("release").textContent = release;

  const check = $<HTMLInputElement>("license-check");
  const accept = $<HTMLButtonElement>("license-accept");
  check.addEventListener("change", () => {
    accept.disabled = !check.checked;
  });
  accept.addEventListener("click", async () => {
    await acceptLicense();
    await start();
  });

  $<HTMLFormElement>("form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    submit();
  });
  input().addEventListener("input", onInput);
  panels.search.addEventListener("keydown", onKeydown);
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
