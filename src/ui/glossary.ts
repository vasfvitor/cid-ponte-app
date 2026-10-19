/**
 * Glossary: plain-language definitions of the ICD-11 terms the page uses. One source for both
 * the popover a term opens and the full list in the footer. Texts are ours (trusted HTML).
 */

interface Entry {
  label: string;
  /** Official term, when the plain label differs from it. */
  official?: string;
  text: string;
}

export const GLOSSARY = {
  equivalente: {
    label: "Equivalente",
    official: "Equivalent",
    text: "Segundo a OMS, o código da CID-11 tem o mesmo significado que o da CID-10.",
  },
  "mais-ampla": {
    label: "CID-11 mais ampla",
    official: "Subclass",
    text: "O código da CID-11 abrange o da CID-10 e pode incluir outros casos. Para ficar tão específico quanto o original, às vezes é preciso acrescentar detalhes.",
  },
  principal: {
    label: "Principal",
    text: "A correspondência que a OMS indica como primeira escolha.",
  },
  alternativo: {
    label: "Alternativo",
    official: "tabela de múltiplas categorias",
    text: "Outra correspondência possível, para quando o código da CID-10 cobre situações que na CID-11 ficam em códigos diferentes.",
  },
  "fora-de-uso": {
    label: "Fora de uso",
    text: "O código consta na CID-10 brasileira, mas não está ativo na versão 2019. Pode aparecer em bases de dados antigas.",
  },
  cluster: {
    label: "Código composto",
    official: "cluster",
    text: "Dois ou mais códigos da CID-11 unidos por “/”, que juntos descrevem o caso. Ex.: <code>1C41/1G40</code> = infecção bacteriana + sepse. Não cabe nos campos de 4 caracteres usados hoje nos sistemas do SUS.",
  },
  extensao: {
    label: "Detalhe extra",
    official: "código de extensão",
    text: "Código que começa com X e entra depois de um “&amp;” para informar algo a mais, como agente, local, gravidade ou lado do corpo. Nunca é usado sozinho. Ex.: <code>&amp;XN1P6</code> = <em>Haemophilus influenzae</em>.",
  },
  "pos-coordenacao": {
    label: "Pós-coordenação",
    text: "Combinar códigos da CID-11 com “/” ou “&amp;” para descrever o caso com mais detalhe do que um código sozinho permite.",
  },
  residual: {
    label: "Código genérico",
    official: "categoria residual",
    text: "Códigos “outros especificados” (terminam em Y) ou “não especificado” (terminam em Z). Servem para quando falta informação para um código mais preciso.",
  },
  bloco: {
    label: "Grupo",
    official: "bloco",
    text: "Um agrupamento de códigos da CID-11 que não pode ser usado como código. É preciso escolher um código dentro dele.",
  },
  mapa: {
    label: "Mapa da OMS",
    text: "As tabelas oficiais da OMS que ligam cada código da CID-10 a um código da CID-11. Não incluem os códigos criados só no Brasil.",
  },
  local: {
    label: "Local da ocorrência",
    official: "4º caractere",
    text: "Nas causas externas (W00–Y34), o 4º caractere indica onde aconteceu (0 = residência, 2 = escola, 4 = rua e estrada…). O mapa da OMS só cobre a categoria de 3 caracteres; na CID-11, o local entra como detalhe extra.",
  },
  "causa-basica": {
    label: "Causa básica de óbito",
    text: "A doença ou lesão que iniciou a cadeia de eventos que levou à morte. É escolhida por regras da OMS a partir da declaração de óbito inteira, por isso não basta converter um código isolado.",
  },
  "coding-tool": {
    label: "Ferramenta de codificação da OMS",
    official: "Coding Tool",
    text: "Ferramenta oficial e gratuita da OMS para buscar e montar códigos da CID-11 a partir do texto do diagnóstico. Ela monta sozinha os códigos compostos e os detalhes extras.",
  },
  versao: {
    label: "Versão da CID-11",
    official: "release",
    text: "A OMS publica uma versão atualizada por ano, por exemplo 2026-01. Este app usa uma versão fixa.",
  },
} as const satisfies Record<string, Entry>;

export type TermId = keyof typeof GLOSSARY;

const popId = (id: TermId): string => `term-${id}`;
const entryId = (id: TermId): string => `g-${id}`;

/** A term that opens its definition. `label` defaults to the glossary label. */
export function termEl(id: TermId, label: string = GLOSSARY[id].label, cls = "term"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.dataset["term"] = id;
  b.setAttribute("popovertarget", popId(id));
  b.textContent = label;
  return b;
}

/** `termEl` as HTML, for notices built from strings. */
export function term(id: TermId, label?: string): string {
  return termEl(id, label).outerHTML;
}

function heading(id: TermId, tag: "p" | "dt"): HTMLElement {
  const g: Entry = GLOSSARY[id];
  const node = document.createElement(tag);
  const strong = document.createElement("strong");
  strong.textContent = g.label;
  node.append(strong);
  if (g.official) {
    const off = document.createElement("span");
    off.className = "official";
    off.textContent = ` (${g.official})`;
    node.append(off);
  }
  return node;
}

/** Open the footer glossary at an entry. Not via the URL hash: the hash holds the looked-up code. */
function showEntry(id: TermId): void {
  const dt = document.getElementById(entryId(id));
  const details = dt?.closest("details");
  if (!dt || !details) return;
  details.open = true;
  dt.scrollIntoView({ block: "center" });
  dt.focus({ preventScroll: true });
}

const GAP = 8;
const EDGE = 16;

/** Below the term (above when there is no room), clamped to the viewport. */
function place(pop: HTMLElement, anchor: Element): void {
  const r = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 2 * EDGE);
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.min(Math.max(EDGE, r.left), window.innerWidth - EDGE - width)}px`;
  const h = pop.offsetHeight;
  const above = r.top - GAP - h;
  const fitsBelow = r.bottom + GAP + h <= window.innerHeight - GAP;
  pop.style.top = `${!fitsBelow && above >= GAP ? above : r.bottom + GAP}px`;
}

/**
 * Builds one popover per term and the footer list (`list`, a <dl> inside a <details>).
 * Terms are buttons with `popovertarget`, so the browser handles open/close, Esc and outside
 * clicks; this only positions the popover next to the term that opened it.
 */
export function mountGlossary(list: HTMLElement): void {
  const supported = "showPopover" in HTMLElement.prototype;
  let anchor: Element | null = null;
  let open: HTMLElement | null = null;

  for (const id of Object.keys(GLOSSARY) as TermId[]) {
    const dt = heading(id, "dt");
    dt.id = entryId(id);
    dt.tabIndex = -1;
    const dd = document.createElement("dd");
    dd.innerHTML = GLOSSARY[id].text;
    list.append(dt, dd);

    if (!supported) continue;
    const pop = document.createElement("div");
    pop.id = popId(id);
    pop.className = "term-pop";
    pop.popover = "auto";
    const text = document.createElement("p");
    text.innerHTML = GLOSSARY[id].text;
    const more = document.createElement("a");
    more.href = `#${entryId(id)}`;
    more.textContent = "Ver no glossário";
    more.addEventListener("click", (ev) => {
      ev.preventDefault();
      pop.hidePopover();
      showEntry(id);
    });
    pop.append(heading(id, "p"), text, more);
    // Place before it shows (no flash at the default centre), then again once it has a height.
    pop.addEventListener("beforetoggle", (ev) => {
      if (ev.newState === "open" && anchor) place(pop, anchor);
    });
    pop.addEventListener("toggle", () => {
      open = pop.matches(":popover-open") ? pop : null;
      if (open && anchor) place(open, anchor);
    });
    document.body.append(pop);
  }

  // Capture runs before the button's popover activation, so `anchor` is set when it opens.
  document.addEventListener(
    "click",
    (ev) => {
      const t = (ev.target as Element | null)?.closest<HTMLElement>(".term");
      if (!t) return;
      anchor = t;
      if (!supported) showEntry(t.dataset["term"] as TermId);
    },
    true,
  );
  const follow = (): void => {
    if (open && anchor) place(open, anchor);
  };
  window.addEventListener("scroll", follow, { passive: true });
  window.addEventListener("resize", follow);
}
