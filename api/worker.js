/**
 * Imperial Barbearia — API de autenticação e armazenamento no GitHub.
 * Cloudflare Worker + KV. Segredos nunca ficam no navegador.
 */
const COOKIE = "imperial_session";
const DATA_PATH = "dados/imperial_barbearia_data.json";
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function cookie(value, maxAge = 604800) { return COOKIE + "=" + value + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAge; }
function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function sameOrigin(request, env) { return request.headers.get("Origin") === env.APP_ORIGIN; }
async function session(request, env) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(/(?:^|; )imperial_session=([^;]+)/);
  if (!match) return null;
  const value = await env.SESSIONS.get(match[1], "json");
  if (!value || value.expires < Date.now()) { await env.SESSIONS.delete(match[1]); return null; }
  return { id: match[1], ...value };
}
async function github(env, token, path, options = {}) {
  return fetch("https://api.github.com/repos/" + env.GITHUB_REPO + "/contents/" + path, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Imperial-Barbearia", ...(options.headers || {}) }
  });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": env.APP_ORIGIN, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type"
    }});

    if (url.pathname === "/auth/login" && request.method === "GET") {
      const state = randomId();
      await env.SESSIONS.put("oauth:" + state, "1", { expirationTtl: 600 });
      const target = new URL("https://github.com/login/oauth/authorize");
      target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      target.searchParams.set("redirect_uri", url.origin + "/auth/callback");
      target.searchParams.set("scope", "repo");
      target.searchParams.set("state", state);
      return Response.redirect(target.toString(), 302);
    }

    if (url.pathname === "/auth/callback" && request.method === "GET") {
      const state = url.searchParams.get("state");
      if (!state || !(await env.SESSIONS.get("oauth:" + state))) return json({ error: "Estado OAuth inválido." }, 400);
      await env.SESSIONS.delete("oauth:" + state);
      const code = url.searchParams.get("code");
      if (!code) return json({ error: "Autorização não concluída." }, 400);
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code })
      });
      const tokenData = await tokenResponse.json();
      if (!tokenData.access_token) return json({ error: "Não foi possível autenticar no GitHub." }, 401);
      const userResponse = await fetch("https://api.github.com/user", {
        headers: { Authorization: "Bearer " + tokenData.access_token, Accept: "application/vnd.github+json", "User-Agent": "Imperial-Barbearia" }
      });
      const user = await userResponse.json();
      const allowed = (env.ALLOWED_GITHUB_USERS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
      if (!user.login || !allowed.includes(user.login.toLowerCase())) return json({ error: "Usuário sem permissão para acessar a Imperial." }, 403);
      const id = randomId();
      await env.SESSIONS.put(id, JSON.stringify({ token: tokenData.access_token, login: user.login, expires: Date.now() + 604800000 }), { expirationTtl: 604800 });
      return new Response(null, { status: 302, headers: { Location: env.APP_ORIGIN, "Set-Cookie": cookie(id) } });
    }

    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (!sameOrigin(request, env)) return json({ error: "Origem inválida." }, 403);
      const s = await session(request, env);
      if (s) await env.SESSIONS.delete(s.id);
      return new Response(null, { status: 204, headers: { "Set-Cookie": cookie("", 0) } });
    }

    if (url.pathname.startsWith("/api/")) {
      if (!sameOrigin(request, env)) return json({ error: "Origem inválida." }, 403);
      const s = await session(request, env);
      if (!s) return json({ error: "Faça login para continuar." }, 401);
      if (url.pathname === "/api/me" && request.method === "GET") return json({ login: s.login });
      if (url.pathname === "/api/data" && request.method === "GET") {
        const response = await github(env, s.token, DATA_PATH);
        if (response.status === 404) return json({ data: null, sha: null });
        if (!response.ok) return json({ error: "Falha ao ler dados do GitHub." }, 502);
        const file = await response.json();
        const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), c => c.charCodeAt(0));
        return json({ data: JSON.parse(new TextDecoder().decode(bytes)), sha: file.sha });
      }
      if (url.pathname === "/api/data" && request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "JSON inválido." }, 400); }
        if (!body || typeof body.data !== "object" || body.data === null) return json({ error: "Dados inválidos." }, 400);
        const current = await github(env, s.token, DATA_PATH);
        let sha;
        if (current.ok) sha = (await current.json()).sha;
        else if (current.status !== 404) return json({ error: "Falha ao consultar arquivo no GitHub." }, 502);
        const bytes = new TextEncoder().encode(JSON.stringify(body.data, null, 2));
        let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
        const saved = await github(env, s.token, DATA_PATH, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Imperial: dados atualizados por " + s.login, content: btoa(binary), ...(sha ? { sha } : {}) })
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
