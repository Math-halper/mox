# Line-of-code reference: HTML, CSS, JavaScript

A lookup table for single lines. Each entry is the line, what it does, and the mistake it usually hides. Use it to explain code you found, or to remember the exact spelling of the one attribute you always forget.

## HTML — the head

```html
<!doctype html>
```
Tells the browser to use modern standards mode. Without it the page renders in quirks mode and box-sizing, line-height and table sizing all change.

```html
<html lang="en">
```
Declares the document language. Screen readers pick a pronunciation, and translation tools decide whether to offer to translate. Change it per page; a Spanish page says `lang="es"`.

```html
<meta charset="utf-8">
```
The character encoding. It must appear in the first 1024 bytes, before any text, or accents and emoji break. There is no good reason to use anything else today.

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```
Makes the layout width follow the device and sets the initial zoom. Without it, phones render the page at about 980 px and shrink it — the classic "why is my site tiny on mobile".

```html
<meta name="description" content="One sentence about this page.">
```
The snippet search engines may show. It does not affect ranking directly, and pages that omit it get whatever text the crawler finds first.

```html
<link rel="stylesheet" href="styles.css">
```
Loads a stylesheet, blocking render until it arrives. Put it in the head so the first paint is styled; a stylesheet at the end of the body gives a flash of unstyled content.

```html
<link rel="icon" href="favicon.svg" type="image/svg+xml">
```
The tab icon. SVG scales; `.ico` is a legacy fallback that browsers still check at `/favicon.ico` if nothing is declared.

```html
<script src="app.js" defer></script>
```
`defer` downloads in parallel and runs after the HTML is parsed, in order. Without it, the script runs immediately and any `querySelector` for markup below it returns null. `async` runs as soon as it arrives, out of order.

```html
<script type="module" src="app.js"></script>
```
An ES module: `import`/`export` work, and it is deferred by default. Modules are fetched with CORS, so `file://` fails — you need an HTTP server.

```html
<base href="/app/">
```
Changes what every relative URL on the page resolves against. Powerful and easy to forget; most bugs blamed on "broken links" are a stray `<base>`.

## HTML — structure and content

```html
<main id="content">
```
The one primary content region per page. Screen-reader users jump straight to it, and "skip to content" links target it. One per page, not one per section.

```html
<nav aria-label="Breadcrumb">
```
A landmark for navigation. When there is more than one `<nav>`, the label is what distinguishes them in a screen reader's landmark list.

```html
<button type="button">Save</button>
```
`type="button"` stops the button submitting a form it happens to sit inside. Inside a form, use `type="submit"` for the real submit control.

```html
<label for="email">Email</label>
<input id="email" name="email" type="email" required>
```
`for` must match the input's `id` to connect them — clicking the label then focuses the field. `name` is what the server receives; `type` gives the phone the right keyboard and the browser free validation.

```html
<img src="cat.jpg" alt="A grey cat asleep on a keyboard" width="640" height="360" loading="lazy">
```
`alt` describes the image for screen readers and when it fails to load. `width`/`height` reserve space so the page does not jump while loading. `loading="lazy"` defers off-screen images. A decorative image gets `alt=""` — never omit the attribute.

```html
<a href="/pricing" rel="noopener">Pricing</a>
```
A link. `rel="noopener"` on `target="_blank"` stops the new tab from reaching back through `window.opener`.

```html
<table><caption>Q3 sales</caption><thead>…</thead><tbody>…</tbody></table>
```
Tables are for data. `caption` names it, `thead`/`tbody` separate header from body, and `<th scope="col">` tells a screen reader which cells a header describes. Never use a table for layout.

```html
<input type="text" placeholder="Search" aria-label="Search">
```
`placeholder` is not a label — it disappears as you type. Use a real `<label>` or, if the design forbids one, `aria-label`.

```html
<details><summary>More</summary><p>Hidden until opened.</p></details>
```
A disclosure widget with no JavaScript at all. `open` makes it start expanded.

## CSS — the box and the layout

```css
*, *::before, *::after { box-sizing: border-box; }
```
Makes `width` include padding and border, so a 200 px column with 20 px padding is 200 px wide, not 240. The single most useful line in any stylesheet.

```css
:root { --ink: #111; --paper: #fff; }
color: var(--ink);
```
Custom properties are variables that cascade and can be overridden per subtree — `.dark { --ink: #eee; --paper: #111; }` re-themes everything that uses them.

```css
display: flex; align-items: center; justify-content: space-between;
```
One row, vertically centred, pushed to both ends. `justify-content` works on the main axis (row: horizontal), `align-items` on the cross axis.

```css
display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px;
```
A card grid whose column count follows the width: as many 240 px columns as fit, all sharing leftover space. No media queries needed.

```css
position: sticky; top: 0;
```
Pins an element while its container scrolls past. It fails silently if any ancestor sets `overflow: hidden` or `overflow: auto` — the usual reason a sticky header "doesn't work".

```css
position: fixed; inset: 0;
```
`inset: 0` is shorthand for `top: 0; right: 0; bottom: 0; left: 0`, i.e. fill the viewport (or the nearest positioned ancestor, for `absolute`).

```css
max-width: 65ch; margin-inline: auto;
```
A prose column of about 65 characters, centred. `ch` is the width of a zero: it measures text, which `px` cannot. `margin-inline` is logical, so it works in right-to-left languages.

```css
z-index: 10;
```
Only applies to positioned elements (or flex/grid children). Stacking contexts — a parent with `transform`, `filter` or `opacity` below 1 — trap children inside their own layer, which is why a high `z-index` sometimes loses.

```css
min-height: 100dvh;
```
The dynamic viewport height: it accounts for mobile browser chrome that changes as you scroll. `100vh` overflows on phones with a visible address bar.

```css
aspect-ratio: 16 / 9;
```
Reserves a shape before the content loads. Combined with `width: 100%`, it replaces most padding-top hacks.

## CSS — type, colour, motion

```css
font: 16px/1.6 system-ui, sans-serif;
```
Shorthand for size, line-height and family. `system-ui` uses the operating system's own font, which loads instantly and looks native everywhere.

```css
font-size: clamp(1.5rem, 2.5vw + 1rem, 3rem);
```
A heading that scales with the viewport but never goes below 1.5 rem or above 3 rem. Fluid type without media queries.

```css
color: #111; background: #fff;
```
Contrast is a requirement, not a taste: 4.5:1 for body text, 3:1 for large text. `#111` on `#fff` is about 18:1.

```css
outline: 2px solid currentColor; outline-offset: 2px;
```
A focus ring that does not affect layout and follows the text colour. Never write `outline: none` on `:focus` without replacing it.

```css
transition: background .15s ease, color .15s ease;
```
Animates listed properties only. `transition: all` is convenient and expensive: it animates layout properties you did not mean to touch.

```css
@media (prefers-reduced-motion: reduce) { * { animation-duration: .001ms !important; } }
```
Respects the operating-system setting for less motion. Vestibular disorders make large animations genuinely unpleasant.

```css
@media (prefers-color-scheme: dark) { :root { --paper: #111; --ink: #eee; } }
```
Follows the OS theme. Pair with `color-scheme: light dark` so form controls and scrollbars match.

```css
@media print { nav, .ads { display: none; } }
```
Print stylesheets are the cheapest accessibility win: strip chrome, set black on white, avoid breaking inside tables.

```css
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```
One line, cut with "…". For multiple lines, use `display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;`.

## JavaScript — selecting and changing the page

```js
const el = document.querySelector('#save');
```
The first match for a CSS selector, or `null`. `querySelectorAll` returns a static `NodeList`: it has `forEach` but not `map`, so spread it into an array first if you need array methods.

```js
el.textContent = 'Saved';
```
Sets text, safely: any `<` is shown, not parsed. Use it by default. `innerHTML` parses markup and is how user-supplied text becomes an XSS hole.

```js
el.classList.toggle('active', isActive);
```
The second argument forces the state instead of toggling. `classList.add/remove/contains` cover the rest; there is no need to touch `className` strings.

```js
el.setAttribute('aria-expanded', String(open));
```
Sets a state attribute. For ARIA, the value must be the string `"true"` or `"false"` — a boolean becomes `"true"` anyway, but `hidden = false` style mistakes are common, so be explicit.

```js
el.style.setProperty('--progress', '42%');
```
Sets a CSS custom property from script, which lets the stylesheet keep the animation and layout rules.

```js
const item = document.createElement('li'); list.append(item);
```
Create then insert. `append` takes strings and nodes; `appendChild` takes nodes only. `prepend`, `before`, `after` and `replaceWith` cover the other positions.

```js
el.remove();
```
Removes the node. There is no undo — keep a reference first if you intend to put it back.

## JavaScript — events and input

```js
el.addEventListener('click', handleClick);
```
One listener per concern; several can share an element. Pass a named function so you can remove it later with the same reference.

```js
form.addEventListener('submit', (event) => { event.preventDefault(); /* … */ });
```
Stops the browser's own form submission so you can handle it in script. Without it the page reloads and your state disappears.

```js
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
```
Keyboard handling on the document, filtered by `event.key` — the character produced, not the physical key code. `preventDefault()` when you take over a key the browser also uses.

```js
window.addEventListener('resize', debounce(onResize, 150));
```
Debounce collapses a burst of events into one call. Scroll and resize handlers that do layout work will otherwise drop frames.

```js
el.addEventListener('input', (event) => console.log(event.target.value));
```
`input` fires on every change as the user types; `change` fires when the field loses focus. Use `input` for live feedback, `change` for commit-style forms.

```js
element.addEventListener('click', (event) => { const button = event.target.closest('[data-id]'); });
```
Event delegation: one listener on a container handles clicks on children, including ones added later. `closest` walks up to the element that carries the data.

## JavaScript — logic and data

```js
const total = items.reduce((sum, item) => sum + item.price, 0);
```
Reduces an array to one value, starting from an explicit initial value. Forgetting `0` makes an empty array throw.

```js
const names = users.filter((user) => user.active).map((user) => user.name);
```
Filter then map: the everyday data pipeline. Neither mutates the original array; `sort` and `reverse` do — copy first with `[...array]`.

```js
const { name, email = 'none' } = user;
const [first, ...rest] = list;
```
Destructuring with a default and a rest element. `?.` and `??` are its companions: `user?.address?.city` returns `undefined` instead of throwing, and `value ?? 'fallback'` only falls back for `null`/`undefined` — not for `0` or `''`.

```js
const copy = structuredClone(original);
```
A deep copy of plain data, including arrays and `Date`. `JSON.parse(JSON.stringify(x))` loses dates, `undefined` and functions, and is slower.

```js
if (!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(email)) showError();
```
A *plausibility* check, not validation. Email is only truly valid if a message arrives; validate length and presence, then send a confirmation.

```js
const rounded = Math.round(value * 100) / 100;
const money = (value / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
```
Rounding floating point for display, and formatting money. Never do currency arithmetic in binary floats without an integer cents representation.

```js
const pct = ((part / total) * 100).toFixed(1) + '%';
```
Fixed decimal places, as a string. `toFixed` rounds and pads; it is display-only, so parse back with `parseFloat` before more maths.

## JavaScript — async and the network

```js
const response = await fetch('/api/items', { headers: { Accept: 'application/json' } });
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();
```
`fetch` only rejects on network failure — a 404 or 500 resolves normally, so check `response.ok`. The body can be read once: `json()` consumes it.

```js
const controller = new AbortController();
fetch(url, { signal: controller.signal }).catch(() => {});
controller.abort();
```
Cancels a request in flight. Essential for type-ahead search and for the "Stop" button on a streamed answer.

```js
await new Promise((resolve) => setTimeout(resolve, 250));
```
Sleep. There is no `sleep()` in JavaScript; wrapping a timer is the idiom, and it works inside async functions.

```js
try { await save(); } catch (error) { console.error(error); showToast('Could not save'); }
```
Every `await` that can fail belongs in a `try`. An unhandled rejection in a browser is invisible unless you listen for `unhandledrejection`.

## JavaScript — storage and browser APIs

```js
localStorage.setItem('theme', 'dark');
const theme = localStorage.getItem('theme');   // string or null
```
Synchronous, per-origin, ~5 MB, strings only — `JSON.stringify` anything structured. Cleared when the user clears site data.

```js
const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open('app', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('items', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
```
IndexedDB holds megabytes and binary data and is asynchronous. The `onupgradeneeded` handler is where schema changes live — it only runs when the version number increases.

```js
navigator.clipboard.writeText(value);
```
Copies text, requires a user gesture and (outside HTTPS) fails silently. Fall back to a temporary `<textarea>` plus `document.execCommand('copy')` when it throws.

```js
const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
const url = URL.createObjectURL(blob);
```
Turning a canvas into a downloadable file. Revoke the URL afterwards with `URL.revokeObjectURL(url)` or the blob is never freed.

```js
const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
ctx.fillRect(10, 10, 80, 40);
```
The 2-D drawing context. Coordinates are in CSS pixels unless you scale for `devicePixelRatio`, which is why canvas art looks soft on a retina screen.

```js
requestAnimationFrame((time) => { /* draw */ });
```
Schedules a callback before the next repaint, paused when the tab is hidden. Any animation loop should use it rather than `setInterval`.

```js
navigator.serviceWorker.register('sw.js');
```
Registers a worker that can serve the app offline. It only controls pages loaded *after* it activates, and it caches aggressively — the reason a stale deploy sometimes hangs around until a hard reload.

## Reading an unfamiliar line

1. **Where does it run?** In the browser (has `document`/`window`) or on the server (has `process`/`require`)?
2. **What does it return?** A DOM node, a promise, `undefined`? Half of all bugs are a `null` from `querySelector` or a promise that was never awaited.
3. **Does it mutate?** `sort`, `reverse`, `push`, `splice` and DOM inserts change things in place; `map`, `filter`, `slice` return new values.
4. **When does it run?** Immediately, after parsing (`defer`), on an event, or after an `await`.
5. **What happens on the unhappy path?** Missing element, failed request, empty array, `null` from storage. The line that assumes success is the line that breaks.
