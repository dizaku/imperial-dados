# Login próprio e banco GitHub — Imperial Barbearia

## Decisão de arquitetura

O login usa usuário e senha próprios, sem conta GitHub para os funcionários. O conteúdo do sistema é gravado no repositório pelo GitHub Contents API. O token técnico do GitHub fica somente como secret no servidor, nunca no navegador ou no código versionado.

**Não é possível fazer isso com segurança usando apenas GitHub Pages/repositório.** GitHub Pages publica arquivos estáticos e não executa autenticação de servidor. Para proteger a senha e o token de escrita, é necessário um backend. Este projeto usa Cloudflare Worker + KV como camada mínima; o GitHub continua sendo o armazenamento dos dados e o histórico de versões.

## Configuração necessária

1. Torne o repositório privado antes de armazenar dados reais de clientes. Um login no site não esconde arquivos de um repositório público.
2. Crie um Cloudflare Worker e publique `api/worker.js`.
3. Crie um namespace KV e vincule-o ao Worker com o nome `SESSIONS`.
4. Configure os secrets/variáveis no painel do Worker:
   - `APP_ORIGIN`: origem exata do site publicado (ex.: `https://usuario.github.io`).
   - `ADMIN_USERNAME`: usuário de acesso da Imperial.
   - `ADMIN_PASSWORD`: senha forte de acesso da Imperial (guardar como secret, não no GitHub).
   - `GITHUB_REPO`: `dizaku/dizaku.github.imperial-dados.com`.
   - `GITHUB_TOKEN`: token técnico fine-grained, com acesso somente a Contents: Read and write neste repositório privado. Guardar somente como secret no Worker.
5. O endereço do Worker deverá ser configurado na interface do site quando ela for migrada para a API.

## API

- `POST /auth/login` com `{ "username": "...", "password": "..." }` cria sessão protegida por cookie HttpOnly.
- `POST /auth/logout` encerra a sessão.
- `GET /api/me` verifica o usuário autenticado.
- `GET /api/data` lê `dados/imperial_barbearia_data.json`.
- `PUT /api/data` grava o estado atualizado no GitHub e cria um commit.

As chamadas autenticadas devem usar `credentials: "include"`. A API valida a origem do site.

## Importante: ainda não ativado na interface

O arquivo `index.html` existente ainda usa localStorage e o mecanismo antigo de sincronização GitHub configurado pelo usuário no navegador. A API acima é uma base de servidor e não passa a proteger o site automaticamente. É necessário migrar a tela de login e as rotinas `loadState`/`saveState` para `/auth/login`, `/api/data` e `/auth/logout`, configurar e publicar o Worker e testar antes de usar com dados reais.

Não use pastas com nomes aleatórios como mecanismo de segurança: caminhos ocultos não substituem autenticação. Não grave senhas, tokens pessoais ou dados de clientes em repositório público.
