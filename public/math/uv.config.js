/*global Ultraviolet*/
// NOTE: the `wisp` key below is NOT read by this Ultraviolet build (0 hits of
// "wisp" across uv.bundle/handler/client/sw.js). Its transport is the Bare
// client (`barews` in uv.client.js) pointed at `bare: '/bare/'`, for which the
// server registers no route -- so the Ultraviolet engine has no working egress
// regardless of this value. Scramjet is the configured engine and it is the one
// that honours the wisp endpoint (src/scripts/proxy.ts).
self.__uv$config = {
    prefix: '/maths/',
    bare: '/bare/',
    wisp: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/wisp/',
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: '/math/uv.handler.js',
    client: '/math/uv.client.js',
    bundle: '/math/uv.bundle.js',
    config: '/math/uv.config.js',
    sw: '/math/uv.sw.js',
};
