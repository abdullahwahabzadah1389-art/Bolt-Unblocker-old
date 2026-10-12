import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import sirv from "sirv";
import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";

const CDN_UPSTREAM = process.env.CDN_UPSTREAM || "https://boltunblocker.com";
const CDN_ROOT = join(process.cwd(), "public", "cdn");
const CDN_MAX_BUFFERED = 8 * 1024 * 1024;
const cdnCache = new Map();

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
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue1}, 60%, 30%)"/>
    <stop offset="1" stop-color="hsl(${hue2}, 65%, 14%)"/>
  </linearGradient></defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <circle cx="${120 + (hash % 360)}" cy="${100 + ((hash >> 8) % 200)}" r="140" fill="hsl(${hue2}, 60%, 40%)" opacity="0.18"/>
  <text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="170" font-weight="700" fill="rgba(255,255,255,0.9)">${escapeXml(monogram)}</text>
  <text x="50%" y="88%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="34" font-weight="600" fill="rgba(255,255,255,0.75)">${escapeXml(title)}</text>
</svg>`;
}

function gameUnavailablePage(slug) {
    const title = String(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
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
</style></head>
<body><main class="card">
  <span class="badge">Game unavailable</span>
  <h1>${escapeXml(title)}</h1>
  <p>This title can&rsquo;t be loaded right now &mdash; the external game host is offline or doesn&rsquo;t publish this game. Try another game, or check back later.</p>
  <div class="actions">
    <a class="btn primary" href="/games/">Back to Game Hub</a>
    <a class="btn" href="/">Home</a>
  </div>
</main></body></html>`;
}

// Mirrors the production /cdn/* proxy in app.js so the preview behaves the same.
function cdnProxyMiddleware(req, res, next) {
    if (!req.url || !req.url.startsWith("/cdn/")) return next();
    const suffix = decodeURIComponent(req.url.slice("/cdn/".length).split("?")[0]);

    try {
        const localPath = join(CDN_ROOT, suffix);
        if (localPath.startsWith(CDN_ROOT) && existsSync(localPath) && statSync(localPath).isFile()) {
            return next(); // let sirv/public serving pick it up
        }
    } catch { /* fall through */ }

    const cached = cdnCache.get(suffix);
    if (cached) {
        res.setHeader("Cache-Control", "public, max-age=604800");
        res.setHeader("Content-Type", cached.type);
        return res.end(cached.body);
    }

    const upstreamUrl = `${CDN_UPSTREAM}/cdn/${suffix.split("/").map(encodeURIComponent).join("/")}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    fetch(upstreamUrl, { redirect: "follow", signal: controller.signal })
        .then(async (up) => {
            if (!up.ok) throw new Error(`upstream ${up.status}`);
            const type = up.headers.get("content-type") || "application/octet-stream";
            const length = Number(up.headers.get("content-length") || 0);
            res.setHeader("Cache-Control", "public, max-age=604800");
            res.setHeader("Content-Type", type);
            if (type.startsWith("image/") && length <= CDN_MAX_BUFFERED) {
                const body = Buffer.from(await up.arrayBuffer());
                cdnCache.set(suffix, { type, body });
                return res.end(body);
            }
            return Readable.fromWeb(up.body).pipe(res);
        })
        .catch(() => {
            if (res.writableEnded) return;
            if (/\.(webp|png|jpe?g|gif|avif)$/i.test(suffix)) {
                res.setHeader("Cache-Control", "public, max-age=300");
                res.setHeader("Content-Type", "image/svg+xml");
                return res.end(placeholderCover(suffix.split("/").pop()));
            }
            if (suffix.startsWith("games/")) {
                res.statusCode = 200;
                res.setHeader("Cache-Control", "public, max-age=120");
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                return res.end(gameUnavailablePage(suffix.split("/").pop() || "game"));
            }
            res.statusCode = 404;
            res.setHeader("Content-Type", "text/plain");
            res.end("404 Not Found");
        })
        .finally(() => clearTimeout(timer));
}

function customDevServer() {
    return {
        name: 'custom-dev-server',
        hooks: {
            'astro:server:setup': ({ server }) => {

                // httpServer can be null when Astro re-runs this hook during a
                // config reload (e.g. package.json changed), so guard it.
                if (server.httpServer) {
                    server.httpServer.on('upgrade', (req, socket, head) => {
                        if (req.url.startsWith("/wisp/")) {
                            wisp.routeRequest(req, socket, head);
                        }
                    });
                }

                server.middlewares.use((req, res, next) => {
                    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
                    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
                    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
                    next();
                });

                // Proxy /cdn/* to the upstream game host, matching production.
                server.middlewares.use(cdnProxyMiddleware);

                server.middlewares.use('/baremux/', sirv(baremuxPath, { dev: true, etag: true }));

                const serveLibcurl = sirv(libcurlPath, { dev: true, etag: true });
                server.middlewares.use('/libcurl/', (req, res, next) => {

                    if (req.originalUrl.endsWith('.mjs')) {
                        res.setHeader('Content-Type', 'application/javascript');
                    }
                    serveLibcurl(req, res, next);
                });
            },
        },
    };
}

export default defineConfig({
    root: "./",
    outDir: "./dist",
    publicDir: "./public",
    srcDir: "./src",
    vite: {
        plugins: [tailwindcss()]
    },
    build: {
        concurrency: 1
    },
    integrations: [
        customDevServer()
    ]
});