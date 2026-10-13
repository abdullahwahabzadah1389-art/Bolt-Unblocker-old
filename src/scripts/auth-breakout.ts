/**
 * Auth-domain breakout
 *
 * Google refuses to run its sign-in flow inside a proxied iframe: the rewritten
 * DOM trips its anti-phishing heuristics and the frame is rejected outright. The
 * fix is to never proxy those URLs at all — hand them to the browser as normal,
 * top-level navigations.
 *
 * Two properties matter here:
 *
 *   1. `noopener`  — the native tab gets no `window.opener`, so Google's page
 *      cannot reach back into Bolt's DOM. This is what keeps the login flow
 *      clean rather than "manipulated".
 *   2. `noreferrer` — no Referer header is sent with the navigation.
 *
 * Because `noopener` nulls `window.opener`, the OAuth result cannot be handed
 * back with `opener.postMessage`. It is returned through the same-origin
 * BroadcastChannel / localStorage pair instead, which works precisely because
 * the redirect URI lives on this origin (see `onAuthReturn`).
 */

/** OAuth endpoints are auth traffic on whatever host serves them. */
const OAUTH_PATH_RE = /^\/o\/oauth2(?:\/|\b)/i;

/** Sign-in paths that only mean "auth" once the host is known to be Google. */
const GOOGLE_AUTH_PATH_RE =
    /^\/(?:signin|v\d\/signin|ServiceLogin|accountchooser|interactive|challenge|render\/auth)\b/i;

/** Hosts that should always be treated as auth targets even on unknown paths. */
const AUTH_HOST_RE = /^(?:accounts|auth|myaccount)\.google\.com$/i;

/**
 * `true` when the URL must not be proxied.
 *
 * Scoped to sign-in and OAuth hops rather than every `*.google.com` URL, so
 * ordinary proxied Google search keeps working. Set `BREAK_OUT_ALL_GOOGLE` to
 * `true` to route the whole Google surface natively instead.
 */
export const BREAK_OUT_ALL_GOOGLE = false;

export function isAuthUrl(raw: string): boolean {
    if (!raw) return false;

    let target: URL;
    try {
        target = new URL(raw, window.location.href);
    } catch {
        return false;
    }

    if (target.protocol !== "http:" && target.protocol !== "https:") return false;

    // OAuth endpoints are auth traffic regardless of host.
    if (OAUTH_PATH_RE.test(target.pathname)) return true;

    const host = target.hostname.toLowerCase();
    const isGoogle = host === "google.com" || host.endsWith(".google.com");
    // Everything else — including look-alikes such as
    // `accounts.google.com.evil.com` — stays proxied.
    if (!isGoogle) return false;

    if (BREAK_OUT_ALL_GOOGLE) return true;

    if (AUTH_HOST_RE.test(host)) return true;

    return GOOGLE_AUTH_PATH_RE.test(target.pathname);
}

/**
 * Opens `raw` in a fresh native browser tab outside the proxy frame.
 *
 * Returns `true` when the caller must NOT continue proxying this URL —
 * regardless of whether the tab actually opened, because falling back to the
 * proxied frame is never the right outcome for an auth URL.
 *
 * `window.open` with `noopener` returns `null`; that is expected, not an error.
 */
export function breakOutToNativeTab(raw: string): boolean {
    let target = raw;
    try {
        target = new URL(raw, window.location.href).href;
    } catch {
        /* keep the raw string; window.open will reject it below if unusable */
    }

    const opened = window.open(target, "_blank", "noopener,noreferrer");

    if (opened) return true;

    // Popup blocked (no user gesture — e.g. a postMessage-driven navigation).
    // Navigate top-level rather than falling back to the proxied frame: the
    // destination still renders natively, just without the Bolt chrome.
    try {
        window.location.assign(target);
    } catch {
        /* ignore; caller keeps its existing tab */
    }
    return true;
}

/** Returns `true` (and opens a native tab) when `url` needs breaking out. */
export function breakOutIfAuthUrl(url: string): boolean {
    if (!url || !isAuthUrl(url)) return false;
    return breakOutToNativeTab(url);
}

/** Frames already wired for click interception (outer-realm WeakSet). */
const wiredFrames = new WeakSet<Document>();

/**
 * Intercepts anchor clicks inside a proxied frame.
 *
 * The frame is same-origin (`/$/…`), so its document can be hooked directly —
 * this avoids patching the vendored Scramjet bundle. Runs in the capture phase
 * so it fires before the proxy's own handlers, and only ever acts on auth URLs,
 * leaving every ordinary link untouched.
 *
 * @param decode unwraps a proxied href (`dummyProxy.decodeProxiedUrl`).
 *               Passed in rather than imported so this stays testable.
 */
export function wireAuthBreakoutClicks(
    iframe: HTMLIFrameElement,
    decode: (url: string) => string,
): void {
    const attach = () => {
        let doc: Document | null = null;
        try {
            doc = iframe.contentDocument;
        } catch {
            return; // cross-origin frame — not ours to hook
        }
        if (!doc || wiredFrames.has(doc)) return;
        wiredFrames.add(doc);

        doc.addEventListener(
            "click",
            (event) => {
                const target = event.target as {
                    closest?: (selector: string) => { getAttribute(name: string): string | null } | null;
                } | null;

                // Avoid `instanceof Element`: the proxied document lives in a
                // separate realm, so the outer realm's constructor won't match.
                const anchor =
                    target && typeof target.closest === "function"
                        ? target.closest("a[href]")
                        : null;
                if (!anchor) return;

                const href = anchor.getAttribute("href");
                if (!href) return;

                let resolved = href;
                try {
                    resolved = decode(href);
                } catch {
                    /* unparseable href — fall through and test it raw */
                }

                if (!isAuthUrl(resolved)) return;

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                breakOutToNativeTab(resolved);
            },
            true,
        );
    };

    iframe.addEventListener("load", attach);
    attach();
}

/* ── OAuth return path ───────────────────────────────────────────────────── */

const RETURN_KEY = "bolt.auth.return";
const RETURN_CHANNEL = "bolt-auth-return";

export type AuthReturn = {
    /** `code`, `access_token`, `id_token`, or `error` — never log these. */
    state?: string;
    code?: string;
    error?: string;
};

/**
 * Called by the redirect-URI page. Stores the payload on this origin and
 * closes the tab. No token ever travels in the URL fragment or query string of
 * a page that could leak a Referer.
 */
export function deliverAuthReturn(payload: AuthReturn): void {
    try {
        localStorage.setItem(RETURN_KEY, JSON.stringify(payload));
    } catch {
        /* storage unavailable — BroadcastChannel below still fires */
    }

    try {
        new BroadcastChannel(RETURN_CHANNEL).postMessage(payload);
    } catch {
        /* BroadcastChannel unsupported; the storage event covers it */
    }

    setTimeout(() => {
        try {
            window.close();
        } catch {
            /* non-script-opened tabs cannot self-close; harmless */
        }
    }, 400);
}

/**
 * Subscribes the proxy session to a returning OAuth tab. Fires at most once.
 *
 * Uses the `storage` event (fires in *other* same-origin tabs) and a
 * BroadcastChannel, because `window.opener` is unavailable by design.
 */
export function onAuthReturn(handler: (payload: AuthReturn) => void): () => void {
    let done = false;
    const finish = (payload: AuthReturn) => {
        if (done) return;
        done = true;
        handler(payload);
        cleanup();
    };

    const onStorage = (event: StorageEvent) => {
        if (event.key !== RETURN_KEY || !event.newValue) return;
        try {
            finish(JSON.parse(event.newValue) as AuthReturn);
        } catch {
            /* malformed payload — ignore */
        }
    };

    let channel: BroadcastChannel | null = null;
    const onMessage = (event: MessageEvent) => finish(event.data as AuthReturn);

    const cleanup = () => {
        window.removeEventListener("storage", onStorage);
        try {
            channel?.close();
        } catch {
            /* already closed */
        }
    };

    window.addEventListener("storage", onStorage);
    try {
        channel = new BroadcastChannel(RETURN_CHANNEL);
        channel.addEventListener("message", onMessage);
    } catch {
        /* storage event alone is sufficient */
    }

    return cleanup;
}

/* ── Proxy cookie-jar injection ───────────────────────────────────────────── */

export type ProxyCookie = {
    name: string;
    value: string;
    /** ".google.com" — leading dot widens it to subdomains. */
    domain: string;
    path?: string;
    /** Defaults to `true`; the jar drops Secure cookies on http:// targets. */
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    maxAge?: number;
};

/** Serialises to the `Set-Cookie` shape the engine's jar parser expects. */
export function serializeProxyCookie(cookie: ProxyCookie): string {
    const parts = [`${cookie.name}=${cookie.value}`, `Domain=${cookie.domain}`];
    parts.push(`Path=${cookie.path ?? "/"}`);
    if (cookie.secure !== false) parts.push("Secure");
    if (cookie.httpOnly) parts.push("HttpOnly");
    if (cookie.sameSite) parts.push(`SameSite=${cookie.sameSite}`);
    if (typeof cookie.maxAge === "number") parts.push(`Max-Age=${cookie.maxAge}`);
    return parts.join("; ");
}

/**
 * The engine only takes over the page once its worker controls it. On a
 * first-party callback the controller can still be null, so wait briefly for
 * `controllerchange` rather than silently dropping the cookies.
 */
export async function waitForServiceWorkerController(
    timeoutMs = 3000,
): Promise<ServiceWorker | null> {
    if (!("serviceWorker" in navigator)) return null;
    if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;

    // Pages that never load the proxy bundle have no registration at all, so
    // register it here instead of timing out silently.
    try {
        await navigator.serviceWorker.register("/sw.js");
    } catch {
        /* already registered, or blocked — the wait below still applies */
    }

    return new Promise((resolve) => {
        if (navigator.serviceWorker.controller) {
            resolve(navigator.serviceWorker.controller);
            return;
        }

        const done = () => {
            clearTimeout(timer);
            navigator.serviceWorker.removeEventListener("controllerchange", done);
            resolve(navigator.serviceWorker.controller);
        };
        const timer = setTimeout(done, timeoutMs);
        navigator.serviceWorker.addEventListener("controllerchange", done);
    });
}

/**
 * Injects cookies directly into the engine's emulated jar.
 *
 * Posts the same `{ scramjet$type: "cookie" }` message the rewritten
 * `document.cookie` setter emits, so the jar applies them on the next proxied
 * request. This is additive — unlike `ScramjetController.loadcookies()`, which
 * **replaces the entire jar** (and silently ignores a non-string argument).
 *
 * NOTE: cookies must be obtained from a source that actually has them. An
 * OAuth redirect URL does not carry the provider's session cookies.
 *
 * @returns how many cookies were posted to the worker.
 */
export async function injectProxyCookies(
    cookies: ProxyCookie[],
): Promise<number> {
    if (!cookies.length) return 0;
    if (!("serviceWorker" in navigator)) return 0;

    const controller = await waitForServiceWorkerController();
    if (!controller) return 0;

    let injected = 0;
    for (const cookie of cookies) {
        const host = cookie.domain.replace(/^\./, "");
        controller.postMessage({
            scramjet$type: "cookie",
            cookie: serializeProxyCookie(cookie),
            url: `https://${host}${cookie.path ?? "/"}`,
        });
        injected++;
    }
    return injected;
}
