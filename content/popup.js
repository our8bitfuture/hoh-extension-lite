import { SESSION_KEY } from "../src/shared.js";

const el = (id) => document.getElementById(id);

/** The session currently on screen, or null before one has been captured. */
let session = null;

const render = (captured) => {
  session = captured;

  if (!session) {
    el("dot").className = "dot bad";
    el("stateText").textContent = "no session yet";
    el("detail").textContent = "open the game in a tab and let it load";
    el("copyButton").disabled = true;
    return;
  }

  el("dot").className = "dot ok";
  el("stateText").textContent = "session captured";
  el("detail").textContent = [
    session.apiBase.replace(/^https:\/\//, ""),
    `client ${session.clientVersion}`,
    `captured ${new Date(session.capturedAt).toLocaleTimeString()}`,
  ].join(" · ");
  el("copyButton").disabled = false;
};

const onCopy = async () => {
  if (!session) return;
  const button = el("copyButton");
  try {
    await navigator.clipboard.writeText(session.authToken);
    button.textContent = "Copied ✓";
    button.classList.add("done");
    setTimeout(() => {
      button.textContent = "Copy token";
      button.classList.remove("done");
    }, 1400);
  } catch {
    el("detail").textContent = "could not reach the clipboard";
  }
};

const onOpenConsole = async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("content/console.html") });
  window.close();
};

document.addEventListener("DOMContentLoaded", async () => {
  el("copyButton").addEventListener("click", onCopy);
  el("consoleButton").addEventListener("click", onOpenConsole);

  const stored = await chrome.storage.local.get(SESSION_KEY);
  render(stored[SESSION_KEY] || null);

  // A game tab loading while the popup is open should light it up straight away.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SESSION_KEY]) render(changes[SESSION_KEY].newValue || null);
  });
});
