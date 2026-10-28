# Web development: HTML, CSS, and JavaScript in practice

Internet and the web explains protocols; programming fundamentals explains logic. This document is about building the page itself: semantic markup, layout, and the browser features that make an interface feel responsive.

## How a browser turns files into a page

The HTML is parsed into a document object model (DOM). CSS becomes a set of rules applied to that tree to produce a render tree. JavaScript can change the DOM and the CSS after load. Work is split into layout (where boxes go), paint (pixels), and compositing (layers). Animating transform and opacity stays on the fast path; animating width, top, or height forces layout and jank.

## Semantic HTML

Use the element that means what you mean:

- `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>` for page regions.
- `<h1>` to `<h6>` for a real heading outline, one `<h1>` per page.
- `<button>` for actions, `<a href>` for navigation. A clickable `<div>` is invisible to keyboards and screen readers.
- `<label for="id">` tied to every input; `<fieldset>` and `<legend>` for groups.
- `<ul>` and `<ol>` for lists, `<table>` for tabular data with `<th scope>`, never for layout.
- `<img alt="...">` describing the image, or `alt=""` when decorative.
- `<video>`, `<audio>`, `<picture>` for media; `<dialog>` for modal windows.

Accessibility is not a separate project: semantics, a visible focus ring, keyboard reachability, and colour contrast are most of it. Test with the Tab key and a screen reader once; it finds more than any checklist.

## CSS: the model that explains the confusion

Each element is a box with content, padding, border, and margin. `box-sizing: border-box` makes width include padding and border, which is almost always what you want.

Layout choices:

- Normal flow for documents.
- Flexbox for one dimension: a row of buttons, a vertical stack, centring.
- Grid for two dimensions: page layouts, card galleries, dashboards.
- Positioning for overlays and sticky headers; `position: sticky` is often enough.

Specificity decides which rule wins: inline styles beat ids, ids beat classes and attributes, classes beat element selectors; later rules win ties. `!important` is a sign that the specificity problem should be solved instead.

Custom properties (CSS variables) make theming practical: define `--surface` once, use `var(--surface)` everywhere, override it in one place for a dark theme. Media queries adapt to width, `prefers-reduced-motion` and `prefers-color-scheme` adapt to the person. Container queries adapt to the size of the parent, which is often what a component actually needs.

Responsive layout without a framework: a fluid grid, `max-width` on text, `clamp()` for type that scales, and a small number of breakpoints where the content genuinely breaks.

## JavaScript essentials for the interface

- Query the DOM once and keep references; re-querying in a loop is slow.
- Event delegation: one listener on a container instead of hundreds on children.
- Debounce rapid input; batch DOM writes; avoid layout thrash by reading then writing.
- `fetch` with async and await; check `response.ok`; handle errors.
- Keep state in variables and render from state, rather than letting the DOM be the source of truth.
- Use `localStorage` for small preferences, IndexedDB for files and history; both are per-origin and per-browser.
- Modules (`type="module"`) give you imports without a bundler.

## Forms

Always pair a form with validation on the server or engine, not only in the browser. Use the right input types (`email`, `url`, `number`, `date`) so phones show the right keyboard. Disable the submit button while a request is in flight and report the result where the user is looking. Never rely on placeholder text as a label.

## Images and performance

Responsive images use `srcset` and `sizes` so a phone does not download a desktop-size file. Serve modern formats (WebP, AVIF) with fallbacks. Lazy-load below-the-fold images with `loading="lazy"`. Compress before uploading. Fonts: prefer system fonts or `font-display: swap`; every webfont is a render-blocking download.

Perceived speed comes from layout stability (reserve space for images and ads), immediate feedback on interaction, and not shifting content after load.

## Security basics in the browser

Never trust input. Escape untrusted text before inserting it as HTML; prefer `textContent` over `innerHTML`. A strict Content-Security-Policy limits what injected script can do. Set cookies `HttpOnly`, `Secure`, and `SameSite`. Treat third-party scripts as code you did not review — because they are.

## A sane working setup

Start with a plain folder: an `index.html`, a stylesheet, a script, and a way to serve it locally (`python3 -m http.server` is enough). Add a bundler only when you need one, and a framework only when the app has state that plain functions cannot keep straight. Format on save, commit early, and keep the console clean — warnings are cheap to fix now and expensive to find later.
