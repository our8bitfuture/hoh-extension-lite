/*
 * Service worker. Issues API calls straight from the extension, so the console
 * does not depend on a game tab being open with a live content script.
 *
 * `fetch` from an extension page/worker with host permissions is not subject to
 * CORS, but Chrome stamps it with `Origin: chrome-extension://<id>`. The game
 * backend is addressed by the browser client from the game's own origin, so we
 * rewrite Origin/Referer back to that with a declarativeNetRequest session rule
 * scoped to requests that come from no tab (i.e. ours, not the game page's).
 */

import { SESSION_KEY, fromBase64, splitBase64, toBase64, B64_CHUNK_CHARS } from "./shared.js";

/** The one place the game's domain lives outside manifest.json. */
const GAME_DOMAIN = "heroesgame.com";

const ORIGIN_RULE_ID = 1;
const TAB_ID_NONE = -1; // chrome.tabs.TAB_ID_NONE

/** The origin the game client itself sends from. */
const gameOriginFor = (session) => {
  // The initiator of the captured request: the page (or frame) the client runs in.
  return session.pageOrigin || session.apiBase;
};

let appliedOrigin = null;

const syncOriginRule = async (origin) => {
  if (appliedOrigin === origin) return;

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ORIGIN_RULE_ID],
    addRules: [
      {
        id: ORIGIN_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Origin", operation: "set", value: origin },
            { header: "Referer", operation: "set", value: `${origin}/` },
          ],
        },
        condition: {
          requestDomains: [GAME_DOMAIN],
          urlFilter: "/game/",
          resourceTypes: ["xmlhttprequest"],
          // Only our own requests — the game page's requests come from a tab.
          tabIds: [TAB_ID_NONE],
        },
      },
    ],
  });

  appliedOrigin = origin;
};

// --- session capture --------------------------------------------------------
// The session is read off the game's own requests as the browser sends them,
// rather than by hooking the page's XHR/fetch. That sees every request the
// client makes — from the top page, an iframe or a worker, over XHR or fetch —
// so a client rebuild does not quietly stop capture while an old session sits
// in storage looking healthy.
//
// Every X-* header the client sends is kept and replayed, so a header the game
// starts to require in a later patch comes along without a code change. Only
// the per-call ones are regenerated.

const PER_CALL_HEADERS = new Set(["x-request-id", "x-action-at"]);
const CAPTURED_HEADERS = /^(x-|authorization$)/;
/** How often a still-valid session has its last-seen time rewritten. */
const SEEN_WRITE_MS = 60000;

let lastSignature = null;
let lastWrite = 0;

const captureSession = async (details) => {
  // Our own calls carry the token too; the game's are the source of truth.
  if (details.initiator && details.initiator.startsWith("chrome-extension://")) return;

  const url = new URL(details.url);
  if (!url.pathname.startsWith("/game/")) return; // login, chat and assets carry other tokens

  const headers = {};
  for (const { name, value } of details.requestHeaders || []) {
    const key = name.toLowerCase();
    if (CAPTURED_HEADERS.test(key) && !PER_CALL_HEADERS.has(key) && value !== undefined) {
      headers[key] = value;
    }
  }
  if (!headers["x-auth-token"]) return;

  const now = Date.now();
  const signature = JSON.stringify([url.origin, headers]);
  if (signature === lastSignature && now - lastWrite < SEEN_WRITE_MS) return;

  const session = {
    authToken: headers["x-auth-token"],
    clientVersion: headers["x-clientversion"] || "?",
    headers,
    apiBase: url.origin,
    pageOrigin: details.initiator || null,
    seenAt: new Date(now).toISOString(),
  };
  if (signature !== lastSignature) session.capturedAt = session.seenAt;
  else {
    const stored = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
    session.capturedAt = (stored && stored.capturedAt) || session.seenAt;
  }

  lastSignature = signature;
  lastWrite = now;
  await chrome.storage.local.set({ [SESSION_KEY]: session });
};

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    captureSession(details).catch((err) => console.warn("[hoh-lite] could not store the session", err));
  },
  { urls: [`https://*.${GAME_DOMAIN}/game/*`] },
  ["requestHeaders"]
);

// A session from before an update was captured under whatever the game looked
// like then. Drop it rather than guess at migrating it; the next game load
// captures a fresh one.
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove(SESSION_KEY));

// --- oversized bodies -------------------------------------------------------
// A single extension message tops out at 64 MiB and /game/gamedesign is bigger
// than that, so an outsized body is parked here and handed over a chunk per
// message. The buffer is dropped as soon as the last chunk is collected, and
// expires on its own if the caller walks away mid-transfer.

const CHUNK_TTL_MS = 120000;
const parked = new Map();

const parkChunks = (chunks) => {
  const id = crypto.randomUUID();
  parked.set(id, { chunks, timer: setTimeout(() => parked.delete(id), CHUNK_TTL_MS) });
  return { id, count: chunks.length };
};

const takeChunk = (id, index) => {
  const entry = parked.get(id);
  if (!entry) throw new Error("that response is no longer buffered — run the call again");
  const chunk = entry.chunks[index];
  if (chunk === undefined) throw new Error(`chunk ${index} is past the end of that response`);
  if (index === entry.chunks.length - 1) {
    clearTimeout(entry.timer);
    parked.delete(id);
  }
  return chunk;
};

const callGameApi = async (request) => {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const session = stored[SESSION_KEY];
  if (!session) {
    throw new Error("No session captured yet. Open the game and let it load.");
  }

  try {
    await syncOriginRule(gameOriginFor(session));
  } catch (err) {
    // Worth trying the call anyway — the server may not check Origin at all.
    console.warn("[hoh-lite] could not install the Origin rewrite rule", err);
  }

  const headers = {
    // Whatever the client itself sent: token, client version, platform, and
    // anything a later patch adds.
    ...session.headers,
    // The game asks for protobuf; the server honours JSON on the same endpoints.
    Accept: request.accept || "application/json",
    "Content-Type": "application/x-protobuf",
    // Must be unique per call, or the server replays the previous response.
    "X-Request-Id": crypto.randomUUID(),
    "X-Action-At": new Date().toISOString(),
  };

  const body = request.bodyB64 ? fromBase64(request.bodyB64) : new Uint8Array(0);
  const response = await fetch(session.apiBase + request.path, { method: "POST", headers, body });
  const buffer = await response.arrayBuffer();

  const meta = {
    authToken: session.authToken, // so a rejection is pinned to the token that earned it
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("Content-Type") || "",
  };

  const bodyB64 = toBase64(new Uint8Array(buffer));
  if (bodyB64 && bodyB64.length > B64_CHUNK_CHARS) {
    return { ...meta, chunks: parkChunks(splitBase64(bodyB64)) };
  }
  return { ...meta, bodyB64 };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "hohChunk") {
    try {
      sendResponse({ result: takeChunk(message.id, message.index) });
    } catch (err) {
      sendResponse({ error: String((err && err.message) || err) });
    }
    return undefined;
  }

  if (!message || message.type !== "hohFetch") return undefined;

  callGameApi(message.request).then(
    (result) => sendResponse({ result }),
    (err) => sendResponse({ error: String((err && err.message) || err) })
  );
  return true; // keep the channel open for the async response
});
