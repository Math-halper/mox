// Mox drawings — vector pictures made in the browser, not by a model.
//
// A 135M-parameter language model cannot draw, and asking it for raw SVG only
// produces broken markup. So drawing is handled here, deterministically:
//
//   drawSVG('a red heart')                 → real, valid SVG
//   drawSVG('bar chart of 4, 9, 2, 7')     → a real chart of those numbers
//   drawSVG('flowchart: plan -> build')    → boxes and arrows
//
// `drawingIntent()` decides whether a chat message is a request to draw at all,
// so normal questions still go to the model. `sanitizeSVG()` is the other half:
// it takes any ```svg block (from this module, or from a chat answer) and
// strips anything that is not safe drawing markup before it reaches the DOM.

const W = 320;
const H = 240;
const SVG_NS = 'http://www.w3.org/2000/svg';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

function escapeXML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ------------------------------------------------------------------ colours */

const NAMED_COLORS = {
  red: '#e5484d', crimson: '#c2185b', rose: '#f43f5e', pink: '#ec4899',
  magenta: '#d946ef', purple: '#8b5cf6', violet: '#7c3aed', indigo: '#6366f1',
  blue: '#3b82f6', azure: '#0ea5e9', cyan: '#06b6d4', teal: '#14b8a6',
  turquoise: '#2dd4bf', mint: '#6ee7b7', green: '#22a95d', emerald: '#10b981',
  lime: '#84cc16', olive: '#7a8b21', yellow: '#f2c94c', gold: '#d4a017',
  amber: '#f59e0b', orange: '#f08c00', coral: '#ff7f50', brown: '#8b5e34',
  tan: '#d2b48c', beige: '#e8dcc4', white: '#ffffff', silver: '#c0c4cc',
  grey: '#9ca3af', gray: '#9ca3af', black: '#111111', navy: '#1e3a8a',
  maroon: '#7f1d1d', sky: '#7dd3fc', lavender: '#c4b5fd', peach: '#ffd7b5',
  cream: '#fdf6e3', charcoal: '#2f3437', steel: '#64748b'
};

// Colours named in the prompt, longest name first so "light blue" style words
// do not shadow a longer match.
const COLOR_WORDS = Object.keys(NAMED_COLORS).sort((a, b) => b.length - a.length);

function colorWords(text) {
  const found = [];
  for (const word of COLOR_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, 'i');
    if (pattern.test(text)) found.push({ word, hex: NAMED_COLORS[word] });
  }
  for (const match of text.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
    found.push({ word: match[0], hex: match[0].length === 4 ? `#${match[1][0]}${match[1][0]}${match[1][1]}${match[1][1]}${match[1][2]}${match[1][2]}` : match[0] });
  }
  // "red heart with blue outline" — the first colour is the fill.
  return found;
}

function luminance(hex) {
  const value = String(hex).replace('#', '');
  if (value.length !== 6) return 0.5;
  const channel = (offset) => {
    const part = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * Paper, ink and fill for a drawing. Dark colours get light paper (so a navy
 * shape stays visible); light colours stay on the dark paper the app uses.
 */
function palette(colors) {
  const chosen = colors[0]?.hex || null;
  const dark = chosen ? luminance(chosen) < 0.32 : false;
  const fill = chosen || (dark ? '#111111' : '#f5f5f5');
  return {
    paper: dark ? '#f6f6f4' : '#111111',
    ink: dark ? '#111111' : '#f5f5f5',
    fill,
    // An outline only helps when the paper is light; on dark paper a lighter
    // outline around a light shape just fuzzes the edge.
    edge: dark ? '#111111' : 'none',
    // Marks *inside* a filled shape (eyes, windows) must contrast with the fill.
    detail: luminance(fill) > 0.5 ? '#111111' : '#f5f5f5',
    accent: dark ? '#4b5563' : '#9ca3af',
    light: !dark
  };
}

const CHART_COLORS = ['#e5484d', '#f08c00', '#f2c94c', '#22a95d', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

/* ---------------------------------------------------------------- geometry */

function starPoints(cx, cy, outer, inner, points = 5, rotation = -Math.PI / 2) {
  const list = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 ? inner : outer;
    const angle = rotation + (i * Math.PI) / points;
    list.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return list.join(' ');
}

function regularPolygon(cx, cy, radius, sides, rotation = -Math.PI / 2) {
  const list = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    list.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return list.join(' ');
}

function pieSlice(cx, cy, radius, start, end) {
  const x1 = cx + radius * Math.cos(start);
  const y1 = cy + radius * Math.sin(start);
  const x2 = cx + radius * Math.cos(end);
  const y2 = cy + radius * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${cx.toFixed(2)} ${cy.toFixed(2)} L${x1.toFixed(2)} ${y1.toFixed(2)} A${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

/* ---------------------------------------------------------------- templates */

const SHAPES = {
  circle: ({ fill, edge }) => `<circle cx="160" cy="120" r="76" fill="${fill}" stroke="${edge}" stroke-width="5"/>`,
  square: ({ fill, edge }) => `<rect x="86" y="46" width="148" height="148" rx="10" fill="${fill}" stroke="${edge}" stroke-width="5"/>`,
  rectangle: ({ fill, edge }) => `<rect x="44" y="74" width="232" height="124" rx="12" fill="${fill}" stroke="${edge}" stroke-width="5"/>`,
  triangle: ({ fill, edge }) => `<polygon points="160,42 288,206 32,206" fill="${fill}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>`,
  star: ({ fill, edge }) => `<polygon points="${starPoints(160, 122, 96, 40)}" fill="${fill}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>`,
  heart: ({ fill, edge }) => `<path d="M160 204C96 162 54 122 54 88c0-26 20-44 44-44 20 0 34 10 62 38 28-28 42-38 62-38 24 0 44 18 44 44 0 34-42 74-106 116Z" fill="${fill}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>`,
  diamond: ({ fill, edge }) => `<polygon points="160,28 284,120 160,212 36,120" fill="${fill}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>`,
  hexagon: ({ fill, edge }) => `<polygon points="${regularPolygon(160, 120, 92, 6)}" fill="${fill}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>`,
  pentagon: ({ fill, edge }) => `<polygon points="${regularPolygon(160, 124, 92, 5)}" fill="${fill}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>`,
  arrow: ({ fill }) => `
    <line x1="48" y1="120" x2="228" y2="120" stroke="${fill}" stroke-width="20" stroke-linecap="round"/>
    <polygon points="222,66 292,120 222,174" fill="${fill}"/>`,
  sun: ({ fill, edge }) => `
    <circle cx="160" cy="120" r="58" fill="${fill}" stroke="${edge}" stroke-width="4"/>
    ${Array.from({ length: 12 }, (_, index) => {
      const angle = (index * Math.PI) / 6;
      const inner = 72, outer = index % 2 ? 98 : 104;
      return `<line x1="${(160 + inner * Math.cos(angle)).toFixed(1)}" y1="${(120 + inner * Math.sin(angle)).toFixed(1)}" x2="${(160 + outer * Math.cos(angle)).toFixed(1)}" y2="${(120 + outer * Math.sin(angle)).toFixed(1)}" stroke="${fill}" stroke-width="9" stroke-linecap="round"/>`;
    }).join('')}`,
  moon: ({ fill, edge }) => `
    <path d="M206 36a92 92 0 1 0 22 166 96 96 0 0 1-22-166Z" fill="${fill}" stroke="${edge}" stroke-width="4" stroke-linejoin="round"/>`,
  cloud: ({ fill }) => `
    <g fill="${fill}">
      <circle cx="112" cy="132" r="38"/>
      <circle cx="162" cy="110" r="52"/>
      <circle cx="212" cy="136" r="34"/>
      <rect x="110" y="130" width="104" height="40" rx="12"/>
    </g>`,
  tree: ({ fill, edge, accent }) => `
    <rect x="152" y="158" width="16" height="56" fill="${accent}"/>
    <polygon points="160,24 226,118 94,118" fill="${fill}" stroke="${edge}" stroke-width="4" stroke-linejoin="round"/>
    <polygon points="160,74 236,180 84,180" fill="${fill}" stroke="${edge}" stroke-width="4" stroke-linejoin="round" opacity=".92"/>`,
  house: ({ fill, edge, accent, detail, ink }) => `
    <polygon points="160,30 282,112 38,112" fill="${fill}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>
    <rect x="70" y="110" width="180" height="98" fill="none" stroke="${ink}" stroke-width="5"/>
    <rect x="140" y="152" width="40" height="56" fill="${accent}"/>
    <rect x="92" y="132" width="42" height="36" fill="${fill}" stroke="${detail}" stroke-width="4"/>
    <line x1="113" y1="132" x2="113" y2="168" stroke="${detail}" stroke-width="3"/>
    <line x1="92" y1="150" x2="134" y2="150" stroke="${detail}" stroke-width="3"/>`,
  rocket: ({ fill, edge, accent, detail }) => `
    <path d="M160 20c38 34 52 84 52 138H108c0-54 14-104 52-138Z" fill="${fill}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>
    <circle cx="160" cy="98" r="20" fill="none" stroke="${detail}" stroke-width="5"/>
    <polygon points="108,120 62,178 108,170" fill="${accent}"/>
    <polygon points="212,120 258,178 212,170" fill="${accent}"/>
    <path d="M138 160h44c-4 24-14 42-22 54-8-12-18-30-22-54Z" fill="${accent}"/>
    <path d="M150 158h20c-3 20-10 34-10 44-2-12-8-26-10-44Z" fill="${detail}" opacity=".7"/>`,
  flower: ({ fill, edge, accent, detail }) => `
    <path d="M160 128v88" stroke="${accent}" stroke-width="7" stroke-linecap="round"/>
    <path d="M160 180c-34 2-52-10-52-10s20-18 52-2Z" fill="${accent}" opacity=".85"/>
    <g fill="${fill}" stroke="${edge}" stroke-width="3">
      ${Array.from({ length: 6 }, (_, index) => {
        const angle = (index * Math.PI) / 3 - Math.PI / 2;
        const x = (160 + 58 * Math.cos(angle)).toFixed(1);
        const y = (104 + 58 * Math.sin(angle)).toFixed(1);
        return `<ellipse cx="${x}" cy="${y}" rx="23" ry="36" transform="rotate(${(index * 60).toFixed(0)} ${x} ${y})"/>`;
      }).join('')}
    </g>
    <circle cx="160" cy="104" r="22" fill="${accent}" stroke="${detail}" stroke-width="2.5"/>`,
  face: ({ fill, edge, detail }) => `
    <circle cx="160" cy="120" r="90" fill="${fill}" stroke="${edge}" stroke-width="5"/>
    <circle cx="128" cy="100" r="9" fill="${detail}"/>
    <circle cx="192" cy="100" r="9" fill="${detail}"/>
    <path d="M112 138a52 52 0 0 0 96 0" fill="none" stroke="${detail}" stroke-width="7" stroke-linecap="round"/>`,
  check: ({ fill }) => `<polyline points="66,128 128,186 254,54" fill="none" stroke="${fill}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`,
  cross: ({ fill }) => `
    <line x1="76" y1="52" x2="244" y2="188" stroke="${fill}" stroke-width="26" stroke-linecap="round"/>
    <line x1="244" y1="52" x2="76" y2="188" stroke="${fill}" stroke-width="26" stroke-linecap="round"/>`,
  bolt: ({ fill, edge }) => `<polygon points="184,24 88,140 148,140 128,216 232,96 168,96" fill="${fill}" stroke="${edge}" stroke-width="4" stroke-linejoin="round"/>`,
  spiral: ({ fill }) => {
    const points = [];
    for (let i = 0; i < 220; i++) {
      const angle = i * 0.16;
      const radius = 4 + i * 0.55;
      if (radius > 108) break;
      points.push(`${(160 + radius * Math.cos(angle)).toFixed(1)},${(120 + radius * Math.sin(angle)).toFixed(1)}`);
    }
    return `<polyline points="${points.join(' ')}" fill="none" stroke="${fill}" stroke-width="7" stroke-linecap="round"/>`;
  }
};

const SHAPE_WORDS = [
  ['heart', /\bhearts?\b|\blove\b/],
  ['star', /\bstars?\b/],
  ['circle', /\bcircles?\b|\bround\b|\bball\b|\bdot\b/],
  ['square', /\bsquares?\b/],
  ['rectangle', /\brectangles?\b|\boblong\b/],
  ['triangle', /\btriangles?\b/],
  ['diamond', /\bdiamonds?\b|\brhombus\b|\bkite\b/],
  ['hexagon', /\bhexagons?\b/],
  ['pentagon', /\bpentagons?\b/],
  ['arrow', /\barrows?\b/],
  ['sun', /\bsun\b|\bsunshine\b|\bsunny\b/],
  ['moon', /\bmoon\b|\bcrescent\b/],
  ['cloud', /\bclouds?\b/],
  ['tree', /\btrees?\b|\bpine\b|\bfir\b/],
  ['house', /\bhouses?\b|\bhome\b|\bcabin\b/],
  ['rocket', /\brockets?\b|\bspaceship\b|\bspace ?ship\b/],
  ['flower', /\bflowers?\b|\brose\b|\btulip\b|\bblossom\b/],
  ['face', /\bsmiley\b|\bsmiling face\b|\bhappy face\b|\bemoji\b|\bface\b/],
  ['check', /\bcheck(?:mark)?\b|\btick\b|\bapproved?\b/],
  ['cross', /\bcross\b|\bex\b|\bx mark\b/],
  ['bolt', /\bbolt\b|\blightning\b|\bthunder\b/],
  ['spiral', /\bspiral\b|\bswirl\b/]
];

function shapeFor(text) {
  for (const [name, pattern] of SHAPE_WORDS) if (pattern.test(text)) return name;
  return null;
}

/* ------------------------------------------------------------------- scenes */

function landscape(p, prompt) {
  const sunset = /sunset|dusk|evening|sunrise|dawn|morning/i.test(prompt);
  const beach = /beach|sea|ocean|coast|shore|island/i.test(prompt);
  const skyTop = sunset ? '#2b1b3d' : p.light ? '#0b1220' : '#16233a';
  const skyBottom = sunset ? '#f08c00' : p.light ? '#334155' : '#1b2b45';
  const sunColor = sunset ? '#ffb703' : '#f2c94c';
  const hillBack = p.light ? '#4b5563' : '#1f2937';
  const hillFront = p.light ? '#111827' : '#0b0f14';
  const gradient = nextId('sky');
  const sunY = sunset ? 116 : 78;
  const sunX = sunset ? 246 : 250;
  return `
    <defs>
      <linearGradient id="${gradient}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${skyTop}"/>
        <stop offset="1" stop-color="${skyBottom}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#${gradient})"/>
    <circle cx="${sunX}" cy="${sunY}" r="${sunset ? 44 : 36}" fill="${sunColor}"/>
    ${beach
      ? `<rect y="148" width="${W}" height="92" fill="#1e6f8f"/>
         <path d="M0 164c40 10 74-8 120 0s70 12 116 2 60-8 84-2v46H0Z" fill="#155e75" opacity=".75"/>
         <rect y="198" width="${W}" height="42" fill="#e2cfa1"/>`
      : `<polygon points="0,214 70,118 146,214" fill="${hillBack}"/>
         <polygon points="164,214 248,138 330,214" fill="${hillBack}"/>
         <path d="M0 190c46-22 84 12 130-6s96-26 190 12v44H0Z" fill="${hillFront}"/>`}
    ${sunset ? '' : `<g fill="#ffffff" opacity=".8"><circle cx="52" cy="42" r="2"/><circle cx="96" cy="70" r="1.6"/><circle cx="140" cy="34" r="2.2"/><circle cx="286" cy="52" r="1.8"/></g>`}
    <g stroke="#f5f5f5" stroke-width="2" fill="none" opacity=".75">
      <path d="M60 72q8-6 16 0"/><path d="M78 64q8-6 16 0"/>
      <path d="M214 46q7-5 14 0"/><path d="M229 40q7-5 14 0"/>
    </g>`;
}

function nightScene(p, prompt) {
  const gradient = nextId('night');
  const seed = [...prompt].reduce((sum, char) => sum + char.codePointAt(0), 7);
  const stars = Array.from({ length: 26 }, (_, index) => {
    const x = ((seed * (index + 3) * 37) % 300) + 10;
    const y = ((seed * (index + 5) * 17) % 150) + 12;
    const r = index % 5 === 0 ? 2.2 : 1.3;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#f8fafc" opacity="${(0.45 + ((index % 4) * 0.15)).toFixed(2)}"/>`;
  }).join('');
  return `
    <defs>
      <linearGradient id="${gradient}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#05070f"/>
        <stop offset="1" stop-color="#1e2a4a"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#${gradient})"/>
    ${stars}
    <circle cx="236" cy="70" r="34" fill="#f8fafc"/>
    <circle cx="222" cy="62" r="6" fill="#dbe3ef" opacity=".7"/>
    <circle cx="248" cy="80" r="4" fill="#dbe3ef" opacity=".6"/>
    <path d="M0 196c50-30 92 8 140-10s110-24 180 14v40H0Z" fill="#0b1020"/>
    <polygon points="42,208 96,132 150,208" fill="#0b1020"/>
    <polygon points="92,208 150,120 208,208" fill="#0b1020"/>`;
}

/* ------------------------------------------------------------------- charts */

function numbersIn(text) {
  return (text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter((value) => Number.isFinite(value)).slice(0, 12);
}

function barChart(values, p) {
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);
  const baseline = 206;
  const top = 40;
  const slot = (W - 64) / values.length;
  const bars = values.map((value, index) => {
    const height = Math.max(2, (Math.abs(value) / max) * (baseline - top));
    const width = Math.min(46, slot * 0.62);
    const x = 32 + slot * index + (slot - width) / 2;
    const color = CHART_COLORS[index % CHART_COLORS.length];
    return `
      <rect x="${x.toFixed(1)}" y="${(baseline - height).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="4" fill="${color}"/>
      <text x="${(x + width / 2).toFixed(1)}" y="${(baseline - height - 8).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="${p.ink}">${escapeXML(value)}</text>`;
  }).join('');
  return `
    <line x1="24" y1="${baseline}" x2="${W - 20}" y2="${baseline}" stroke="${p.ink}" stroke-width="2" opacity=".6"/>
    ${bars}`;
}

function lineChart(values, p) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const top = 44, bottom = 200, left = 34, right = W - 26;
  const step = values.length > 1 ? (right - left) / (values.length - 1) : 0;
  const point = (value, index) => [
    left + step * index,
    bottom - ((value - min) / span) * (bottom - top)
  ];
  const points = values.map((value, index) => point(value, index).map((part) => part.toFixed(1)).join(',')).join(' ');
  const dots = values.map((value, index) => {
    const [x, y] = point(value, index);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${p.paper}" stroke="${CHART_COLORS[index % CHART_COLORS.length]}" stroke-width="3"/>`;
  }).join('');
  const grid = [0, 1, 2, 3].map((row) => {
    const y = top + ((bottom - top) / 3) * row;
    return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" stroke="${p.ink}" stroke-width="1" opacity=".16"/>`;
  }).join('');
  return `${grid}${dots}<polyline points="${points}" fill="none" stroke="${p.fill}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function pieChart(values, p, donut) {
  const total = values.reduce((sum, value) => sum + Math.abs(value), 0) || 1;
  let angle = -Math.PI / 2;
  const cx = 160, cy = 120, radius = 88;
  const slices = values.map((value, index) => {
    const sweep = (Math.abs(value) / total) * Math.PI * 2;
    const path = pieSlice(cx, cy, radius, angle, angle + sweep);
    angle += sweep;
    return `<path d="${path}" fill="${CHART_COLORS[index % CHART_COLORS.length]}" stroke="${p.paper}" stroke-width="2"/>`;
  }).join('');
  const hole = donut ? `<circle cx="${cx}" cy="${cy}" r="46" fill="${p.paper}"/>` : '';
  return `${slices}${hole}`;
}

/* --------------------------------------------------------------- flowcharts */

function flowChart(steps, p) {
  const items = steps.slice(0, 5);
  const gap = 12;
  const width = (W - 40 - gap * (items.length - 1)) / items.length;
  const height = 74;
  const top = (H - height) / 2;
  const boxes = items.map((label, index) => {
    const x = 20 + index * (width + gap);
    const box = `
      <rect x="${x.toFixed(1)}" y="${top}" width="${width.toFixed(1)}" height="${height}" rx="12" fill="${CHART_COLORS[index % CHART_COLORS.length]}" opacity="${index % 2 ? '.92' : '1'}"/>
      <text x="${(x + width / 2).toFixed(1)}" y="${(top + height / 2 + 5).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${width < 70 ? 11 : 13}" font-weight="600" fill="#ffffff">${escapeXML(label.slice(0, 16))}</text>`;
    if (index === items.length - 1) return box;
    const ax = x + width + 2;
    const bx = x + width + gap - 2;
    const arrow = `<line x1="${ax.toFixed(1)}" y1="${top + height / 2}" x2="${bx.toFixed(1)}" y2="${top + height / 2}" stroke="${p.ink}" stroke-width="3"/>
      <polygon points="${(bx - 6).toFixed(1)},${top + height / 2 - 6} ${bx.toFixed(1)},${top + height / 2} ${(bx - 6).toFixed(1)},${top + height / 2 + 6}" fill="${p.ink}"/>`;
    return box + arrow;
  }).join('');
  return `<rect x="6" y="${top - 16}" width="${W - 12}" height="${height + 32}" rx="16" fill="none" stroke="${p.ink}" stroke-width="1" opacity=".2"/>${boxes}`;
}

/* ------------------------------------------------------------ prompt parsing */

const DRAW_VERBS = /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:(?:now|just|quickly)\s+)?(?:draw|sketch|illustrate|paint|render|generate|create|make|design|compose|produce|give\s+me|show\s+me|i(?:'d|\s+would)?\s+(?:like|love|want|need)|let'?s\s+(?:see|make|draw))\b/;

const VISUAL_WORDS = /\bsvg\b|\bvector\b|\bimage\b|\bpicture\b|\bdrawing\b|\bsketch\b|\billustration\b|\blogo\b|\bicon\b|\bbadge\b|\bposter\b|\bdiagram\b|\bchart\b|\bgraph\b|\bplot\b|\bscene\b|\bwallpaper\b|\bpattern\b|\bemoji\b|\bclipart\b|\bgraphic\b/;

// Questions about drawing as a topic rather than a request for a drawing.
const TEACHING = /^(?:how|why|what|when|where|which|who|explain|describe|tell me about|difference|compare|is|are|does|do|can i|should i)\b|\b(?:tutorial|explain|difference between|syntax|code for|example of)\b/;

/**
 * Decide whether a chat message is a request for a drawing.
 * Returns `{ prompt }` when Mox should draw it, otherwise null.
 */
export function drawingIntent(question) {
  const raw = String(question || '').trim();
  if (!raw || raw.length > 400) return null;
  const text = raw.toLowerCase();
  if (TEACHING.test(text)) return null;
  if (/\b(?:conclusion|comparison|parallel|attention|breath|blood|line|bathtub|lot|near)\b/.test(text) && !VISUAL_WORDS.test(text)) return null;

  const verb = DRAW_VERBS.test(text);
  const visual = VISUAL_WORDS.test(text);
  if (!verb && !visual) return null;
  // "svg" alone is enough; otherwise the verb must point at something visual.
  if (!verb && !/\bsvg\b|\bchart\b|\bgraph\b|\bdiagram\b|\blogo\b|\bicon\b/.test(text)) return null;
  if (verb && !visual && !shapeFor(text) && !isScene(text) && !looksLikeChart(text) && !looksLikeFlow(text)) {
    // "draw a cat" — a subject Mox cannot build. Still handled, with a menu.
    return { prompt: raw, subject: null };
  }
  return { prompt: raw, subject: shapeFor(text) || (isScene(text) ? 'scene' : null) };
}

function isScene(text) {
  return /\bsunset\b|\bsunrise\b|\blandscape\b|\bmountains?\b|\bbeach\b|\bsea\b|\bocean\b|\bnight\b|\bstarry\b|\bstars?\b.*\bsky\b|\bsky\b/.test(text);
}

function looksLikeChart(text) {
  return /\b(?:bar|column|pie|donut|doughnut|line|area|scatter)\s*(?:chart|graph|plot)?\b|\bchart\b|\bgraph\b|\bplot\b/.test(text)
    && numbersIn(text).length >= 2;
}

function looksLikeFlow(text) {
  return /\bflowchart\b|\bflow chart\b|\bprocess\b|\bworkflow\b|\bsteps?\b|\bpipeline\b/.test(text);
}

function flowSteps(text) {
  const cleaned = text
    .replace(/^.*?(?:flowchart|flow chart|process|workflow|pipeline|steps?)\s*(?:of|for|:)?\s*/i, '')
    .replace(/\b(?:please|draw|make|create|sketch|show|me|a|an|the)\b/gi, ' ')
    .trim();
  let parts = cleaned.split(/\s*(?:->|→|=>|then|,|;|\u2192)\s*/i);
  if (parts.length < 2) parts = cleaned.split(/\band\b/i);
  parts = parts.map((part) => part.replace(/[.?!]+$/, '').trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

/* --------------------------------------------------------------- the drawing */

function frame(inner, p) {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <rect width="${W}" height="${H}" fill="${p.paper}"/>
  ${inner}
</svg>`;
}

/**
 * Build an SVG from a short request.
 * Returns `{svg, caption, kind}` — `svg` is null when the subject is not one of
 * the things this engine can construct exactly.
 */
export function drawSVG(prompt, options = {}) {
  const text = String(prompt || '').toLowerCase().trim();
  const colors = colorWords(text);
  const p = palette(colors);
  const values = numbersIn(text);

  // Charts first: they are the most explicit kind of request.
  if (values.length >= 2) {
    if (/\bdonut\b|\bdoughnut\b|\bring\b/.test(text)) {
      return { kind: 'donut', caption: `A donut chart of ${values.join(', ')}.`, svg: frame(pieChart(values, p, true), p) };
    }
    if (/\bpie\b/.test(text)) {
      return { kind: 'pie', caption: `A pie chart of ${values.join(', ')}.`, svg: frame(pieChart(values, p, false), p) };
    }
    if (/\bline\b|\btrend\b|\bplot\b|\bgraph\b|\bover time\b/.test(text) && !/\bbar\b|\bcolumn\b/.test(text)) {
      return { kind: 'line', caption: `A line chart of ${values.join(', ')}.`, svg: frame(lineChart(values, p), p) };
    }
    if (/\bbar\b|\bcolumn\b|\bhistogram\b|\bchart\b|\bgraph\b/.test(text)) {
      return { kind: 'bar', caption: `A bar chart of ${values.join(', ')}.`, svg: frame(barChart(values, p), p) };
    }
  }

  if (looksLikeFlow(text)) {
    const steps = flowSteps(text);
    if (steps) return { kind: 'flow', caption: `A flowchart: ${steps.slice(0, 5).join(' → ')}.`, svg: frame(flowChart(steps, p), p) };
  }

  if (/\bnight\b|\bstarry\b|\bstars in the sky\b/.test(text)) {
    return { kind: 'night', caption: 'A night sky with a moon, stars and hills.', svg: frame(nightScene(p, text), p) };
  }
  if (isScene(text)) {
    const caption = /beach|sea|ocean|coast|shore|island/.test(text)
      ? 'A beach with the sun over the water.'
      : /sunset|dusk|evening/.test(text)
        ? 'A sunset over hills.'
        : /sunrise|dawn|morning/.test(text)
          ? 'A sunrise over hills.'
          : 'A landscape with hills and a sun.';
    return { kind: 'landscape', caption, svg: frame(landscape(p, text), p) };
  }

  const shape = shapeFor(text) || options.shape;
  if (shape && SHAPES[shape]) {
    const svg = frame(SHAPES[shape](p), p);
    const colorName = colors[0]?.word && !colors[0].word.startsWith('#') ? `${colors[0].word} ` : '';
    return { kind: shape, caption: `A ${colorName}${shapeName(shape)}, drawn as SVG.`, svg };
  }

  return { kind: 'none', caption: '', svg: null };
}

function shapeName(shape) {
  return shape === 'face' ? 'smiley face' : shape;
}

export const DRAWABLE = [
  'circle', 'square', 'rectangle', 'triangle', 'star', 'heart', 'diamond', 'hexagon',
  'pentagon', 'arrow', 'sun', 'moon', 'cloud', 'tree', 'house', 'rocket', 'flower',
  'smiley face', 'checkmark', 'cross', 'lightning bolt'
];

export const DRAW_EXAMPLES = [
  'draw a red heart',
  'draw a rocket',
  'bar chart of 4, 9, 2, 7',
  'flowchart: research -> design -> build -> ship'
];

/** A short, honest answer when the subject is not something Mox can build. */
export function drawingMenu(prompt) {
  const asked = String(prompt || '').replace(DRAW_VERBS, '').replace(/\s+/g, ' ').trim();
  const lines = [
    asked ? `I can't build **${asked}** exactly — Mox draws with SVG shapes and charts, not pixels.` : 'Mox draws with SVG shapes and charts, not pixels.',
    '',
    'Things I draw well:',
    '',
    ...DRAWABLE.slice(0, 12).map((item) => `- ${item}`),
    '',
    'Or ask for one of these:',
    '',
    ...DRAW_EXAMPLES.map((item) => `- “${item}”`),
    '',
    'Every drawing is made in this browser: no image model, no upload, and the code is yours to keep.'
  ];
  return lines.join('\n');
}

/** Markdown answer for a chat request: a caption plus the SVG as a fenced block. */
export function drawingAnswer(prompt) {
  const result = drawSVG(prompt);
  if (!result.svg) {
    return { text: drawingMenu(prompt), svg: null, kind: 'menu' };
  }
  const text = [
    `**${result.caption}**`,
    '',
    '```svg',
    result.svg.trim(),
    '```',
    '',
    '_Drawn in your browser — save the .svg, copy the code, or open it in the workspace._'
  ].join('\n');
  return { text, svg: result.svg, kind: result.kind, caption: result.caption };
}

/* -------------------------------------------------------------- svg sanitation */

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'use', 'symbol', 'pattern', 'mask', 'filter', 'feGaussianBlur', 'feOffset',
  'feBlend', 'feColorMatrix', 'feMerge', 'feMergeNode', 'marker'
]);

const ALLOWED_ATTRS = new Set([
  'xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'd', 'points', 'fill', 'fill-opacity',
  'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-opacity', 'stroke-miterlimit', 'opacity', 'transform',
  'gradientUnits', 'gradientTransform', 'offset', 'stop-color', 'stop-opacity',
  'clip-path', 'clipPathUnits', 'id', 'class', 'font-family', 'font-size',
  'font-weight', 'text-anchor', 'dominant-baseline', 'preserveAspectRatio',
  'patternUnits', 'patternContentUnits', 'markerWidth', 'markerHeight', 'refX', 'refY',
  'orient', 'aria-hidden', 'role', 'href', 'xlink:href', 'filter', 'in', 'in2',
  'stdDeviation', 'result', 'mode', 'values', 'type', 'dx', 'dy'
]);

function safeFillValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/url\(#[\w-]+\)/.test(text)) return text;
  if (/^(?:none|currentColor|transparent|inherit)$/i.test(text)) return text;
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^rgba?\(\s*[\d.%\s,]+\)$/i.test(text)) return text;
  if (/^hsla?\(\s*[\d.%\s,deg]+\)$/i.test(text)) return text;
  if (/^[a-z]{3,24}$/i.test(text)) return text;
  return null;
}

/**
 * Keep only drawing markup: no scripts, no event handlers, no external loads.
 * Returns a clean SVG string, or null when the input is not an SVG document.
 */
export function sanitizeSVG(text) {
  const source = String(text || '').trim();
  if (!source || !/<svg[\s>]/i.test(source)) return null;
  const start = source.indexOf('<svg');
  const end = source.lastIndexOf('</svg>');
  if (end < start) return null;
  const slice = source.slice(start, end + 6);
  if (typeof DOMParser !== 'function') return null;

  let doc;
  try {
    doc = new DOMParser().parseFromString(slice, 'image/svg+xml');
  } catch {
    return null;
  }
  if (!doc || doc.querySelector('parsererror')) return null;
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;

  const clean = (node) => {
    if (node.nodeType === 3) return;                       // text nodes are fine
    if (node.nodeType !== 1) { node.remove(); return; }    // comments, CDATA, processing instructions
    const tag = node.nodeName;
    const normalized = tag.includes(':') ? tag.split(':').pop() : tag;
    if (!ALLOWED_TAGS.has(normalized)) { node.remove(); return; }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      const allowed = ALLOWED_ATTRS.has(name) || /^data-[\w-]+$/.test(name) || /^aria-[\w-]+$/.test(name);
      if (!allowed) { node.removeAttribute(attribute.name); continue; }
      if (name === 'href' || name === 'xlink:href') {
        if (!value.trim().startsWith('#')) node.removeAttribute(attribute.name);
        continue;
      }
      if (['fill', 'stroke', 'stop-color', 'filter', 'clip-path'].includes(name)) {
        const safe = safeFillValue(value);
        if (safe === null) node.removeAttribute(attribute.name);
      }
    }
    // <use> must point inside this document.
    for (const child of [...node.children]) clean(child);
  };

  clean(root);
  for (const child of [...root.children]) clean(child);
  const viewBox = root.getAttribute('viewBox');
  if (!viewBox && root.getAttribute('width') && root.getAttribute('height')) {
    root.setAttribute('viewBox', `0 0 ${parseFloat(root.getAttribute('width')) || W} ${parseFloat(root.getAttribute('height')) || H}`);
  }
  root.removeAttribute('width');
  root.removeAttribute('height');
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${W} ${H}`);
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  let output = '';
  try { output = new XMLSerializer().serializeToString(root); } catch { output = root.outerHTML || ''; }
  if (!output) return null;
  // Some serialisers drop the namespace, which breaks standalone .svg files.
  if (!/^<svg[^>]*\sxmlns=/i.test(output)) {
    output = output.replace(/^<svg/i, `<svg xmlns="${SVG_NS}"`);
  }
  return output;
}

/** Any ```svg fenced block in a text answer, sanitized. */
export function svgBlocksIn(text) {
  const blocks = [];
  for (const match of String(text || '').matchAll(/```svg[^\n]*\n([\s\S]*?)```/gi)) {
    const clean = sanitizeSVG(match[1]);
    if (clean) blocks.push(clean);
  }
  return blocks;
}

/** Turn `<draw>a red heart</draw>` in a model answer into a real drawing block. */
export function resolveDrawTags(text) {
  if (!text || !/<draw>/i.test(text)) return text;
  return String(text).replace(/<draw>\s*([\s\S]{1,300}?)\s*<\/draw>/gi, (match, request) => {
    const result = drawSVG(request);
    if (!result.svg) return `_(Mox cannot draw “${request}”.)_`;
    return `\n\n\`\`\`svg\n${result.svg.trim()}\n\`\`\`\n\n`;
  });
}

export function svgDataURL(svg) {
  const clean = sanitizeSVG(svg);
  if (!clean) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
}

/** Rasterise a drawing for a PNG download. Rejects when canvas is unavailable. */
export function svgToPNG(svg, width = 960) {
  const url = svgDataURL(svg);
  if (!url) return Promise.reject(new Error('That is not a valid SVG'));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const ratio = image.height && image.width ? image.height / image.width : H / W;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.round(width * ratio);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('Could not read that SVG'));
    image.src = url;
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slugify(value, fallback = 'mox-drawing') {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || fallback;
}

/* ------------------------------------------------------------ chat rendering */

function figureButton(label, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'md-figure-action';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Replace ```svg code blocks inside rendered chat HTML with the drawing plus
 * its actions. `hooks` supplies the app-side callbacks: toast, copy, workspace.
 */
export function hydrateSVGFigures(root, hooks = {}) {
  if (!root || typeof document === 'undefined') return 0;
  let count = 0;
  for (const block of [...root.querySelectorAll('pre[data-lang="svg"]')]) {
    const code = block.querySelector('code');
    const source = code ? code.textContent : block.textContent;
    const clean = sanitizeSVG(source);
    if (!clean) continue;

    const figure = document.createElement('figure');
    figure.className = 'md-figure';

    const canvas = document.createElement('div');
    canvas.className = 'md-figure-canvas';
    canvas.innerHTML = clean;
    const svg = canvas.firstElementChild;
    if (svg) {
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', 'auto');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('aria-hidden', 'true');
    }
    figure.append(canvas);

    const bar = document.createElement('figcaption');
    bar.className = 'md-figure-bar';

    const label = document.createElement('span');
    label.className = 'md-figure-label';
    label.textContent = 'SVG drawing';
    bar.append(label);

    const actions = document.createElement('div');
    actions.className = 'md-figure-actions';

    actions.append(figureButton('Download', 'Save this drawing as image.svg', () => {
      downloadBlob(new Blob([clean], { type: 'image/svg+xml' }), 'mox-drawing.svg');
      hooks.toast?.('Saved mox-drawing.svg');
    }));
    actions.append(figureButton('PNG', 'Save a 960 px PNG copy', async () => {
      try {
        downloadBlob(await svgToPNG(clean), 'mox-drawing.png');
        hooks.toast?.('Saved mox-drawing.png');
      } catch {
        hooks.toast?.('PNG export is not available in this browser; the .svg still works.');
      }
    }));
    actions.append(figureButton('Copy', 'Copy the SVG code', async () => {
      try {
        await hooks.copy?.(clean);
        hooks.toast?.('SVG code copied');
      } catch {
        hooks.toast?.('Could not copy the SVG');
      }
    }));
    if (hooks.openInWorkspace) {
      actions.append(figureButton('Open in workspace', 'Edit this drawing in the code workspace', () => {
        hooks.openInWorkspace(clean);
      }));
    }
    bar.append(actions);
    figure.append(bar);

    block.replaceWith(figure);
    count += 1;
  }
  return count;
}

/** The scripting API behind window.__mox.draw. */
export const svgAPI = {
  draw: (prompt) => drawSVG(prompt),
  answer: (prompt) => drawingAnswer(prompt),
  sanitize: sanitizeSVG,
  blocks: svgBlocksIn,
  shapes: [...DRAWABLE],
  examples: [...DRAW_EXAMPLES]
};
