import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { join } from "node:path";
import { hostname } from "node:os";
import { existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";



try { process.loadEnvFile(); } catch { /* .env not present or Node is too old */ }

const __dirname = process.cwd();
const publicPath = join(__dirname, "dist");

// The game hub's games.json references /cdn/imgs/* and /cdn/games/* assets that
// were never committed to this repository (same for upstream). The official
// deployment serves them from its own origin, so we proxy anything under /cdn/
// to it and fall back to a generated placeholder cover for missing images.
const CDN_UPSTREAM = process.env.CDN_UPSTREAM || "https://boltunblocker.com";

const cdnCache = new Map(); // path -> { type, body }
const CDN_CACHE_LIMIT = 24 * 1024 * 1024;
const CDN_MAX_BUFFERED = 8 * 1024 * 1024;
let cdnCacheBytes = 0;

function cacheCdn(key, type, body) {
    if (body.length > CDN_MAX_BUFFERED) return;
    while (cdnCacheBytes + body.length > CDN_CACHE_LIMIT && cdnCache.size > 0) {
        const oldest = cdnCache.keys().next().value;
        cdnCacheBytes -= cdnCache.get(oldest).body.length;
        cdnCache.delete(oldest);
    }
    cdnCache.set(key, { type, body });
    cdnCacheBytes += body.length;
}

function escapeXml(text) {
    return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function placeholderCover(name) {
    const base = name.replace(/\.(webp|png|jpe?g|gif|avif)$/i, "");
    const words = base.split(/[-_ ]+/).filter(Boolean);
    const monogram = words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "B";
    const title = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").slice(0, 28) || "Game";

    let hash = 0;
    for (const c of base) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    const hue1 = hash % 360;
    const hue2 = (hue1 + 50) % 360;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue1}, 60%, 30%)"/>
      <stop offset="1" stop-color="hsl(${hue2}, 65%, 14%)"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <circle cx="${120 + (hash % 360)}" cy="${100 + ((hash >> 8) % 200)}" r="140" fill="hsl(${hue2}, 60%, 40%)" opacity="0.18"/>
  <text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="170" font-weight="700" fill="rgba(255,255,255,0.9)">${escapeXml(monogram)}</text>
  <text x="50%" y="88%" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="600" fill="rgba(255,255,255,0.75)">${escapeXml(title)}</text>
</svg>`;
}

// Friendly page shown in the game iframe when a /cdn/games/* path can't be
// fetched (upstream host down or the title isn't published upstream). Built as
// a string so it ships with the server and needs no template dependency.
function gameUnavailablePage(slug) {
    const title = String(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeXml(title)} — Unavailable</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0b0d12; color:#e6e8ee; font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .card { max-width:30rem; padding:2.25rem 2rem; text-align:center; }
  .badge { display:inline-block; font-size:.7rem; letter-spacing:.12em; text-transform:uppercase;
           color:#9aa4b2; border:1px solid #2a3140; border-radius:999px; padding:.35rem .8rem; margin-bottom:1.1rem; }
  h1 { font-size:1.5rem; margin:.2rem 0 .6rem; }
  p { color:#aab2c0; line-height:1.55; margin:0 0 1.4rem; }
  .actions { display:flex; gap:.6rem; justify-content:center; flex-wrap:wrap; }
  a.btn { text-decoration:none; font-size:.9rem; border-radius:.6rem; padding:.6rem 1.1rem; border:1px solid #2a3140; color:#e6e8ee; }
  a.btn.primary { background:#2563eb; border-color:#2563eb; color:#fff; }
  a.btn:hover { border-color:#3a4457; }
</style>
</head>
<body>
  <main class="card">
    <span class="badge">Game unavailable</span>
    <h1>${escapeXml(title)}</h1>
    <p>This title can&rsquo;t be loaded right now &mdash; the external game host is offline or doesn&rsquo;t publish this game. Try another game, or check back later.</p>
    <div class="actions">
      <a class="btn primary" href="/games/">Back to Game Hub</a>
      <a class="btn" href="/">Home</a>
    </div>
  </main>
</body>
</html>`;
}

const fastify = Fastify({
    logger: true,
});

fastify.addHook("onSend", async (request, reply, payload) => {
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Embedder-Policy-Report-Only", "require-corp");
    return payload;
});
fastify.server.on("upgrade", (req, socket, head) => {
    wisp.routeRequest(req, socket, head);
});


await fastify.register(fastifyStatic, {
    root: publicPath,
    prefix: "/"
});


fastify.addContentTypeParser('application/javascript', { parseAs: 'string' }, (req, body, done) => {
    done(null, body);
});

await fastify.register(fastifyStatic, {
    root: libcurlPath,
    prefix: "/libcurl/",
    decorateReply: false,
    setHeaders: (res, path, stat) => {
        if (path.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
});

await fastify.register(fastifyStatic, {
    root: baremuxPath,
    prefix: "/baremux/",
    decorateReply: false
});


fastify.get("/cdn/*", async (request, reply) => {
    const suffix = String(request.params["*"] || "");

    // Local override: files added to public/cdn are copied to dist/cdn at build
    // time and always win over the upstream.
    try {
        const localPath = join(publicPath, "cdn", suffix);
        if (localPath.startsWith(join(publicPath, "cdn")) && existsSync(localPath) && statSync(localPath).isFile()) {
            return reply.sendFile(join("cdn", suffix));
        }
    } catch { /* fall through to upstream */ }

    const cached = cdnCache.get(suffix);
    if (cached) {
        reply.header("Cache-Control", "public, max-age=604800");
        return reply.type(cached.type).send(cached.body);
    }

    const upstreamUrl = `${CDN_UPSTREAM}/cdn/${suffix.split("/").map(encodeURIComponent).join("/")}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch(upstreamUrl, { redirect: "follow", signal: controller.signal });
        if (res.ok) {
            const type = res.headers.get("content-type") || "application/octet-stream";
            const length = Number(res.headers.get("content-length") || 0);

            reply.header("Cache-Control", "public, max-age=604800");

            if (type.startsWith("image/") && length <= CDN_MAX_BUFFERED) {
                const body = Buffer.from(await res.arrayBuffer());
                cacheCdn(suffix, type, body);
                return reply.type(type).send(body);
            }

            return reply.type(type).send(Readable.fromWeb(res.body));
        }
    } catch (err) {
        request.log.debug({ err, upstreamUrl }, "cdn upstream unavailable");
    } finally {
        clearTimeout(timer);
    }

    // Upstream missed or unreachable: never show a broken tile.
    if (/\.(webp|png|jpe?g|gif|avif)$/i.test(suffix)) {
        reply.header("Cache-Control", "public, max-age=300");
        return reply.type("image/svg+xml").send(placeholderCover(suffix.split("/").pop()));
    }

    // Game pages (/cdn/games/<slug>) degrade to a friendly notice rather than a
    // bare 404 when the upstream game host is down. The hub iframes this path,
    // so a bare 404 reads as "the whole site is broken" to a player.
    if (suffix.startsWith("games/")) {
        reply.header("Cache-Control", "public, max-age=120");
        return reply.type("text/html").send(gameUnavailablePage(suffix.split("/").pop() || "game"));
    }

    return reply.status(404).type("text/plain").send("404 Not Found");
});

fastify.get("/", (request, reply) => {
    return reply.sendFile("index.html");
});


fastify.post("/api/chat", async (request, reply) => {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        return reply.status(500).send({ error: "API key not configured on server." });
    }

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": request.headers["origin"] ?? "",
            "X-Title": "Bolt AI",
        },
        body: JSON.stringify(request.body),
    });

    const data = await upstream.json();
    return reply.status(upstream.status).send(data);
});

// Tiny liveness endpoint for the keep-alive self-ping and uptime monitors.
// Deliberately trivial so it never touches the proxy, filesystem, or CDN cache.
fastify.get("/healthz", (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.status(200).send({ ok: true });
});

fastify.post("/api/deepreset", async (request, reply) => {
    const cookieNames = ["session", "auth-token", "refresh-token"];

    for (const name of cookieNames) {
        reply.header(
            "Set-Cookie",
            `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 UTC; HttpOnly; SameSite=Lax`
        );
    }

    reply.header("Clear-Site-Data", '"cache", "cookies", "storage"');

    return reply.status(200).send({ ok: true });
});


fastify.setNotFoundHandler((request, reply) => {
    return reply.send("404 Not Found");
});


function shutdown() {
    console.log("SIGTERM signal received: closing HTTP server");
    fastify.close();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);


let port = parseInt(process.env.PORT || "8080");
if (isNaN(port)) port = 8080;

// Render's free tier spins the service down after 15 idle minutes, which makes
// the next visitor wait ~60s for the cold start (the "SERVICE WAKING UP" screen).
// Once this process is up, ping our own public URL every 10 min — under Render's
// idle threshold — so the instance never sleeps. This cannot revive an already
// spun-down instance (nothing is running to send the ping); the GitHub Actions
// keep-awake cron in .github/workflows covers that half. Off outside Render.
const SELF_PING_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_PING_URL) {
    setInterval(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        fetch(new URL("/healthz", SELF_PING_URL), { signal: controller.signal })
            .catch(() => { /* transient blip; next tick retries */ })
            .finally(() => clearTimeout(timer));
    }, 10 * 60 * 1000);
}

try {
    const address = await fastify.listen({ port, host: "0.0.0.0" });
    console.log("Listening on:");
    console.log(`\thttp://localhost:${port}`);
    console.log(`\thttp://${hostname()}:${port}`);

    const serverAddress = fastify.server.address();
    console.log(
        `\thttp://${serverAddress.family === "IPv6" ? `[${serverAddress.address}]` : serverAddress.address}:${serverAddress.port}`
    );
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}