# Fontes

- `cid10_v2008*.csv`: Ministério da Saúde / DATASUS, CID-10 versão 2008, `http://www2.datasus.gov.br/cid10/V2008/downloads/CID10CSV.zip` (ISO-8859-1 convertido para UTF-8).
- `cid10_v2019.csv`: CC BR-FIC, `PREVISAO_TABELA_CID10.xlsx`, `http://plataforma.saude.gov.br/cc-br-fic/`.
- `cid10_v2019_alteracoes.csv`: CC BR-FIC, `CID10-v2019-lista-codigos.xlsx` (4 abas achatadas).

Checksums dos originais em `data/SHA256SUMS` no repositório. Gerado por `scripts/build_br.py`.
## Correções locais em `cid10_v2019.csv` (2026-10-19)

O CSV gerado veio com 44 títulos corrompidos: bytes Latin-1 lidos como GBK, e cada caractere
chinês escondia uma letra acentuada e a letra seguinte (ex.: `S韓drome`). Foram recuperados
de forma mecânica (cada caractere CJK recodificado em GBK e lido como cp1252), sem tocar no
resto do arquivo. São as linhas que tinham acento na fonte; as demais continuam sem acento,
como na fonte:

B33.4, B50.8, G90.4, G94.3, I27.2, K22.7, K85.0, K85.2, K85.9, M31.7, N18.2–N18.5, O94, P35.4,
P91.6, Q31.5, R29.6, S44.5, S57.8, U06.9, U80.8, U81.8, U83.1, U83.2, U89, U89.8, U89.9,
W46, W46.0–W46.9, X59.0, X59.9, Z58.7, Z92.6.

Correções manuais (não mecânicas):

- U83.1 "relacionados à vancomicina" e U83.2 "Resistencia às quinolonas": o "à" tinha passado
  por duas decodificações erradas.
- Z58.7: a fonte traz só "Exposição". Completado como "Exposição à fumaça do tabaco" (título
  da CID-10 para Z58.7, "Exposure to tobacco smoke"). **A confirmar com o DATASUS/CC BR-FIC.**

A corrupção já vem no arquivo oficial (`PREVISAO_TABELA_CID10.xlsx` da CC BR-FIC, conferido
em 2026-10-19), inclusive o Z58.7 truncado; não é erro de leitura.

**Pendência:** levar este reparo para o `scripts/build_br.py` do cid-ponte, como etapa explícita
sobre o original, e regenerar o CSV de lá. Quando isso for feito, estas correções locais deixam
de ser necessárias (o teste em `tests/br.test.ts` acusa se voltar a haver caracteres CJK).

Atribuição: Ministério da Saúde do Brasil (DATASUS; Centro Colaborador Brasileiro para a Família de Classificações Internacionais da OMS) e Organização Mundial da Saúde.
