# Website design references: how the famous layouts are built

When someone says "build it like Hacker News" or "make a page that feels like Stripe", they are asking for a *structure*, not a copy. This document describes the anatomy of a dozen layouts most people already recognise, so a page can be built from the same bones in plain HTML and CSS.

The rule is constant: **borrow the structure, never the brand.** Take the grid, the density, the type scale and the interaction; do not take the logo, the name, the copy, the photography or the exact colour. A lookalike is fine as a homage; a clone of the trademark is not.

## Quick reference

| If the person says… | Base it on | The skeleton |
| --- | --- | --- |
| "a news site", "a link list", "dense" | Hacker News | one narrow column, numbered rows, orange header bar |
| "classifieds", "simple listing", "no frills" | Craigslist | three text columns, underlined blue links, zero images |
| "an encyclopedia", "an article", "reference" | Wikipedia | sidebar, serif-free body column, infobox on the right, footnotes |
| "documentation", "docs", "reference manual" | MDN | sticky left nav, prose column, code blocks, "on this page" |
| "a repo page", "dashboard", "developer tool" | GitHub | tabs, file table, right rail with about/metadata |
| "a landing page", "startup", "SaaS" | Stripe | large hero, gradient, feature grid of three, sub-page links |
| "marketplace", "bookings", "cards" | Airbnb | sticky search bar, card grid with images and price lines |
| "product page", "store" | Amazon | dense info column, buy box on the right, review block |
| "forum", "community", "feed" | Reddit | post cards with vote rail, comment threads |
| "video site", "gallery", "media" | YouTube | responsive thumbnail grid, sidebar of sections |
| "a search page", "a tool", "one box" | Google | centred input, nothing else competing |
| "a modern app", "workspace", "dark product" | Linear / Notion | fixed sidebar, content canvas, command palette |

## News list — the Hacker News skeleton

The most copied layout on the web, and the cheapest to build.

- **One column, ~800 px**, left-aligned, nothing centred.
- Rows: rank number, title link, then a dim metadata line ("142 points by user 3 hours ago | 84 comments").
- Header: a solid bar with the site name and a few plain links; the accent colour appears **only** there.
- Type: 10–13 px sans, tight line-height, grey metadata at ~60% contrast. Density is the point — no padding between rows beyond a couple of pixels.
- Interaction: nothing. Links navigate; that is the whole app.

```css
body { font: 12px/1.5 system-ui, sans-serif; max-width: 820px; margin: 0 auto; }
header { background: #ff6600; padding: 2px 6px; }
.row { padding: 3px 0; }
.meta { color: #666; font-size: 11px; }
```

## Classifieds — the Craigslist skeleton

- A header of plain categories, then **three columns of text links**, each with the count in parentheses.
- Blue underlined links on white; every element is a link; no images, no shadows, no cards.
- The page is a *directory*, so the only layout decision is column count at each breakpoint.

## Article — the Wikipedia skeleton

- Two zones: a left sidebar of navigation and a body column capped at ~55–70 characters per line.
- An **infobox** floats right: a bordered table of key/value facts, small type.
- A **table of contents** in a bordered box before the first heading.
- Headings create a visible hierarchy (`h2` with a hairline rule under it), and the footnote markers are small superscript links to a references list at the bottom.
- Type: body 14–16 px serif or humanist sans, generous line-height (1.6), links in a distinct blue, visited links purple.

## Documentation — the MDN skeleton

- **Sticky left sidebar**: nested sections, current page marked, collapsible groups.
- **Middle prose column**, max ~75 characters, with `h2` sections that are visually heavy and code blocks that are visibly distinct (`pre` with a border, monospace, horizontal scroll).
- **Right rail**: "On this page" links that follow the scroll, plus metadata.
- Inline `code` in a tinted pill; tables for parameters; a banner at the top marking the page's status.
- The pattern that makes docs usable: **every page is reachable from the sidebar**, and the URL mirrors the nesting.

## Repository — the GitHub skeleton

- Top: owner/name, a tab row (Code, Issues, Pull requests, Actions…), then a summary bar with counts.
- Body: a **file table** (icon, name, last commit message, relative time) that is really a list with aligned columns.
- Right rail: About, releases, languages bar, contributors.
- Buttons are the only rounded, filled elements; everything else is a hairline border on white or near-black.

## Landing page — the Stripe skeleton

- **Hero**: one enormous headline (48–72 px), one supporting sentence, one primary button, one secondary link.
- Behind it, a decorative gradient or abstract graphic that does not compete with the text.
- Then a **feature grid**: three columns, each an icon, a short heading, two lines of copy.
- Then a code sample or product screenshot, then logos/social proof, then a footer with four link columns.
- Dark and light variants exist; both rely on very few colours, one accent, and huge vertical spacing (80–120 px between sections).

## Marketplace — the Airbnb skeleton

- **Sticky search bar** at the top, split into segments (where / when / who), with a pill button.
- **Card grid**: 2 columns on a phone, 4–5 on a desktop, each card an image with rounded corners, a title line, a dim subtitle, a price line with bold price.
- Cards are links; hover lifts the image slightly and shows a heart button.
- Everything is derived from one data array — the grid is a `map`, not hand-written markup.

## Product page — the Amazon skeleton

- Two columns: **gallery on the left, buy box on the right**, details stacked between.
- The buy box is a bordered card: price, delivery line, stock status, quantity select, a full-width yellow button.
- Below: bullet "about this item", then specifications table, then reviews with a star histogram.
- Dense, unstyled-looking, and ruthlessly optimised: every element answers a purchase question.

## Community — the Reddit skeleton

- Post cards: a **vote column** on the left (arrow, count, arrow), a content column, a dim metadata row.
- Feed is infinite: fetch the next page when the sentinel scrolls into view (`IntersectionObserver`).
- Comments are nested with a vertical guide line per depth and a collapse control.
- Sorting controls (hot / new / top) change the *order of the same data*, not the layout.

## Media grid — the YouTube skeleton

- Fixed left sidebar (Home, Subscriptions, Library), collapses to icons on narrow screens.
- Thumbnail grid of 16:9 images with a duration badge, then two-line title, channel name, views and age.
- Hovering previews; clicking opens a detail view that replaces the grid.
- Responsive rule that matters: the grid uses `repeat(auto-fill, minmax(280px, 1fr))`, so the column count is a consequence of width rather than of breakpoints.

## Search — the Google skeleton

- One centered input, one button, a small logo above, and nothing else above the fold.
- The input is 500–600 px wide, fully rounded, with a visible focus ring and a live suggestion list.
- Results page: a narrow left column of filters, a wider column of results with a title link, a breadcrumb URL, and two lines of snippet.

## Modern app — the Linear / Notion skeleton

- **Fixed left sidebar** (~240 px): workspace switcher, navigation, a list of items.
- **Content canvas**: generous padding, one content column, no visible scrollbars until hover.
- **Command palette** on ⌘K: a centered overlay input with fuzzy results.
- Dark theme done properly: near-black background (`#0b0b0c`), three levels of elevation via slightly lighter panels and hairline borders, one accent colour, and text at 21:1 contrast rather than pure grey-on-black mush.

## How to build any of them from the description

1. **Pick the skeleton**: one column, two columns, sidebar + column, or card grid.
2. **Set the measure**: prose columns 60–75 characters; listings can be wider; grids are fluid.
3. **Choose the density**: editorial (generous), utility (tight). This single choice does more than any colour.
4. **One accent, everything else neutral.** The reference sites are almost all monochrome plus one colour.
5. **Type scale of three**: body, small/dim, and one heading size. Four sizes is already a lot.
6. **Build it from data**, even fake data — an array plus a `map` — so the layout survives having 40 items instead of 4.
7. **Make it work at 360 px wide** before adding anything decorative.

## What not to take

- **Logos, wordmarks and icons** — trademarks, and using them implies an affiliation that does not exist.
- **Body copy and marketing lines** — copyrighted text; write your own.
- **Photography and illustrations** — most are licensed, and hotlinking them is worse.
- **Trade dress**: the exact orange bar with the exact logo, or a pixel-for-pixel clone of a distinctive page, invites a complaint.

Say what you are doing: "a Hacker News-style list" is a description of a genre and is fine; "Hacker News" as your site's name and logo is not.

## Credits and further reading

The sites described here are public interfaces; the descriptions are original, written from how they work, with no code, copy or assets taken from them. For deeper, citable detail on any pattern:

- [MDN Web Docs](https://developer.mozilla.org/) — the authoritative reference for every CSS and HTML feature these layouts use.
- [web.dev](https://web.dev/) — layout, performance and accessibility guidance from the Chrome team.
- [WebAIM](https://webaim.org/) — contrast and screen-reader practice.
- [W3C WAI](https://www.w3.org/WAI/) — the accessibility guidelines themselves.
- [Wikipedia](https://www.wikipedia.org/) — for the history of these sites and their designs.
