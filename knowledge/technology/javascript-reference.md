# JavaScript reference — language, DOM, APIs, and patterns

JavaScript is a dynamically typed, single-threaded, garbage-collected language. It runs in the browser (where it can touch the page) and on servers (Node.js, Deno, Bun). This document covers the language, the standard library, and the browser APIs you use to build real interfaces.

## Values and types

There are eight types: seven primitives and one object type.

| Type | Example | Notes |
| --- | --- | --- |
| `string` | `'hello'`, `"hi"`, `` `hi ${name}` `` | Immutable UTF-16 sequences. |
| `number` | `42`, `3.14`, `1e6`, `0xff`, `NaN`, `Infinity` | IEEE-754 double; integers are exact only to 2^53−1. |
| `bigint` | `9007199254740993n` | Arbitrary precision; cannot mix with numbers in arithmetic. |
| `boolean` | `true`, `false` | |
| `undefined` | `let x;` | "No value assigned". |
| `null` | `null` | Deliberate absence. `typeof null === 'object'` is a historic bug. |
| `symbol` | `Symbol('id')` | Unique, non-string object keys. |
| `object` | `{}`, `[]`, functions, dates, maps | Everything else. |

`typeof` returns `'string' | 'number' | 'bigint' | 'boolean' | 'undefined' | 'symbol' | 'function' | 'object'`. Use `Array.isArray(x)` for arrays, `x === null` for null, `Number.isNaN(x)` for NaN (never `x === NaN`).

Truthiness: `false`, `0`, `-0`, `0n`, `''`, `null`, `undefined`, `NaN` are falsy. Everything else — including `[]`, `{}`, `'0'`, `'false'`, functions — is truthy.

## Variables

- `const` — block-scoped, cannot be reassigned. The value can still be mutated (`const list = []; list.push(1)`).
- `let` — block-scoped, reassignable.
- `var` — function-scoped, hoisted, avoid in new code.

Use `const` by default and `let` when reassignment is real. Declare before use: `let`/`const` are hoisted but sit in a temporal dead zone until initialised.

## Operators

- Arithmetic: `+ - * / % **`. `+` also concatenates strings, so `'1' + 2 === '12'`, while `'2' - 1 === 11`.
- Increment/decrement: `++`, `--` (prefix and postfix differ in the returned value).
- Comparison: `===` (strict, no coercion — use this) and `==` (coerces; avoid). `!=`, `!==`, `<`, `>`, `<=`, `>=`.
- Logical: `&&` (returns the first falsy or the last value), `||` (first truthy), `??` (first non-nullish), `!`.
- Optional chaining: `user?.address?.city`, `fn?.()`, `list?.[0]` — short-circuits to `undefined`.
- Nullish defaults: `count ?? 0` (only for `null`/`undefined`), `count || 0` (also for `0`, `''`, `false`).
- Assignment: `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `&&=`, `||=`, `??=`.
- Bitwise: `& | ^ ~ << >> >>>`. Use `>>> 0` to force an unsigned 32-bit integer.
- Ternary: `condition ? a : b`.
- Spread/rest: `...` — `[...a, ...b]`, `{ ...defaults, ...options }`, `function f(...args)`, `const { a, ...rest } = obj`.
- `in` checks a property key; `instanceof` checks the prototype chain.
- `delete obj.key` removes a property (not array elements — use `splice`).
- `void 0` is a reliable `undefined`.
- `typeof x === 'undefined'` is safe even for undeclared variables; direct comparison is not.

## Control flow

```js
if (a > b) { … } else if (a === b) { … } else { … }

switch (command) {
  case 'save': save(); break;
  case 'load': load(); break;
  default: unknown();
}

for (let i = 0; i < 10; i++) { … }
for (const item of array) { … }        // values
for (const [index, value] of array.entries()) { … }
for (const key in object) { … }        // inherited enumerable keys; guard with hasOwn
while (condition) { … }
do { … } while (condition);

array.forEach((item) => { … });        // cannot break
```

`break` exits a loop, `continue` skips to the next iteration. Label loops if you must break the outer one: `outer: for (…) { for (…) break outer; }`.

## Functions

```js
function add(a, b = 0) { return a + b; }        // declaration, hoisted
const mul = function (a, b) { return a * b; };   // expression
const sub = (a, b) => a - b;                    // arrow: implicit return
const obj = { add(a, b) { return a + b; }, get value() { return 1; } };
```

- Arrow functions inherit `this`, `arguments`, and `super` from the enclosing scope. They are right for callbacks, wrong for methods that need their own `this`.
- Default parameters apply when the argument is `undefined`.
- Rest: `function sum(...numbers)`. Spread at the call site: `sum(...list)`.
- Functions are objects: they can be passed, stored, and returned (higher-order functions).
- `arguments` exists only in normal functions; prefer rest parameters.
- Recursion is fine for trees; deep recursion can overflow the stack.

## Scope, closures, and `this`

- Block scope: `{}` inside `if`, `for`, functions, and modules.
- Closures capture variables, not values: a function returned from another keeps its scope alive.
- `this` depends on the call site: `obj.method()` → `obj`; `fn()` → `undefined` in modules/strict mode (or the global object in sloppy mode); `new Fn()` → the new instance; `.call/.apply/.bind` override it. Arrow functions do not have their own `this`.
- Modules are strict mode by default and have their own top-level scope.
- `globalThis` is the portable global object (`window` in browsers).

```js
function counter() {
  let count = 0;
  return { increment: () => ++count, value: () => count };
}
```

## Objects

```js
const user = {
  name: 'Ada',
  age: 36,
  greet() { return `Hi ${this.name}`; },
  ['computed' + 'Key']: true,
  nested: { city: 'London' }
};
user.email = 'ada@example.com';
const { name, nested: { city }, missing = 'n/a' } = user;
const copy = { ...user, age: 37 };
Object.keys(user); Object.values(user); Object.entries(user);
Object.assign({}, user);
Object.freeze(user);        // shallow immutability
Object.hasOwn(user, 'name');
delete user.email;
'name' in user;             // true, includes prototype chain
```

- Property order is declaration order for string keys (integer-like keys come first).
- Access with dots for known keys, brackets for dynamic ones.
- `Object.create(proto)` sets a prototype; `Object.getPrototypeOf`/`setPrototypeOf` inspect it. Most code should use classes or factories instead of manual prototypes.
- Getters and setters: `get value()`, `set value(v)`, or `Object.defineProperty(obj, key, { get, set, enumerable, configurable, writable })`.

## Arrays

```js
const list = [3, 1, 2];
list.length;                  // 3
list[0];                      // 3
list.at(-1);                  // 2
Array.isArray(list);          // true
Array.from('abc');            // ['a','b','c']
Array.from({ length: 3 }, (_, i) => i); // [0,1,2]
Array.of(1, 2, 3);
[...'hello'];
new Array(3).fill(0);         // [0,0,0]
```

Mutating methods: `push`, `pop`, `shift`, `unshift`, `splice(start, deleteCount, ...items)`, `sort(compare)`, `reverse`, `fill`, `copyWithin`.

Non-mutating methods (return new arrays): `slice`, `concat`, `map`, `filter`, `flat`, `flatMap`, `toSorted`, `toReversed`, `toSpliced`, `with`, `join`, `includes`, `indexOf`, `lastIndexOf`, `find`, `findIndex`, `findLast`, `findLastIndex`, `some`, `every`, `reduce`, `reduceRight`, `forEach`, `keys`, `values`, `entries`, `toString`.

```js
const numbers = [5, 2, 9, 1];
numbers.reduce((sum, n) => sum + n, 0);          // 17, always pass an initial value
numbers.toSorted((a, b) => a - b);               // [1,2,5,9], leaves the original
[1, [2, [3]]].flat(Infinity);                    // [1,2,3]
[1, 2, 3].includes(2);                           // true
[1, 2, 3].findIndex((n) => n > 1);               // 1
```

Sorting compares strings by default, so `[10, 9].sort()` gives `[10, 9]`. Always pass `(a, b) => a - b` for numbers.

## Strings

```js
const s = 'Hello, world';
s.length;                       // 12
s.toUpperCase(); s.toLowerCase();
s.trim(); s.trimStart(); s.trimEnd();
s.includes('world'); s.startsWith('Hello'); s.endsWith('d');
s.indexOf('o'); s.lastIndexOf('o');
s.slice(0, 5); s.substring(0, 5); s.at(-1);
s.split(', '); s.replace('world', 'there'); s.replaceAll('l', 'L');
s.padStart(15, '.'); s.padEnd(15, '.');
s.repeat(3); s.concat('!');
s.charCodeAt(0); String.fromCharCode(65);
s.codePointAt(0); String.fromCodePoint(128512);
s.localeCompare('hello', 'en', { sensitivity: 'base' });
'  a  b '.split(/\s+/);         // regex splitting
```

Template literals support interpolation, multiline text, and tagged templates: `` tag`x ${y}` ``.

Strings are immutable; every method returns a new string. Indexing gives UTF-16 code units, so emoji can count as two — use `[...s]` or `Intl.Segmenter` for grapheme-aware handling.

## Numbers and Math

```js
Number('42'); Number.parseInt('42px', 10); Number.parseFloat('3.14em');
Number.isInteger(5); Number.isFinite(Infinity); Number.isNaN(NaN);
(1234.5678).toFixed(2);    // '1234.57'
(1234.5678).toPrecision(5);
(255).toString(16);        // 'ff'
Number.MAX_SAFE_INTEGER; Number.EPSILON; Number.MAX_VALUE;
```

`Math` members: `abs`, `sign`, `sqrt`, `cbrt`, `pow`, `exp`, `log`, `log10`, `log2`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `hypot`, `random`, and the constants `PI`, `E`, `LN2`, `LN10`, `SQRT2`. `Math.random()` returns 0 ≤ x < 1; for random integers use `Math.floor(Math.random() * n)`.

Floating point is binary: `0.1 + 0.2 === 0.30000000000000004`. Compare with a tolerance (`Math.abs(a - b) < 1e-9`) or work in integers (cents, not dollars). Rounding money: `Math.round(value * 100) / 100` is still approximate for large values; use `Intl.NumberFormat` for display.

## Dates

```js
const now = new Date();
new Date('2026-10-28T12:00:00Z');
new Date(2026, 9, 28);            // month is 0-based: 9 = October
Date.now();                        // milliseconds since the epoch
now.getFullYear(); now.getMonth(); now.getDate(); now.getDay();
now.getHours(); now.getMinutes(); now.getSeconds(); now.getMilliseconds();
now.getTime(); now.toISOString(); now.toLocaleDateString('en-US');
now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
```

`Intl.DateTimeFormat` formats dates for a locale; `Intl.RelativeTimeFormat` gives "3 days ago". For parsing non-ISO strings, beware time zones; `new Date('2026-10-28')` is UTC midnight, while `new Date('2026-10-28T00:00')` is local. Add a duration by milliseconds: `new Date(date.getTime() + 864e5)`.

## JSON

```js
JSON.stringify({ a: 1 }, null, 2);    // pretty print
JSON.parse(text);
JSON.parse(text, (key, value) => key === 'date' ? new Date(value) : value);
```

JSON supports objects, arrays, strings, numbers, booleans, and null. It does not support `undefined`, functions, `NaN`, `Infinity`, dates (they become strings), or cycles. `JSON.stringify` drops function properties and turns `undefined` into absence. Custom serialisation: `toJSON()` on the object, or a replacer function.

## Map, Set, WeakMap, WeakSet

```js
const map = new Map([['a', 1]]);
map.set('b', 2).set('c', 3);
map.get('a'); map.has('b'); map.size; map.delete('c');
for (const [key, value] of map) { … }
map.keys(); map.values(); map.entries();

const set = new Set([1, 2, 2]);
set.add(3); set.has(1); set.size;
const unique = [...new Set(array)];
```

- Object keys are strings/symbols; Map keys can be anything, including objects, and insertion order is preserved.
- Set stores unique values using SameValueZero.
- `WeakMap`/`WeakSet` hold weak references so keys can be garbage-collected — good for caching metadata about DOM nodes. They are not iterable and have no `size`.

## Classes

```js
class Animal {
  #secret = 1;                    // private field
  static population = 0;
  constructor(name) { this.name = name; Animal.population++; }
  speak() { return `${this.name} makes a sound`; }
  get label() { return this.name.toUpperCase(); }
  set label(value) { this.name = value; }
  static create(name) { return new Animal(name); }
}

class Dog extends Animal {
  constructor(name, breed) { super(name); this.breed = breed; }
  speak() { return `${super.speak()} — woof`; }
}
```

- `#private` fields and methods cannot be reached from outside the class.
- Inheritance uses `extends` and `super`. `super.method()` calls the parent's method.
- Class fields are defined per instance, not on the prototype.
- Calling a class without `new` throws.
- Prefer composition when inheritance starts to feel forced.

## Errors

```js
try {
  risky();
} catch (error) {
  console.error(error.name, error.message, error.stack);
} finally {
  cleanup();
}

throw new Error('Something failed');
throw new TypeError('Expected a string');
class ValidationError extends Error {
  constructor(message, field) { super(message); this.name = 'ValidationError'; this.field = field; }
}
```

Built-in error types: `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError`. Catch what you can handle; re-throw what you cannot. Never swallow errors silently. `finally` runs whether or not an error was thrown.

## Promises and async

```js
const promise = new Promise((resolve, reject) => {
  setTimeout(() => resolve('done'), 100);
});

promise.then((value) => console.log(value)).catch((error) => console.error(error)).finally(() => {});

async function load() {
  try {
    const response = await fetch('/data.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
}

const [a, b] = await Promise.all([fetchA(), fetchB()]);
const fastest = await Promise.race([fetchA(), timeout(3000)]);
const settled = await Promise.allSettled([fetchA(), fetchB()]);
const firstOk = await Promise.any([fetchA(), fetchB()]);
```

- An `async` function always returns a promise. `await` pauses that function only.
- `Promise.all` rejects as soon as one promise rejects; `allSettled` never rejects and reports each result; `any` resolves with the first success.
- Unhandled rejections crash some runtimes and log in others. Always attach a `catch`.
- Sequential vs parallel: `for (const item of list) await work(item)` is one-at-a-time; `await Promise.all(list.map(work))` is parallel.
- Timers: `setTimeout(fn, ms)`, `setInterval`, `clearTimeout`, `clearInterval`; `queueMicrotask` and `Promise.resolve().then()` run before timers.
- `AbortController` cancels fetches and other async work: `const controller = new AbortController(); fetch(url, { signal: controller.signal }); controller.abort();`

## Regular expressions

```js
const pattern = /(\d{4})-(\d{2})-(\d{2})/g;
pattern.test('2026-10-28');
'2026-10-28'.match(/\d+/g);
'2026-10-28'.replace(/(\d+)-(\d+)-(\d+)/, '$3/$2/$1');
[...'a1b2'.matchAll(/([a-z])(\d)/g)].map((m) => m[1]);
/Dog/i.test('dog');              // flags: i, g, m, s, u, y, d
```

Character classes: `\d` digit, `\w` word, `\s` whitespace, `.` any except newline, `\b` word boundary. Quantifiers: `*` 0+, `+` 1+, `?` 0–1, `{2,5}`. Groups: `(…)` capture, `(?:…)` non-capture, `(?<name>…)` named, `(?=…)` lookahead, `(?<=…)` lookbehind. Anchors `^` and `$`. A `g` regex is stateful with `.test()` because it remembers `lastIndex` — create a fresh regex or reset it.

## Browser: the DOM

```html
<h1 id="title">Hello</h1>
<ul class="list"><li>One</li></ul>
```

```js
document.getElementById('title');
document.querySelector('.list > li');            // first match
document.querySelectorAll('li');                  // static NodeList
document.getElementsByClassName('list');          // live HTMLCollection
document.createElement('div');
document.createTextNode('text');
document.createDocumentFragment();
```

- Reading: `element.textContent` (text only), `element.innerHTML` (parsed HTML — never insert untrusted input), `element.innerText` (visible text), `element.outerHTML`, `element.attributes`, `element.dataset`, `element.classList`, `element.tagName`, `element.children`, `element.parentElement`, `element.nextElementSibling`, `element.closest('.card')`, `element.matches('.active')`.
- Writing: `textContent = '…'` (safe), `innerHTML`, `insertAdjacentHTML('beforeend', html)`, `element.append(node)`, `prepend`, `before`, `after`, `replaceWith`, `remove()`, `cloneNode(true)`, `setAttribute`, `removeAttribute`, `classList.add/remove/toggle/replace/contains`, `element.style.setProperty('--x', '1')`.
- Creating: `const div = document.createElement('div'); div.textContent = 'hi'; parent.append(div);`
- Node lists are not arrays: `[...document.querySelectorAll('a')]` or `NodeList.forEach` (most methods exist, but `map`/`filter` do not).
- `document.body`, `document.documentElement`, `document.head`, `document.title`, `document.readyState`, `document.activeElement`.
- Changing many elements: build a `DocumentFragment` or set `innerHTML` once — one reflow, not many.

## Browser: events

```js
button.addEventListener('click', (event) => {
  event.preventDefault();          // stop the default browser action
  event.stopPropagation();         // stop bubbling (use sparingly)
  console.log(event.target, event.currentTarget, event.type);
});

window.addEventListener('resize', handleResize);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
});

window.removeEventListener('resize', handleResize);   // same function reference
```

- Events bubble from the target up to `document` (most of them). Use delegation: one listener on a container, check `event.target.closest('[data-action]')`.
- `event.preventDefault()` stops scrolling on space, form submission, link navigation, and default touch gestures.
- Common events: `click`, `dblclick`, `pointerdown/move/up`, `mouseenter/leave`, `keydown/up`, `input`, `change`, `submit`, `focus/blur`, `focusin/focusout`, `scroll`, `resize`, `load`, `DOMContentLoaded`, `visibilitychange`, `beforeunload`, `dragstart/dragover/drop`, `touchstart/move/end`, `wheel`, `contextmenu`, `hashchange`, `popstate`.
- `input` fires on every keystroke; `change` fires on commit (blur or selection).
- `submit` belongs on the form, not the button. Call `event.preventDefault()` to handle it yourself.
- Event options: `{ once: true }`, `{ passive: true }` (promises you will not preventDefault — better scrolling), `{ capture: true }`.
- Custom events: `element.dispatchEvent(new CustomEvent('mox:save', { detail: data, bubbles: true }))`.

## Browser: forms and validation

```js
const form = document.querySelector('form');
form.elements.email.value;
form.checkValidity();
input.validity.valid; input.validity.typeMismatch; input.validationMessage;
input.setCustomValidity('Use a work email');
form.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(form); });
```

`FormData` gives `get`, `getAll`, `has`, `append`, `set`, `delete`, entries. Convert to an object with `Object.fromEntries(formData)`. Serialise with `new URLSearchParams(formData)` for `application/x-www-form-urlencoded`.

## Browser: network

```js
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  signal: controller.signal,
  cache: 'no-store',
  credentials: 'same-origin'
});
if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
const data = await response.json();       // or .text(), .blob(), .arrayBuffer(), .formData()
```

- `fetch` only rejects on network failure, not on 404/500 — check `response.ok`.
- Response headers: `response.headers.get('content-type')`, `response.url`, `response.redirected`, `response.status`.
- Streaming: `for await (const chunk of response.body)` with `TextDecoder`.
- Upload progress is not available with `fetch`; use `XMLHttpRequest` or streams.
- `WebSocket` for two-way real-time traffic: `socket.onopen`, `socket.onmessage`, `socket.send()`, `socket.close()`.
- `EventSource` for server-sent events (one-way).
- `navigator.sendBeacon(url, data)` for analytics on page unload.
- CORS: the server must send `Access-Control-Allow-Origin`; you cannot bypass it from the browser.

## Browser: storage

- `localStorage.setItem(key, value)`, `getItem`, `removeItem`, `clear`, `key(i)`, `length` — strings only, synchronous, persists until cleared (about 5 MB).
- `sessionStorage` — same API, cleared when the tab closes.
- `indexedDB` — asynchronous, large structured data and blobs. `indexedDB.open(name, version)`, `db.createObjectStore(key, { keyPath })`, transactions with `readonly`/`readwrite`, `objectStore.add/put/get/getAll/delete`, `index.getAll`.
- Cookies: `document.cookie` (awkward; use it for server-side session markers, not data); `Secure`, `HttpOnly`, and `SameSite` are set by the server.
- `navigator.storage.estimate()` reports usage and quota; `navigator.storage.persist()` asks for durable storage.
- The Cache API (`caches.open`, `cache.put`, `cache.match`) powers service workers and offline apps.
- Never store secrets (tokens, passwords) in localStorage: any script on the page can read them. Use HttpOnly cookies for sessions.

## Browser: other useful APIs

- **Timing**: `performance.now()` (monotonic), `performance.mark/measure`, `console.time/timeEnd`.
- **Animation**: `requestAnimationFrame(fn)` before each paint; `element.animate(keyframes, options)`.
- **Observation**: `IntersectionObserver` (visibility/scroll), `ResizeObserver` (size changes), `MutationObserver` (DOM changes).
- **Media**: `navigator.mediaDevices.getUserMedia({ video: true, audio: true })`, `<video>`/`<audio>`, `AudioContext` for sound synthesis.
- **Canvas**: `canvas.getContext('2d')` with `fillRect`, `strokeRect`, `beginPath`, `moveTo`, `lineTo`, `arc`, `fill`, `stroke`, `fillText`, `drawImage`, `save/restore`, `translate/rotate/scale`, `createLinearGradient`. WebGL for 3D; `OffscreenCanvas` for workers.
- **SVG**: create elements with `document.createElementNS('http://www.w3.org/2000/svg', 'circle')`.
- **Files**: `<input type="file">`, `file.text()`, `file.arrayBuffer()`, `FileReader`, `URL.createObjectURL(blob)` (revoke it when done), drag-and-drop via `dataTransfer.files`.
- **Clipboard**: `navigator.clipboard.writeText(text)` and `readText()` (needs a user gesture and secure context).
- **Dialogs**: `alert`, `confirm`, `prompt` block the page; `window.confirm` returns a boolean; `<dialog>` is better for custom UI.
- **Navigation**: `location.href`, `location.assign/replace/reload`, `history.pushState/replaceState`, `popstate`, `URL` and `URLSearchParams`.
- **Device**: `navigator.userAgent`, `navigator.language`, `navigator.onLine`, `navigator.hardwareConcurrency`, `navigator.geolocation.getCurrentPosition`.
- **Workers**: `new Worker('worker.js')` runs JavaScript off the main thread; communicate with `postMessage` and `onmessage`. Web Workers cannot touch the DOM.
- **Service Workers**: proxy network requests for offline support and caching; register with `navigator.serviceWorker.register('/sw.js')`.
- **Intl**: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `Intl.PluralRules`, `Intl.Collator`, `Intl.Segmenter`.

## Modules

```js
// math.js
export const pi = 3.14159;
export function square(n) { return n * n; }
export default class Calculator { … }

// app.js
import Calculator, { pi, square } from './math.js';
import * as math from './math.js';
const { square } = await import('./math.js');   // dynamic, lazy
```

- ES modules are strict, have their own scope, are deferred by default, and run once per URL.
- Paths need the extension in browsers (`./math.js`). Bare imports (`'lodash'`) need a bundler or import map.
- `<script type="module" src="app.js">` is required in HTML. Module scripts are CORS-restricted, so `file://` will not work.
- Named exports are bindings (live); default exports are values.
- Import cycles are legal but fragile; keep dependencies one-way.

## Iterators and generators

```js
function* range(start, end) {
  for (let i = start; i < end; i++) yield i;
}
[...range(0, 5)];            // [0,1,2,3,4]

const iterable = { *[Symbol.iterator]() { yield 1; yield 2; } };
```

`for...of` works on strings, arrays, maps, sets, NodeLists, and generators. Destructuring and spread use the iterator protocol. Generators pause at `yield` and resume on `.next()`.

## Patterns worth knowing

- **Guard clauses**: return early instead of nesting `if`s.
- **Debounce**: delay work until input pauses. `const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };`
- **Throttle**: run at most once per interval.
- **Memoisation**: cache results by key.
- **Pure functions**: same input, same output, no side effects — easier to test.
- **Immutability**: spread instead of in-place mutation for state you compare.
- **Factory functions** over classes for small objects; classes for identity and inheritance.
- **Module pattern**: a closure returning only the public API.
- **Event delegation** for lists that change.
- **Feature detection** (`if ('clipboard' in navigator)`) beats user-agent sniffing.
- **Progressive enhancement**: ship working HTML, add JS behaviour on top.
- **State-driven UI**: keep one state object, re-render from it, avoid scattered DOM edits.

## Debugging

- `console.log`, `console.table`, `console.time`, `console.trace`, `debugger;` (pauses DevTools).
- Read the stack trace from the first line that is your code. `TypeError: Cannot read properties of undefined` means something before the dot was undefined.
- Breakpoints in Sources let you inspect scope, step over/into, and watch expressions.
- Network panel shows failed requests, status codes, timings, and response bodies.
- `element.getBoundingClientRect()` gives position and size; `window.getComputedStyle(element)` gives resolved CSS.
- `document.querySelectorAll` returning an empty list means the selector is wrong or the DOM is not ready.
- Handle async errors with `window.addEventListener('error')` and `'unhandledrejection'`.
- `localStorage.clear()` and "Clear site data" fix stale-state bugs; a hard reload bypasses caches.

## Performance notes

- Minimise DOM writes inside loops; batch with fragments.
- Debounce `input`, `scroll`, and `resize` handlers; prefer passive listeners for scrolling.
- Avoid layout thrash: read all geometry (`offsetWidth`, `getBoundingClientRect`) before writing styles.
- Use `requestAnimationFrame` for visual updates.
- Load code with `type="module"` and split rarely used features behind dynamic `import()`.
- Cache expensive results, but measure before optimising: the Performance panel and `performance.now()` tell you where time actually goes.
- `structuredClone(value)` deep-copies plain data, arrays, maps, sets, and dates.
