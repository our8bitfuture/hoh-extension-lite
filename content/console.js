import {
  ENDPOINTS,
  SESSION_KEY,
  callApi,
  downloadJson,
  encodeFields,
  endpointById,
  formatBytes,
} from "../src/shared.js";

const el = (id) => document.getElementById(id);

/** The response currently on screen. */
let current = null; // {label, json, text}

/** Pretty-printing a multi-megabyte body locks the tab up; the download has it all. */
const RENDER_LIMIT = 2 * 1024 * 1024;

// --- session ----------------------------------------------------------------

let session = null;

const renderSession = (captured) => {
  session = captured;
  const chip = el("sessionChip");
  if (!session) {
    chip.textContent = "no session";
    chip.className = "chip bad";
    el("sessionDetail").textContent = "open the game in a tab and let it load";
    el("copyTokenButton").disabled = true;
    return;
  }
  chip.textContent = "session captured";
  chip.className = "chip ok";
  el("sessionDetail").textContent = [
    session.apiBase.replace(/^https:\/\//, ""),
    `client ${session.clientVersion}`,
    `captured ${new Date(session.capturedAt).toLocaleTimeString()}`,
  ].join(" · ");
  el("copyTokenButton").disabled = false;
};

const onCopyToken = async () => {
  if (!session) return;
  const button = el("copyTokenButton");
  await navigator.clipboard.writeText(session.authToken);
  button.textContent = "copied ✓";
  setTimeout(() => (button.textContent = "copy token"), 1400);
};

// --- request body builder ---------------------------------------------------

const addFieldRow = (field = { field: 1, type: "varint", value: "" }) => {
  const row = document.createElement("div");
  row.className = "field-row";

  const num = document.createElement("input");
  num.type = "number";
  num.min = "1";
  num.className = "field-num";
  num.placeholder = "field";
  num.value = field.field ?? "";

  const type = document.createElement("select");
  type.className = "field-type";
  for (const value of ["varint", "string"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    type.appendChild(option);
  }
  type.value = field.type || "varint";

  const value = document.createElement("input");
  value.type = "text";
  value.className = "field-value";
  value.placeholder = "value";
  value.value = field.value ?? "";

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Remove field";
  remove.addEventListener("click", () => row.remove());

  row.append(num, type, value, remove);
  el("fieldRows").appendChild(row);
};

const setFieldRows = (fields = []) => {
  el("fieldRows").innerHTML = "";
  for (const field of fields) addFieldRow(field);
};

const readFieldRows = () =>
  Array.from(el("fieldRows").children, (row) => ({
    field: row.querySelector(".field-num").value,
    type: row.querySelector(".field-type").value,
    value: row.querySelector(".field-value").value,
  }));

// --- endpoints --------------------------------------------------------------

let activeEndpointId = null;

const selectEndpoint = (endpoint) => {
  activeEndpointId = endpoint.id;
  el("pathInput").value = endpoint.path;
  setFieldRows(endpoint.fields || []);
  el("endpointNote").textContent = endpoint.note || "";
  el("endpointNote").classList.toggle("hidden", !endpoint.note);
  for (const button of el("endpointList").querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.id === endpoint.id);
  }
};

const renderEndpoints = () => {
  const list = el("endpointList");
  for (const endpoint of ENDPOINTS) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.dataset.id = endpoint.id;
    button.textContent = endpoint.label;
    button.addEventListener("click", () => selectEndpoint(endpoint));
    li.appendChild(button);
    list.appendChild(li);
  }
};

// --- send -------------------------------------------------------------------

const setStatus = (text, isError = false) => {
  el("responseMeta").textContent = text;
  el("responseMeta").classList.toggle("error", isError);
};

const showBody = (text, placeholder = false) => {
  el("responseBody").textContent = text;
  el("responseBody").classList.toggle("placeholder", placeholder);
};

const onSend = async () => {
  const path = el("pathInput").value.trim();
  if (!path.startsWith("/")) {
    setStatus("Path has to start with a slash, e.g. /game/startup", true);
    return;
  }

  let body;
  try {
    body = encodeFields(readFieldRows());
  } catch (err) {
    setStatus(err.message, true);
    return;
  }

  el("sendButton").disabled = true;
  setStatus(`POST ${path}…`);
  try {
    const response = await callApi(path, body, { accept: el("acceptSelect").value });
    const label = (endpointById(activeEndpointId) || {}).label || path;

    if (response.json === null) {
      current = null;
      setStatus(
        `HTTP ${response.status} · ${response.contentType} · ${formatBytes(response.bytes.length)} · ${response.ms} ms`
      );
      showBody("Body is not JSON — switch Accept to JSON to read it here.", true);
    } else {
      const text = JSON.stringify(response.json, null, 2);
      current = { label, json: response.json, text };
      setStatus(
        `HTTP ${response.status} · ${formatBytes(response.bytes.length)} · ${response.ms} ms`
      );
      showBody(
        text.length > RENDER_LIMIT
          ? `${text.slice(0, RENDER_LIMIT)}\n\n… truncated for display. Download for the whole body.`
          : text
      );
    }
  } catch (err) {
    current = null;
    setStatus(err.message, true);
    showBody("No response.", true);
  } finally {
    el("sendButton").disabled = false;
    el("copyJsonButton").disabled = !current;
    el("downloadButton").disabled = !current;
  }
};

const onCopyJson = async () => {
  if (!current) return;
  await navigator.clipboard.writeText(current.text);
  const button = el("copyJsonButton");
  button.textContent = "Copied ✓";
  setTimeout(() => (button.textContent = "Copy JSON"), 1400);
};

const onDownload = () => {
  if (!current) return;
  const name = el("pathInput").value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const redacted = downloadJson(`${name || "response"}.json`, current.json);
  if (redacted.length > 0) {
    setStatus(`${el("responseMeta").textContent} · ${redacted.length} credential(s) blanked in the file`);
  }
};

// --- init -------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  renderEndpoints();
  selectEndpoint(ENDPOINTS[0]);

  el("copyTokenButton").addEventListener("click", onCopyToken);
  el("addFieldButton").addEventListener("click", () => addFieldRow());
  el("sendButton").addEventListener("click", onSend);
  el("copyJsonButton").addEventListener("click", onCopyJson);
  el("downloadButton").addEventListener("click", onDownload);
  el("pathInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") onSend();
  });

  const stored = await chrome.storage.local.get(SESSION_KEY);
  renderSession(stored[SESSION_KEY] || null);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SESSION_KEY]) renderSession(changes[SESSION_KEY].newValue || null);
  });
});
