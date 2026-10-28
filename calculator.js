// Mox calculator — a real expression engine, not `eval`.
//
// The same engine powers three surfaces:
//   1. the calculator panel (keypad, history, unit converter),
//   2. <calc>…</calc> tags in model answers, so arithmetic is exact, and
//   3. window.__mox.calc(), the scripting API.
//
// Grammar (precedence low → high):
//   expression := term (('+' | '-') term)*
//   term       := unary (('*' | '/' | implicit) unary)*
//   unary      := ('+' | '-') unary | power
//   power      := postfix ('^' unary)?          right associative
//   postfix    := primary ('!' | '%')*
//   primary    := number | constant | name | name '(' args ')' | '(' expression ')'
//
// `%` is always "per cent" (÷100); use mod(a, b) for a remainder.

export class CalcError extends Error {
  constructor(message, position = -1) {
    super(message);
    this.name = 'CalcError';
    this.position = position;
  }
}

/* ------------------------------------------------------------------ units */

// Each category: base unit name plus a factor to the base unit. Temperature is
// special-cased because it has an offset as well as a scale.
const UNIT_TABLE = {
  length: {
    label: 'Length', base: 'm',
    units: {
      m: 1, km: 1000, cm: 0.01, mm: 0.001, um: 1e-6, nm: 1e-9,
      mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254,
      nmi: 1852, ly: 9.4607304725808e15, au: 1.495978707e11, pc: 3.0856775814913673e16
    }
  },
  mass: {
    label: 'Mass', base: 'kg',
    units: {
      kg: 1, g: 0.001, mg: 1e-6, ug: 1e-9, t: 1000,
      lb: 0.45359237, oz: 0.028349523125, st: 6.35029318,
      ton: 907.18474, tonne: 1000, gr: 6.479891e-5
    }
  },
  temperature: {
    label: 'Temperature', base: '°C', units: { '°C': 1, '°F': 1, K: 1, '°R': 1 }
  },
  time: {
    label: 'Time', base: 's',
    units: {
      s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9, min: 60, h: 3600,
      day: 86400, week: 604800, fortnight: 1209600, year: 31557600,
      decade: 315576000, century: 3155760000
    }
  },
  data: {
    label: 'Digital storage', base: 'byte',
    units: {
      byte: 1, B: 1, bit: 0.125, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15,
      KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776,
      kb: 125, Mb: 125000, Gb: 125000000
    }
  },
  speed: {
    label: 'Speed', base: 'm/s',
    units: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 0.5144444444, 'ft/s': 0.3048, c: 299792458 }
  },
  area: {
    label: 'Area', base: 'm²',
    units: {
      'm²': 1, 'km²': 1e6, 'cm²': 1e-4, 'mm²': 1e-6, ha: 1e4, acre: 4046.8564224,
      'ft²': 0.09290304, 'in²': 0.00064516, 'mi²': 2589988.110336, 'yd²': 0.83612736
    }
  },
  volume: {
    label: 'Volume', base: 'L',
    units: {
      L: 1, mL: 0.001, 'm³': 1000, 'cm³': 0.001, 'ft³': 28.316846592,
      'gal': 3.785411784, 'qt': 0.946352946, 'pt': 0.473176473, cup: 0.2365882365,
      floz: 0.0295735295625, tbsp: 0.01478676478125, tsp: 0.00492892159375,
      'galUK': 4.54609
    }
  },
  energy: {
    label: 'Energy', base: 'J',
    units: {
      J: 1, kJ: 1000, MJ: 1e6, cal: 4.184, kcal: 4184, Wh: 3600, kWh: 3.6e6,
      eV: 1.602176634e-19, BTU: 1055.05585262, erg: 1e-7, therm: 1.05505585262e8
    }
  },
  pressure: {
    label: 'Pressure', base: 'Pa',
    units: { Pa: 1, kPa: 1000, MPa: 1e6, bar: 1e5, atm: 101325, psi: 6894.757293168, mmHg: 133.322387415, torr: 133.322368421, mbar: 100 }
  },
  angle: {
    label: 'Angle', base: 'rad',
    units: { rad: 1, deg: Math.PI / 180, grad: Math.PI / 200, turn: Math.PI * 2, arcmin: Math.PI / 10800, arcsec: Math.PI / 648000 }
  },
  frequency: {
    label: 'Frequency', base: 'Hz',
    units: { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9, THz: 1e12, rpm: 1 / 60 }
  },
  power: {
    label: 'Power', base: 'W',
    units: { W: 1, mW: 1e-3, kW: 1e3, MW: 1e6, GW: 1e9, hp: 745.6998715823 }
  },
  force: {
    label: 'Force', base: 'N',
    units: { N: 1, kN: 1e3, MN: 1e6, dyn: 1e-5, lbf: 4.4482216152605, kgf: 9.80665 }
  }
};

// Exact names win (MB ≠ Mb, KiB ≠ kib). A case-insensitive fallback is kept
// only for names whose lower-case form is unambiguous across the whole table.
const UNIT_LOOKUP = new Map();
const UNIT_LOOKUP_LOWER = new Map();
// ASCII spellings people actually type.
const UNIT_ALIASES = {
  m2: 'm²', km2: 'km²', cm2: 'cm²', mm2: 'mm²', ft2: 'ft²', in2: 'in²', mi2: 'mi²', yd2: 'yd²',
  m3: 'm³', cm3: 'cm³', ft3: 'ft³',
  celsius: '°C', fahrenheit: '°F', kelvin: 'K', c: '°C', f: '°F',
  meters: 'm', metres: 'm', kilometer: 'km', kilometers: 'km', miles: 'mi', mile: 'mi',
  feet: 'ft', foot: 'ft', inches: 'in', inch: 'in', pounds: 'lb', pound: 'lb', ounces: 'oz', ounce: 'oz',
  seconds: 's', minutes: 'min', hours: 'h', days: 'day', weeks: 'week', years: 'year',
  liters: 'L', litres: 'L', litres_: 'L', gallons: 'gal', kilograms: 'kg', grams: 'g',
  bytes: 'byte', kb_: 'KB', mb_: 'MB', gb_: 'GB', tb_: 'TB', degrees: 'deg', radians: 'rad'
};
const ambiguous = new Set();
for (const [category, group] of Object.entries(UNIT_TABLE)) {
  for (const name of Object.keys(group.units)) {
    const entry = { category, name };
    UNIT_LOOKUP.set(name, entry);
    const lower = name.toLowerCase();
    if (UNIT_LOOKUP_LOWER.has(lower) && UNIT_LOOKUP_LOWER.get(lower).name !== name) ambiguous.add(lower);
    else UNIT_LOOKUP_LOWER.set(lower, entry);
  }
}

export function unitCategories() {
  return Object.entries(UNIT_TABLE).map(([id, group]) => ({
    id, label: group.label, base: group.base, units: Object.keys(group.units)
  }));
}

function toBase(category, unit, value) {
  if (category === 'temperature') {
    if (unit === '°C') return value;
    if (unit === '°F') return (value - 32) * 5 / 9;
    if (unit === 'K') return value - 273.15;
    if (unit === '°R') return (value - 491.67) * 5 / 9;
  }
  return value * UNIT_TABLE[category].units[unit];
}

function fromBase(category, unit, value) {
  if (category === 'temperature') {
    if (unit === '°C') return value;
    if (unit === '°F') return value * 9 / 5 + 32;
    if (unit === 'K') return value + 273.15;
    if (unit === '°R') return (value + 273.15) * 9 / 5;
  }
  return value / UNIT_TABLE[category].units[unit];
}

function resolveUnit(name) {
  if (!name) return null;
  const text = String(name).trim();
  const alias = UNIT_ALIASES[text] || UNIT_ALIASES[text.toLowerCase()];
  if (alias) return { ...UNIT_LOOKUP.get(alias), canonical: alias };
  const direct = UNIT_LOOKUP.get(text);
  if (direct) return { ...direct, canonical: direct.name };
  // Temperature is commonly written without the degree sign: "72 F in C".
  // (Capital letters only: lower-case `c` is the speed of light unit.)
  const temperature = text.match(/^°?([CFK])$/);
  if (temperature) {
    const canonical = { C: '°C', F: '°F', K: 'K' }[temperature[1]];
    return { category: 'temperature', name: canonical, canonical };
  }
  const lower = text.toLowerCase();
  if (!ambiguous.has(lower)) {
    const fuzzy = UNIT_LOOKUP_LOWER.get(lower);
    if (fuzzy) return { ...fuzzy, canonical: fuzzy.name };
  }
  return null;
}

/** Convert between any two units of the same kind. Throws CalcError otherwise. */
export function convert(value, from, to) {
  const source = resolveUnit(from);
  const target = resolveUnit(to);
  if (!source) throw new CalcError(`Unknown unit “${from}”`);
  if (!target) throw new CalcError(`Unknown unit “${to}”`);
  if (source.category !== target.category) {
    throw new CalcError(`Can't convert ${UNIT_TABLE[source.category].label.toLowerCase()} to ${UNIT_TABLE[target.category].label.toLowerCase()}`);
  }
  return fromBase(target.category, target.canonical, toBase(source.category, source.canonical, value));
}

export function convertUnits(value, from, to) {
  try {
    const result = convert(value, from, to);
    return { ok: true, value: result, text: `${formatNumber(result)} ${to}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/* -------------------------------------------------------------- formatting */

export function formatNumber(value) {
  if (typeof value !== 'number') return String(value);
  if (Number.isNaN(value)) return 'not a number';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e15 || magnitude < 1e-9) {
    return value.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
  }
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toPrecision(12));
  let text = String(rounded);
  if (text.includes('e')) return text;
  if (text.length > 18) text = rounded.toPrecision(10).replace(/0+$/, '').replace(/\.$/, '');
  return text;
}

/* --------------------------------------------------------------- functions */

const factorial = (n) => {
  const x = Number(n);
  if (Number.isInteger(x) && x >= 0) {
    if (x > 170) return Infinity;
    let total = 1;
    for (let i = 2; i <= x; i++) total *= i;
    return total;
  }
  // Gamma(n + 1) via Lanczos, so 0.5! works.
  const g = (z) => {
    const coefficients = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * g(1 - z));
    z -= 1;
    let a = 0.99999999999980993;
    for (let i = 0; i < coefficients.length; i++) a += coefficients[i] / (z + i + 1);
    const t = z + coefficients.length - 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
  };
  return g(x + 1);
};

const nCr = (n, r) => {
  n = Math.round(n); r = Math.round(r);
  if (r < 0 || r > n) return 0;
  r = Math.min(r, n - r);
  let result = 1;
  for (let i = 1; i <= r; i++) result = result * (n - r + i) / i;
  return Math.round(result);
};
const nPr = (n, r) => {
  n = Math.round(n); r = Math.round(r);
  if (r < 0 || r > n) return 0;
  let result = 1;
  for (let i = 0; i < r; i++) result *= n - i;
  return result;
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const variance = (values, sample = false) => {
  if (values.length < 2 && !sample) return 0;
  const average = mean(values);
  const divisor = sample ? values.length - 1 : values.length;
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (divisor || 1);
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// { min, max } arity. `variadic` functions accept one or more.
const FUNCTIONS = {
  // roots, powers, rounding
  sqrt: { arity: [1, 1], fn: Math.sqrt, note: 'square root' },
  cbrt: { arity: [1, 1], fn: Math.cbrt, note: 'cube root' },
  root: { arity: [2, 2], fn: (value, n) => Math.sign(value) * Math.pow(Math.abs(value), 1 / n), note: 'root(x, n)' },
  pow: { arity: [2, 2], fn: Math.pow, note: 'pow(base, exponent)' },
  exp: { arity: [1, 1], fn: Math.exp },
  ln: { arity: [1, 1], fn: Math.log },
  log: { arity: [1, 2], fn: (value, base) => (base === undefined ? Math.log10(value) : Math.log(value) / Math.log(base)), note: 'log(x) base 10 · log(x, b)' },
  log10: { arity: [1, 1], fn: Math.log10 },
  log2: { arity: [1, 1], fn: Math.log2 },
  abs: { arity: [1, 1], fn: Math.abs },
  sign: { arity: [1, 1], fn: Math.sign },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
  round: { arity: [1, 2], fn: (value, digits = 0) => { const f = Math.pow(10, digits); return Math.round(value * f) / f; }, note: 'round(x) · round(x, digits)' },
  trunc: { arity: [1, 1], fn: Math.trunc, note: 'drop the fraction' },
  frac: { arity: [1, 1], fn: (value) => value - Math.trunc(value) },
  clamp: { arity: [3, 3], fn: (value, low, high) => Math.min(high, Math.max(low, value)) },
  lerp: { arity: [3, 3], fn: (a, b, t) => a + (b - a) * t },

  // trigonometry (radians; use deg()/rad() to switch)
  sin: { arity: [1, 1], fn: Math.sin },
  cos: { arity: [1, 1], fn: Math.cos },
  tan: { arity: [1, 1], fn: Math.tan },
  asin: { arity: [1, 1], fn: Math.asin },
  acos: { arity: [1, 1], fn: Math.acos },
  atan: { arity: [1, 1], fn: Math.atan },
  atan2: { arity: [2, 2], fn: Math.atan2 },
  sinh: { arity: [1, 1], fn: Math.sinh },
  cosh: { arity: [1, 1], fn: Math.cosh },
  tanh: { arity: [1, 1], fn: Math.tanh },
  asinh: { arity: [1, 1], fn: Math.asinh },
  acosh: { arity: [1, 1], fn: Math.acosh },
  atanh: { arity: [1, 1], fn: Math.atanh },
  deg: { arity: [1, 1], fn: (radians) => radians * 180 / Math.PI, note: 'radians → degrees' },
  rad: { arity: [1, 1], fn: (degrees) => degrees * Math.PI / 180, note: 'degrees → radians' },
  hypot: { variadic: [2], fn: (...values) => Math.hypot(...values) },

  // integer maths
  mod: { arity: [2, 2], fn: (a, b) => ((a % b) + b) % b, note: 'always-positive remainder' },
  rem: { arity: [2, 2], fn: (a, b) => a % b, note: 'remainder, may be negative' },
  gcd: { variadic: [2], fn: (...values) => values.map(Math.abs).reduce((a, b) => { while (b) [a, b] = [b, a % b]; return a; }) },
  lcm: { variadic: [2], fn: (...values) => values.map(Math.abs).reduce((a, b) => (a * b) / (FUNCTIONS.gcd.fn(a, b) || 1)) },
  fact: { arity: [1, 1], fn: factorial, note: 'factorial, same as x!' },
  ncr: { arity: [2, 2], fn: nCr, note: 'combinations nCr(n, r)' },
  npr: { arity: [2, 2], fn: nPr, note: 'permutations nPr(n, r)' },
  isprime: { arity: [1, 1], fn: (n) => {
    n = Math.round(n);
    if (n < 2) return 0;
    if (n % 2 === 0) return n === 2 ? 1 : 0;
    for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return 0;
    return 1;
  }, note: '1 if prime, else 0' },

  // statistics over any number of arguments
  min: { variadic: [1], fn: (...values) => Math.min(...values) },
  max: { variadic: [1], fn: (...values) => Math.max(...values) },
  sum: { variadic: [1], fn: (...values) => values.reduce((a, b) => a + b, 0) },
  product: { variadic: [1], fn: (...values) => values.reduce((a, b) => a * b, 1) },
  mean: { variadic: [1], fn: (...values) => mean(values), note: 'arithmetic average' },
  avg: { variadic: [1], fn: (...values) => mean(values) },
  median: { variadic: [1], fn: (...values) => median(values) },
  mode: { variadic: [1], fn: (...values) => {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    let best = values[0], bestCount = 0;
    for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
    return best;
  } },
  variance: { variadic: [2], fn: (...values) => variance(values), note: 'population variance' },
  stdev: { variadic: [2], fn: (...values) => Math.sqrt(variance(values)), note: 'population standard deviation' },
  samplevariance: { variadic: [2], fn: (...values) => variance(values, true) },
  samplestdev: { variadic: [2], fn: (...values) => Math.sqrt(variance(values, true)) },

  // percentage helpers
  pct: { arity: [2, 2], fn: (percent, value) => (percent / 100) * value, note: 'pct(20, 150) = 20% of 150' },
  increase: { arity: [2, 2], fn: (value, percent) => value + (value * percent) / 100, note: 'increase(200, 15) = 230' },
  decrease: { arity: [2, 2], fn: (value, percent) => value - (value * percent) / 100, note: 'decrease(200, 15) = 170' },
  percentchange: { arity: [2, 2], fn: (from, to) => ((to - from) / Math.abs(from || 1)) * 100 },

  // randomness
  random: { arity: [0, 0], fn: () => Math.random(), note: '0 ≤ x < 1' },
  randint: { arity: [2, 2], fn: (low, high) => Math.floor(low + Math.random() * (high - low + 1)), note: 'random integer, inclusive' },

  // conversions
  convert: { arity: [3, 3], fn: (value, from, to) => convert(value, from, to), note: 'convert(10, km, mi) — bare unit names' }
};

// Unit names are also accepted as string-ish identifiers inside convert(), e.g.
// convert(10, km, mi) — the parser turns bare names into their unit string.
const UNIT_IDENTIFIERS = new Set([...UNIT_LOOKUP.keys(), 'C', 'F', 'K']);

const CONSTANTS = {
  pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2, φ: (1 + Math.sqrt(5)) / 2,
  phi: (1 + Math.sqrt(5)) / 2, inf: Infinity, infinity: Infinity, nan: NaN
};

export function functionList() {
  return Object.entries(FUNCTIONS).map(([name, entry]) => ({
    name,
    note: entry.note || '',
    args: entry.variadic ? `${entry.variadic[0]}+` : entry.arity[0] === entry.arity[1] ? String(entry.arity[0]) : `${entry.arity[0]}–${entry.arity[1]}`
  }));
}

/* ---------------------------------------------------------------- tokenizer */

function tokenize(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const character = input[index];
    if (/\s/.test(character)) { index++; continue; }

    // Numbers, including 0x/0b literals and scientific notation.
    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(input[index + 1] || ''))) {
      const start = index;
      if (character === '0' && /[xXbBoO]/.test(input[index + 1] || '')) {
        const base = /[xX]/.test(input[index + 1]) ? 16 : /[bB]/.test(input[index + 1]) ? 2 : 8;
        index += 2;
        const digitStart = index;
        while (index < input.length && /[0-9a-fA-F_]/.test(input[index])) index++;
        const digits = input.slice(digitStart, index).replace(/_/g, '');
        if (!digits) throw new CalcError('That number literal is incomplete', start);
        tokens.push({ type: 'number', value: parseInt(digits, base), pos: start });
        continue;
      }
      while (index < input.length && /[0-9_]/.test(input[index])) index++;
      if (input[index] === '.') {
        index++;
        while (index < input.length && /[0-9_]/.test(input[index])) index++;
      }
      if (/[eE]/.test(input[index] || '') && /[+\-0-9]/.test(input[index + 1] || '')) {
        index += 2;
        while (index < input.length && /[0-9]/.test(input[index])) index++;
      }
      const raw = input.slice(start, index).replace(/_/g, '');
      tokens.push({ type: 'number', value: Number(raw), raw, pos: start });
      continue;
    }

    // Names: functions, constants, units, and "to"/"of" as plain words.
    if (/[A-Za-z_πφ°µ]/.test(character)) {
      const start = index;
      while (index < input.length && /[A-Za-z0-9_πφ°µ]/.test(input[index])) index++;
      tokens.push({ type: 'name', value: input.slice(start, index), pos: start });
      continue;
    }

    const pair = input.slice(index, index + 2);
    if (pair === '**') { tokens.push({ type: 'op', value: '^', pos: index }); index += 2; continue; }
    if (pair === '!=') throw new CalcError('Comparison operators are not supported; use min/max/mod instead', index);
    if ('+-*/^%(),!'.includes(character)) { tokens.push({ type: 'op', value: character, pos: index }); index++; continue; }
    throw new CalcError(`Unexpected character “${character}”`, index);
  }
  tokens.push({ type: 'end', value: '', pos: input.length });
  return tokens;
}

/* ------------------------------------------------------------------ parser */

class Parser {
  constructor(tokens, input) {
    this.tokens = tokens;
    this.input = input;
    this.index = 0;
  }
  peek(offset = 0) { return this.tokens[this.index + offset]; }
  next() { return this.tokens[this.index++]; }
  isOp(value) { const token = this.peek(); return token.type === 'op' && token.value === value; }
  eatOp(value) { if (this.isOp(value)) { this.index++; return true; } return false; }
  expectOp(value) {
    if (!this.eatOp(value)) {
      const token = this.peek();
      throw new CalcError(`Expected “${value}”${token.type === 'end' ? ' before the end' : ` but found “${this.input.slice(token.pos, token.pos + 1)}”`}`, token.pos);
    }
  }

  parse() {
    if (this.peek().type === 'end') throw new CalcError('Type an expression to calculate', 0);
    const value = this.expression();
    const token = this.peek();
    if (token.type !== 'end') {
      throw new CalcError(`Unexpected “${this.input.slice(token.pos, token.pos + 8).trim()}”`, token.pos);
    }
    return value;
  }

  assertNumber(value, position) {
    if (typeof value !== 'number') {
      throw new CalcError('Unit names only work inside convert(value, from, to)', position);
    }
    return value;
  }

  expression() {
    let value = this.term();
    for (;;) {
      if (this.eatOp('+')) value = this.assertNumber(value, this.peek().pos) + this.term();
      else if (this.eatOp('-')) value = this.assertNumber(value, this.peek().pos) - this.term();
      else return value;
    }
  }

  term() {
    let value = this.unary();
    for (;;) {
      if (this.eatOp('*')) value = this.assertNumber(value, this.peek().pos) * this.unary();
      else if (this.eatOp('/')) {
        const divisor = this.unary();
        if (divisor === 0) throw new CalcError('Division by zero', this.peek().pos);
        value = this.assertNumber(value, this.peek().pos) / divisor;
      } else if (this.startsPrimary(this.peek())) {
        // Implicit multiplication: 2(3+4), 3x, (1+2)(3).
        value = this.assertNumber(value, this.peek().pos) * this.unary();
      } else return value;
    }
  }

  startsPrimary(token) {
    if (token.type === 'number') return true;
    if (token.type === 'name') {
      // Functions with omitted parentheses are not implicit products.
      return !FUNCTIONS[token.value.toLowerCase()];
    }
    return token.type === 'op' && token.value === '(';
  }

  unary() {
    if (this.eatOp('+')) return this.unary();
    if (this.eatOp('-')) return -this.unary();
    return this.power();
  }

  power() {
    const base = this.postfix();
    if (this.eatOp('^')) return Math.pow(base, this.unary());   // right associative
    return base;
  }

  postfix() {
    let value = this.primary();
    for (;;) {
      if (this.eatOp('!')) value = factorial(value);
      else if (this.eatOp('%')) value = value / 100;
      else return value;
    }
  }

  primary() {
    const token = this.peek();
    if (token.type === 'number') { this.index++; return token.value; }
    if (token.type === 'op' && token.value === '(') {
      this.index++;
      const value = this.expression();
      this.expectOp(')');
      return value;
    }
    if (token.type === 'name') {
      this.index++;
      const raw = token.value;
      const name = raw.toLowerCase();

      if (this.isOp('(')) {
        this.index++;
        const args = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.expression());
            if (this.eatOp(',')) continue;
            break;
          }
        }
        this.expectOp(')');
        return this.call(raw, args, token.pos);
      }

      if (name in CONSTANTS || raw in CONSTANTS) return raw in CONSTANTS ? CONSTANTS[raw] : CONSTANTS[name];
      const unit = resolveUnit(raw);
      if (unit) return unit.name;                          // for convert(10, km, mi)
      if (FUNCTIONS[name]) {
        if (FUNCTIONS[name].arity && FUNCTIONS[name].arity[0] === 0) return this.call(raw, [], token.pos);
        throw new CalcError(`“${raw}” needs parentheses, e.g. ${raw}(9)`, token.pos);
      }
      throw new CalcError(`Unknown name “${raw}”`, token.pos);
    }
    if (token.type === 'op' && token.value === ')') throw new CalcError('Unmatched “)”', token.pos);
    throw new CalcError(token.type === 'end' ? 'The expression ends too early' : `Unexpected “${this.input.slice(token.pos, token.pos + 4)}”`, token.pos);
  }

  call(raw, args, position) {
    const name = raw.toLowerCase();
    const entry = FUNCTIONS[name];
    if (!entry) throw new CalcError(`Unknown function “${raw}”`, position);
    if (entry.variadic) {
      if (args.length < entry.variadic[0]) {
        throw new CalcError(`${name}() needs at least ${entry.variadic[0]} argument${entry.variadic[0] === 1 ? '' : 's'}`, position);
      }
    } else {
      const [low, high] = entry.arity;
      if (args.length < low || args.length > high) {
        const expected = low === high ? String(low) : `${low}–${high}`;
        throw new CalcError(`${name}() takes ${expected} argument${expected === '1' ? '' : 's'}, not ${args.length}`, position);
      }
    }
    // convert() accepts bare unit names, which the parser returns as strings.
    if (name === 'convert') {
      if (typeof args[1] !== 'string' || typeof args[2] !== 'string') {
        throw new CalcError('convert() needs unit names, e.g. convert(10, km, mi)', position);
      }
    }
    try {
      const result = entry.fn(...args);
      if (typeof result === 'number' && Number.isNaN(result) && !args.some((value) => Number.isNaN(value))) {
        throw new CalcError(`${name}() is undefined for that input`, position);
      }
      return result;
    } catch (error) {
      if (error instanceof CalcError) throw error;
      throw new CalcError(error.message || `${name}() failed`, position);
    }
  }
}

/* ------------------------------------------------------------------- API */

/**
 * Evaluate an expression.
 * @returns {{ok: boolean, value?: number, text?: string, error?: string, position?: number}}
 */
export function evaluate(expression) {
  const source = String(expression ?? '')
  if (!source) return { ok: false, error: 'Type an expression to calculate', position: 0 };

  // Natural percentage phrasing: "20% of 150", "15% of (200 + 50)".
  const percentOf = source.match(/^(-?[0-9.]+)\s*%\s*of\s+(.+)$/i);
  if (percentOf) {
    const inner = evaluate(percentOf[2]);
    if (!inner.ok) return inner;
    const value = (Number(percentOf[1]) / 100) * inner.value;
    return { ok: true, value, text: formatNumber(value), conversion: `${percentOf[1]}% of ${inner.text} = ${formatNumber(value)}` };
  }

  // Friendly natural-language conversions: "10 km to mi", "72 F in C".
  const natural = source.match(/^(.+?)\s+(?:to|in|as)\s+([A-Za-z0-9°µ²³/]+)$/);
  if (natural && !/[()^!]/.test(natural[1])) {
    const unitTarget = resolveUnit(natural[2]);
    const unitMatch = natural[1].match(/^([0-9.+\-eE]+)\s*([A-Za-z0-9°µ²³/]+)?$/);
    if (unitTarget && unitMatch) {
      const amount = Number(unitMatch[1]);
      const unitSource = resolveUnit(unitMatch[2] || (unitTarget.category === 'temperature' ? '°C' : ''));
      if (Number.isFinite(amount) && unitSource) {
        try {
          const value = convert(amount, unitSource.canonical, unitTarget.canonical);
          return { ok: true, value, text: formatNumber(value), conversion: `${formatNumber(amount)} ${unitSource.canonical} = ${formatNumber(value)} ${unitTarget.canonical}` };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }
    }
  }

  try {
    const value = new Parser(tokenize(source), source).parse();
    if (typeof value === 'string') throw new CalcError('That expression is just a name; add a function call', 0);
    if (typeof value !== 'number') throw new CalcError('That expression did not produce a number', 0);
    return { ok: true, value, text: formatNumber(value) };
  } catch (error) {
    if (error instanceof CalcError) return { ok: false, error: error.message, position: error.position };
    return { ok: false, error: error.message || 'Could not calculate that' };
  }
}

/** Replace <calc>…</calc> / {{calc: …}} in model text with the computed value. */
export function resolveCalcTags(text) {
  if (!text || !/<calc>|\{\{calc:/i.test(text)) return text;
  return String(text)
    .replace(/<calc>\s*([\s\S]{1,400}?)\s*<\/calc>/gi, (match, expression) => {
      const result = evaluate(expression);
      return result.ok ? `\`${expression.trim()} = ${result.text}\`` : `\`${expression.trim()} = ? (${result.error})\``;
    })
    .replace(/\{\{\s*calc:\s*([\s\S]{1,400}?)\s*\}\}/gi, (match, expression) => {
      const result = evaluate(expression);
      return result.ok ? result.text : `? (${result.error})`;
    });
}

/* -------------------------------------------------------------------- UI */

const HISTORY_LIMIT = 40;
const KEYS = [
  ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['π', 'pi'], ['C', 'clear'],
  ['√', 'sqrt('], ['x²', '^2'], ['xʸ', '^'], ['%', '%'], ['⌫', 'back'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '/'], ['!', '!'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['×', '*'], ['(', '('],
  ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-'], [')', ')'],
  ['0', '0'], ['.', '.'], ['+', '+'], ['ln', 'ln('], ['=', 'equals']
];

function loadHistory() {
  try {
    const raw = localStorage.getItem('mox-calc-history');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch { return []; }
}
function saveHistory(entries) {
  try { localStorage.setItem('mox-calc-history', JSON.stringify(entries.slice(0, HISTORY_LIMIT))); } catch { /* private mode */ }
}

let calcApi = null;   // exposed for app.js

export function initCalculator() {
  if (calcApi) return calcApi;
  const panel = document.getElementById('calculatorPanel');
  if (!panel) return null;

  const display = panel.querySelector('#calcExpression');
  const result = panel.querySelector('#calcResult');
  const historyList = panel.querySelector('#calcHistory');
  const keys = panel.querySelector('#calcKeys');
  const functionListBox = panel.querySelector('#calcFunctions');
  const convertGroup = panel.querySelector('#calcConvertGroup');
  const convertValue = panel.querySelector('#calcConvertValue');
  const convertFrom = panel.querySelector('#calcConvertFrom');
  const convertTo = panel.querySelector('#calcConvertTo');
  const convertResult = panel.querySelector('#calcConvertResult');

  let entries = loadHistory();
  let lastResult = null;
  let memory = 0;

  const setResult = (evaluation) => {
    if (!evaluation) { result.textContent = ''; result.dataset.state = ''; return; }
    if (evaluation.ok) {
      lastResult = evaluation.value;
      result.textContent = evaluation.text;
      result.dataset.state = 'ok';
      result.title = 'Click to copy';
    } else {
      result.textContent = evaluation.error;
      result.dataset.state = 'error';
      result.title = '';
    }
  };

  const pushHistory = (expression, evaluation) => {
    entries = [{ expression, text: evaluation.text, value: evaluation.value, at: Date.now() }, ...entries].slice(0, HISTORY_LIMIT);
    saveHistory(entries);
    renderHistory();
  };

  const renderHistory = () => {
    if (!entries.length) {
      historyList.innerHTML = '<div class="calc-empty">Answers you work out are kept on this device.</div>';
      return;
    }
    historyList.innerHTML = '';
    entries.forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calc-history-item';
      button.innerHTML = `<span>${escapeHTML(entry.expression)}</span><strong>${escapeHTML(entry.text)}</strong>`;
      button.addEventListener('click', () => {
        display.value = entry.expression;
        display.focus();
        setResult({ ok: true, value: entry.value ?? Number(entry.text), text: entry.text });
      });
      historyList.append(button);
    });
  };

  const calculate = (expression = display.value) => {
    const evaluation = evaluate(expression);
    setResult(evaluation);
    if (evaluation.ok) pushHistory(expression.trim(), evaluation);
    return evaluation;
  };

  const insert = (text) => {
    const start = display.selectionStart ?? display.value.length;
    const end = display.selectionEnd ?? display.value.length;
    display.value = display.value.slice(0, start) + text + display.value.slice(end);
    const caret = start + text.length;
    display.setSelectionRange(caret, caret);
    display.focus();
    const preview = evaluate(display.value);
    setResult(preview.ok ? preview : null);
  };

  keys.innerHTML = '';
  for (const [label, action] of KEYS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `calc-key${'0123456789'.includes(label) || label === '.' ? ' number' : ''}${action === 'equals' ? ' equals' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-label', action === 'clear' ? 'Clear' : action === 'back' ? 'Backspace' : action === 'equals' ? 'Equals' : label);
    button.addEventListener('click', () => {
      if (action === 'clear') { display.value = ''; setResult(null); display.focus(); }
      else if (action === 'back') {
        const start = display.selectionStart ?? display.value.length;
        const end = display.selectionEnd ?? display.value.length;
        if (start !== end) display.value = display.value.slice(0, start) + display.value.slice(end);
        else if (start > 0) display.value = display.value.slice(0, start - 1) + display.value.slice(start);
        display.focus();
        const preview = evaluate(display.value);
        setResult(preview.ok ? preview : null);
      } else if (action === 'equals') calculate();
      else insert(action);
    });
    keys.append(button);
  }

  functionListBox.innerHTML = functionList()
    .filter((entry) => entry.name !== 'units')
    .map((entry) => `<button type="button" class="calc-fn" data-insert="${escapeHTML(entry.name)}(" title="${escapeHTML(entry.note || entry.name)}"><code>${escapeHTML(entry.name)}</code><span>${escapeHTML(entry.args)}</span></button>`)
    .join('');
  functionListBox.querySelectorAll('[data-insert]').forEach((button) => {
    button.addEventListener('click', () => insert(button.dataset.insert));
  });

  // Unit converter.
  const groups = unitCategories();
  convertGroup.innerHTML = groups.map((group) => `<option value="${escapeHTML(group.id)}">${escapeHTML(group.label)}</option>`).join('');
  const fillUnits = (category, selectedFrom, selectedTo) => {
    const group = groups.find((entry) => entry.id === category) || groups[0];
    const options = group.units.map((unit) => `<option value="${escapeHTML(unit)}">${escapeHTML(unit)}</option>`).join('');
    convertFrom.innerHTML = options;
    convertTo.innerHTML = options;
    if (selectedFrom) convertFrom.value = selectedFrom;
    if (selectedTo) convertTo.value = selectedTo;
    convertFrom.value = group.units.includes(convertFrom.value) ? convertFrom.value : group.units[0];
    convertTo.value = group.units.includes(convertTo.value) ? convertTo.value : group.units[1] || group.units[0];
    runConversion();
  };
  const runConversion = () => {
    const value = Number(convertValue.value);
    if (!Number.isFinite(value)) { convertResult.textContent = '—'; return; }
    const outcome = convertUnits(value, convertFrom.value, convertTo.value);
    convertResult.textContent = outcome.ok ? outcome.text : outcome.error;
    convertResult.dataset.state = outcome.ok ? 'ok' : 'error';
  };
  convertGroup.addEventListener('change', () => fillUnits(convertGroup.value));
  [convertValue, convertFrom, convertTo].forEach((node) => {
    node.addEventListener('input', runConversion);
    node.addEventListener('change', runConversion);
  });
  fillUnits('length', 'km', 'mi');

  display.addEventListener('input', () => {
    const preview = evaluate(display.value);
    setResult(preview.ok ? preview : null);
    display.dataset.typing = 'true';
  });
  display.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); calculate(); }
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  });
  result.addEventListener('click', async () => {
    if (!result.textContent || result.dataset.state !== 'ok') return;
    try {
      await navigator.clipboard.writeText(result.textContent);
      const copied = result.textContent;
      result.textContent = 'Copied';
      setTimeout(() => { result.textContent = copied; result.dataset.state = 'ok'; }, 900);
    } catch { /* clipboard unavailable */ }
  });

  const syncAppInert = () => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    const anotherPanelOpen = [...document.querySelectorAll('.workspace-panel, .calc-panel')]
      .some((node) => node.hidden === false);
    shell.inert = anotherPanelOpen;
  };

  const open = () => {
    panel.hidden = false;
    document.body.classList.add('panel-open');
    syncAppInert();
    renderHistory();
    setTimeout(() => display.focus(), 30);
  };
  const close = () => {
    panel.hidden = true;
    document.body.classList.remove('panel-open');
    syncAppInert();
  };

  panel.querySelector('#calcClose')?.addEventListener('click', close);
  panel.querySelector('#calcClearHistory')?.addEventListener('click', () => {
    entries = [];
    saveHistory(entries);
    renderHistory();
  });

  // Memory keys.
  panel.querySelectorAll('[data-memory]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.memory;
      if (action === 'store') { memory = lastResult || 0; button.textContent = 'MR'; }
      if (action === 'recall') insert(formatNumber(memory));
      if (action === 'clear') { memory = 0; insert(''); }
    });
  });

  calcApi = { open, close, calculate, evaluate, insert, panel };
  return calcApi;
}

export function openCalculator() {
  const api = initCalculator();
  api?.open();
}

export function closeCalculator() {
  calcApi?.close();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}
