# Proxy de token do painel "Detalhar"

Entrega ao app o token OAuth2 da ICD-API da OMS sem expor as credenciais no navegador. Só
responde às origens de `ALLOWED_ORIGINS`, com limite de 30 pedidos por minuto por IP
(`wrangler.toml`).

A restrição por origem é CORS, não autenticação: fora do navegador qualquer um obtém um token
(só leitura da CID-11, válido por 1 hora). Em caso de abuso, revogar a chave na ICD-API e gerar
outra.

## Configurar

1. Na ICD-API (<https://icd.who.int/icdapi> → *Register*), gerar o Client Id e o Client Secret
   em *View API access key(s)*.
2. Criar uma conta na Cloudflare.

## Publicar

```sh
cd worker
pnpm install
pnpm wrangler login
pnpm wrangler secret put ICD_CLIENT_ID
pnpm wrangler secret put ICD_CLIENT_SECRET
pnpm run deploy
```

No app, `VITE_DETAIL_TOKEN_URL=<URL do deploy>/token` (no CI: variável `VITE_DETAIL_TOKEN_URL` do repositório, em *Settings → Secrets and variables → Actions → Variables*).

## Desenvolver

`worker/.dev.vars`:

```
ICD_CLIENT_ID=...
ICD_CLIENT_SECRET=...
```

Rodar `pnpm dev` em `worker/` (usa `[env.dev]`, que aceita `localhost`). Na raiz do app, criar
`.env.development.local` com `VITE_DETAIL_TOKEN_URL=http://localhost:8787/token` e rodar `pnpm dev`.
