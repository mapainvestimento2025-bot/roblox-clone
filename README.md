# Roblox Clone — Deploy na Vercel + Neon

## Passo a passo completo

### 1. Suba o projeto no GitHub

1. Crie um repositório no github.com (pode ser privado)
2. Faça upload de todos esses arquivos para o repositório

### 2. Crie o banco de dados no Neon

1. Acesse **neon.tech** e crie uma conta gratuita
2. Clique em **"New Project"**
3. Dê um nome (ex: `roblox-clone`) e clique em **Create**
4. Na tela do projeto, clique em **"Connection string"**
5. Copie a string que começa com `postgres://...`
   - Ela parece com isso: `postgres://user:senha@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

### 3. Faça o deploy na Vercel

1. Acesse **vercel.com** e faça login com GitHub
2. Clique em **"Add New Project"**
3. Importe o repositório que você criou no passo 1
4. **ANTES de clicar em Deploy**, expanda a seção **"Environment Variables"**
5. Adicione a variável:
   - **Nome:** `BRPLAYBOX`
   - **Valor:** a connection string do Neon que você copiou
6. Clique em **Deploy**

### 4. Pronto!

O banco de dados é criado automaticamente na primeira requisição.
O primeiro usuário a se registrar vira automaticamente o **admin/owner** do site.

---

## Estrutura do projeto

```
roblox-vercel/
├── api/                    ← API em Node.js (Vercel Functions)
│   ├── _db.js              ← Conexão com Neon + criação das tabelas
│   ├── db.js               ← GET /api/db  (snapshot do banco)
│   ├── register.js         ← POST /api/register
│   ├── login.js            ← POST /api/login
│   ├── bio.js              ← POST /api/bio
│   ├── avatar.js           ← POST /api/avatar
│   ├── friend.js           ← POST /api/friend
│   ├── game.js             ← POST /api/game
│   ├── game/
│   │   ├── delete.js       ← POST /api/game/delete
│   │   ├── visit.js        ← POST /api/game/visit
│   │   └── vote.js         ← POST /api/game/vote
│   ├── chat.js             ← GET/POST /api/chat
│   ├── dm.js               ← GET/POST /api/dm
│   ├── dm/
│   │   └── summary.js      ← GET /api/dm/summary
│   ├── ban/
│   │   └── check.js        ← POST /api/ban/check
│   ├── presence.js         ← GET /api/presence
│   ├── presence/
│   │   ├── beat.js         ← POST /api/presence/beat
│   │   └── leave.js        ← POST /api/presence/leave
│   ├── ping.js             ← POST /api/ping
│   ├── status.js           ← GET /api/status
│   ├── join.js             ← POST /api/join
│   └── import.js           ← POST /api/import
├── public/                 ← Arquivos HTML, CSS, JS do site
├── package.json
├── vercel.json
└── .env.example
```
