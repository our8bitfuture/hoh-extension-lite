/*
 * Shared plumbing for the extension's own pages (popup and console).
 * Content scripts do not import this — they run as classic scripts.
 */

export const SESSION_KEY = "hohSession";

// --- protobuf request bodies ------------------------------------------------
// The game's request bodies are protobuf. The ones we need are one or two
// scalar fields, so hand-encoding beats shipping a protobuf runtime.

/**
 * Encoded through BigInt: the game's ids are int64s, and `>>>` would quietly
 * wrap anything past 32 bits into a different alliance's id.
 */
export const varint = (value) => {
  let n;
  try {
    const text = typeof value === "bigint" ? value : String(value).trim();
    if (text === "") throw new Error("empty");
    n = BigInt(text);
  } catch {
    throw new Error(`"${value}" is not a whole number`);
  }
  if (n < 0n) throw new Error("varints cannot be negative");

  const bytes = [];
  while (n > 0x7fn) {
    bytes.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return bytes;
};

/** field number `field`, wire type 0 (varint) */
export const pbVarintField = (field, value) => [(field << 3) | 0, ...varint(value)];

/** field number `field`, wire type 2 (length-delimited), UTF-8 payload */
export const pbStringField = (field, text) => {
  const bytes = Array.from(new TextEncoder().encode(text));
  return [(field << 3) | 2, ...varint(bytes.length), ...bytes];
};

export const toBase64 = (byteArray) => {
  if (!byteArray || byteArray.length === 0) return null;
  // Encode in slices: String.fromCharCode over a whole multi-megabyte body at
  // once blows the argument limit, and byte-at-a-time concatenation is glacial.
  const bytes = byteArray instanceof Uint8Array ? byteArray : Uint8Array.from(byteArray);
  const slice = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += slice) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + slice));
  }
  return btoa(binary);
};

export const fromBase64 = (b64) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// --- oversized response bodies ----------------------------------------------
// Extension messaging caps a single message at 64 MiB, and /game/gamedesign is
// comfortably past that once base64 has added its third. Bodies over the cap are
// handed back as a chunk ticket instead, and pulled one message at a time.
//
// The split is on base64 characters, not bytes: with a chunk length that is a
// multiple of four, every chunk decodes on its own and plain concatenation puts
// the original string back together.

export const B64_CHUNK_CHARS = 4 * 1024 * 1024;

export const splitBase64 = (b64) => {
  const chunks = [];
  for (let i = 0; i < b64.length; i += B64_CHUNK_CHARS) {
    chunks.push(b64.slice(i, i + B64_CHUNK_CHARS));
  }
  return chunks;
};

// --- endpoint catalogue -----------------------------------------------------
// `fields` describes the request body so the console can prefill its builder;
// `body` is what actually gets encoded.

export const ENDPOINTS = [
  {
    id: "startup",
    label: "Startup — full account snapshot",
    path: "/game/startup",
    note: "Everything the client loads at boot: city, heroes, inventory, alliance, events.",
  },
  {
    id: "ranking-player-rp",
    label: "Player leaderboard (ranking points)",
    path: "/game/ranking/player",
    note: "Top 100 plus your own position.",
  },
  {
    id: "ranking-player-trophy",
    label: "Player leaderboard (trophies)",
    path: "/game/ranking/player",
    fields: [{ field: 1, type: "varint", value: "1" }],
  },
  {
    id: "ranking-alliance",
    label: "Alliance leaderboard",
    path: "/game/ranking/alliance",
    fields: [{ field: 1, type: "varint", value: "2" }],
  },
  {
    id: "alliance-members",
    label: "Alliance members",
    path: "/game/alliances/members",
    fields: [{ field: 1, type: "varint", value: "" }],
    note: "field 1 = alliance id, out of a startup snapshot.",
  },
  {
    id: "player-profile",
    label: "Player profile",
    path: "/game/player/profile",
    fields: [{ field: 1, type: "varint", value: "" }],
    note: "field 1 = player id, out of a startup snapshot.",
  },
  {
    id: "alliance-search",
    label: "Alliance search",
    path: "/game/alliances/search",
    fields: [
      { field: 1, type: "varint", value: "20" },
      { field: 2, type: "varint", value: "0" },
    ],
    note: "field 1 = page size, field 2 = page index, field 3 = search string.",
  },
  {
    id: "gamedesign",
    label: "Game design (large — all definitions)",
    path: "/game/gamedesign",
    fields: [{ field: 1, type: "string", value: "invalid" }],
    note: "Multi-megabyte static definition dump. Changes only when the server version does.",
  },
  {
    id: "loca",
    label: "Localisation strings",
    path: "/game/loca",
    fields: [
      { field: 1, type: "string", value: "en_DK" },
      { field: 2, type: "string", value: "invalid" },
    ],
    note: "Maps definition ids to display names.",
  },
];

export const endpointById = (id) => ENDPOINTS.find((e) => e.id === id);

/** Encode a console field list ({field, type, value}) into request bytes. */
export const encodeFields = (fields) => {
  const bytes = [];
  for (const row of fields) {
    const field = Number(row.field);
    const value = String(row.value ?? "").trim();
    if (!field && value === "") continue;
    if (!Number.isInteger(field) || field < 1) throw new Error("Field numbers must be 1 or greater.");
    if (row.type === "string") {
      bytes.push(...pbStringField(field, value));
    } else {
      // Empty would encode as 0, which the server answers with an error about an
      // id nobody meant to send. Say what is missing instead.
      if (value === "") throw new Error(`Field ${field}: this call needs a value.`);
      if (!/^\d+$/.test(value)) throw new Error(`Field ${field}: varint needs a non-negative integer.`);
      bytes.push(...pbVarintField(field, value));
    }
  }
  return bytes.length ? Uint8Array.from(bytes) : null;
};

// --- transport --------------------------------------------------------------

const unwrap = (response) => {
  if (!response) throw new Error("the extension service worker did not respond");
  if (response.error) throw new Error(response.error);
  return response.result;
};

/**
 * Turn a result into its body bytes, pulling the chunks in sequence when the
 * body was too big to come back in one message.
 */
const readBody = async (result) => {
  if (!result.chunks) return result.bodyB64 ? fromBase64(result.bodyB64) : new Uint8Array(0);
  let b64 = "";
  for (let index = 0; index < result.chunks.count; index += 1) {
    b64 += unwrap(await chrome.runtime.sendMessage({ type: "hohChunk", id: result.chunks.id, index }));
  }
  return fromBase64(b64);
};

/**
 * POST to the game API through the service worker, which carries the captured
 * token and rewrites Origin back to the game's own.
 *
 * Returns {json, status, contentType, bytes, ms} — `json` is null for non-JSON
 * replies.
 */
export const callApi = async (path, bodyBytes, { accept = "application/json" } = {}) => {
  const request = { path, bodyB64: toBase64(bodyBytes), accept };
  const started = performance.now();

  const result = unwrap(await chrome.runtime.sendMessage({ type: "hohFetch", request }));
  const bytes = await readBody(result);
  const ms = Math.round(performance.now() - started);
  const meta = { status: result.status, contentType: result.contentType, bytes, ms };

  if (!result.contentType.includes("json")) {
    if (!result.ok) throw new Error(`${path} failed with HTTP ${result.status}`);
    return { json: null, ...meta };
  }

  const text = new TextDecoder().decode(bytes);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned a body that is not JSON (HTTP ${result.status})`);
  }

  if (json.errorType === "SoftErrorType_REQUEST_SESSION_EXPIRED") {
    throw new Error("Session expired. Reload the game tab to get a fresh token.");
  }
  if (json.errorType) throw new Error(`${path} failed: ${json.errorType}`);
  if (json.status && json.error) throw new Error(`${path} failed: ${json.status} — ${json.error}`);
  if (!result.ok) throw new Error(`${path} failed with HTTP ${result.status}`);

  return { json, ...meta };
};

// --- formatting -------------------------------------------------------------

export const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

// --- redaction --------------------------------------------------------------
// A /game/startup snapshot carries live credentials — SocketLoginResponse.token
// is a working chat login. Everything stays on this machine while it sits in
// storage, but a downloaded file is the one copy that tends to get mailed
// around, so credentials are blanked on the way out.

export const REDACTED = "[redacted by HoH Token & API Console]";

/**
 * Exact key names only, and never numbers: the game has its own currencies and
 * counters with names like `tokens`, and blanking those would quietly corrupt
 * the very data the download is for.
 */
const SENSITIVE_KEYS = new Set([
  "token",
  "authtoken",
  "auth_token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "sessiontoken",
  "session_token",
  "sessionid",
  "session_id",
  "jwt",
  "password",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "credential",
  "credentials",
  "x-auth-token",
]);

/**
 * A deep copy with credential-shaped fields blanked. Returns the copy plus the
 * dot-paths that were hit, so the caller can say what it took out rather than
 * silently changing the payload.
 */
export const redactSecrets = (value) => {
  const hits = [];

  const walk = (node, here) => {
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${here}${here ? "." : ""}${i}`));
    if (!node || typeof node !== "object") return node;

    const copy = {};
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${here}${here ? "." : ""}${key}`;
      const sensitive =
        SENSITIVE_KEYS.has(key.toLowerCase()) && child !== null && typeof child !== "number";
      if (sensitive) {
        hits.push(childPath);
        copy[key] = REDACTED;
      } else {
        copy[key] = walk(child, childPath);
      }
    }
    return copy;
  };

  return { value: walk(value, ""), redacted: hits };
};

/**
 * Write a JSON file. Redaction happens here rather than at each call site, so a
 * new download path cannot forget it. Returns the paths that were blanked.
 */
export const downloadJson = (filename, value) => {
  const { value: safe, redacted } = redactSecrets(value);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return redacted;
};
