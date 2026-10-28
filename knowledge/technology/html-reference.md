# HTML reference — every element, attribute, and pattern

HTML (HyperText Markup Language) describes the structure and meaning of a web page. The browser parses the markup into a tree of nodes (the DOM), then CSS styles it and JavaScript can read or change it. HTML is not a programming language: it declares what things *are* — a heading, a list, a form field, an image — and the browser supplies the behaviour.

## Document skeleton

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page title</title>
  <link rel="stylesheet" href="styles.css">
  <script src="app.js" defer></script>
</head>
<body>
  <h1>Hello</h1>
</body>
</html>
```

- `<!doctype html>` must come first. It puts the browser in standards mode; without it, old quirks-mode layout rules apply.
- `<html lang="en">` declares the language (screen readers use it to pick a voice). Use a BCP-47 tag such as `en`, `en-GB`, `es-MX`, `zh-Hans`.
- `<head>` holds metadata that is not rendered: title, character set, stylesheets, scripts, icons, social preview tags.
- `<body>` holds everything the visitor sees.
- Only one `<html>`, `<head>`, and `<body>` per document. `<title>` is required in practice; browsers and search engines use it.

## Head metadata

| Element | Purpose |
| --- | --- |
| `<title>` | Tab title, bookmark name, search result headline. Plain text only. |
| `<meta charset="utf-8">` | Character encoding; should be the first thing in `<head>`. |
| `<meta name="viewport" content="width=device-width, initial-scale=1">` | Makes mobile browsers use the device width instead of a 980px fake viewport. |
| `<meta name="description" content="…">` | Short summary for search engines (about 150 characters). |
| `<meta name="theme-color" content="#000000">` | Colours the browser toolbar on mobile. |
| `<meta name="robots" content="noindex">` | Tells crawlers not to index the page. |
| `<link rel="stylesheet" href="…">` | Loads CSS. `media="print"` limits it to printing. |
| `<link rel="icon" href="favicon.ico">` | Browser tab icon. |
| `<link rel="preload" href="font.woff2" as="font" crossorigin>` | Fetches a critical asset early. |
| `<link rel="canonical" href="…">` | The preferred URL when content is duplicated. |
| `<script src="app.js" defer>` | Loads JavaScript after parsing without blocking. `async` runs as soon as it downloads. |
| `<style>…</style>` | Inline stylesheet. |
| `<base href="/app/">` | Changes the base URL for relative links (use sparingly). |

## Global attributes

These work on every element:

- `id` — unique identifier. One per page. Used by `#id` CSS, `document.getElementById`, and `label for`.
- `class` — space-separated list of reusable style/behaviour names.
- `style` — inline CSS declarations.
- `title` — tooltip text, and the accessible description when nothing better exists.
- `lang` — language of the element's content.
- `dir="ltr|rtl|auto"` — text direction.
- `hidden` — hides the element (like `display: none`).
- `tabindex` — `0` makes a non-interactive element focusable in document order, `-1` makes it focusable only by script, positive numbers create a custom order (avoid).
- `contenteditable="true"` — makes the element's text editable in place.
- `draggable="true"` — enables the drag-and-drop API.
- `spellcheck="false"` — turns off spell checking in editable text.
- `translate="no"` — asks translation tools to leave the text alone.
- `accesskey` — a keyboard shortcut (inconsistent across browsers; discouraged).
- `data-*` — custom data attributes: `data-user-id="42"` becomes `element.dataset.userId`.
- `aria-*` — accessibility attributes (see below).
- `role` — overrides or clarifies the accessibility role.

## Document structure and semantic elements

| Element | Meaning |
| --- | --- |
| `<header>` | Introductory content for the page or a section: logo, navigation, search. |
| `<nav>` | A block of navigation links. Label multiple navbars with `aria-label`. |
| `<main>` | The dominant content of the page. One per page. |
| `<footer>` | Closing content: copyright, contact, related links. |
| `<section>` | A thematic grouping, usually with its own heading. |
| `<article>` | Self-contained content that would make sense on its own: a post, a card, a comment. |
| `<aside>` | Tangential content: sidebars, pull quotes, ads, related links. |
| `<div>` | Generic block container with no meaning. Use it for layout only. |
| `<span>` | Generic inline container. |
| `<figure>` | Self-contained illustration with an optional `<figcaption>`. |
| `<figcaption>` | Caption for a figure; must be first or last child. |
| `<address>` | Contact information for the nearest article or the page. |
| `<hr>` | Thematic break (a topic change), not a decorative line. |
| `<br>` | A meaningful line break inside a paragraph (addresses, poetry). |
| `<template>` | Inert markup cloned by script; not rendered until used. |
| `<slot>` | Placeholder inside a Web Component's shadow tree. |

## Headings and text

- `<h1>` … `<h6>` are six heading levels. Use one `<h1>` per page and do not skip levels for styling — style with CSS instead. Headings build the document outline that screen readers navigate by.
- `<p>` is a paragraph. Browsers add vertical margins.
- `<strong>` is important text (usually bold). `<b>` is bold with no extra importance.
- `<em>` is stress emphasis (usually italic). `<i>` is italic for names, terms, or a different voice.
- `<mark>` highlights text relevant to the current context.
- `<small>` is fine print: disclaimers, legal text.
- `<s>` is no-longer-accurate text (old price). `<del>` and `<ins>` describe edits with `datetime`.
- `<u>` is an unarticulated annotation; not for underlining arbitrary text.
- `<sub>` and `<sup>` are subscript and superscript.
- `<abbr title="HyperText Markup Language">HTML</abbr>` gives an expansion.
- `<cite>` names a work being referenced.
- `<q>` is an inline quotation. `<blockquote cite="…">` is a block quotation.
- `<code>` is computer code, `<kbd>` is user input, `<samp>` is program output, `<var>` is a variable, `<pre>` preserves whitespace and line breaks.
- `<time datetime="2026-10-28">October 28</time>` is a machine-readable date or time.
- `<bdi>` isolates text whose direction may differ; `<bdo dir="rtl">` forces direction.
- `<ruby>`, `<rt>`, `<rp>` add pronunciation guides (CJK text).
- `<wbr>` suggests a line-break opportunity.
- `<span>` groups inline content for styling.

Character escapes: `&lt;` `<`, `&gt;` `>`, `&amp;` `&`, `&quot;` `"`, `&apos;` `'`, `&nbsp;` non-breaking space, `&copy;` ©, `&mdash;` —, `&ndash;` –, `&hellip;` …, `&times;` ×, `&divide;` ÷, `&rarr;` →, `&deg;` °, `&euro;` €. Numeric references work too: `&#169;`.

## Links and paths

```html
<a href="page.html">Relative</a>
<a href="/docs/">Root-relative</a>
<a href="https://example.com" target="_blank" rel="noopener noreferrer">New tab</a>
<a href="#section">Jump to an id</a>
<a href="mailto:hi@example.com?subject=Hello">Email</a>
<a href="tel:+15551234567">Call</a>
<a href="file.pdf" download>Download</a>
```

- `<a>` needs `href` to be a link. Without it, it is only a placeholder.
- `target="_blank"` opens a new tab; add `rel="noopener"` so the new page cannot access `window.opener` (modern browsers do this by default, but be explicit).
- The link text should make sense out of context. "Read the pricing guide", not "click here".
- Fragment links scroll to the element with that `id` and update the URL.
- `<link>` is for metadata; `<a>` is for the visitor.

## Images and media

```html
<img src="photo.jpg" alt="A black cat asleep on a keyboard" width="640" height="427" loading="lazy">
<picture>
  <source srcset="hero.avif" type="image/avif">
  <source srcset="hero.webp" type="image/webp">
  <img src="hero.jpg" alt="Mountain sunrise" width="1200" height="600">
</picture>
```

- `alt` is required. Describe the content and purpose. Use `alt=""` for purely decorative images so screen readers skip them.
- Always set `width` and `height` (or CSS aspect-ratio) so the layout does not jump while images load.
- `loading="lazy"` defers off-screen images; `decoding="async"` helps rendering.
- `srcset` and `sizes` let the browser choose a resolution.
- `<video controls autoplay muted loop playsinline poster="thumb.jpg">` with `<source src type>` and fallback text. Autoplay is only allowed when muted.
- `<audio controls src>` embeds sound.
- `<track kind="captions" src="captions.vtt" srclang="en" label="English">` adds captions to video.
- `<iframe src="…" title="Map of Houston" loading="lazy" sandbox="allow-scripts">` embeds another document. Always give a `title`.
- `<canvas>` is a bitmap drawing surface driven by JavaScript; `<svg>` is scalable vector markup you can style with CSS.
- `<map>` and `<area>` make image regions clickable.

## Lists

```html
<ul>                <!-- unordered: bullets -->
  <li>Item</li>
</ul>
<ol start="3" reversed>  <!-- ordered: numbers -->
  <li>Third</li>
</ol>
<dl>                <!-- description list -->
  <dt>HTML</dt>
  <dd>The structure of a page.</dd>
</dl>
```

Only `<li>` may be a direct child of `<ul>` or `<ol>`. `<dl>` groups one or more `<dt>` with one or more `<dd>`.

## Tables

```html
<table>
  <caption>Quarterly sales</caption>
  <thead>
    <tr><th scope="col">Quarter</th><th scope="col">Revenue</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">Q1</th><td>$12,000</td></tr>
  </tbody>
  <tfoot>
    <tr><td>Total</td><td>$12,000</td></tr>
  </tfoot>
</table>
```

- Use tables for data, never for layout. Use CSS Grid or Flexbox for layout.
- `<caption>` describes the table. `<th scope="col|row">` tells screen readers which header applies to which cell.
- `<colgroup>` and `<col span="2">` style whole columns.
- `<td colspan="2" rowspan="3">` merges cells.
- Do not leave empty cells; use `—` or explain the gap.

## Forms

```html
<form action="/subscribe" method="post" novalidate>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com">

  <fieldset>
    <legend>Plan</legend>
    <label><input type="radio" name="plan" value="monthly" checked> Monthly</label>
    <label><input type="radio" name="plan" value="yearly"> Yearly</label>
  </fieldset>

  <label for="notes">Notes</label>
  <textarea id="notes" name="notes" rows="4" maxlength="500"></textarea>

  <label for="country">Country</label>
  <select id="country" name="country">
    <optgroup label="North America">
      <option value="us" selected>United States</option>
      <option value="ca">Canada</option>
    </optgroup>
  </select>

  <label><input type="checkbox" name="terms" required> I agree</label>
  <button type="submit">Subscribe</button>
</form>
```

Input types and what they give you: `text`, `email`, `password`, `search`, `tel`, `url`, `number`, `range`, `date`, `time`, `datetime-local`, `month`, `week`, `color`, `file`, `checkbox`, `radio`, `hidden`, `submit`, `reset`, `button`, `image`.

Useful input attributes: `name` (required for submission), `value`, `placeholder`, `required`, `disabled`, `readonly`, `autofocus`, `autocomplete`, `pattern="[0-9]{5}"`, `min`, `max`, `step`, `minlength`, `maxlength`, `multiple` (files, emails), `accept="image/*"`, `checked`, `selected`.

- Every input needs a `<label>` (use `for` + `id`, or wrap the input). Placeholders are not labels: they vanish on typing.
- Use the right `type` so phones show the right keyboard and browsers validate for free.
- `<fieldset>` groups related controls; `<legend>` names the group. Screen readers announce the legend with each control.
- `<datalist id="cities">` offers autocomplete suggestions for an `<input list="cities">`.
- `<output>` shows a calculation result.
- `<progress value="30" max="100">` and `<meter value="0.7">` show completion and measurements.
- Set `novalidate` on the form only when you validate with JavaScript yourself.
- GET puts values in the URL (good for searches); POST sends them in the body (good for changes). Use `enctype="multipart/form-data"` for file uploads.
- Group radios and checkboxes with the same `name`. Only radios enforce one selection.

Validation attributes trigger the browser's constraint API: `input.validity.valid`, `input.checkValidity()`, `input.setCustomValidity('message')`, and the `invalid` event. `form.reportValidity()` shows the built-in bubbles.

## Interactive elements

- `<button type="button|submit|reset">` — `submit` is the default, which surprises people inside forms; set the type explicitly. A `<button>` can contain icons and elements; `<input type="submit">` cannot.
- `<details>` with `<summary>` creates a native collapsible section. `details[open]` starts expanded. Its toggle event fires on change.
- `<dialog>` is a native modal. `dialog.showModal()` opens it with a backdrop, focus trapping, and Escape support; `dialog.close()` closes it. `::backdrop` styles the overlay.
- `<summary>` is the always-visible heading of a details element.
- `<menu>` is a semantic list of commands (rarely used).

## Accessibility essentials (ARIA)

The first rule of ARIA is not to use it when native HTML already says the right thing. A `<button>` is already a button; do not put `role="button"` on a `<div>` and rebuild keyboard support badly.

- `role="button|navigation|dialog|alert|status|tab|tabpanel|list|listitem|region"` declare intent when native elements cannot.
- `aria-label="Close dialog"` names an element with no visible text. `aria-labelledby="id"` points to visible text instead.
- `aria-describedby="id"` links extra help text.
- `aria-hidden="true"` removes decorative content from the accessibility tree. Never hide focusable content this way.
- `aria-expanded="true|false"` reports collapsed/expanded state for menus and accordions.
- `aria-controls="panel-id"` names the element a control affects.
- `aria-live="polite|assertive"` makes a region announce changes (chat messages, toasts). `role="status"` is a polite live region; `role="alert"` is assertive.
- `aria-current="page|step|location"` marks the active item in navigation.
- `aria-selected`, `aria-checked`, `aria-disabled`, `aria-pressed`, `aria-valuenow/min/max` mirror widget state.
- Keep a logical focus order. Never remove focus outlines without a visible replacement. Use `:focus-visible` for keyboard-only rings.
- Provide a "skip to content" link as the first focusable element.
- Text needs 4.5:1 contrast against its background (3:1 for large text and UI borders).

## Common mistakes

- Using `<div>` for a button, link, or heading instead of the real element.
- Duplicate `id` values, or `id`s starting with a digit.
- Nesting interactive elements (a button inside a link).
- Missing `alt`, or repeating the caption in `alt`.
- Using `<br>` for spacing instead of CSS margins.
- Nesting `<p>` inside `<p>` or leaving unclosed tags: the parser silently repairs the tree, usually not how you imagined.
- Using `<table>` to lay out a page.
- Forgetting `name` on form fields, so nothing is submitted.
- Loading scripts in `<head>` without `defer`, then querying elements that do not exist yet.
- Building a page that only works on mouse hover, or only with JavaScript.

## How HTML works with CSS and JavaScript

- CSS selectors match elements, ids, classes, attributes, and document structure. HTML supplies the hooks: classes, ids, data attributes, and semantic elements.
- JavaScript reaches the page through `document.querySelector`, `element.textContent`, `element.classList`, `element.setAttribute`, and event listeners. Keep behaviour in JS and styling in CSS.
- Inline `onclick="…"` handlers are hard to debug and blocked by strict Content-Security-Policy headers. Use `addEventListener`.
- The browser builds the DOM while parsing; `<script defer>` runs after the DOM is ready, which is why deferred scripts can query anything in the document.
- The accessibility tree is built from HTML semantics; good structure is the cheapest accessibility win there is.
