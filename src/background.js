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

const ORIGIN_RULE_ID = 1;
const TAB_ID_NONE = -1; // chrome.tabs.TAB_ID_NONE

/** The page origin the game client itself uses, e.g. https://un0.heroesofhistorygame.com */
const gameOriginFor = (session) => {
  if (session.pageOrigin) return session.pageOrigin;
  // API host un1/zz1, page host un0/zz0.
  return session.apiBase.replace(/^https:\/\/(un|zz)\d/, (_, prefix) => `https://${prefix}0`);
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
          requestDomains: ["heroesofhistorygame.com"],
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
    // The game asks for protobuf; the server honours JSON on the same endpoints.
    Accept: request.accept || "application/json",
    "Content-Type": "application/x-protobuf",
    Authorization: "Basic",
    "X-AUTH-TOKEN": session.authToken,
    "X-ClientVersion": session.clientVersion,
    "X-OS": "Browser",
    "X-Platform": "Browser",
    "X-AppStore": "None",
    // Must be unique per call, or the server replays the previous response.
    "X-Request-Id": crypto.randomUUID(),
    "X-Action-At": new Date().toISOString(),
  };

  const body = request.bodyB64 ? fromBase64(request.bodyB64) : new Uint8Array(0);
  const response = await fetch(session.apiBase + request.path, { method: "POST", headers, body });
  const buffer = await response.arrayBuffer();

  const meta = {
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
