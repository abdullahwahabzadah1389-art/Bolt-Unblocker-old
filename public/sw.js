if (navigator.userAgent.includes("Firefox")) {
    Object.defineProperty(globalThis, "crossOriginIsolated", {
        value: true,
        writable: false,
    });
}


importScripts("/math/uv.bundle.js");
importScripts("/math/uv.config.js");
importScripts("/math/uv.sw.js");
importScripts("/learn/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const uv = new UVServiceWorker(self.__uv$config);
const scramjet = new ScramjetServiceWorker();

// Take control of the current page immediately. Without this a freshly
// registered worker does not control the page it was registered from, so a
// first-party page (e.g. the OAuth callback, which does not load the proxy
// bundle) would have no `serviceWorker.controller` to post cookies to.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));


async function handleRequest(event) {
    try {
        await scramjet.loadConfig().catch(err => console.error("Scramjet Config Load Failed", err));

        if (uv.route(event)) {
            return await uv.fetch(event);
        }


        if (scramjet.route(event)) {
            return await scramjet.fetch(event);
        }
    } catch (error) {
        console.error("Proxy Error:", error);
    }


    return fetch(event.request);
}



self.addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event));
});

let playgroundData;
self.addEventListener("message", ({ data }) => {
    if (data.type === "playgroundData") {
        playgroundData = data;
    }
});

// ── Targeted raw pass-through for Instagram script assets ────────────────────
//
// Scope is deliberately SCRIPT PAYLOADS ONLY. The HTML document is never
// passed through raw: if it were, Scramjet would have nothing to rewrite and
// the proxy would stop containerizing the page entirely. That is also why the
// earlier blanket `*.cdninstagram.com` host bypass was pulled back in — a host
// rule cannot tell a script bundle from a document.
//
// Set to false to disable in one edit.
const RAW_BYPASS_ENABLED = true;

// Anchored on purpose: `cdninstagram.com.evil.com` must not match.
const RAW_HOST_RE = /^(?:[a-z0-9-]+\.)*cdninstagram\.com$/i;
const IG_HOST_RE = /^(?:[a-z0-9-]+\.)*instagram\.com$/i;
// Instagram ships its modules through /rsrc.php/* and plain .js paths.
const IG_SCRIPT_RE = /\/rsrc\.php(?:\/|$)|\.m?js$/i;

function isRawBypassTarget(url) {
    if (!RAW_BYPASS_ENABLED) return false;
    if (RAW_HOST_RE.test(url.hostname)) return true;
    if (IG_HOST_RE.test(url.hostname)) return IG_SCRIPT_RE.test(url.pathname);
    return false;
}

function respondRaw(e, target) {
    // A plain fetch inside a service worker does not re-enter this fetch
    // handler, so this is a genuine direct request rather than a rewritten one.
    e.response = fetch(target.href).then((upstream) => {
        const rawHeaders = Object.fromEntries(upstream.headers.entries());
        const out = new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: upstream.headers,
        });
        out.rawHeaders = rawHeaders;
        out.rawResponse = {
            body: out.body,
            headers: rawHeaders,
            status: upstream.status,
            statusText: upstream.statusText,
        };
        out.finalURL = target.href;
        return out;
    });
}

scramjet.addEventListener("request", (e) => {
    let target = null;
    try {
        target = new URL(e.url.href);
    } catch {
        target = null;
    }
    if (target && isRawBypassTarget(target)) {
        respondRaw(e, target);
        return;
    }

    if (playgroundData && e.url.href.startsWith(playgroundData.origin)) {
        const headers = {};
        const origin = playgroundData.origin;
        if (e.url.href === origin + "/") {
            headers["content-type"] = "text/html";
            e.response = new Response(playgroundData.html, { headers });
        } else if (e.url.href === origin + "/style.css") {
            headers["content-type"] = "text/css";
            e.response = new Response(playgroundData.css, { headers });
        } else if (e.url.href === origin + "/script.js") {
            headers["content-type"] = "application/javascript";
            e.response = new Response(playgroundData.js, { headers });
        } else {
            e.response = new Response("empty response", { headers });
        }
        e.response.rawHeaders = headers;
        e.response.rawResponse = {
            body: e.response.body,
            headers: headers,
            status: e.response.status,
            statusText: e.response.statusText,
        };
        e.response.finalURL = e.url.toString();
    } else {
        return;
    }
});
