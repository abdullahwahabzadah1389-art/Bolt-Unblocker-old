/**
 * Bolt Live Chat
 * ==============
 * Polls the existing Supabase `iv_chat` table over its REST API and lets
 * visitors post messages. No new Supabase project or service-role key is
 * used — only the public publishable key, which is safe for browsers.
 *
 * Reads last 60 messages (id desc), posts { name, message }. The existing
 * Supabase daily noon-Eastern wipe clears the table; nothing here recreates
 * or modifies that job, and visitors can only read + post (no edit/delete).
 *
 * Messages are rendered with textContent only — never innerHTML — so user
 * input can never inject markup or script.
 *
 * This ships from public/ so Astro serves it verbatim on every page, the same
 * way /sw.js is loaded. (A bundled Layout script is attributed to a single
 * page by Astro's build, so it cannot act as a site-wide widget host.)
 */

(function () {
    "use strict";

    var SUPABASE_URL = "https://uigmxogewcaksotxkhji.supabase.co";
    var SUPABASE_KEY = "sb_publishable_rqgnsYMn_Pvus4uS5NmdBA_jJYxdrHM";
    var REST_TABLE = SUPABASE_URL + "/rest/v1/iv_chat";
    var SELECT_Q = "select=id,created_at,name,message&order=id.desc&limit=60";
    var POLL_MS = 3000;

    var LS_NAME = "boltChatName";
    var LS_STATE = "boltChatState"; // "open" | "closed" | "docked"

    function authHeaders() {
        return { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
    }

    function getState() {
        try {
            return localStorage.getItem(LS_STATE) || "closed";
        } catch (e) {
            return "closed";
        }
    }

    function setState(state) {
        try {
            localStorage.setItem(LS_STATE, state);
        } catch (e) {
            /* storage unavailable */
        }
    }

    function getSavedName() {
        try {
            return localStorage.getItem(LS_NAME) || "";
        } catch (e) {
            return "";
        }
    }

    function saveName(name) {
        try {
            localStorage.setItem(LS_NAME, name);
        } catch (e) {
            /* storage unavailable */
        }
    }

    function buildUi() {
        // ── Launcher (bottom-left 💬) ────────────────────────────────────
        var launcher = document.createElement("button");
        launcher.id = "chat-launcher";
        launcher.className = "chat-launcher";
        launcher.setAttribute("aria-label", "Open live chat");
        launcher.textContent = "\u{1F4AC}";

        // ── Dock tab (left edge, used when panel is docked) ─────────────
        var dockTab = document.createElement("button");
        dockTab.id = "chat-dock-tab";
        dockTab.className = "chat-dock-tab";
        dockTab.setAttribute("aria-label", "Show live chat");
        dockTab.setAttribute("title", "Show chat");
        dockTab.textContent = "\u{1F4AC}";

        // ── Panel ───────────────────────────────────────────────────────
        var panel = document.createElement("section");
        panel.id = "chat-panel";
        panel.className = "chat-panel";

        var header = document.createElement("header");
        header.className = "chat-header";

        var title = document.createElement("h2");
        title.className = "chat-title";
        title.textContent = "Live Chat";

        var controls = document.createElement("div");
        controls.className = "chat-controls";

        var dockBtn = document.createElement("button");
        dockBtn.id = "chat-dock-btn";
        dockBtn.className = "chat-ctl";
        dockBtn.type = "button";
        dockBtn.textContent = "Hide";
        dockBtn.setAttribute("aria-label", "Hide chat to the side");

        var closeBtn = document.createElement("button");
        closeBtn.id = "chat-close-btn";
        closeBtn.className = "chat-ctl";
        closeBtn.type = "button";
        closeBtn.textContent = "\u2715";
        closeBtn.setAttribute("aria-label", "Close chat");

        controls.appendChild(dockBtn);
        controls.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(controls);

        var body = document.createElement("div");
        body.id = "chat-messages";
        body.className = "chat-messages";
        body.setAttribute("aria-live", "polite");

        var status = document.createElement("p");
        status.id = "chat-status";
        status.className = "chat-status";
        status.textContent = "Connecting\u2026";

        var form = document.createElement("form");
        form.id = "chat-form";
        form.className = "chat-form";

        var nameInput = document.createElement("input");
        nameInput.id = "chat-name";
        nameInput.className = "chat-input chat-name";
        nameInput.type = "text";
        nameInput.maxLength = 32;
        nameInput.placeholder = "Your name";
        nameInput.autocomplete = "nickname";
        nameInput.value = getSavedName();

        var msgInput = document.createElement("input");
        msgInput.id = "chat-message";
        msgInput.className = "chat-input chat-message";
        msgInput.type = "text";
        msgInput.maxLength = 500;
        msgInput.placeholder = "Type a message\u2026";
        msgInput.autocomplete = "off";

        var sendBtn = document.createElement("button");
        sendBtn.id = "chat-send";
        sendBtn.className = "chat-send";
        sendBtn.type = "submit";
        sendBtn.textContent = "Send";

        form.appendChild(nameInput);
        form.appendChild(msgInput);
        form.appendChild(sendBtn);

        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(status);
        panel.appendChild(form);

        document.body.appendChild(launcher);
        document.body.appendChild(panel);
        document.body.appendChild(dockTab);

        wire({ launcher: launcher, panel: panel, dockTab: dockTab, dockBtn: dockBtn,
            closeBtn: closeBtn, form: form, body: body, status: status,
            nameInput: nameInput, msgInput: msgInput, sendBtn: sendBtn });
    }

    function applyState(state, els) {
        els.panel.classList.remove("chat-open", "chat-docked", "chat-closed");
        els.dockTab.classList.remove("chat-tab-visible");
        els.launcher.classList.remove("chat-launcher-hidden");

        if (state === "docked") {
            els.panel.classList.add("chat-docked");
            els.dockTab.classList.add("chat-tab-visible");
            els.launcher.classList.add("chat-launcher-hidden");
        } else if (state === "open") {
            els.panel.classList.add("chat-open");
            els.launcher.classList.add("chat-launcher-hidden");
        } else {
            els.panel.classList.add("chat-closed");
        }
    }

    function wire(els) {
        var go = function (state) {
            setState(state);
            applyState(state, els);
        };

        els.launcher.addEventListener("click", function () { go("open"); });
        els.dockTab.addEventListener("click", function () { go("open"); });
        els.dockBtn.addEventListener("click", function () { go("docked"); });
        els.closeBtn.addEventListener("click", function () { go("closed"); });

        els.nameInput.addEventListener("change", function () {
            saveName(els.nameInput.value.trim());
        });

        els.form.addEventListener("submit", function (e) {
            e.preventDefault();
            var name = els.nameInput.value.trim() || "Visitor";
            var message = els.msgInput.value.trim();
            if (!message) return;
            saveName(name);
            els.sendBtn.disabled = true;
            sendMessage(name, message)
                .then(function () {
                    els.msgInput.value = "";
                    fetchMessages(els);
                })
                .catch(function () {
                    els.status.textContent = "Could not send. Try again.";
                })
                .finally(function () {
                    els.sendBtn.disabled = false;
                });
        });

        // Initial paint + polling.
        fetchMessages(els);
        window.setInterval(function () { fetchMessages(els); }, POLL_MS);

        applyState(getState(), els);
    }

    function fetchMessages(els) {
        fetch(REST_TABLE + "?" + SELECT_Q, {
            method: "GET",
            headers: Object.assign({ "Content-Type": "application/json" }, authHeaders())
        })
            .then(function (res) {
                if (!res.ok) {
                    els.status.textContent = res.status === 404
                        ? "Chat unavailable."
                        : "Unable to load messages.";
                    return null;
                }
                return res.json();
            })
            .then(function (rows) {
                if (!rows) return;
                renderMessages(els.body, rows);
                els.status.textContent = rows.length === 0 ? "No messages yet \u2014 say hi!" : "";
            })
            .catch(function () {
                els.status.textContent = "Offline \u2014 retrying\u2026";
            });
    }

    function renderMessages(body, rows) {
        var wasNearBottom =
            body.scrollHeight - body.scrollTop - body.clientHeight < 60;

        // id desc from API → ascending so newest is at the bottom.
        var ordered = rows.slice().sort(function (a, b) { return a.id - b.id; });

        // Rebuild with text nodes only (never innerHTML) to stay XSS-safe.
        body.replaceChildren();
        ordered.forEach(function (row) {
            var item = document.createElement("div");
            item.className = "chat-msg";

            var meta = document.createElement("div");
            meta.className = "chat-msg-meta";

            var nameSpan = document.createElement("span");
            nameSpan.className = "chat-msg-name";
            nameSpan.textContent = row.name || "Visitor";

            var timeSpan = document.createElement("span");
            timeSpan.className = "chat-msg-time";
            timeSpan.textContent = formatTime(row.created_at);

            meta.appendChild(nameSpan);
            meta.appendChild(timeSpan);

            var text = document.createElement("div");
            text.className = "chat-msg-text";
            text.textContent = row.message || "";

            item.appendChild(meta);
            item.appendChild(text);
            body.appendChild(item);
        });

        if (wasNearBottom) {
            body.scrollTop = body.scrollHeight;
        }
    }

    function formatTime(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    function sendMessage(name, message) {
        return fetch(REST_TABLE, {
            method: "POST",
            headers: Object.assign({
                "Content-Type": "application/json",
                Prefer: "return=minimal"
            }, authHeaders()),
            body: JSON.stringify({ name: name, message: message })
        }).then(function (res) {
            if (!res.ok) throw new Error("send failed: " + res.status);
        });
    }

    function init() {
        // Top-level only: Layout.astro is used by proxied content, the games
        // window, and settings iframes, and the widget must not mount there.
        // Mirrors the guard in src/scripts/global.ts.
        if (window.self !== window.top) return;
        if (document.getElementById("chat-panel")) return; // already wired
        buildUi();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
