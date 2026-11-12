# HoH Token & API Console

A small Chrome extension for [Heroes of History](https://www.heroesgame.com)
players who want to work with their **own** game data.

Click the toolbar button and you get two things:

- **Copy token** — puts your live `X-AUTH-TOKEN` on the clipboard, for use with
  your own scripts or tools.
- **Open API console** — a page for POSTing to the game's endpoints and reading
  the JSON that comes back.

Nothing is sent anywhere. The token is read off the game's own requests in your
browser, kept in extension storage, and used only for calls you ask for.

```
 ● session live
 un1.heroesgame.com · client 1.53.3 · seen just now

 [        Copy token        ]
 [    Open API console      ]
```

## Install

1. Clone or download this repo.
2. Go to `chrome://extensions`, turn on **Developer mode**.
3. **Load unpacked** → pick this folder.
4. Open the game in a tab and let it load — the extension reads the session off
   the first API request the client makes.

The dot is green while the game is using the session, amber once the game has
not used it for half an hour, and red when the server has turned the token down.
Updating the extension clears the stored session; reload the game to capture a
new one.

## How it works

| File | Job |
| --- | --- |
| `src/background.js` | Reads the session off the game's `/game/*` requests with `webRequest`, and makes the API calls, with a `declarativeNetRequest` session rule that rewrites `Origin`/`Referer` back to the game's own. Chunks bodies over the 64 MiB message cap. |
| `src/shared.js` | Endpoint catalogue, protobuf field encoding, transport, session status, redaction. |
| `content/popup.*` | The two buttons. |
| `content/console.*` | The console page. |
| `tools/make_icons.py` | Regenerates `icons/*.png`. |

Request bodies are protobuf. The ones these endpoints need are one or two scalar
fields, so the console encodes them by hand (field number + varint/string)
rather than shipping a protobuf runtime. The server answers the same endpoints
in JSON when asked to, which is why the responses are readable.

### Permissions, and why each one is there

- `storage` — keep the captured session and nothing else.
- `webRequest` — read the headers on the game's own `/game/*` requests to pick up
  the session. Observe only: it cannot block or change anything.
- `declarativeNetRequestWithHostAccess` — one session rule that sets `Origin`
  and `Referer` on the extension's own requests to the game API.
- `https://*.heroesgame.com/*` — the game, and only the game.

There is no `tabs`, no `scripting`, no content script, no remote code, no
analytics, no server. Nothing runs inside the game page.

### Surviving game patches

The extension makes as few assumptions about the client as it can:

- The session is read from the requests the browser sends, not by hooking the
  page, so it does not care whether the client runs in the top page, an iframe
  or a worker, or uses XHR or fetch.
- Every `X-*` header the client sends is replayed on console calls, so a header
  a patch starts requiring comes along without a code change.
- The game's domain lives in `GAME_DOMAIN` in `src/background.js` and in
  `manifest.json`'s `host_permissions`. A domain move is a change to those two
  places and nothing else.

### Downloads are redacted

A `/game/startup` snapshot contains live credentials (the chat login token, for
one). While it sits in your browser that is your business, but a downloaded file
is the copy that tends to get mailed around, so credential-shaped keys are
blanked on the way out and the console tells you how many it blanked.

## Caveats

- The token is short-lived. Reload the game tab when the dot goes red.
- Calls go out from the extension itself, so a game tab does not need to stay
  open — but the session has to have been captured at least once.
- Unofficial, unaffiliated, and read-only by intent: it calls the same endpoints
  the client calls at boot. Use it on your own account.

## Licence

MIT — see `LICENSE`.
