import { BareMuxConnection } from '@mercuryworkshop/bare-mux';

// ── Outbound relay ────────────────────────────────────────────────────────
// Every proxied fetch is performed by the *wisp server*, not by this page, so
// this value determines the source IP the target site sees. Keeping it on the
// local /wisp/ means all traffic exits from Render's datacenter IP, which Meta
// (and similar) throttle. Point it at a public relay to change the exit IP.
//
// Relay pool, measured 2026-10-13 (raw TLS+WS handshake, 5 attempts each):
//   wss://my-private-relay.up.railway.app/  404 on every path  <- preferred, NOT YET MOUNTED
//   wss://wisp.freewisp.org/     5/5  101  avg  749ms
//   wss://wisp.mercurywork.shop/ 5/5  101  avg  966ms
//   wss://anura.pro/             5/5  101  avg 1445ms  (922-3454ms, jittery)
//
// The private node RESOLVES (69.46.46.111) and the Railway app is running, but
// it returns `404 Not Found` for /, /wisp/, /ws/, /socket and /bare/ — no wisp
// service is mounted yet. probeRelay() therefore rejects it (a failed WS
// handshake fires `error` -> `close` -> null) and the pool falls through to the
// public nodes automatically. The moment a wisp server is mounted on that host,
// it starts winning without any further change here.
//
// Verified DEAD, deliberately NOT in the pool:
//   wisp.coia.wtf                ENOTFOUND (NXDOMAIN — the name does not exist)
//   wisp.rhw.one                 ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR
//   nebulaproxy.io/wisp/         timeout on all 5 attempts
//   wisp.pydust.cloud            NXDOMAIN
//
// Note the measurement method matters: Node's fetch() refuses the Connection /
// Upgrade headers (UND_ERR_INVALID_ARG), so a fetch-based probe reports a false
// negative for every endpoint. probeRelay() below uses a real WebSocket instead.
//
// Override at runtime with:  localStorage.setItem('wisp-endpoint', 'wss://…')
// Revert to pool selection: localStorage.removeItem('wisp-endpoint')
const WISP_ENDPOINT_KEY = "wisp-endpoint";
const ACTIVE_WISP_KEY = "wisp-active-endpoint";
const DEFAULT_WISP = "wss://wisp.freewisp.org/";

// The operator's own egress. Preferred over every public node so proxied
// traffic exits from a dedicated IP rather than a shared public relay pool.
// Kept as a separate constant so it can be pointed at a new host without
// editing the ordering below.
const PRIVATE_WISP = "wss://my-private-relay.up.railway.app/";

// ARRAY ORDER IS THE PREFERENCE RANKING. Index 0 wins whenever it answers;
// later entries are fallbacks. Note this is deliberately NOT a latency sort —
// a private node must be preferred even when a Cloudflare-backed public relay
// would handshakes faster, otherwise "preferred" would mean "only if fastest"
// and the private endpoint could never be relied upon.
const RELAY_POOL: readonly string[] = [
    PRIVATE_WISP,
    DEFAULT_WISP,
    "wss://wisp.mercurywork.shop/",
    "wss://anura.pro/",
];

// A relay that has not answered within this window is treated as down.
const WISP_PROBE_TIMEOUT_MS = 3000;

/**
 * Opens a real WebSocket to the relay and resolves with its connection latency
 * in ms, or null if it could not be reached (error, early close, or timeout).
 *
 * The socket is closed as soon as it is known to be healthy — the probe is a
 * health check, not a session, and must not hold a slot on a node that caps
 * concurrent connections.
 */
function probeRelay(url: string, timeoutMs = WISP_PROBE_TIMEOUT_MS): Promise<number | null> {
    return new Promise((resolve) => {
        const started = performance.now();
        let settled = false;
        let socket: WebSocket | null = null;

        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (socket) {
                try {
                    socket.close();
                } catch {
                    /* already closed */
                }
            }
            resolve(ok ? performance.now() - started : null);
        };

        const timer = setTimeout(() => finish(false), timeoutMs);

        try {
            socket = new WebSocket(url);
        } catch {
            // Malformed URL or no network at all.
            finish(false);
            return;
        }

        socket.addEventListener("open", () => finish(true));
        socket.addEventListener("error", () => finish(false));
        // Fires if the server accepts then drops us before we read `open`.
        socket.addEventListener("close", () => finish(false));
    });
}

/**
 * Picks the relay for this page load.
 *
 * Stability is preferred over raw speed: if the relay used last time is still
 * healthy we keep it, so an in-flight session does not silently change exit IP
 * between navigations. Only when it is gone do we re-measure the pool and take
 * the fastest surviving node.
 */
async function selectRelay(): Promise<string> {
    // An explicit override is the operator's decision — never probe it away.
    const override = localStorage.getItem(WISP_ENDPOINT_KEY);
    if (override) return override;

    // A wss:// endpoint is unreachable from an insecure origin.
    if (location.protocol === "http:") {
        return "ws://" + location.host + "/wisp/";
    }

    const stored = localStorage.getItem(ACTIVE_WISP_KEY);
    if (stored && RELAY_POOL.includes(stored)) {
        if ((await probeRelay(stored)) !== null) return stored;
    }

    // Promise.all preserves input order, so `results` is already in RELAY_POOL
    // order and filtering keeps it. We intentionally do NOT sort by latency:
    // array position is the preference, and the pool's public entries are
    // already written slowest-last.
    const results = await Promise.all(
        RELAY_POOL.map(async (url) => ({ url, ms: await probeRelay(url) })),
    );
    const healthy = results.filter(
        (r): r is { url: string; ms: number } => r.ms !== null,
    );

    // First healthy node in preference order wins.
    if (healthy.length > 0) return healthy[0].url;

    // Everything timed out: binding nothing would break the proxy outright, so
    // fall back to the default and let the transport itself retry.
    return DEFAULT_WISP;
}
const bareUrl = (location.protocol === "https:" ? "https" : "http") + "://" + location.host + "/bare/";



var transport = "/libcurl/index.mjs";
const { ScramjetController } = typeof $scramjetLoadController !== 'undefined' ? $scramjetLoadController() : {
    ScramjetController: class {
        init() { }
        encodeUrl(url: string) { return url; }
    } as any
};

if (localStorage.getItem('transport') === 'lib') {
    transport = '/libcurl/index.mjs';
}

const scramjet = new ScramjetController({
    files: {
        wasm: "/learn/scramjet.wasm.wasm",
        all: "/learn/scramjet.all.js",
        sync: "/learn/scramjet.sync.js",
    },
    flags: {
        rewriterLogs: false,
        scramitize: false,
        cleanErrors: true,
        // ROOT CAUSE of "scramjetpushsourcemap is not defined". The engine's
        // built-in default is `sourcemaps:!0`, and the per-request resolver
        // (`U5` -> `l(e,t)` in scramjet.all.js) returns `flags.sourcemaps` for
        // ANY host the siteFlags below do not match:
        //
        //     function l(e,t){let r=a.flags[e];
        //       for(let r in a.siteFlags){let n=a.siteFlags[r];
        //         if(new RegExp(r).test(t.href)&&e in n)return n[e]}
        //       return r}                      // <- global flags.sourcemaps
        //
        // When it resolves true, the rewriter checks for the
        // `$scramjet$pushsourcemap` hook; if that hook is absent in the realm,
        // it emits a LITERAL call to the name into the script text:
        //
        //     `${pushsourcemapfn}([${map.join(",")}], "${tag}");`
        //
        // That call hits an undefined global and throws ReferenceError the
        // moment the script loads, killing execution and freezing the splash.
        //
        // Per-site rules alone cannot prevent it: the Instagram web client
        // also loads scripts from hosts our rules never match (facebook.com,
        // *.fbcdn.net, connect.facebook.net, graph.instagram.com, …), and each
        // of those still resolved `true`. False makes the whole branch
        // unreachable for every host, which is what "disable sourcemapping
        // completely" has to mean to actually stop the error.
        sourcemaps: false,
    },
    // Per-site rewriter overrides — keyed by RegExp matched against the target
    // href. Values are Partial<ScramjetFlags>, whose complete key set is:
    //   serviceworkers, syncxhr, strictRewrites, rewriterLogs, captureErrors,
    //   cleanErrors, scramitize, sourcemaps, destructureRewrites,
    //   interceptDownloads, allowInvalidJs, allowFailedIntercepts
    //
    // `strictRewrites: false` is the "disable strict string tampering" switch,
    // so it is what keeps normal routing while relaxing rewrite strictness.
    //
    // `shieldCrypto` and `masquerade` are intentionally NOT set. The engine
    // resolves a flag with `e in n` where `e` is a name IT asks for, and both
    // strings occur zero times in scramjet.all.js — they would be read by
    // nothing while looking like protection. Note tsc does NOT catch this: the
    // controller comes off an untyped ternary, so excess keys pass silently.
    // "DOM Masquerading" is an InvisiProxy LTS feature (disguiseFiles), not a
    // Scramjet flag — InvisiProxy is a separate proxy service that bundles
    // Scramjet and Ultraviolet rather than a superset of their flag set.
    //
    // Likewise no crypto shim: neither Scramjet nor Ultraviolet defines a
    // window.crypto / crypto.subtle hook, so these flags only tune the
    // rewriter's own instrumentation on the page.
    // `allowInvalidJs: true` is a real flag, resolved per-request by the
    // engine's flag lookup: when its JS rewriter throws on a script it cannot
    // parse, it returns the ORIGINAL upstream bytes instead of aborting, so the
    // script still loads and runs as authored.
    //
    // It is also the engine default, so on its own this changes no behaviour —
    // it pins the value per-host, which matters because our global `flags` above
    // sets only 4 of the 12 keys and the runtime `modifyConfig` API merges
    // shallowly (Object.assign({}, $W, e)); either path could otherwise drop it.
    siteFlags: {
        '^https?://([a-z0-9-]+\\.)?google\\.com(/|$)': {
            sourcemaps: false,
            captureErrors: false,
            strictRewrites: false,
            allowInvalidJs: true,
        },
        '^https?://([a-z0-9-]+\\.)?instagram\\.com(/|$)': {
            sourcemaps: false,
            captureErrors: false,
            strictRewrites: false,
            allowInvalidJs: true,
        },
        '^https?://([a-z0-9-]+\\.)?cdninstagram\\.com(/|$)': {
            sourcemaps: false,
            captureErrors: false,
            strictRewrites: false,
            // Instagram's script bundles are served from *.cdninstagram.com, so
            // this is the rule that actually governs the rewriter here.
            allowInvalidJs: true,
        },
    },
    prefix: '/$/'
});

if (scramjet.init) scramjet.init();
export const swReady = new Promise<void>((resolve) => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(() => {
            if (navigator.serviceWorker.controller) {
                resolve();
            } else {
                navigator.serviceWorker.addEventListener('controllerchange', () => resolve());
            }
        });
    } else {
        resolve();
    }
});

const bmc = new BareMuxConnection("/baremux/worker.js");
(async () => {
    // Probe before binding: the wisp URL is not known until the pool has been
    // measured, so it can no longer be resolved at module scope.
    const wispUrl = await selectRelay();

    let current: string | null = null;
    try {
        current = await bmc.getTransport();
    } catch {
        /* no transport bound yet */
    }

    // bare-mux persists the transport, so `setTransport` must be called again
    // whenever the relay changes — otherwise an existing session keeps its old
    // exit IP and this edit silently never takes effect.
    const relayChanged = localStorage.getItem(ACTIVE_WISP_KEY) !== wispUrl;

    if (!current || relayChanged) {
        await bmc.setTransport(transport, [{ wisp: wispUrl }]);
        localStorage.setItem(ACTIVE_WISP_KEY, wispUrl);
    }
})();

function getProxyEngine(): string {
    try {
        const settings = JSON.parse(localStorage.getItem('bolt-settings') || '{}');
        return settings.proxyEngine || 'scramjet';
    } catch {
        return 'scramjet';
    }
}

function encodeUrl(url: string): string {
    const engine = getProxyEngine();

    if (engine === 'ultraviolet') {
        const encoded = uvXorEncode(url);
        return '/maths/' + encoded;
    }

    return scramjet.encodeUrl(url);
}

function uvXorEncode(str: string): string {
    if (!str) return str;
    let result = '';
    for (let i = 0; i < str.length; i++) {
        if (i % 2) {
            result += String.fromCharCode(str.charCodeAt(i) ^ 2);
        } else {
            result += str[i];
        }
    }
    return encodeURIComponent(result);
}

function decodeProxiedUrl(proxiedUrl: string): string {
    const engine = getProxyEngine();

    if (engine === 'ultraviolet' && proxiedUrl.includes('/maths/')) {
        const encoded = proxiedUrl.split('/maths/')[1];
        if (encoded) {
            return uvXorDecode(encoded);
        }
    }

    if (proxiedUrl.includes('/$/')) {
        return decodeURIComponent(proxiedUrl.split('/$/')[1] || proxiedUrl);
    }

    return proxiedUrl;
}

function uvXorDecode(str: string): string {
    if (!str) return str;
    let [input, ...search] = str.split('?');

    let decodedInput = decodeURIComponent(input);
    let result = '';
    for (let i = 0; i < decodedInput.length; i++) {
        if (i % 2) {
            result += String.fromCharCode(decodedInput.charCodeAt(i) ^ 2);
        } else {
            result += decodedInput[i];
        }
    }
    return result + (search.length ? '?' + search.join('?') : '');
}

function isProxiedUrl(url: string): boolean {
    return url.includes('/$/') || url.includes('/maths/');
}

function getProxyPrefix(): string {
    return getProxyEngine() === 'ultraviolet' ? '/maths/' : '/$/';
}

const proxy = {
    encodeUrl,
    decodeProxiedUrl,
    isProxiedUrl,
    getProxyPrefix,
    getProxyEngine,
    scramjet,
};

export default proxy;