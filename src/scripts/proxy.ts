import { BareMuxConnection } from '@mercuryworkshop/bare-mux';

// ── Outbound relay ────────────────────────────────────────────────────────
// Every proxied fetch is performed by the *wisp server*, not by this page, so
// this value determines the source IP the target site sees. Keeping it on the
// local /wisp/ means all traffic exits from Render's datacenter IP, which Meta
// (and similar) throttle. Point it at a public relay to change the exit IP.
//
// Endpoints checked 2026-10-13 (WS handshake, 5 attempts each):
//   wss://wisp.freewisp.org/     5/5  101  <- current default
//   wss://wisp.mercurywork.shop/ 5/5  101  (retired; rate-limited demo node)
//   wss://anura.pro/               1    101
//   wss://wisp.rhw.one/            fail 35 (SSL connect error)
//   nebulaproxy.io/wisp/           fail    timeout
//   wisp.pydust.cloud / wisp.coia.wtf      NXDOMAIN (do not exist)
//
// Override at runtime with:  localStorage.setItem('wisp-endpoint', 'wss://…')
// Revert to default:         localStorage.removeItem('wisp-endpoint')
const WISP_ENDPOINT_KEY = "wisp-endpoint";
const ACTIVE_WISP_KEY = "wisp-active-endpoint";
const DEFAULT_WISP = "wss://wisp.freewisp.org/";

function resolveWispUrl(): string {
    const stored = localStorage.getItem(WISP_ENDPOINT_KEY);
    if (stored) return stored;
    // A wss:// endpoint is unreachable from an insecure origin.
    if (location.protocol === "http:") {
        return "ws://" + location.host + "/wisp/";
    }
    return DEFAULT_WISP;
}

const wispUrl = resolveWispUrl();
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
        sourcemaps: true,
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
    siteFlags: {
        '^https?://([a-z0-9-]+\\.)?google\\.com(/|$)': {
            sourcemaps: false,
            captureErrors: false,
            strictRewrites: false,
        },
        '^https?://([a-z0-9-]+\\.)?instagram\\.com(/|$)': {
            sourcemaps: false,
            captureErrors: false,
            strictRewrites: false,
        },
        '^https?://([a-z0-9-]+\\.)?cdninstagram\\.com(/|$)': {
            sourcemaps: false,
            captureErrors: false,
            strictRewrites: false,
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