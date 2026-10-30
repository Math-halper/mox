# Charts, diagrams, and data visualization

A chart is an argument made of geometry. Choosing the right one, and labelling it honestly, matters more than any styling.

## Choosing the chart type

| Job | Chart | Why |
| --- | --- | --- |
| Compare categories | Bar or column chart | Length is the easiest difference for the eye to judge |
| Show a trend over time | Line chart | Position along a shared axis shows direction and turning points |
| Show parts of a whole | Pie or donut chart | Only with fewer than about six slices; otherwise use a bar chart |
| Show a distribution | Histogram, box plot, or dot plot | Reveals spread, clusters, and outliers |
| Show a relationship between two measures | Scatter plot | Clusters, gaps, and trends become visible |
| Show flow or sequence | Flowchart or Sankey diagram | Makes steps and quantities explicit |
| Show structure | Tree, org chart, or mind map | Hierarchy, not magnitude |
| Show a schedule | Gantt chart | Time on one axis, tasks on the other |

Rules of thumb: bars when the categories are ordered arbitrarily, lines when the categories are consecutive (usually time), and scatter points when both axes are measurements. If the story is "these values differ", a bar chart almost always wins over a pie.

## Honest axes and scales

- **Bar charts must start at zero.** A bar's length *is* its value; cutting the axis off exaggerates differences many times over.
- **Line charts may start above zero** when the changes are small relative to the total, but say so with a label or a visible axis break.
- **One axis scale per measure.** Two measures on one chart need two labelled axes or a separate chart.
- **Logarithmic scales** compress a huge range (1 to 1,000,000). They are honest only when labelled as logarithmic, because equal distances then mean equal *ratios*.
- **Same width for equal intervals.** Uneven bins or categories of unequal width mislead unless the widths carry meaning.
- Percentages across categories must add to 100; if respondents could pick several options, they will not, and the chart should say so.

## Labels, titles, and legends

A finished chart answers three questions without help: what is being measured, of what, and over which range.

- **Title** describes the finding ("Sales rose 12% in the last quarter"), not the variable ("Sales").
- **Axis labels** include units. A bare "10" is not information.
- **Legends** appear when there are several series; direct labels on the line or bar are better still.
- **Data labels** help for a handful of values, then become clutter.
- **Sources and dates** belong in small print under the chart. "Since when" is part of the claim.
- Round for the reader: 3 or 4 significant figures is plenty on a chart. Keep full precision in the data file.

## Design in black and white

- Use colour for meaning, not decoration. Highlight the one series that matters and make the rest grey.
- Check contrast: 4.5:1 for text, 3:1 for lines and areas at normal size.
- Do not rely on red and green alone. About 8% of men have a colour-vision deficiency; pair colour with labels, line styles, or patterns.
- Order colours consistently: the same category keeps the same colour in every chart in a report.
- Fewer lines, thinner gridlines, no 3-D effects, no shadows. Anything that does not carry data competes with it.
- Sort bars by value unless the categories have a natural order (months, age bands, grades).

## Common chart mistakes

- Pie charts with ten slices, or slices that nearly match.
- A truncated y-axis on a bar chart.
- Doubling the picture size of a bar while doubling only one dimension (an "area" horror that overstates the change).
- Comparing percentages drawn from wildly different sample sizes without the counts.
- Mixing units on one axis, or comparing a total with a rate.
- Turning a correlation into a cause in the title.
- Truncating a time series that has a longer history — the scale of the past is part of the story.

## Building a chart from numbers by hand

1. **List the data** as ordered pairs or a table.
2. **Find the range** for each axis: minimum and maximum, then round outwards to friendly numbers.
3. **Map data to pixels**: `pixel = margin + (value - min) / (max - min) * plotSize`. For bar length with a zero baseline, `min = 0`.
4. **Draw the scaffolding**: axes, gridlines, labels.
5. **Draw the marks**: bars as rectangles, points as circles, a line as a polyline through those points.
6. **Annotate**: axis titles, units, the source line, and one highlight if there is a point to make.
7. **Check**: print the chart small, squint, and see whether the claim still reads correctly.

Worked example — values 12, 18, 5, 9 with plot height 160 and a zero baseline:

- Maximum: 18.
- Bar heights: `12/18 * 160 = 107`, `18/18 * 160 = 160`, `5/18 * 160 = 44`, `9/18 * 160 = 80`.
- With a 20-pixel slot per bar and 12 pixels of gap, the bar width is 8 and each bar starts at `20 * index + 6`.

## Diagrams that explain something

- **Flowcharts** use a box per step and arrows for direction. Rhombuses mark decisions, with labelled "yes" and "no" branches. Keep one direction of flow — top to bottom or left to right.
- **Before/after and comparison diagrams** should have identical frames, so the eye compares content rather than layout.
- **Annotated diagrams** point at the real thing (a labelled heart, a labelled machine) rather than at a box standing in for it.
- Aim for five to nine items on one diagram. Beyond that, split it or use a hierarchy.
- Write each step as a verb phrase ("validate input", "send confirmation"), not a noun.

## Describing a chart in words

A useful written summary gives the measure, the direction, the size, and the exception: "Monthly signups rose from 1,200 in January to 1,850 in June, roughly 54%, with a dip in April." Numbers first, adjectives second. State what the chart cannot tell you — a chart of signups says nothing about whether those users stayed.

## Where charts come in this app

Mox can build bar, line, pie, and donut charts as real SVG from the numbers in a question — `bar chart of 4, 9, 2, 7`, `pie chart of 50, 30, 20`, `line chart of 3, 8, 4, 12, 6` — and diagrams such as `flowchart: research -> design -> build -> ship`. Because the numbers are placed on the axis by arithmetic rather than by a model's guess, the geometry matches the data. The calculator handles the arithmetic exactly; the chart engine handles the coordinates.
