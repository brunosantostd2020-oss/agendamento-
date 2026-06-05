# Segurança — AgendaOK

## ⚠️ NUNCA suba para o GitHub

- `.env` — contém suas senhas e chaves
- `node_modules/` — dependências (muito pesado, desnecessário)
- Qualquer arquivo com senhas reais

## ✅ O que vai para o GitHub

Apenas o código-fonte. Sem senhas, sem chaves, sem dados.

## 🔑 Variáveis obrigatórias no Railway

Configure no painel do Railway em **Variables**:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | URL do PostgreSQL (Railway gera automaticamente) |
| `SESSION_SECRET` | String aleatória longa (mín. 32 caracteres) |
| `MASTER_USER` | Seu usuário de acesso master |
| `MASTER_SENHA` | Sua senha de acesso master |
| `NODE_ENV` | `production` |
| `BASE_URL` | URL do seu site (ex: https://agendaok.railway.app) |

## 🔐 Gerar SESSION_SECRET seguro

No terminal:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cole o resultado no Railway em SESSION_SECRET.

## 🚫 Se acidentalmente subiu credenciais

1. **Troque as senhas imediatamente** no Railway
2. Vá em GitHub → Settings → Secrets and alerts → Secret scanning
3. Revogue qualquer token ou chave exposta
4. Force um novo push que sobrescreva o histórico:
   ```
   git filter-branch --force --index-filter \
   'git rm --cached --ignore-unmatch .env' \
   --prune-empty --tag-name-filter cat -- --all
   git push origin --force --all
   ```
