import http from "node:http";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

// Railway (and most platforms) inject the listen port; fall back for local runs.
const PORT = parseInt(process.env.PORT ?? "8080", 10);
// Bind 0.0.0.0 — binding localhost inside a container makes the port unreachable.
const HOST = process.env.HOST ?? "0.0.0.0";

const server = http.createServer((req, res) => {
    // Container liveness probe. Deliberately trivial: it must never touch the
    // wisp connection pool, so a health check cannot count against the cap.
    if (req.method === "GET" && (req.url === "/health" || req.url === "/health/")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 not found");
});

// Every WebSocket upgrade is handed to wisp. wisp keys behaviour off the path:
// one ending in "/" (our root "/") establishes a wisp tunnel, anything else is
// treated as a plain WS proxy target, so the root path is what clients use.
server.on("upgrade", (req, socket, head) => {
    wisp.routeRequest(req, socket, head);
});

// Surface close reasons instead of dying silently on an unhandled rejection.
process.on("unhandledRejection", (reason) => {
    console.error("unhandledRejection:", reason);
});

// ── Self-ping keep-alive ────────────────────────────────────────────────────
// Platforms that sleep idle containers do so on the basis of inbound traffic
// at the edge, not on the process being alive. Pinging 127.0.0.1 would not
// count, so the ping goes to the PUBLIC domain, which is the request that
// actually registers as activity.
//
// RAILWAY_PUBLIC_DOMAIN is injected automatically by Railway (form
// `example.up.railway.app`). It is only present when a public domain is
// attached; without one there is nothing external to ping, so we skip.
const PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN ?? "";
const KEEPALIVE_URL = PUBLIC_DOMAIN ? `https://${PUBLIC_DOMAIN}/health` : null;
// 7 minutes: inside the requested 5-10 minute window, and safely under the
// ~30 min idle thresholds platforms typically use. Overridable so the operator
// can trade log volume against sleep margin without editing code.
const KEEPALIVE_INTERVAL_MS =
    parseInt(process.env.KEEPALIVE_INTERVAL_MINUTES ?? "7", 10) * 60 * 1000;

function keepAlivePing() {
    if (!KEEPALIVE_URL) return;
    // AbortSignal.timeout caps a hung request so pings cannot pile up.
    fetch(KEEPALIVE_URL, { signal: AbortSignal.timeout(10_000) })
        .then((res) => {
            // Log failures only. A keep-alive that prints every 7 minutes for
            // the lifetime of the container is log noise, not signal.
            if (!res.ok) {
                console.warn(`keep-alive ping -> HTTP ${res.status}`);
            }
        })
        .catch((err) => {
            // A failed ping is never fatal: the container is being kept awake
            // for real client traffic, so a blip must not take the server down.
            console.warn(`keep-alive ping failed: ${err?.message ?? err}`);
        });
}

server.listen(PORT, HOST, () => {
    console.log(`wisp egress listening on http://${HOST}:${PORT}`);
    console.log(`health check:  http://${HOST}:${PORT}/health`);
    console.log(`wisp endpoint: wss://<your-host>/`);

    // Start only once we are actually accepting connections, so a ping never
    // races a server that has not bound its port yet.
    if (KEEPALIVE_URL) {
        console.log(`keep-alive:    ${KEEPALIVE_URL} every ${KEEPALIVE_INTERVAL_MS / 60000}min`);
        const timer = setInterval(keepAlivePing, KEEPALIVE_INTERVAL_MS);
        // unref: this timer must never be the reason the process lingers. The
        // listening server already holds the event loop open on its own.
        timer.unref();
    } else {
        console.log("keep-alive:    disabled (no RAILWAY_PUBLIC_DOMAIN set)");
    }
});

server.on("error", (err) => {
    console.error("server error:", err);
    process.exit(1);
});
