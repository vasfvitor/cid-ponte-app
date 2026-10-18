/** Page wiring: license gate → download → search → render. All user-facing text in pt-BR. */

import type { Bridge, Lookup, Target } from "../bridge";
import { parse11 } from "../bridge";
import {
  ChecksumMismatch, LicenseNotAccepted, acceptLicense, clearCache, isCached, licenseAccepted,
  loadBridge, type Status,
} from "../data/load";
import {
  APPROX_DOWNLOAD_MB, CITATION, DEFAULT_RELEASE, LICENSE_URL, browserUrl, codingToolUrl,
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

function onStatus(s: Status): void {
  const status = $<HTMLElement>("status");
  const progress = $<HTMLProgressElement>("progress");
  switch (s.phase) {
    case "cache":
      status.textContent = `Lendo ${s.file} do cache…`;
      progress.removeAttribute("value");
      break;
    case "download": {
      const mb = (s.received / 1_048_576).toFixed(1);
      if (s.total) {
        progress.value = (100 * s.received) / s.total;
        status.textContent = `Baixando ${s.file}: ${mb} de ${(s.total / 1_048_576).toFixed(1)} MB`;
      } else {
        progress.removeAttribute("value");
        status.textContent = `Baixando ${s.file}: ${mb} MB`;
      }
      break;
    }
    case "verify":
      status.textContent = `Verificando integridade de ${s.file}…`;
      progress.removeAttribute("value");
      break;
    case "parse":
      status.textContent = `Indexando ${s.file}…`;
      progress.removeAttribute("value");
      break;
    case "ready":
      status.textContent = "Pronto.";
      progress.value = 100;
      break;
  }
}

async function start(): Promise<void> {
  show("loading");
  try {
    bridge = await loadBridge(release, onStatus);
    show("search");
    $<HTMLInputElement>("code").focus();
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) {
      $<HTMLInputElement>("code").value = fromHash;
      render(bridge.lookup(fromHash));
    }
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

// ---------------------------------------------------------------- rendering

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notice(kind: "warn" | "bad" | "ok", html: string): HTMLElement {
  const n = el("div", `notice${kind === "warn" ? "" : ` ${kind}`}`);
  const p = el("p");
  p.innerHTML = html;
  n.append(p);
  return n;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function renderTarget(t: Target, b: Bridge): HTMLElement {
  const card = el("article", "target");
  const head = el("div");
  head.append(el("span", "code", t.code ?? "(bloco sem código)"));
  if (t.relation) head.append(" ", el("span", "tag", t.relation === "Equivalent" ? "equivalente" : "subclasse"));
  head.append(" ", el("span", "tag", t.table === "one" ? "principal" : "alternativo"));
  card.append(head);

  const pt = t.titlePt;
  if (pt) card.append(el("p", "title-pt", pt));
  if (t.titleEn) card.append(el("p", "title-en", t.titleEn));
  if (!pt && t.code) card.append(notice("warn", "Sem título em português na release oficial; título em inglês acima."));

  const parsed = parse11(t.code);
  if (parsed && (parsed.stems.length > 1 || parsed.extensions.length > 0)) {
    const ul = el("ul", "parts");
    for (const s of parsed.stems) {
      const e = b.entity(s);
      ul.append(el("li", undefined, `${s} — ${e?.title ?? e?.titleEn ?? "tronco"}`));
    }
    for (const x of parsed.extensions) {
      const e = b.entity(x);
      ul.append(el("li", undefined, `${x} — ${e?.title ?? e?.titleEn ?? "código de extensão"} (extensão)`));
    }
    card.append(
      notice(
        "warn",
        parsed.stems.length > 1
          ? "Alvo em <strong>cluster</strong>: mais de um código-tronco ligado por “/”. Campos de 4 caracteres herdados do SUS não comportam este formato."
          : "Alvo com <strong>extensão</strong> (“&amp;”): código-tronco mais código de extensão. Campos de 4 caracteres herdados do SUS não comportam este formato.",
      ),
      ul,
    );
  }

  const entity = t.code ? b.entity(parsed?.stems[0] ?? t.code) : undefined;
  if (entity?.isResidual) {
    card.append(
      notice("warn", "Categoria <strong>residual</strong> (“outros especificados” ou “não especificado”). A CID-11 provavelmente tem um código mais específico para o caso; vale refinar."),
    );
  }

  const meta = el("p", "meta");
  const link = browserUrl(b.release, t.foundationUri);
  if (link) {
    const a = el("a", undefined, "ver no Browser da CID-11");
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener";
    meta.append(a);
  }
  if (t.relationN !== null && t.relationN < 0) {
    meta.append(el("span", undefined, `relação herdada de ${-t.relationN} nível(is) acima`));
  }
  card.append(meta);
  return card;
}

function render(lk: Lookup): void {
  const b = bridge!;
  const out = panels.result;
  out.replaceChildren();
  panels.error.hidden = true;
  history.replaceState(null, "", lk.code ? `#${encodeURIComponent(lk.code)}` : location.pathname);

  const origin = el("div", "origin panel");
  const h = el("div");
  h.append(el("span", "code", lk.code || "—"));
  if (lk.existsInBr && !lk.active2019) h.append(" ", el("span", "tag", "inativo na v2019"));
  if (!lk.existsInBr && lk.code) h.append(" ", el("span", "tag", "não consta na CID-10 brasileira"));
  origin.append(h);
  if (lk.brTitle) origin.append(el("p", "title", lk.brTitle));

  switch (lk.reason) {
    case "empty":
      origin.append(notice("bad", "Digite um código CID-10."));
      break;
    case "unknown":
      origin.append(notice("bad", "Código não encontrado no mapa da OMS nem na CID-10 brasileira. Confira a digitação."));
      break;
    case "no_br_path":
      origin.append(
        notice("bad", "<strong>Código nacional sem correspondente.</strong> Este código existe na CID-10 brasileira mas não aparece no mapa da OMS, nem a sua categoria. Não há conversão automática; consulte a orientação do Ministério da Saúde ou use o Coding Tool para codificar pelo diagnóstico."),
      );
      break;
    case "no_mapping":
      origin.append(notice("bad", "<strong>A OMS declara “sem mapeamento”</strong> para este código. Codifique pelo diagnóstico no Coding Tool."));
      break;
    case "parent_category":
      origin.append(
        notice("warn", `O 4º caractere indica <strong>local de ocorrência</strong>, que a CID-11 trata por extensão. A OMS mapeia a categoria <code>${esc(lk.effectiveCode ?? "")}</code>; o resultado abaixo é dela.`),
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
      notice("warn", `<strong>Mais de um código possível</strong> (${1 + alternatives.length} opções). O primeiro é o que a OMS indica como principal; os demais são alternativas da tabela “múltiplas categorias”. A escolha depende do caso clínico.`),
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
    const a = el("a", undefined, "Refinar ou pós-coordenar no Coding Tool da OMS");
    a.href = codingToolUrl(b.release);
    a.target = "_blank";
    a.rel = "noopener";
    ct.append(a);
    out.append(ct);
  }
  out.hidden = false;
}

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  $<HTMLAnchorElement>("license-link").href = LICENSE_URL;
  $<HTMLElement>("download-size").textContent = String(APPROX_DOWNLOAD_MB);
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
    if (bridge) render(bridge.lookup($<HTMLInputElement>("code").value));
  });
  for (const chip of document.querySelectorAll<HTMLButtonElement>(".chip")) {
    chip.addEventListener("click", () => {
      const code = chip.dataset["code"] ?? "";
      $<HTMLInputElement>("code").value = code;
      if (bridge) render(bridge.lookup(code));
    });
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
