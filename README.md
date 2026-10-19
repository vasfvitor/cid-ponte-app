# cid-ponte-app

Interface para quem conhece a CID-10 e precisa chegar à CID-11. Digite o código que você sempre usou, com ou sem ponto, e veja o correspondente na CID-11 com título em português, mais os avisos sobre o que o mapa oficial não resolve: mais de um alvo possível, categoria residual, código nacional sem correspondente, alvo em cluster ou com extensão.

Tudo roda no navegador. As tabelas de mapeamento e os títulos em português são baixados do servidor da OMS na primeira visita, verificados por SHA-256 e guardados em IndexedDB, para não serem baixados de novo nas próximas visitas (o app ainda precisa de conexão para abrir; não há modo offline). Nada do que você digita sai da sua máquina.

**Prova de conceito.** A lógica da ponte é uma porta do pacote Python [`cid-ponte`](https://github.com/vasfvitor/cid-ponte), onde a investigação, os números de cobertura e as regras brasileiras foram estabelecidos. Os testes garantem que o TypeScript responde exatamente igual ao Python sobre os mesmos recortes das tabelas.

## O que faz

- CID-10 → CID-11 pelas tabelas oficiais da OMS (`10To11MapToOneCategory` e `10To11MapToMultipleCategories`), com a relação Equivalent/Subclass da tabela `foundation_10To11MapToOneCategory`.
- Títulos em português da release oficial "pt" da CID-11.
- Busca da CID-10 brasileira **por nome**, sem acento e em qualquer ordem de palavras ("infarto agudo" → I21.x). O Coding Tool da OMS busca a CID-11 por texto; a CID-10 brasileira ninguém buscava.
- Regras da CID-10 brasileira (CC BR-FIC v2019, embarcada): título do código de origem; fallback para a categoria de 3 caracteres nos códigos de local de ocorrência (W00–Y34); lista dos códigos nacionais sem caminho na OMS (O93.x, U06, U92, I84 e outros).
- Link para a entidade no Browser da CID-11 e para o Coding Tool da OMS, para refinar ou pós-coordenar.

## O que não faz

- Não cria crosswalks próprios nem traduz nada: só aplica o que a OMS publica.
- Não reproduz a seleção de causa básica da CID-11 (DORIS). Para mortalidade o mapa é aproximação.
- Não resolve pós-coordenação. Alvos com `&` e `/` são mostrados inteiros e decompostos.
- Não substitui a codificação clínica. É ponto de partida e aprendizado durante a transição.

## Desenvolvimento

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # Vitest: contrato com o cid-ponte + unidades
pnpm build      # tsc --noEmit && vite build → dist/
LIVE=1 pnpm test                     # também baixa a release real da OMS e testa as tabelas completas
WHO_FILES_DIR=/caminho pnpm test     # idem, lendo mapping.zip e SimpleTabulation-…-pt.zip locais
```

Estrutura:

| Caminho | Conteúdo |
|---|---|
| `src/bridge/` | A ponte, sem DOM: parsing das tabelas da OMS, normalização de códigos, regras BR, `Bridge.lookup()`. |
| `src/data/` | URLs e hashes por release, download com verificação, cache em IndexedDB, unzip. |
| `src/ui/` | A página. |
| `public/data/cid10_v2019.csv` | CID-10 brasileira v2019 (CC BR-FIC), gerada em `cid-ponte` por `scripts/build_br.py`. |
| `tests/fixtures/` | Recortes das tabelas da OMS e o JSON golden gerado pelo pacote Python. |

Para regenerar o golden após mudar o Python: no repositório `cid-ponte`, rodar o gerador sobre `fixtures/oms` e gravar em `tests/fixtures/golden-2026-01.json` aqui.

## Dados e licenças

- **Código:** MIT.
- **Dados da OMS** (mapa 10↔11, títulos da CID-11): não estão neste repositório. São baixados em tempo de execução de `icdcdn.who.int`, com SHA-256 fixado por release, ao abrir o app; o uso implica aceite dos [termos de uso](https://icd.who.int/en/docs/icd11-license.pdf) (CC BY-ND 3.0 IGO), avisado na tela. Citação: *International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO) 2019. https://icd.who.int/browse11.* Os recortes em `tests/fixtures/oms/` são mínimos, só para teste, © OMS.
- **CID-10 brasileira:** Centro Colaborador Brasileiro para a Família de Classificações Internacionais da OMS (CC BR-FIC) / Ministério da Saúde, versão 2019, redistribuída com atribuição como dado público oficial. Ver `public/data/FONTES.md`.
- Campos que este projeto acrescenta e que **não** vêm da OMS: `cardinality`, `normalization`, `reason`, `existsInBr`, `active2019`, `brTitle`.
- Projeto independente, sem vínculo ou endosso da OMS ou do Ministério da Saúde.
