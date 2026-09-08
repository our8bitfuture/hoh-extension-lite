/*
 * Isolated-world content script. Its only job is to take the session the
 * MAIN-world hook lifted off the game's traffic and put it in extension
 * storage, where the popup and the console can read it.
 */
(() => {
  "use strict";

  const SOURCE = "hohLitePage";
  const EVT_CREDS = "hohLiteCredentials";
  const SESSION_KEY = "hohSession";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.event !== EVT_CREDS || !data.session) return;
    chrome.storage.local.set({ [SESSION_KEY]: data.session });
  });
})();
