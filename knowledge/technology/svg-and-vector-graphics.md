# SVG and vector graphics

SVG (Scalable Vector Graphics) is a picture format written in markup. Instead of a grid of coloured pixels, an SVG file lists shapes and the numbers that describe them: "a circle here, this big, in this colour". The browser draws it at any size without blurring, which is why logos, icons, charts, diagrams, and maps are usually SVG.

## A minimal file

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <circle cx="50" cy="50" r="40" fill="#e5484d" stroke="#111" stroke-width="4"/>
</svg>
```

- `xmlns` declares the SVG namespace. It is required for a standalone `.svg` file.
- `viewBox="minX minY width height"` defines the internal coordinate system. The browser scales that box to whatever size the element is given, so `viewBox` is what makes a drawing responsive.
- `width` and `height` set the size on screen. Omit them (and use CSS) when the drawing should fill its container.

Coordinates start at the top-left corner. x grows to the right, y grows downwards — the opposite of the maths you learn at school.

## The shape elements

| Element | What it draws | Main attributes |
| --- | --- | --- |
| `<rect>` | Rectangle | `x`, `y`, `width`, `height`, `rx`, `ry` (corner radius) |
| `<circle>` | Circle | `cx`, `cy`, `r` |
| `<ellipse>` | Oval | `cx`, `cy`, `rx`, `ry` |
| `<line>` | Straight line | `x1`, `y1`, `x2`, `y2` |
| `<polyline>` | Connected line, not closed | `points="x1,y1 x2,y2 …"` |
| `<polygon>` | Closed shape | `points="…"` |
| `<path>` | Anything | `d` (drawing commands) |
| `<text>` | Text | `x`, `y`, `font-size`, `text-anchor` |
| `<image>` | A raster image inside the drawing | `href`, `x`, `y`, `width`, `height` |
| `<g>` | A group, so styles and transforms apply to several shapes | `transform` |

## Path commands

`<path>` is the workhorse. Its `d` attribute is a list of commands with coordinates:

- `M x y` — move to (start a new subpath)
- `L x y` — line to; `H x` and `V y` for horizontal and vertical
- `C x1 y1 x2 y2 x y` — cubic Bézier curve
- `Q x1 y1 x y` — quadratic Bézier curve
- `A rx ry rotation large-arc sweep x y` — elliptical arc
- `Z` — close the path

Commands are case-sensitive: uppercase means absolute coordinates, lowercase means relative to the previous point. For example, a heart can be drawn as `M160 204C96 162 54 122 54 88c0-26 20-44 44-44 20 0 34 10 62 38…`.

## Styling

Every shape accepts presentation attributes, or the same properties through CSS:

- `fill` — inside colour; `fill="none"` for an outline only.
- `stroke` — outline colour; `stroke-width` its thickness; `stroke-linecap` (`butt`, `round`, `square`) and `stroke-linejoin` (`miter`, `round`, `bevel`) shape the ends and corners.
- `stroke-dasharray="8 4"` makes dashes; add `stroke-dashoffset` to shift them and animate them for "drawing" effects.
- `opacity` (0–1) fades the whole shape; `fill-opacity` and `stroke-opacity` fade one part.
- `transform="translate(10,20) rotate(30) scale(1.5)"` moves, turns, and resizes; transforms apply in the order written.

Colours can be named (`red`, `teal`), hexadecimal (`#e5484d`), `rgb()`, `hsl()`, or a reference to a gradient: `fill="url(#sunset)"`.

```svg
<defs>
  <linearGradient id="sunset" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2b1b3d"/>
    <stop offset="1" stop-color="#f08c00"/>
  </linearGradient>
</defs>
<rect width="320" height="240" fill="url(#sunset)"/>
```

`<defs>` holds reusable pieces that are not drawn until referenced: gradients, `<symbol>`s, `<clipPath>`s, `<mask>`s, and `<pattern>`s. `<use href="#id"/>` stamps a copy of a defined element, and `id` values must be unique within the document.

## Text

`<text x="80" y="100" font-family="system-ui, sans-serif" font-size="16" text-anchor="middle">Hello</text>`. `text-anchor` controls horizontal alignment (`start`, `middle`, `end`) around `x`; `dominant-baseline` does the same vertically. Text is selectable and searchable, which matters for charts and diagrams. To wrap long text, use `<tspan>` with `x` and `dy`, or a `<foreignObject>` containing HTML.

## Using SVG on a web page

- **Inline**: paste the `<svg>` element straight into the HTML. It can be styled with CSS from the page, animated with JavaScript, and read by screen readers. This is the most flexible option and the one Mox uses for drawings.
- **`<img src="drawing.svg">`**: cached like any image, and safe (no scripts), but you cannot restyle the inside.
- **CSS `background-image: url(drawing.svg)`**: fine for decoration; needs a `viewBox` to scale predictably.
- **`<object>` or `<iframe>`**: an isolated document, useful for interactive SVG.

## SVG versus raster images

| | SVG | PNG / JPEG / WebP |
| --- | --- | --- |
| Made of | Geometry and numbers | A grid of pixels |
| Scaling | Sharp at any size | Blurs or pixelates |
| File size | Tiny for shapes, charts, logos | Grows with resolution |
| Photographs | Poor fit | The right tool |
| Editing | Text editor, diffable, greppable | Image editor |

The rule of thumb: vector for things that are drawn (logos, icons, charts, diagrams, maps, UI), raster for things that are photographed or painted.

## Making charts in SVG

Build a chart from primitives and compute the coordinates:

1. Choose a plotting area: `x` from 40 to 300, `y` from 40 to 200.
2. Find the maximum value of the data. `height = (value / max) * plotHeight`.
3. A bar is a `<rect>` whose top is `baseline - height`.
4. An axis is a `<line>`; tick labels are `<text>` elements.
5. A line chart is a `<polyline>` through the points, with a `<circle>` at each one.
6. A pie slice is a `<path>`: `M cx cy L x1 y1 A r r 0 largeArc 1 x2 y2 Z`. `largeArc` is 1 when the slice spans more than 180°.

Never guess a number that can be computed. Worked example: for the values 4, 9, 2 with a maximum of 9 and a plot height of 160, the bars are 71, 160, and 36 units tall.

## Accessibility

- Give the root element `role="img"` and an `<title>` (and optionally `<desc>`) as its first children; screen readers announce the title.
- If a drawing is purely decorative, mark it `aria-hidden="true"` and do not give it a title.
- Do not encode meaning in colour alone: add labels, patterns, or different shapes.
- Keep text at least 12 px equivalent and check contrast: 4.5:1 for body-sized text, 3:1 for large text and graphical objects.

## Optimising an SVG file

Editor exports carry a lot of waste. Remove metadata, comments, unused `<defs>`, and editor namespaces; round coordinates to two decimals; combine repeated attributes into a `<g>`; avoid embedded images and huge filter stacks. Tools such as SVGO do this automatically, but check the result — some optimisers flatten things you wanted to keep editable.

## Security

SVG is markup, so it can carry scripts and event handlers. An SVG uploaded by a stranger must be sanitised before it is shown inline: strip `<script>`, `on*` event attributes, external `href` loads, and `<foreignObject>` unless it is trusted. Served as `<img>` or as a background image, SVG is inert; inlined into the page, it is as powerful as the page itself.

## How Mox draws

Mox has a drawing engine rather than an image model. Ask for something it can construct exactly and it writes the SVG itself:

- **Shapes**: circle, square, rectangle, triangle, star, heart, diamond, hexagon, pentagon, arrow, sun, moon, cloud, tree, house, rocket, flower, smiley face, checkmark, cross, lightning bolt, spiral.
- **Charts**: `bar chart of 4, 9, 2, 7`, `pie chart of 50, 30, 20`, `donut chart of 1,2,3`, `line chart of 3, 8, 4, 12`.
- **Diagrams**: `flowchart: research -> design -> build -> ship`.
- **Scenes**: `draw a sunset over mountains`, `draw a night sky`, `draw a beach`.
- **Colours** are understood in words (`a red heart`, `a navy star`) or as hex codes, and the paper flips to light behind dark shapes so the drawing stays visible.

Every drawing in chat has buttons to download the `.svg`, export a PNG, copy the markup, or open it in the code workspace. The same engine is reachable from the console: `__mox.draw.draw('draw a blue hexagon')` returns `{svg, caption, kind}`.

The honest limit: this is geometry, not imagination. It draws shapes, charts, diagrams, and simple scenes well; it cannot draw a dog, a portrait, or a photorealistic anything. For those, a raster image needs an image model or a drawing hand.
