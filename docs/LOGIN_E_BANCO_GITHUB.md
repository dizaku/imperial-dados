# Login e armazenamento GitHub — Imperial Barbearia

Esta pasta prepara a camada entre a aplicação e o repositório. O GitHub continua sendo o armazenamento dos dados, no arquivo dados/imperial_barbearia_data.json, mas o navegador não recebe token de acesso ao GitHub.

## Como funciona

1. O usuário entra usando sua conta GitHub (OAuth).
2. O Worker valida o usuário contra a lista ALLOWED_GITHUB_USERS.
3. O token OAuth fica guardado no Cloudflare KV, associado a uma sessão em cookie HttpOnly, Secure e SameSite=Lax.
4. A API lê e grava o JSON no repositório configurado.
5. O histórico de alterações fica no histórico de commits do GitHub.

**Importante:** para dados de clientes, configure o repositório como privado. Se o repositório for público, o conteúdo salvo nele continuará público, mesmo com login na aplicação. O login não torna privado um repositório público.

## Implantação (necessária antes de ativar o login)

1. Crie um OAuth App em GitHub → Settings → Developer settings → OAuth Apps.
   - Homepage URL: endereço publicado da aplicação.
   - Authorization callback URL: https://SEU-WORKER.workers.dev/auth/callback (ou domínio próprio do Worker).
2. Crie um Worker na Cloudflare e associe um namespace KV chamado SESSIONS.
3. Publique api/worker.js como código do Worker.
4. Configure os bindings/variáveis:
   - KV binding: SESSIONS
   - GITHUB_CLIENT_ID: Client ID do OAuth App
   - Secret GITHUB_CLIENT_SECRET: Client Secret do OAuth App
   - GITHUB_REPO: proprietario/repositorio (recomendado: repositório privado)
   - ALLOWED_GITHUB_USERS: logins GitHub autorizados, separados por vírgula
   - APP_ORIGIN: origem exata do site, por exemplo https://SEU-USUARIO.github.io
5. No OAuth App, mantenha o callback exatamente igual ao configurado acima.

## Endpoints

- GET /auth/login: inicia o login GitHub.
- GET /auth/callback: recebe o retorno OAuth e cria a sessão.
- GET /api/me: informa o usuário autenticado.
- GET /api/data: lê o JSON de dados.
- PUT /api/data: grava o JSON de dados.
- POST /auth/logout: encerra a sessão.

As chamadas /api/* devem ser feitas pelo mesmo site, com cookies incluídos (credentials: include). O Worker rejeita chamadas de outras origens.

## Estado desta entrega

Esta é a camada de servidor preparada, ainda não ativada na interface. A aplicação atual (index.html) continua usando o fluxo antigo de sincronização GitHub/localStorage até que a interface seja migrada para os endpoints acima e o Worker seja implantado com as credenciais e permissões necessárias. Não informe aos usuários que o login está ativo antes dessas etapas e dos testes.

Nunca coloque GITHUB_CLIENT_SECRET, tokens pessoais ou tokens OAuth no repositório.
