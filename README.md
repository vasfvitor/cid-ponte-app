# cid-ponte-app

Do código CID-10 ao correspondente na CID-11, com título em português e avisos sobre o que o mapa
oficial da OMS não resolve: mais de um alvo, categoria residual, código nacional sem
correspondente, código composto (`/`, `&`).

Roda no navegador. As tabelas da OMS são baixadas na primeira visita, verificadas por SHA-256 e
guardadas em IndexedDB. O app precisa de conexão para abrir. Nada do que você digita sai da sua
máquina, exceto no painel "Detalhar aqui", que busca na API da OMS.

A lógica é uma porta do pacote Python [`cid-ponte`](https://github.com/vasfvitor/cid-ponte); os
testes garantem que as duas respondem igual.

## O que faz

- CID-10 → CID-11 pelas tabelas oficiais da OMS (`10To11MapToOneCategory`,
  `10To11MapToMultipleCategories`, relação Equivalent/Subclass da
  `foundation_10To11MapToOneCategory`).
- Títulos da release "pt" da CID-11.
- Busca da CID-10 brasileira por nome, sem acento e em qualquer ordem ("infarto agudo" → I21.x).
- Regras da CID-10 brasileira (CC BR-FIC v2019, embarcada): título do código de origem; subcategoria
  fora do mapa cai para a categoria de 3 caracteres (inclusive local de ocorrência, W00–Y34);
  códigos nacionais sem caminho na OMS (O93.x, U06, U92, I84 e outros).
- "Detalhar aqui": a ferramenta de codificação da OMS (Embedded Coding Tool) dentro da página,
  para acrescentar detalhes ao código (`/`, `&`) e copiar o resultado. Precisa do proxy de token
  em `worker/`; sem ele, fica só o link para o site da OMS.
- Links para a entidade no Browser da CID-11 e para a ferramenta de codificação da OMS.

## O que não faz

- Não cria mapeamentos próprios: só aplica o que a OMS publica.
- Não reproduz a seleção de causa básica da CID-11; para mortalidade o mapa é aproximação.
- Não pós-coordena por conta própria: os códigos compostos do mapa são mostrados inteiros e
  decompostos; acrescentar detalhes é com a ferramenta da OMS.
- Não substitui a codificação clínica.

## Desenvolvimento

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
LIVE=1 pnpm test                     # também testa contra a release real da OMS (baixa)
WHO_FILES_DIR=/caminho pnpm test     # idem, com mapping.zip e SimpleTabulation-…-pt.zip locais
```

| Caminho | Conteúdo |
|---|---|
| `src/bridge/` | A ponte, sem DOM: tabelas da OMS, códigos, regras BR, `Bridge.lookup()`. |
| `src/data/` | URLs e hashes por release, download, cache, unzip. |
| `src/ui/` | A página. |
| `public/data/cid10_v2019.csv` | CID-10 brasileira v2019, gerada em `cid-ponte` por `scripts/build_br.py`. |
| `tests/fixtures/` | Recortes das tabelas da OMS e o golden do pacote Python. |
| `worker/` | Proxy de token do "Detalhar aqui" (ver `worker/README.md`). |

Após mudar o Python, no `cid-ponte`:
`uv run scripts/make_golden.py ../cid-ponte-app/tests/fixtures/golden-2026-01.json`. Se as fixtures
mudarem (`scripts/make_fixtures.py`), copiar `fixtures/oms/2026-01/` para `tests/fixtures/oms/2026-01/`.

## Dados e licenças

- **Código:** MIT. O Embedded Coding Tool (`@whoicd/icd11ect`) é software da OMS, sob a licença
  dele (`license.pdf` no pacote), carregado só ao abrir o "Detalhar aqui".
- **Dados da OMS:** não estão no repositório; são baixados de `icdcdn.who.int` com SHA-256 fixado
  por release. O uso implica aceite dos [termos de uso](https://icd.who.int/docs/icd-api/license)
  (CC BY-ND 3.0 IGO), avisado na tela. *International Classification of Diseases, Eleventh
  Revision (ICD-11), World Health Organization (WHO) 2019. https://icd.who.int/browse11.* Os
  recortes em `tests/fixtures/oms/` são só para teste, © OMS.
- **CID-10 brasileira:** CC BR-FIC / Ministério da Saúde, v2019, redistribuída com atribuição. Ver
  `public/data/FONTES.md`.
- Campos acrescentados por este projeto (não vêm da OMS): `cardinality`, `normalization`, `reason`,
  `existsInBr`, `active2019`, `brTitle`.
- Projeto independente, sem vínculo com a OMS ou o Ministério da Saúde.
