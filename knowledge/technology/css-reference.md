# CSS reference — selectors, every property group, and layout

CSS (Cascading Style Sheets) turns the HTML tree into a designed page. A rule has a selector, a declaration block, and declarations made of a property and a value:

```css
.card > h2:hover {
  color: #ffffff;
  font-size: clamp(1.2rem, 2vw, 1.6rem);
}
```

Comments are `/* … */`. There are no `//` comments. Declarations end with `;`, and the last one should too. Unknown properties are ignored, which is how progressive enhancement works.

## Ways to apply CSS

- **External**: `<link rel="stylesheet" href="styles.css">` — cached, reusable, the default choice.
- **Internal**: `<style>` in the head — one page only.
- **Inline**: `style="color:red"` — highest specificity (except `!important`), impossible to reuse, avoid.
- **CSS-in-JS / constructed stylesheets**: `new CSSStyleSheet()` and `document.adoptedStyleSheets`.

## Selectors

| Selector | Matches |
| --- | --- |
| `*` | Every element. |
| `p` | All `<p>` elements. |
| `.card` | Elements with class `card`. |
| `#main` | The element with id `main`. |
| `[disabled]` | Elements with the attribute. |
| `[type="email"]` | Exact attribute value. |
| `[class~="tag"]` | Whitespace-separated word. |
| `[lang\|="en"]` | Value equal to or starting with `en-`. |
| `[href^="https"]`, `$=".pdf"`, `*="docs"` | Prefix, suffix, substring. |
| `[href$=".pdf" i]` | Case-insensitive flag. |
| `a, button` | Selector list: both. |
| `div p` | Descendant `<p>` anywhere inside a div. |
| `div > p` | Direct child only. |
| `h2 + p` | The `<p>` immediately after an h2. |
| `h2 ~ p` | Any `<p>` after an h2, same parent. |
| `:hover`, `:focus`, `:active`, `:visited` | User interaction states. |
| `:focus-visible` | Focus that should show a ring (keyboard, not mouse click). |
| `:focus-within` | Element containing a focused descendant. |
| `:first-child`, `:last-child`, `:only-child` | Position among siblings. |
| `:nth-child(2n+1)`, `:nth-of-type(3)` | Formulas and type-aware positions. |
| `:not(.active)`, `:is(h1, h2)`, `:where(h1, h2)` | Negation and grouping (`:where` has zero specificity). |
| `:has(> img)` | Parent selector: elements that contain a matching child. |
| `:empty` | No children or text. |
| `:disabled`, `:checked`, `:required`, `:invalid`, `:placeholder-shown` | Form states. |
| `:root` | The `<html>` element; where custom properties usually live. |
| `::before`, `::after` | Generated content (needs `content`). |
| `::first-line`, `::first-letter` | Typography details. |
| `::selection` | Highlighted text. |
| `::placeholder` | Placeholder text. |
| `::marker` | List bullets and numbers. |
| `::backdrop` | The dim layer behind a modal dialog. |

The universal reset `*, *::before, *::after { box-sizing: border-box; }` is the most useful one-liner in CSS.

## Cascade, specificity, inheritance

When rules conflict, the winner is decided by, in order:

1. **Origin and importance**: user-agent → user → author → author `!important` → user `!important`. Inline styles beat author rules; `!important` flips the order. Use `!important` rarely, mostly to override third-party CSS.
2. **Layer**: declarations in a `@layer` are weaker than unlayered ones, even if more specific.
3. **Specificity**: `(id, class/attribute/pseudo-class, element/pseudo-element)`. `#nav .item a` = (1,1,1). Inline style adds a virtual id level.
4. **Source order**: the later rule wins.

Inheritance: text properties (`color`, `font-*`, `line-height`, `text-align`, `visibility`) inherit; layout and box properties do not. Force either with `inherit`, `initial`, `unset`, or `revert`. Use `all: unset` to wipe everything.

Cascade layers:

```css
@layer reset, base, components, utilities;
@layer components { .button { … } }
```

## The box model

Every element is a rectangle made of content → padding → border → margin.

- `box-sizing: content-box` (default): `width` is the content width; padding and border add to it.
- `box-sizing: border-box`: `width` includes padding and border. Almost every project sets this globally.
- `margin` collapses between vertical adjacent blocks (the larger margin wins). Padding and borders prevent collapse. Flex and grid children do not collapse margins.
- `padding` percentages resolve against the containing block's **width**, even for top/bottom.
- Shorthand order is top right bottom left (clockwise). `margin: 1rem auto` centres a block with a width.
- Negative margins pull elements; `margin: auto` in flexbox absorbs free space.
- `overflow: visible|hidden|auto|scroll|clip` controls what happens when content is larger. `overflow-x` and `overflow-y` can differ. `overflow: auto` shows a scrollbar only when needed.
- `aspect-ratio: 16 / 9` reserves a shape independent of content.
- `min-width`, `max-width`, `min-height`, `max-height` constrain the box; `min-width: 0` is the classic fix for flex children that refuse to shrink.

## Display and layout basics

| `display` | Behaviour |
| --- | --- |
| `block` | Full-width box; starts on a new line. |
| `inline` | Flows with text; width/height ignored; vertical margins do not apply. |
| `inline-block` | Flows inline but accepts box properties. |
| `flex` | One-dimensional layout container. |
| `grid` | Two-dimensional layout container. |
| `flow-root` | Block box that contains its floats. |
| `contents` | The box disappears; children participate in the parent's layout. |
| `none` | Removed from layout and the accessibility tree. |

`visibility: hidden` hides but keeps space. `opacity: 0` also keeps space and still receives clicks. `hidden` attribute equals `display: none`.

## Positioning

- `position: static` — default flow.
- `position: relative` — offsets from its normal spot, which still reserves space. Also makes it the containing block for absolutely positioned children.
- `position: absolute` — removed from flow, positioned against the nearest positioned ancestor (or the initial containing block). Add `position: relative` to the parent.
- `position: fixed` — positioned against the viewport; stays while scrolling. A transformed or filtered ancestor breaks "fixed" and makes it behave like absolute.
- `position: sticky` — behaves relative until a threshold (`top: 0`), then sticks within its parent.
- Offsets: `top`, `right`, `bottom`, `left`, `inset`, `inset-inline`.
- `z-index` orders positioned (or flex/grid) elements within a stacking context. A new context is created by `position` + `z-index`, `transform`, `filter`, `opacity < 1`, `will-change`, `contain`, and `isolation: isolate`. If a tooltip mysteriously sits under something, check for an ancestor stacking context.
- Centring: `display: grid; place-items: center;` on the parent, or `position: absolute; inset: 0; margin: auto;` for a fixed-size box.

## Flexbox

```css
.row {
  display: flex;
  flex-direction: row;        /* row | row-reverse | column | column-reverse */
  flex-wrap: wrap;            /* nowrap | wrap | wrap-reverse */
  justify-content: space-between; /* main axis: flex-start | center | flex-end | space-around | space-evenly */
  align-items: center;        /* cross axis: stretch | flex-start | flex-end | baseline */
  align-content: flex-start;  /* cross-axis lines when wrapping */
  gap: 12px 20px;             /* row-gap column-gap */
}
.item {
  flex: 1 1 200px;            /* grow shrink basis */
  align-self: flex-end;       /* override align-items */
  order: 2;                   /* visual order; not for accessibility-critical order */
}
```

- `flex: 1` = `1 1 0%` (equal widths). `flex: auto` = `1 1 auto` (size from content). `flex: none` = `0 0 auto`.
- `margin-left: auto` on a flex child pushes it to the far end — an easy split navigation.
- The main axis follows `flex-direction`; `justify-content` follows the main axis, `align-items` the cross axis.
- Flex children default to `min-width: auto`, so long text refuses to shrink. Set `min-width: 0` (or `overflow: hidden`) on the child.
- `gap` works in flex and grid; it replaces many margin hacks.
- Flexbox is best for one dimension: rows of buttons, navigation bars, card contents.

## Grid

```css
.layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 320px;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "side main aside"
    "side main aside"
    "foot foot foot";
  gap: 16px;
}
.sidebar { grid-area: side; }
.header  { grid-column: 1 / -1; }   /* span every column */
.item    { grid-column: 2 / span 2; grid-row: 1; }
```

- `repeat(3, 1fr)` makes equal columns. `repeat(auto-fit, minmax(240px, 1fr))` is the responsive card grid — it fits as many 240px columns as possible.
- `auto-fill` keeps empty tracks; `auto-fit` collapses them (cards stretch). `minmax(0, 1fr)` avoids overflow from long content.
- `1fr` means "one share of the free space". `auto` sizes to content. `min-content`/`max-content` are intrinsic sizes.
- Implicit tracks (created by content beyond the template) are sized by `grid-auto-rows` / `grid-auto-columns`.
- Place items with `grid-column`, `grid-row`, `grid-area`, and line numbers (`1 / -1` spans everything). Named lines use `grid-template-columns: [start] 1fr [content] 2fr [end]`.
- Alignment: `justify-items/self` (inline axis), `align-items/self` (block axis), `place-items`, `justify-content`, `align-content`.
- `grid-template-areas` is the clearest way to describe a page layout; every row string must have the same number of cells.
- Subgrid: `grid-template-columns: subgrid` lets a child align to the parent's tracks.

## Sizing, units, and functions

- Absolute: `px`, `cm`, `mm`, `in`, `pt`, `pc`.
- Font-relative: `em` (parent font size), `rem` (root font size), `ex`, `ch` (width of "0").
- Viewport: `vw`, `vh`, `vmin`, `vmax`, `dvh`/`svh`/`lvh` (dynamic/small/large viewport height — better for phones), `vi`, `vb`.
- Container: `cqw`, `cqh`, `cqmin`, `cqmax` inside a `container-type` parent.
- Percentages resolve against the containing block (height percentages need a sized ancestor).
- `calc(100% - 48px)`, `min(60ch, 100%)`, `max(1rem, 2vw)`, `clamp(1rem, 2.5vw, 2rem)`.
- `min-content`, `max-content`, `fit-content(40ch)` size boxes to content.
- `env(safe-area-inset-bottom)` handles notches on phones.

## Typography

```css
body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: clamp(16px, 1rem + 0.2vw, 18px);
  line-height: 1.6;
  font-weight: 400;
  font-style: normal;
  letter-spacing: 0.01em;
  word-spacing: normal;
  text-align: left;
  text-transform: none;
  text-decoration: none;
  text-indent: 0;
  white-space: normal;      /* pre | pre-wrap | nowrap */
  overflow-wrap: break-word;
  hyphens: auto;
  font-variant-numeric: tabular-nums;
}
```

- `line-height` is best unitless (`1.5`) so it scales with font size.
- Font stacks avoid a web-font request; self-host fonts with `@font-face` and `font-display: swap` for speed.
- `@font-face { font-family: "Mox"; src: url(font.woff2) format("woff2"); font-weight: 400 700; font-display: swap; }` — variable fonts declare a weight range.
- `text-wrap: balance` balances headings; `pretty` avoids orphans in paragraphs.
- `letter-spacing` needs units (`0.02em`); negative values tighten large headings.
- `-webkit-line-clamp: 2` with `display: -webkit-box` truncates to two lines.
- `font-feature-settings` and `font-variant-*` enable ligatures, small caps, tabular numbers.
- Long words: `overflow-wrap: anywhere` or `word-break: break-word`; `hyphens: auto` needs a `lang` attribute.

## Colour, backgrounds, and borders

- Colour formats: `#000`, `#000000`, `#00000080` (alpha hex), `rgb(0 0 0 / 50%)`, `hsl(210 80% 40%)`, `oklch(0.6 0.15 250)`, `color(display-p3 …)`, `currentColor`, `transparent`, named colours.
- `background-color`, `background-image: url() | linear-gradient(45deg, #000, #fff) | radial-gradient(…) | conic-gradient(…) | repeating-linear-gradient(…)`, `background-size: cover|contain|100% 100%`, `background-position: center`, `background-repeat: no-repeat`, `background-attachment: fixed` (and `scroll`), `background-clip: text|padding-box|border-box`, `background-blend-mode`.
- `border: 1px solid #fff`; separate sides; `border-radius: 12px` or a shorthand `12px 4px 12px 4px`; `border-image`; `outline` draws outside the border box and does not affect layout.
- `box-shadow: 0 8px 24px rgb(0 0 0 / 40%)`, multiple comma-separated shadows, `inset` for inner shadows.
- `filter: blur(4px) brightness(1.2) contrast(1.1) grayscale(1) drop-shadow(0 2px 4px #000)`, `backdrop-filter: blur(12px)`.
- `mix-blend-mode`, `isolation: isolate`.
- `opacity` fades an element and its children; use `rgb()` alpha to fade only a background.

## Overflow, scrolling, and clipping

- `overflow: hidden` clips; `overflow: clip` clips without creating a scroll container.
- `scroll-behavior: smooth`, `overscroll-behavior: contain`, `scrollbar-width: thin`, `scrollbar-color`, `::-webkit-scrollbar`.
- `scroll-snap-type: x mandatory` on the container and `scroll-snap-align: start` on children builds a carousel.
- `position: sticky` needs a scrolling ancestor and a threshold.
- `clip-path: circle(50%) | polygon(…) | inset(0 0 20% 0)`, `mask-image`, `-webkit-mask`.
- `contain: layout paint`; `content-visibility: auto` skips off-screen rendering work.

## Transforms

`transform` accepts a list applied in order: `translate(x, y)`, `translateX`, `translateY`, `translate3d`, `scale`, `scaleX/Y`, `rotate(45deg)`, `skew`, `matrix`, `perspective()`.

- `transform-origin: center top` changes the pivot.
- `translate: 10px 20px` and `rotate: 45deg` are individual longhands.
- Transforms create a containing block for `fixed` descendants and a new stacking context.
- `will-change: transform` hints the compositor; do not apply it permanently to many elements.
- 3D: `perspective: 800px` on the parent, `transform-style: preserve-3d` on the child, `backface-visibility: hidden`.

## Transitions and animations

```css
.button {
  transition: background-color 150ms ease, transform 150ms cubic-bezier(.2,.8,.2,1);
}
.button:hover { background-color: #fff; transform: translateY(-1px); }

@keyframes spin { to { rotate: 360deg; } }
.spinner { animation: spin 900ms linear infinite; }
```

- `transition: property duration timing-function delay` (the first time is duration).
- Timing functions: `ease`, `ease-in`, `ease-out`, `ease-in-out`, `linear`, `steps(4, end)`, `cubic-bezier(x1,y1,x2,y2)`.
- Animate only `transform` and `opacity` for smooth 60 fps; animating `width`, `height`, `top`, or `margin` forces layout.
- `animation` shorthand: name duration timing delay iteration-count direction fill-mode play-state.
- `@media (prefers-reduced-motion: reduce)` should remove or reduce motion.

## Custom properties and functions

```css
:root { --ink: #ffffff; --space: 12px; --radius: 10px; }
.card {
  color: var(--ink, #fff);        /* fallback value */
  padding: calc(var(--space) * 2);
  border-radius: var(--radius);
}
```

- Custom properties are inherited, live in the cascade, and can be changed by media queries, classes, or JavaScript (`element.style.setProperty('--ink', '#000')`).
- They can hold any token stream, not just colours.
- `@property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }` gives a type and lets it animate.

## Responsive design

```css
@media (min-width: 700px) { … }
@media (max-width: 699px) { … }
@media (prefers-color-scheme: dark) { … }
@media (prefers-reduced-motion: reduce) { … }
@media (prefers-contrast: more) { … }
@media (hover: none) { … }
@media print { … }
```

- Mobile-first: base styles are for small screens, `min-width` queries add complexity upward.
- Use `clamp()`, `min()`, and `max()` for fluid type and spacing; use container queries for components.
- `@container (min-width: 420px) { … }` responds to the parent's size. The parent needs `container-type: inline-size` and a `container-name` to target it: `@container card (min-width: 420px)`.
- `@supports (display: grid) { … }` tests a feature. Modern alternative: write the modern property twice and let the browser discard what it cannot parse.
- Do not lock zoom: `user-scalable=no` is an accessibility failure.
- Touch targets should be at least 44×44 px.

## PSI: pseudo-elements and generated content

```css
.card::before { content: ""; position: absolute; inset: 0; background: #0008; }
.badge::after { content: attr(data-count); }
li::marker { color: #fff; }
```

- `::before`/`::after` require `content` (strings, `attr()`, counters, `none`).
- Generated content is decorative for screen readers unless you use `content: "…" / "alt text"`.
- Counters: `counter-reset`, `counter-increment`, `content: counter(step) ". "`.

## Forms and UI styling

- Reset form controls: `appearance: none`, then style backgrounds, borders, padding, and the focus ring.
- `accent-color: #fff` colours checkboxes, radios, and range tracks.
- Style placeholders with `::placeholder`; style invalid fields with `:invalid` or `:user-invalid` (only after interaction).
- `:focus` versus `:focus-visible`: the second is what keyboard users need.
- `fieldset { border: 0; margin: 0; padding: 0; }` is a common reset because browsers add odd defaults.
- `textarea { resize: vertical; }` prevents horizontal layout breakage.
- Native `<dialog>` is easier and more accessible than a hand-built modal.

## Modern CSS worth knowing

- Nesting: `.card { & > h2 { … } &:hover { … } }`.
- `:has()` parent selection: `.form:has(input:invalid) .hint { color: #fff; }`.
- `aspect-ratio`, `gap` in flex, `place-items`, `inset`, `dvh`.
- `color-mix(in oklab, #000 60%, #fff)`, `light-dark(#000, #fff)` with `color-scheme`.
- Logical properties: `margin-inline`, `padding-block`, `inset-inline-start`, `border-start-start-radius` adapt to writing direction; use `padding-inline` instead of left/right in international layouts.
- `text-box-trim` and `text-box-edge` trim leading whitespace above and below text.
- `view-transition-name` and the View Transitions API animate between DOM states.
- `@scope (.card) to (.card__inner) { … }` limits selectors to a subtree.
- `scroll-driven animations` via `animation-timeline: scroll()`.
- `field-sizing: content` auto-sizes textareas.

## Debugging CSS

1. Inspect the element; the Styles panel shows which rules apply and which are struck through (overridden).
2. Check the Computed panel for the actual final value of a property.
3. Use the Box Model diagram in DevTools to see padding, border, and margin.
4. Toggle declarations on and off to find the culprit; test with `!important` only as a diagnostic, not a fix.
5. If a layout overflows, add `outline: 1px solid red` to suspicious elements (outlines do not change layout).
6. If z-index fails, look for a stacking context created by a parent's transform, filter, or opacity.
7. If a flex/grid child will not shrink, check `min-width` and long unbreakable words.
8. Reproduce at 320px wide, 200% zoom, and with a keyboard only.

## Quick recipes

- **Centred page column**: `main { max-width: 72ch; margin-inline: auto; padding: 24px; }`
- **Sticky header**: `header { position: sticky; top: 0; z-index: 10; background: #000; }`
- **Responsive card grid**: `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px;`
- **Truncate one line**: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
- **Visually hidden but readable**: `position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0;`
- **Full-bleed background**: `width: 100vw; margin-left: calc(50% - 50vw);`
- **Equal-height cards**: flex/grid handles it automatically; with floats it does not.
- **Aspect ratio thumbnail**: `aspect-ratio: 4 / 3; object-fit: cover;`
