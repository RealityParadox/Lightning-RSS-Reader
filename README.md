# Lightning RSS Reader

A fast, mobile-first reader for [FreshRSS](https://freshrss.org), built as a single HTML file.
It talks to your FreshRSS instance through its Google Reader (GReader) API and installs as a PWA on Android or desktop.

No build step, no framework, no dependencies: `index.html` holds all the HTML, CSS and JavaScript (plus a tiny `sw.js` service worker for notifications).

## Features

**Reading**
- Three views: unread (with a count badge), read and starred.
- Article cards with thumbnail, title, excerpt, source and date; full article view with the original link.
- Optional *mark as read while scrolling*, plus a button at the end of the list to mark everything seen and refresh.
- Read marks are queued and synced in the background. When you come back to the app, it refreshes if you were at the top of the list ("No new articles" confirms it when nothing changed); otherwise it greys out articles read on another device and offers a tappable "N new articles" toast instead of reshuffling the list.
- Search and filter: text search on loaded articles (accent and case insensitive), plus categories, individual feeds and labels.
- Two-column layout on wide screens, with a resizable splitter.
- Unread count in the page title (Vivaldi shows it as a tab badge) and on the installed app icon where the browser supports it (Windows, macOS, ChromeOS).

**Touch gestures**, each one configurable (or turned off) in the options:

| Gesture | Default action | Other actions |
|---|---|---|
| Swipe a card right / left in the list | Star / Labels | Open in browser, Share |
| Pull up at the end of the list | Mark all as read and refresh | Refresh |
| Pull down at the top of the list | Refresh | Mark all as read and refresh |
| Swipe left / right on an article | Next / Previous article | Close, Star, Labels, Open, Share |
| Pull up at the end / down at the top of an article | Close | Next, Previous, Star, Labels, Open, Share |

Gestures give visual feedback (the content follows the finger, progress bar) and a short vibration at the threshold.

**Options**, grouped in categories:
- *Interface*: list toolbar and article toolbar at the top or bottom; text size of the interface and of articles; thumbnails and excerpts in the list shown or hidden; article toolbar buttons (close, star, open, share, labels) turned on or off and reordered.
- *Behaviour*: mark as read while scrolling; what to do when returning to the app (refresh, only check for read and new articles, or nothing).
- *Gestures*: vibrations on or off, and the action of each gesture.
- *Notifications*: push notifications for new unread articles, checked by the server every 5 minutes to 3 hours, even when the app is closed (Docker container only).

## Requirements

- A FreshRSS instance with the API enabled (*Settings → Authentication → Allow API access*).
- An **API password** set in your FreshRSS profile (*Settings → Profile → API management*). The reader logs in with your username and this API password, not your account password.
- A Chromium-based browser is the main target (Chrome, Edge, Vivaldi, Samsung Internet...).

## Installation

The reader calls the FreshRSS API on its own site (`/api/greader.php`), so it must be served from the same origin as that API. Two ways to do that:

### Option 1: Docker container (recommended)

A single container (Node.js, no dependencies) serves the app, proxies `/api/` to FreshRSS and sends the push notifications. It can live on its own (sub)domain and is independent of your FreshRSS install.

The image is published on GitHub Container Registry: `ghcr.io/realityparadox/lightning-rss-reader` (`latest` follows the main branch, version tags are also published), for amd64 and arm64.

```bash
docker run -d --name lightning-rss-reader -p 8095:3000 \
  -e FRESHRSS_URL=http://192.168.1.10:8080 \
  -v /path/to/data:/data \
  ghcr.io/realityparadox/lightning-rss-reader:latest
```

Set `FRESHRSS_URL` to your FreshRSS address as seen from the container, without a trailing slash (for example `http://192.168.1.10:8080`, or FreshRSS's public URL). The reader then listens on port `8095`: point your reverse proxy (with HTTPS) at it. HTTPS is required for the PWA to install and for notifications.

To build the image yourself instead, clone this repository, copy `.env.example` to `.env`, set `FRESHRSS_URL` and run `docker compose up -d --build`.

| Variable | Default | |
|---|---|---|
| `FRESHRSS_URL` | (required) | FreshRSS base URL as seen from the container |
| `NOTIFICATIONS` | `true` | Set to `false` to disable push notifications |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contact address sent to push services |
| `PORT` | `3000` | Port inside the container |

The container keeps its VAPID keys and the push subscriptions in `/data` (`./data` with the compose file). Subscriptions include the FreshRSS API token of each subscribed device, so keep that folder private. It must be writable by the container user (uid 1000 by default, configurable with `user:` in the compose file).

#### Unraid

`unraid/lightning-rss-reader.xml` is a Docker template for Unraid's web UI:

1. Copy it to the server:
   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-lightning-rss-reader.xml \
     https://raw.githubusercontent.com/RealityParadox/Lightning-RSS-Reader/main/unraid/lightning-rss-reader.xml
   ```
2. In *Docker → Add Container*, pick `lightning-rss-reader` in the *Template* list, set *FreshRSS URL*, then *Apply*.
3. The data folder (`/mnt/user/appdata/lightning-rss-reader` by default) must be writable by `nobody:users`: `chown -R 99:100 /mnt/user/appdata/lightning-rss-reader`.

Updates: *Check for updates*, then *Update*, in the Docker tab. Turn on *Autostart* so the container starts with the server.

### Option 2: inside FreshRSS

Copy `index.html`, `sw.js`, `app.webmanifest`, `app-192.png` and `app-512.png` into a folder under FreshRSS's public `p/` directory, for example `p/reader/`, and open `https://your-freshrss/reader/`.

With the LinuxServer.io FreshRSS image, you can bind-mount a folder to `/app/www/p/reader`.

Notifications are not available with this option.

### Deploying from a development machine

`deploy.sh` copies the sources to a Docker host over SSH, then rebuilds and restarts the container:

1. Copy `deploy.env.example` to `deploy.env` and set `HOST` (SSH target, key login) and `BASE` (folder on the host).
2. Create `.env` locally (it is copied too), then run `./deploy.sh`.

The version badge in the top bar (`vNN`) shows which build a device has loaded.

## Notes and limitations

- Search only covers articles already loaded in the list: the GReader API has no text search.
- The login token is stored in the browser's `localStorage`.
- Each device signs in separately; options are stored per browser.
- Notifications go through the browser vendor's push service (Firebase Cloud Messaging for Chrome-based browsers). The message is end-to-end encrypted and only contains the number of new articles and up to five titles.
- Article HTML is sanitized before display (scripts, iframes, forms, inline styles and event handlers are removed).

## License

[MIT](LICENSE)
