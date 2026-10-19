/**
 * Glossary: plain-language definitions of the ICD-11 terms the page uses. One source for both
 * the popover a term opens and the full list in the footer.
 */

import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { html, nothing, render, type TemplateResult } from "lit-html";

interface Entry {
  label: string;
  /** Official term, when the plain label differs from it. */
  official?: string;
  text: TemplateResult;
}

export const GLOSSARY = {
  equivalente: {
    label: "Equivalente",
    official: "Equivalent",
    text: html`Segundo a OMS, o código da CID-11 tem o mesmo significado que o da CID-10.`,
  },
  "mais-ampla": {
    label: "CID-11 mais ampla",
    official: "Subclass",
    text: html`O código da CID-11 abrange o da CID-10 e pode incluir outros casos. Para ficar tão específico quanto o original, às vezes é preciso acrescentar detalhes.`,
  },
  principal: {
    label: "Principal",
    text: html`A correspondência que a OMS indica como primeira escolha.`,
  },
  alternativo: {
    label: "Alternativo",
    official: "tabela de múltiplas categorias",
    text: html`Outra correspondência possível, para quando o código da CID-10 cobre situações que na CID-11 ficam em códigos diferentes.`,
  },
  "fora-de-uso": {
    label: "Fora de uso",
    text: html`O código consta na CID-10 brasileira, mas não está ativo na versão 2019. Pode aparecer em bases de dados antigas.`,
  },
  cluster: {
    label: "Código composto",
    official: "cluster",
    text: html`Dois ou mais códigos da CID-11 unidos por “/”, que juntos descrevem o caso. Ex.: <code>1C41/1G40</code> = infecção bacteriana + sepse. Não cabe nos campos de 4 caracteres usados hoje nos sistemas do SUS.`,
  },
  extensao: {
    label: "Detalhe extra",
    official: "código de extensão",
    text: html`Código que começa com X e entra depois de um “&amp;” para informar algo a mais, como agente, local, gravidade ou lado do corpo. Nunca é usado sozinho. Ex.: <code>&amp;XN1P6</code> = <em>Haemophilus influenzae</em>.`,
  },
  "pos-coordenacao": {
    label: "Pós-coordenação",
    text: html`Combinar códigos da CID-11 com “/” ou “&amp;” para descrever o caso com mais detalhe do que um código sozinho permite.`,
  },
  residual: {
    label: "Código genérico",
    official: "categoria residual",
    text: html`Códigos “outros especificados” (terminam em Y) ou “não especificado” (terminam em Z). Servem para quando falta informação para um código mais preciso.`,
  },
  bloco: {
    label: "Grupo",
    official: "bloco",
    text: html`Um agrupamento de códigos da CID-11 que não pode ser usado como código. É preciso escolher um código dentro dele.`,
  },
  mapa: {
    label: "Mapa da OMS",
    text: html`As tabelas oficiais da OMS que ligam cada código da CID-10 a um código da CID-11. Não incluem os códigos criados só no Brasil.`,
  },
  local: {
    label: "Local da ocorrência",
    official: "4º caractere",
    text: html`Nas causas externas (W00–Y34), o 4º caractere indica onde aconteceu (0 = residência, 2 = escola, 4 = rua e estrada…). O mapa da OMS só cobre a categoria de 3 caracteres; na CID-11, o local entra como detalhe extra.`,
  },
  "causa-basica": {
    label: "Causa básica de óbito",
    text: html`A doença ou lesão que iniciou a cadeia de eventos que levou à morte. É escolhida por regras da OMS a partir da declaração de óbito inteira, por isso não basta converter um código isolado.`,
  },
  "coding-tool": {
    label: "Ferramenta de codificação da OMS",
    official: "Coding Tool",
    text: html`Ferramenta oficial e gratuita da OMS para buscar e montar códigos da CID-11 a partir do texto do diagnóstico. Ela monta sozinha os códigos compostos e os detalhes extras.`,
  },
  versao: {
    label: "Versão da CID-11",
    official: "release",
    text: html`A OMS publica uma versão atualizada por ano, por exemplo 2026-01. Este app usa uma versão fixa.`,
  },
} as const satisfies Record<string, Entry>;

export type TermId = keyof typeof GLOSSARY;

const popId = (id: TermId): string => `term-${id}`;
const entryId = (id: TermId): string => `g-${id}`;

/** A term that opens its definition. `label` defaults to the glossary label. */
export const term = (id: TermId, label: string = GLOSSARY[id].label, cls = "term"): TemplateResult =>
  html`<button type="button" class=${cls} data-term=${id} popovertarget=${popId(id)}>${label}</button>`;

function heading(id: TermId): TemplateResult {
  const g: Entry = GLOSSARY[id];
  return html`<strong>${g.label}</strong>${g.official ? html`<span class="official"> (${g.official})</span>` : nothing}`;
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

/** Keep `pop` below `anchor` (above when there is no room), inside the viewport. Returns the stop function. */
function follow(pop: HTMLElement, anchor: Element): () => void {
  return autoUpdate(anchor, pop, () => {
    void computePosition(anchor, pop, {
      strategy: "fixed",
      placement: "bottom-start",
      middleware: [offset(8), flip(), shift({ padding: 16 })],
    }).then(({ x, y }) => {
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
    });
  });
}

/**
 * Builds one popover per term and the footer list (`list`, a <dl> inside a <details>).
 * Terms are buttons with `popovertarget`, so the browser handles open/close, Esc and outside
 * clicks; Floating UI keeps the popover next to the term that opened it.
 */
export function mountGlossary(list: HTMLElement): void {
  const supported = "showPopover" in HTMLElement.prototype;
  let anchor: Element | null = null;
  const ids = Object.keys(GLOSSARY) as TermId[];

  render(
    ids.map((id) => html`<dt id=${entryId(id)} tabindex="-1">${heading(id)}</dt><dd>${GLOSSARY[id].text}</dd>`),
    list,
  );

  if (supported) {
    const popover = (id: TermId): TemplateResult => {
      let stop: (() => void) | undefined;
      // Start before it shows: autoUpdate re-measures once it has a size, before the first paint.
      const onBeforeToggle = (ev: ToggleEvent): void => {
        stop?.();
        stop = ev.newState === "open" && anchor ? follow(ev.target as HTMLElement, anchor) : undefined;
      };
      const onMore = (ev: Event): void => {
        ev.preventDefault();
        (ev.currentTarget as HTMLElement).closest<HTMLElement>(".term-pop")!.hidePopover();
        showEntry(id);
      };
      return html`
        <div id=${popId(id)} class="term-pop" popover="auto" @beforetoggle=${onBeforeToggle}>
          <p>${heading(id)}</p>
          <p>${GLOSSARY[id].text}</p>
          <a href="#${entryId(id)}" @click=${onMore}>Ver no glossário</a>
        </div>
      `;
    };
    render(ids.map(popover), document.body.appendChild(document.createElement("div")));
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
}
