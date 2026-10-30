# Building a desktop environment in the browser

A window manager, an app launcher, a file system, a terminal and a text editor can all run as one static website: no server, no build step, no runtime dependencies. This is how such a shell is put together, and where the sharp edges are.

## The shape of it

```
index.html            cover page / sign-in gate
assets/
  config-loader.js    parses the app and website catalogs
  core.js             desktop, window manager, registries, registerApp()
  html-loader.js      fetches app modules at boot (or on first launch)
  store.js            accounts and per-account storage
  fs.js               the virtual file system
  fs-archive.js       dependency-free ZIP export
  search.js           the search engine
  icons.js            monochrome SVG icons
  styles.css
apps/
  system/…  productivity/…  media/…  tools/…  games/…
data/
  applications.js     ONE catalog: name, path, icon, category, size
  websites.js         the same for built-in sites
  fs-manifest.js      generated: every deployed file
  search-index.js     generated: the repository's searchable prose
```

Everything is a plain file that a static host can serve. Deploying is copying the folder.

## One app, one folder, one catalog entry

Each app is a single HTML file in its own folder: `apps/<category>/<name>/app.html`. A `<script data-app>` block calls `registerApp({ render })`; the catalog entry supplies the metadata. Because the catalog is the only list, adding an app is one folder plus one block, and removing it is one deletion — no import graph to update.

Rules that keep this from rotting:

- **The catalog is the truth.** Menu order is block order. If a folder is not catalogued it does not exist; if a catalog entry has no file, boot fails loudly.
- **Category matches folder.** `cat=Media` lives in `apps/media/`. A mismatch is a bug that shows up as a menu that lies.
- **Templates are skipped by generators.** Prefix `_template/` with an underscore and have the manifest generator ignore every underscore folder, or every template becomes a phantom file in the file system.

## The window manager

The minimum a desktop needs:

- **Windows** with a title bar, close button, and a z-index stack. Focus follows the last click; the focused window gets the keyboard.
- **Drag to move, corner drag to resize**, with a minimum size and clamping so a window cannot be dragged fully off-screen and lost.
- **Taskbar and menu** showing open windows, with a click to focus and a second click to minimise.
- **Per-app default size** from the catalog, so a calculator and a video player do not open at the same dimensions.
- **A launcher registry** so apps can open each other by id (`openApp('files')`) rather than by reaching into each other's code.

State lives in one place: which windows are open, which is focused, and each window's geometry. Re-render from that state; do not let each app keep its own copy of what is on screen.

## The virtual file system

A file system in local storage is a tree of paths plus contents. The parts that matter:

- **One API** — `read`, `write`, `list`, `mkdir`, `move`, `copy`, `remove`, `exists` — so Files, the editor, the image viewer and the terminal all agree about what exists.
- **A file-type registry**: `FS.appFor('report.pdf')` returns the app that opens it (`pdf`), falling back to Files. That one function is the difference between a desktop and a pile of apps.
- **Export as a ZIP** built by hand (a local file header, central directory, CRC-32, and `STORE` compression) — no library needed, roughly a hundred lines.
- **Import** through a file picker, then store the bytes as data or as a blob reference, and enforce a size cap so one 400 MB video does not brick the profile.
- **Two sources, one dialog.** Every open/save asks *which* file system: this computer (`device`) or the virtual one (`vfs`). Mixing them silently is how users lose work.

Paths are strings; normalise them (`/home/ana/notes.txt`), reject traversal outside the home root, and never trust a path that came from a URL without checking it.

## Accounts without a server

With no backend, "accounts" are local storage namespaces:

```js
localStorage['app.accounts.v1']            // list of profiles
localStorage['app.user.<name>.v1']         // that profile's data
localStorage['app.desktopProfile.v1']      // who was here last
```

- **Namespacing is versioning.** Bump the prefix (`app2.*`) and delete the old keys on load when the data model changes, so stale accounts cannot half-load.
- **Say what the password is.** A password stored in a file the site serves, or checked in client code, is a *gate*, not security. Anyone who can read the site's files can read it. State that plainly in the interface.
- **Backups are the user's job**, so give them a button: export the whole profile as JSON, import it back.
- **Clearing site data deletes everything.** Warn before it happens, not after.

## Search over a static site

Two generated files do most of the work:

1. **`search-index.js`** — the prose of every text file, chunked.
2. **`fs-manifest.js`** — every deployed file, which becomes the read-only `/` tree.

Then a small engine: lowercase, tokenise, stem, score by term frequency and inverse document frequency, boost title matches, and return the best few with a snippet.

The trap is **stemmer drift**: the Python generator that writes the index and the JavaScript engine that reads it must agree on the stem of every word. Pin the invariant in a test — every term in the index must be a fixed point of the engine's own stemmer (`stem(stem(word)) === stem(word)` for every token). Without that test, search quality decays silently as either side is edited.

A generated manifest also needs a test: regenerate it and assert it matches what is deployed. Otherwise a new file is invisible to the file system and to search, and nobody notices for a month.

## Media, threads, and the browser's own rules

Two browser policies break naive desktop apps:

- **Autoplay.** A page cannot make sound until the user interacts with it. If a player's audio clock is also its playback clock, a suspended `AudioContext` shows up as video that will not start. Create the context on the first click or keypress, resume it on every later one, and pass *that* context to the engine rather than letting the engine make its own.
- **Cross-origin isolation for WebAssembly threads.** A WASM build that spawns threads needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. A static host may not let you set headers, so ship a tiny service worker that adds them by reloading once. Detect "not isolated yet", register, reload, continue.

Keyboard handling has a similar shape: put the shortcut listener on the document, dispatch to the focused app, and refuse to fire inside text fields, open dialogs, the menu, or another app's window. "Keys follow the front window" is the rule users expect.

## Rendering other people's pages

Embedding a game or a tool as an `<iframe>` is fine when the files are in your repository and the frame is a local page. It becomes a liability with three hosts, three content policies, and a page that expects to be top-level. Prefer:

- vendoring the build *and* its assets into a folder you control;
- framing only local pages, never remote ones;
- keeping a smoke test that asserts each framed page really exists in the deployed tree.

## A practice site built over the shell

An app can also be a whole website inside the desktop: a school-style practice cover page with a skill search, grade buttons, generated practice questions, instant marking with explanations, a diagnostic that builds an action plan, and progress saved per profile.

The design constraints that matter there:

- **Generate questions, not a static quiz bank** — infinite practice, no answer key to leak.
- **Mark instantly and explain the step**, not just right/wrong.
- **Store progress under a versioned key**, and let the learner reset it.
- **Separate the waitlist from the account.** A form that silently signs someone up (or silently fails) is a bug, not a growth tactic: only add an entry after explicit confirmation, and never add one as a side effect of signing in.
- **Do not hide content behind a video.** Anything auto-playing, unmovable and full-screen is hostile; if a media file exists but is unused, leave it unused.

## What to test

- Every catalogued app's file exists, in its category folder, with its icon.
- The generated manifest matches the repository.
- A desktop boots headlessly and opens each app.
- The file system round-trips: create, rename, move, import, search, zip, and open every file type through `appFor`.
- Shortcuts to files follow renames and are marked when their target is missing.
- Text editing on a large file does not block the UI for seconds.

A browser desktop is a lot of small, boring contracts. Tests are what keep them boring.
