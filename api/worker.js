/**
 * Imperial Barbearia — autenticação própria + JSON no GitHub.
 * Implantar como Cloudflare Worker; configurar SESSIONS (KV) e secrets.
 * Nunca coloque os secrets no repositório nem no JavaScript do navegador.
 */
const COOKIE = "imperial_session";
const DATA_PATH = "dados/imperial_barbearia_data.json";
const MAX_AGE = 60 * 60 * 12;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function cookie(value, age = MAX_AGE) {
  return COOKIE + "=" + value + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + age;
}
function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function sameOrigin(request, env) {
  return request.headers.get("Origin") === env.APP_ORIGIN;
}
async function getSession(request, env) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(/(?:^|; )imperial_session=([^;]+)/);
  if (!match) return null;
  const value = await env.SESSIONS.get(match[1], "json");
  if (!value || value.expires < Date.now()) {
    await env.SESSIONS.delete(match[1]);
    return null;
  }
  return { id: match[1], ...value };
}
async function github(path, env, options = {}) {
  return fetch("https://api.github.com/repos/" + env.GITHUB_REPO + "/contents/" + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Imperial-Barbearia",
      ...(options.headers || {})
    }
  });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/auth/login" && request.method === "POST") {
      if (!sameOrigin(request, env)) return json({ error: "Origem inválida." }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
      const username = String(body.username || "");
      const password = String(body.password || "");
      if (username !== env.ADMIN_USERNAME || password !== env.ADMIN_PASSWORD) {
        return json({ error: "Usuário ou senha incorretos." }, 401);
      }
      const id = randomId();
      await env.SESSIONS.put(id, JSON.stringify({ username, expires: Date.now() + MAX_AGE * 1000 }), { expirationTtl: MAX_AGE });
      return new Response(JSON.stringify({ ok: true, username }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "Set-Cookie": cookie(id) }
      });
    }
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (!sameOrigin(request, env)) return json({ error: "Origem inválida." }, 403);
      const s = await getSession(request, env);
      if (s) await env.SESSIONS.delete(s.id);
      return new Response(null, { status: 204, headers: { "Set-Cookie": cookie("", 0), "cache-control": "no-store" } });
    }
    if (url.pathname.startsWith("/api/")) {
      if (!sameOrigin(request, env)) return json({ error: "Origem inválida." }, 403);
      const s = await getSession(request, env);
      if (!s) return json({ error: "Faça login para continuar." }, 401);
      if (url.pathname === "/api/me" && request.method === "GET") return json({ username: s.username });
      if (url.pathname === "/api/data" && request.method === "GET") {
        const response = await github(DATA_PATH, env);
        if (response.status === 404) return json({ data: null, sha: null });
        if (!response.ok) return json({ error: "Falha ao ler os dados do GitHub." }, 502);
        const file = await response.json();
        const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), c => c.charCodeAt(0));
        return json({ data: JSON.parse(new TextDecoder().decode(bytes)), sha: file.sha });
      }
      if (url.pathname === "/api/data" && request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "JSON inválido." }, 400); }
        if (!body || typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) return json({ error: "Dados inválidos." }, 400);
        const current = await github(DATA_PATH, env);
        let sha;
        if (current.ok) sha = (await current.json()).sha;
        else if (current.status !== 404) return json({ error: "Falha ao consultar o arquivo no GitHub." }, 502);
        const bytes = new TextEncoder().encode(JSON.stringify(body.data, null, 2));
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const saved = await github(DATA_PATH, env, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Imperial: atualização de dados", content: btoa(binary), ...(sha ? { sha } : {}) })
        });
        if (!saved.ok) return json({ error: "Não foi possível salvar no GitHub.", conflict: saved.status === 409 || saved.status === 422 }, 502);
        const result = await saved.json();
        return json({ ok: true, sha: result.content.sha });
      }
      return json({ error: "Rota não encontrada." }, 404);
    }
    return json({ service: "Imperial Barbearia API", ok: true });
  }
};
