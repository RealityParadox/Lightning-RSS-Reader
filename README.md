# Lightning RSS Reader

A fast, mobile-first reader for [FreshRSS](https://freshrss.org), built as a single HTML file.
It talks to your FreshRSS instance through its Google Reader (GReader) API and installs as a PWA on Android or desktop.

No build step, no framework, no dependencies: `index.html` holds all the HTML, CSS and JavaScript.

## Features

- **Three views**: unread (with a count badge), read and starred.
- **Mark as read while scrolling** (optional), plus a "mark all seen and refresh" button at the end of the list.
- **Touch gestures**:
  - list: swipe a card right to star it, left to edit its labels, pull up at the bottom to refresh;
  - article: swipe left/right for the next/previous article, pull down at the top or up at the end to close.
- **Search and filter**: text search on loaded articles (accent and case insensitive), plus categories, individual feeds and labels.
- **Article view** with star, open in browser, share and labels.
- **Two-column layout** on wide screens, with a resizable splitter.
- **Options**: mark as read on scroll, list toolbar at the top or bottom, article toolbar at the top or bottom.
- Read marks are queued and synced in the background; articles read on another device are greyed out when you come back to the app.

## Requirements

- A FreshRSS instance with the API enabled (*Settings → Authentication → Allow API access*).
- An **API password** set in your FreshRSS profile (*Settings → Profile → API management*). The reader logs in with your username and this API password, not your account password.
- A Chromium-based browser is the main target (Chrome, Edge, Vivaldi, Samsung Internet...).

## Installation

The browser must see the reader and FreshRSS's `/api/greader.php` on **the same origin** (the app builds API URLs from `location.origin`, and there is no CORS support). Two ways to do that:

### Option 1: inside FreshRSS

Copy `index.html`, `app.webmanifest`, `app-192.png` and `app-512.png` into a folder under FreshRSS's public `p/` directory, for example `p/reader/`, and open `https://your-freshrss/reader/`.

With the LinuxServer.io FreshRSS image, you can bind-mount a folder to `/app/www/p/reader`.

### Option 2: standalone container (recommended)

The `server/` folder contains a small nginx container that serves the app and proxies `/api/` to FreshRSS. It can live on its own (sub)domain and is independent of your FreshRSS install.

1. Copy `server/` to your Docker host and the four app files into `server/www/`.
2. Copy `server/.env.example` to `server/.env` and set `FRESHRSS_UPSTREAM` to your FreshRSS address as seen from the container, without a trailing slash (for example `http://192.168.1.10:8080`, or FreshRSS's public URL).
3. Run `docker compose up -d`. The reader listens on port `8095`.
4. Point your reverse proxy (with HTTPS) at it. HTTPS is required for the PWA to install.

### Deploying updates

`deploy.sh` pushes the files over SSH with rsync:

1. Copy `deploy.env.example` to `deploy.env` and set `HOST` (SSH target, key login) and `BASE` (the folder holding `docker-compose.yml`).
2. `./deploy.sh` updates the app files, `./deploy.sh server` also updates the container config and recreates it.

The version badge in the top bar (`vNN`) shows which build a device has loaded.

## Notes and limitations

- Search only covers articles already loaded in the list: the GReader API has no text search.
- The login token is stored in the browser's `localStorage`.
- Article HTML is sanitized before display (scripts, iframes, forms, inline styles and event handlers are removed).

## License

[MIT](LICENSE)
