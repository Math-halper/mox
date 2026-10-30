# Old games in a new browser: Flash, retro consoles, and WebAssembly ports

Whole libraries of games — Flash-era adventures, 8- and 16-bit console titles, Game Boy cartridges, old desktop games — can run in a web page today. Each needs a different kind of runtime, and each has its own legal line.

## Flash: Ruffle

Flash died in 2020 when browsers stopped loading the plugin. **Ruffle** (`ruffle-rs/ruffle`, MIT/Apache-2.0 dual, ~19k stars) reimplements the Flash player in Rust and compiles it to WebAssembly, so `.swf` files play again with no plugin.

- Usage is a single script tag plus a `<embed>`/`<object>` fallback, or the self-hosted build with a `.wasm` beside it.
- It renders with WebGL (falling back to canvas) and supports most ActionScript 1/2 and a growing share of AS3.
- Not every file works: complex AS3 titles, 3-D, and DRM'd content are the usual failures. Expect a compatibility list, not a guarantee.
- Flash games often expect a **fixed stage size**, right-click context menus, and keyboard focus — test all three, or the game will feel broken for reasons unrelated to emulation.
- Host the `.wasm` yourself. A player that fetches its runtime from a CDN contradicts any claim that the page works offline.

## Retro consoles: EmulatorJS and webretro

Two open-source front ends wrap the same idea — a libretro core compiled to WebAssembly plus a UI.

- **EmulatorJS** (`EmulatorJS/EmulatorJS`, GPL-3.0) is a drop-in web frontend for RetroArch cores: a script, a data attribute, and a ROM. It handles saves, save states, controllers, and fullscreen.
- **webretro** (`BinBashBanana/webretro`, MIT) is RetroArch in the browser with a chooser for N64, SNES, NES, Game Boy and more.

Practical notes:

- Cores are large (tens of MB), and the good ones (N64, PlayStation) need WebAssembly threads and cross-origin isolation for usable speed.
- Saves live in the browser's storage unless you export them; tell players where their save file is.
- Gamepads come through the Gamepad API; keyboard mappings need to be visible and rebindable.
- **ROMs are the legal question, not the emulator.** Bundling commercial ROMs in a public repository is copyright infringement even though the emulator is free. Ship the emulator, let players bring their own files, and say so plainly.

## Old desktop games: love.js and other WebAssembly ports

Some games were written for desktop frameworks and then ported by compiling the framework:

- **love.js** compiles a LÖVE (Lua) game to WebAssembly — the route taken by several well-known indie games, including the Mario-meets-Portal puzzler *Mari0*.
- **Emscripten** is the general answer for C/C++: SDL, OpenGL, and audio get translated, with limits.
- Native ports that reimplement the game (rather than emulate it) are faster and more fragile: Super Mario 64's fan web port is the famous example.

Ports have a predictable set of problems: fixed canvas resolution, pointer lock, audio that must start after a click, save data with nowhere to go, and a filesystem that does not exist. Expect to shim all five.

## Unity WebGL builds

Unity exports a WebGL build that is a folder of assets plus a loader. It is not a plugin, but it behaves like one:

- The build needs HTTP (not `file://`), a compression setting the host supports, and often several hundred megabytes of download.
- It runs in a canvas, takes focus aggressively, and does not resize gracefully without a template change.
- Mobile support is fragile; treat desktop as the target unless you test.
- Hosting on a static site is fine; the loader expects relative paths, so keep the folder intact.

## Embedding a game in a site: the checklist

- **Frame it, don't inline it.** An `<iframe>` isolates the game's globals, its keyboard handling and its crashes from your page. Add `sandbox="allow-scripts allow-same-origin"` deliberately — and understand that `allow-same-origin` plus `allow-scripts` on same-origin content is effectively no sandbox.
- **Serve it from your own origin** and vendor the runtime, or accept that "works offline" is not true.
- **Size honestly.** A 30 MB core and a 500 MB Unity build are different promises; show the download size before the player clicks.
- **Respect focus.** Only capture the keyboard when the game has focus; escape hatches matter.
- **Sound after a click.** Browsers will not autoplay audio; start the audio context on the first interaction.
- **Fullscreen and orientation.** Offer fullscreen, and handle the phone rotating.
- **Saves are user data.** Export/import them, and name the storage key.
- **Credit the runtime, and respect its licence** — GPL-3.0 (EmulatorJS) has obligations that MIT (webretro) does not.

## What is safe to ship, in one table

| Content | Status |
| --- | --- |
| Your own game | Yours — ship it |
| Open-source game with a licence (2048, Tetris clones, Snake, Breakout, Flappy Bird clones, the Chromium dino) | Yes, with the licence respected |
| The emulator itself (Ruffle, EmulatorJS, webretro) | Yes, per its licence — and credit it |
| Commercial ROMs (Mario, Zelda, Pokémon cartridges) | No — copyright, regardless of age or abandonware claims |
| Fan ports of commercial games (Mario 64 web ports, Minecraft clients, fan sequels) | Usually not licensed for redistribution; request takedowns happen |
| Flash games by their original authors | Only with permission or an explicit free licence, even though Ruffle can play them |
| "Abandonware" sites | Not a legal category; the copyright still exists |

Emulation is legal in many jurisdictions; distributing other people's games is a different question. Keep the two separate when you describe what a site does.
