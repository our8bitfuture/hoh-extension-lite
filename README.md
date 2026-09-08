# HoH Token & API Console

A small Chrome extension for [Heroes of History](https://heroesofhistorygame.com)
players who want to work with their **own** game data.

Click the toolbar button and you get two things:

- **Copy token** — puts your live `X-AUTH-TOKEN` on the clipboard, for use with
  your own scripts or tools.
- **Open API console** — a page for POSTing to the game's endpoints and reading
  the JSON that comes back.

Nothing is sent anywhere. The token is read off the game's own requests in your
browser, kept in extension storage, and used only for calls you ask for.

```
 ● session captured
 un1.heroesofhistorygame.com · client 1.53.3 · captured 7:32:20 PM

 [        Copy token        ]
 [    Open API console      ]
```

## Install

1. Clone or download this repo.
2. Go to `chrome://extensions`, turn on **Developer mode**.
3. **Load unpacked** → pick this folder.
4. Open the game in a tab and let it load — the extension reads the session off
   the first request the client makes.

## How it works

| File | Job |
| --- | --- |
| `src/inject.js` | Runs in the page's own world; hooks `XMLHttpRequest` and `fetch` to read `X-AUTH-TOKEN`, `X-ClientVersion` and the API host off the game's traffic. |
| `src/content.js` | Isolated-world half; writes what the hook saw into `chrome.storage.local`. |
| `src/background.js` | Makes the API calls, with a `declarativeNetRequest` session rule that rewrites `Origin`/`Referer` back to the game's own. Chunks bodies over the 64 MiB message cap. |
| `src/shared.js` | Endpoint catalogue, protobuf field encoding, transport, redaction. |
| `content/popup.*` | The two buttons. |
| `content/console.*` | The console page. |
| `tools/make_icons.py` | Regenerates `icons/*.png`. |

Request bodies are protobuf. The ones these endpoints need are one or two scalar
fields, so the console encodes them by hand (field number + varint/string)
rather than shipping a protobuf runtime. The server answers the same endpoints
in JSON when asked to, which is why the responses are readable.

### Permissions, and why each one is there

- `storage` — keep the captured session and nothing else.
- `declarativeNetRequestWithHostAccess` — one session rule that sets `Origin`
  and `Referer` on the extension's own requests to the game API.
- `https://*.heroesofhistorygame.com/*` — the game, and only the game.

There is no `tabs`, no `scripting`, no remote code, no analytics, no server.

### Downloads are redacted

A `/game/startup` snapshot contains live credentials (the chat login token, for
one). While it sits in your browser that is your business, but a downloaded file
is the copy that tends to get mailed around, so credential-shaped keys are
blanked on the way out and the console tells you how many it blanked.

## Caveats

- The token is short-lived. Reload the game tab when a call comes back with
  `session expired`.
- Calls go out from the extension itself, so a game tab does not need to stay
  open — but the session has to have been captured at least once.
- Unofficial, unaffiliated, and read-only by intent: it calls the same endpoints
  the client calls at boot. Use it on your own account.

The XHR hook is modelled on [IngweLand/hoh-helper](https://github.com/IngweLand/hoh-helper)
(AGPL), which in turn came from the FoE-Helper extension.

## Licence

MIT — see `LICENSE`.
