/*global Ultraviolet*/

// Transport for the Ultraviolet engine must match the Scramjet engine's, or
// switching engines silently moves all proxied traffic back onto this server's
// IP. Resolved the same way src/scripts/proxy.ts resolves it: a runtime
// override in localStorage wins, then the shared public relay.
//
// localStorage does not exist inside a Service Worker (this file is loaded by
// importScripts there), so the read is guarded and simply falls through.
function __resolveWisp() {
    try {
        if (typeof localStorage !== "undefined") {
            const stored = localStorage.getItem("wisp-endpoint");
            if (stored) return stored;
        }
    } catch {
        /* service worker, or storage blocked */
    }
    // wss:// is not reachable from an insecure origin.
    if (location.protocol === "http:") return "ws://" + location.host + "/wisp/";
    return "wss://wisp.freewisp.org/";
}

self.__uv$config = {
    prefix: '/maths/',
    bare: '/bare/',
    wisp: __resolveWisp(),
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: '/math/uv.handler.js',
    client: '/math/uv.client.js',
    bundle: '/math/uv.bundle.js',
    config: '/math/uv.config.js',
    sw: '/math/uv.sw.js',
};
