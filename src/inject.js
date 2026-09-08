/*
 * MAIN-world script. One job: watch the game's own XHR/fetch traffic and lift
 * the session headers (X-AUTH-TOKEN, X-ClientVersion) plus the API host off it,
 * then hand them to the isolated content script.
 *
 * The XHR hook is modelled on IngweLand/hoh-helper (AGPL), which in turn came
 * from the FoE-Helper extension. Nothing is ever sent off the machine.
 */
(() => {
  "use strict";

  const SOURCE = "hohLitePage";
  const EVT_CREDS = "hohLiteCredentials";

  const AUTH_HEADER = "x-auth-token";
  const VERSION_HEADER = "x-clientversion";

  /** Last set of session headers seen on the wire, or null before the game calls out. */
  let session = null;

  const postCredentials = (headers, url) => {
    const authToken = headers[AUTH_HEADER];
    const clientVersion = headers[VERSION_HEADER];
    if (!authToken || !clientVersion) return;

    let apiBase;
    try {
      apiBase = new URL(url, location.href).origin;
    } catch {
      return;
    }

    if (
      session &&
      session.authToken === authToken &&
      session.clientVersion === clientVersion &&
      session.apiBase === apiBase
    ) {
      return; // unchanged, no need to churn storage
    }

    session = {
      authToken,
      clientVersion,
      apiBase,
      pageOrigin: location.origin,
      capturedAt: new Date().toISOString(),
    };
    window.postMessage({ source: SOURCE, event: EVT_CREDS, session }, "*");
  };

  // --- XHR hook -------------------------------------------------------------

  const xhrState = new WeakMap();
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSetRequestHeader = XHR.setRequestHeader;
  const originalSend = XHR.send;

  const stateFor = (xhr) => {
    let state = xhrState.get(xhr);
    if (!state) {
      state = { url: "", headers: {} };
      xhrState.set(xhr, state);
    }
    return state;
  };

  XHR.open = function (method, url, ...rest) {
    const state = stateFor(this);
    state.url = String(url);
    state.headers = {};
    return originalOpen.call(this, method, url, ...rest);
  };

  XHR.setRequestHeader = function (name, value) {
    stateFor(this).headers[String(name).toLowerCase()] = String(value);
    return originalSetRequestHeader.call(this, name, value);
  };

  XHR.send = function (body) {
    try {
      const state = stateFor(this);
      postCredentials(state.headers, state.url);
    } catch (err) {
      console.warn("[hoh-lite] failed to read XHR session headers", err);
    }
    return originalSend.call(this, body);
  };

  // --- fetch hook -----------------------------------------------------------
  // The game currently uses XHR, but hook fetch too so a client change doesn't
  // silently break credential capture.

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === "string" ? input : input && input.url;
        const headers = {};
        const collect = (h) => {
          if (!h) return;
          if (typeof h.forEach === "function") {
            h.forEach((value, key) => (headers[String(key).toLowerCase()] = String(value)));
          } else if (Array.isArray(h)) {
            for (const [key, value] of h) headers[String(key).toLowerCase()] = String(value);
          } else {
            for (const key of Object.keys(h)) headers[key.toLowerCase()] = String(h[key]);
          }
        };
        if (input && typeof input === "object" && input.headers) collect(input.headers);
        if (init && init.headers) collect(init.headers);
        if (url) postCredentials(headers, url);
      } catch (err) {
        console.warn("[hoh-lite] failed to read fetch session headers", err);
      }
      return originalFetch.apply(this, arguments);
    };
  }
})();
