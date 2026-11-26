# Lightning RSS Reader

Single-file mobile-first PWA that talks to a FreshRSS instance through its Google Reader (GReader) API.
Personal setup details (server, domains, language preferences) live in `CLAUDE.local.md`, which is not committed.

## Conventions
- The app UI is in English. Never translate article content (it comes from FreshRSS as-is).
- Code comments are in English (public repo).
- Target browsers are Chromium-based (Android and desktop).
- Keep it one dependency-free file: no build step, no framework.

## Files
- `index.html`: all HTML, CSS and JS.
- `app.webmanifest`, `app-192.png`, `app-512.png`: the PWA manifest and icons actually in use (see "Gotchas").
- `sw.js`: service worker, push notifications only (no fetch handler, no offline cache).
- `server/server.js` + `Dockerfile` + `docker-compose.yml`: single Node container, zero dependencies. It serves the app files (baked into the image under `/app/www`), proxies `/api/` to `FRESHRSS_URL` (so the app stays same-origin with no code change) and runs the push notifier under `/push/` (Web Push encryption and VAPID via `node:crypto`; keys and subscriptions in `/data`). `/healthz` for the healthcheck. `.dockerignore` is a whitelist: add new app files there, in the `Dockerfile` and in `deploy.sh`.
- `.github/workflows/docker.yml`: (only when files that go into the image change, keep its `paths` list in sync with the `Dockerfile`) builds the image for amd64 and arm64 and pushes it to `ghcr.io/<owner>/lightning-rss-reader` (`latest` on every push to main, `X.Y.Z` / `X.Y` / `X` on `vX.Y.Z` tags).
- `unraid/lightning-rss-reader.xml`: Unraid Docker template for that image (port 3000 -> 8095, `FRESHRSS_URL`, `NOTIFICATIONS`, `VAPID_SUBJECT`, `/data`, `--user 99:100`). Keep it generic: no personal values.
- `deploy.sh`: rsyncs the build context, `docker-compose.yml` and `.env` over SSH, then runs `docker compose up -d --build`. Configured by `deploy.env` (git-ignored, see `deploy.env.example`).
- The version badge `<small id="ver">vNN</small>` sits in the top bar (currently v79). **Bump it on every change**: it is how to check which build a device loaded.

## Deployment
- The app must be served from the same origin as FreshRSS's `/api/greader.php` (it builds API URLs from `location.origin`). Either use the Docker container, which proxies `/api/`, or drop the files in FreshRSS's `p/` folder (no notifications then).
- Login uses the FreshRSS **API password** (not the account password). The page stores the returned Auth token in `localStorage.auth`.

## API usage (all under `/api/greader.php/reader/api/0/`)
- Login: `POST /api/greader.php/accounts/ClientLogin` (Email, Passwd) -> `Auth=...`; header `Authorization: GoogleLogin auth=<Auth>`.
- Write token: `GET token`; writes use `POST edit-tag` with `T`, `a`/`r` (`user/-/state/com.google/read`, `.../starred`, `user/-/label/NAME`) and repeated `i`.
- Unread: `stream/contents/reading-list?output=json&n=200&xt=user/-/state/com.google/read`.
- Read view: `reading-list?...&n=300&xt=user/-/state/com.google/unread`, then filter client-side on `categories` containing `.../read`. A direct `stream/contents/user/-/state/com.google/read` returned 400 on the instance this was developed against.
- Starred: `stream/contents/user/-/state/com.google/starred`.
- Labels/categories: `tag/list`: `type:'tag'` = labels, `type:'folder'` = categories. Item `categories` contains both as `user/-/label/NAME`.
- Soft sync (see below): `stream/items/ids` with `xt=read`, `n=1000`. `idNum()` converts both id forms to BigInt. This was written without access to the live instance, so verify it works if articles read elsewhere are not greyed out.
- Search is client-side only: FreshRSS has no text search in this API. It only covers already-loaded items.

## Features (what exists)
- Top bar: three view buttons (unread with count badge, read, starred), search/filter, refresh icon, options (gear), version.
- List cards: thumbnail (first `<img>`, fallback to enclosure; floated left, 96px), title, 160-char excerpt, source and date. Starred items show a star.
- Mark as read on scroll: `IntersectionObserver` (rootMargin `-48px` top). Only in the unread view, and only if the option is on. Opening an article marks it read.
- Read marks are queued in `pending` (persisted in `localStorage`) and flushed every 3 s, when the page is hidden, and before refreshes.
- Unread count = cards without `.read` in the DOM (not derived from `pending`; that caused a bug).
- End of list: an empty spacer of about one screen, then a button that is `position:sticky` (appears under the last article, then pins to the bottom of the screen). Tap or pull-up there = mark seen + sync + refresh (`refresh(true)`).
- Top-bar refresh icon = `refresh(false)`: sync and reload without marking the visible list as read.
- On app start and on returning to the app (`refresh(true,true)`, "auto"): a "No new articles" toast confirms the refresh when every fetched unread item was already in `seenIds`, the list as the user last had it on screen (snapshot on the first `pointerdown`/`keydown` after each refresh; on a cold start it is empty, so the toast only shows when there are no unread items). Comparing with the previous fetch was wrong: a refresh can run while the user is not looking.
- On returning to the app: refresh if the list is empty, all read, or at the top; otherwise `softSync()` greys articles read elsewhere without touching the list or scroll position, and if the server has unread ids newer than anything loaded it shows a tappable toast ("N new articles · Tap to refresh", 8 s, `toast(text,action,ms)`) that runs `refresh(false)`; any refresh hides it. Skipped in non-unread views and if the last sync was under 10 s ago.
- Search/filter popup: text (accent/case-insensitive, all words must match) plus categories/labels (any selected). Categories expand (chevron) to individual feeds from `subscription/list`; a fully checked category is stored in `filt.tags`, a partial one as feed ids in `filt.feeds` (matched on `origin.streamId`). The filter persists across refreshes. Hidden items are never marked read.
- Touch gestures:
  - Configurable in Options > Gestures (`GESTURES` / `GACT`, options `gCardRight`, `gCardLeft`, `gListUp`, `gListDown`, `gArtUp`, `gArtDown`, `gArtLeft`, `gArtRight`; select rows built in JS into `#ogest`). Card swipe actions (`cardAction()`, on that card's article): nothing, star, labels, open, share; the revealed area shows `CARDLBL[action]` through `data-lbl`. List actions (`listAction()`): nothing, refresh, mark all as read and refresh. Article actions (`artAction()`): nothing, close, next, previous, star, labels, open, share. "Nothing" disarms the gesture (no progress bar, no feedback). Defaults keep the original behaviour: card right = star, card left = labels, list up = mark all read + refresh, list down = refresh, article up/down = close, left = next, right = previous.
  - List: swipe a card right or left (configurable, see above). Pull up at the bottom and pull down at the top (the list follows the finger) run the configured actions in every view. Touches inside `NOPULL` (popups, options, article pane) never start a list pull. `html{overscroll-behavior-y:contain}` keeps the browser's own pull-to-refresh out of the way.
  - Article: swipe left/right (history is replaced for next/previous, so Back still returns to the list); pull up at the end or pull down at the top. The end-of-article hint and the end-of-list hint (`#endhint`, `applyGestures()`) follow the configured actions. While pulling up at the end or down at the top, the content follows the finger (`liftArt()`, damped `translateY` on `#art .in`, reset by `dropArt()`).
  - All gestures are ignored while pinch-zoomed.
  - Vibration at thresholds. Chrome blocks `navigator.vibrate` until the first tap after a reload (browser rule), and it is silent in the phone's silent mode. The progress bar thickens as a visual cue.
- Article toolbar (icons only): close (back to the list), star, open in browser, share (Web Share API), labels popup. Order and on/off are options (`opts.tbOrder`, `opts.tbOff`, Interface category): `applyTb()` reorders the `#tb` children, hides turned-off buttons with `.off` (separate from `hidden`, which `updateTb()` uses when an article has no link), hides the whole bar if every button is off (`html.notb`) and rebuilds the editor rows in `#otb` (toggle + up/down). New buttons go in `TBB`; ones missing from a saved order are appended. The title is also a link to the original.
- Options page (gear icon), stored in `localStorage.opts`, grouped in categories (`OCATS`: Interface, Behaviour, Gestures, Notifications; one `<section data-c>` each, plus a link in `#ocats`). `routeOpts()`: on phones `#options` shows the category list and `#options/<cat>` one category (new history entry, so Back returns to the list); at 900px and wider the list is a left column, `#options` shows the first category and switching uses `replaceState`. Contents: "Mark as read when scrolling" toggle, plus Top/Bottom segmented choices (`.seg`) for the list toolbar (`opts.listBar`, class `html.hdb` when bottom) and the article toolbar (`opts.artBar`, class `html.tbt` when top). Add new options to the matching section (or a new category in `OCATS`, the nav and the sections).
- Notifications (option off by default, interval 5 min to 3 h): `pushOn()` registers `sw.js`, subscribes with the server's VAPID key (`GET push/key`) and posts subscription + FreshRSS token + interval to `push/subscribe` (also on every app start). The notifier checks `stream/items/ids` per subscription; "new" = id greater than the largest id seen (FreshRSS ids grow with insertion time); first check only sets the baseline. Counts and titles accumulate until the app posts `push/seen` (on every visibility change). `sw.js` shows nothing if an app window is visible. Tag `unread` replaces the previous notification.
- List toolbar at the bottom: `#hd` gets `order:9` + `sticky bottom`; the observer rootMargin, `#sync` sticky offset and `seenLimit()` account for it.
- Two-column layout at 900px and wider: list on the left (scrolls in `#left`), article pane on the right (`#art`), draggable splitter (`--lw`, saved in `localStorage.lw`, double-click resets). Selecting an article uses `history.replaceState` + `route()`; nothing is selected after a refresh. Swipe gestures on cards are touch-only.
- Unread badge: `updateCount()` calls `setBadge(unreadN)`, which prefixes the title with `(N)` (Vivaldi turns that into a blue tab badge, like for FreshRSS) and calls `navigator.setAppBadge()` (only effective for installed PWAs on Windows/macOS/ChromeOS; no-op on Linux and Android, where launchers only badge notifications). The favicon itself is deliberately left unchanged (user preference). The push payload also carries `unread` (server-side total, up to 1000) so `sw.js` can set the app badge while the app is closed.
- Loading indicator: thin animated bar at the top plus a spinning refresh icon.

## Architecture notes
- Routing is hash-based: `#a/<index>` (article, index into `items`), `#options`. `route()` renders everything; on mobile `#art` is a full-screen overlay, in wide mode it is the right pane.
- `rawItems` = last fetched list; `items` = displayed (after filter). Card `data-i` is the index into `items`.
- The scrolling element differs by mode: `SC()` returns `#left` in wide mode, else `document.scrollingElement`. Use `vh()`, `toTop()`, `atBottom()`, `scrolledTop()` instead of `window.scrollY` / `innerHeight`.
- On mobile `#left` has `display:contents`, so the page layout is a flex column on `body`.

## Gotchas learned the hard way
- **Stale static files**: after replacing `manifest.webmanifest` and icons on the server, the old versions kept being served somewhere (NPM "Cache Assets" is off). Renaming the files (`app.webmanifest`, `app-*.png`) fixed it. Do the same for any new static asset. `index.html` updates are fine.
- **Android adaptive icons**: Samsung shows only about the central 66% of the icon. The glyph must stay inside a circle of radius about 28% of the canvas.
- **CSS class collisions**: `.sw` and `.swl` are the swipe states on list cards; the options switch is `.tgl`. Article content contains `<header>`, so the top bar rule is scoped to `#hd`.
- **`[hidden]{display:none!important}`** is needed because several IDs set `display:flex`.
- **`100dvh` was unreliable** in the Vivaldi PWA: use `html{height:100%}` and the `--vh` variable set from `innerHeight`.
- Article HTML from feeds can be broken or styled. It is sanitized with a `<template>`, inline styles and `on*` attributes are stripped, and `#art .in *` forces `position:static` and no floats. If a `<picture><source>` image fails, the sources are removed so the `<img>` fallback loads.
- **Idle CPU**: never leave an `infinite` animation running on a hidden element (`opacity:0` still animates). The loading bar used to animate `left` all the time and cost ~18% of a core; it is now only animated under `html.loading`, with `transform`.
- `markRead` must not rely on `pending` for counting: `pending` is emptied after each successful flush.
- **Swipes in Chromium**: on a diagonal move Chromium starts the vertical scroll in the first pixels (and fires `pointercancel` on pointer events), so swipes were lost. List and article swipes use touch events with a non-passive `touchmove`: the direction is decided at once (horizontal if `|dx|>|dy|`) and horizontal-ish moves call `preventDefault()` before the browser commits to scrolling; if `e.cancelable` is false the page is already scrolling and the swipe is dropped. Touch events also keep mouse drags from swiping.

## Testing
- No test suite. Syntax check after edits: extract the `<script>` content to a file and run `node --check` on it.
- Real behaviour (touch, haptics, layout) can only be checked on a real phone and desktop browser against a live FreshRSS instance. State clearly when something was not tested.
