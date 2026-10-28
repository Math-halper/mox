# APIs, HTTP, and JSON — how programs talk to each other

An API (application programming interface) is a contract: a set of names, inputs, outputs, and rules that one piece of software exposes so another can use it without knowing how it works inside. A function is an API. A class is an API. A web service reached over HTTP is the kind people usually mean, and it is the one that gets confused with the browser APIs (`fetch`, `localStorage`, `canvas`) built into JavaScript.

## Two kinds of API you will meet

**Browser APIs** are already present in the page: `document.querySelector`, `fetch`, `localStorage`, `IntersectionObserver`, `navigator.clipboard`, `indexedDB`, `CanvasRenderingContext2D`, `AudioContext`, `WebSocket`. They are documented on MDN, they need no server, and they are the reason a static page can do real work. Capabilities are gated by permissions and secure-context rules: clipboard, camera, geolocation, notifications, and service workers require HTTPS (or localhost). Always feature-detect before calling them.

```js
if ('clipboard' in navigator) await navigator.clipboard.writeText(text);
if ('geolocation' in navigator) navigator.geolocation.getCurrentPosition(onFix, onError);
const estimate = await navigator.storage?.estimate?.();
```

**Web service APIs** live on a server you call over the network. They expose resources through URLs and HTTP methods. You usually meet them as REST, GraphQL, or RPC.

## HTTP in one page

A request is a method, a URL, headers, and optionally a body. A response is a status code, headers, and a body.

| Method | Meaning | Body? | Safe to retry? |
| --- | --- | --- | --- |
| `GET` | Read a resource | No | Yes (idempotent) |
| `POST` | Create something, or run an action | Yes | No |
| `PUT` | Replace a resource completely | Yes | Yes (idempotent) |
| `PATCH` | Update part of a resource | Yes | Sometimes |
| `DELETE` | Remove a resource | Optional | Yes |
| `HEAD` | Headers only, no body | No | Yes |
| `OPTIONS` | Ask what is allowed (CORS preflight) | No | Yes |

Status codes worth knowing: `200 OK`, `201 Created`, `204 No Content`, `301/308` permanent redirect, `304 Not Modified`, `400 Bad Request`, `401 Unauthorized` (not authenticated), `403 Forbidden` (authenticated but not allowed), `404 Not Found`, `405 Method Not Allowed`, `409 Conflict`, `422 Unprocessable Entity` (validation), `429 Too Many Requests`, `500 Internal Server Error`, `502 Bad Gateway`, `503 Service Unavailable`.

Headers carry metadata: `Content-Type: application/json`, `Accept: application/json`, `Authorization: Bearer <token>`, `Cache-Control`, `ETag`, `Retry-After`, `Access-Control-Allow-Origin`, `Set-Cookie`.

## Calling an API from JavaScript

```js
async function getUser(id, signal) {
  const response = await fetch(`https://api.example.com/users/${id}`, {
    headers: { Accept: 'application/json' },
    signal
  });
  if (response.status === 404) return null;
  if (response.status === 429) throw new Error(`Rate limited; retry after ${response.headers.get('Retry-After')}s`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
```

- `fetch` resolves even for 404 and 500; only network failures reject. Check `response.ok`.
- Send JSON with `method: 'POST'`, `headers: { 'Content-Type': 'application/json' }`, `body: JSON.stringify(data)`.
- Cancel with an `AbortController`; time out with `AbortSignal.timeout(5000)`.
- Some services need `mode: 'cors'`, `credentials: 'include'` (to send cookies), or a proxy because of CORS.
- API keys in front-end code are public. If a key must stay secret, the request has to go through your own server.
- Pagination: look for `next`, `cursor`, `page`, or `Link` headers. Never assume one response holds everything.
- Rate limits: cap concurrency, back off exponentially on 429/5xx, and cache responses.
- Idempotency keys let a retried POST be safely deduplicated.
- Webhooks are the reverse direction: the service calls your URL when something happens. Verify the signature and respond 2xx quickly.

## JSON

JSON is a text format for structured data. It has objects `{}` (string keys, double quotes), arrays `[]`, strings (double quotes, escape `\"` and `\n`), numbers, `true`/`false`, and `null`. No comments, no trailing commas, no `undefined`, no functions, no dates (use ISO strings), no `NaN`.

```js
const text = JSON.stringify({ user: { id: 1, tags: ['a', 'b'] } }, null, 2);
const data = JSON.parse(text);
```

Handle malformed input:

```js
function safeParse(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}
```

JSON Schema describes the expected shape. In JavaScript, validate at the boundary (any network input), not in every function. `structuredClone(value)` deep-copies parsed plain data, maps, sets, and dates.

## Designing an API

- Name resources with nouns and plurals: `/users`, `/users/42/orders`. Use verbs only for actions: `/users/42/reset-password`.
- Version it (`/v1/…`) or evolve compatibly.
- Return consistent shapes, including errors: `{ "error": { "code": "invalid_email", "message": "…" } }`.
- Use the correct status code instead of `200 { "error": true }`.
- Make list endpoints paginated and filterable from the start.
- Validate and reject bad input early with a clear 400/422 message.
- Document every endpoint, field, and error in an OpenAPI file or a README table.
- Design for retries: idempotent writes, stable ids, no side effects on GET.
- Protect: authentication (who you are), authorisation (what you may do), rate limits, input size caps, and CSRF protection for cookie-based sessions.
- CORS is a browser rule, not security for your server; the server must still check permissions.

## GraphQL and RPC in brief

GraphQL exposes one endpoint with a typed schema; the client asks for exactly the fields it needs. Queries read, mutations write, subscriptions stream. Watch for N+1 resolver problems and unbounded query depth. RPC (gRPC, JSON-RPC) exposes named procedures such as `createUser` rather than resources; it is common between internal services.

## Mox's own in-page APIs

The Mox app exposes a small scripting surface at `window.__mox` for debugging, lessons, and automation:

- `__mox.calc('sqrt(2) * 10')` → `{ ok, value, text }`. The calculator engine also accepts `convert(10, km, mi)`, `20% of 150`, `ncr(5,2)`, `mean(1,2,3)`, and the rest of the function list.
- `__mox.calc('72 F in C')` converts units, including temperature offsets.
- `__mox.workspace.files()` lists the files in the workspace; `read(path)` returns one; `apply([{ path, content }])` writes files; `open()` shows the panel.
- `__mox.workspace.writesFrom(text)` extracts file-write blocks from model output.
- `__mox.models.list()` shows every available model, including uploads; `reload()` rescans.
- `__mox.retrieve('photosynthesis')` returns the knowledge passages the app would send to the model.
- On this device, the model can edit the workspace by emitting a fenced block whose info line is `mox:write path=index.html`, followed by the complete file. `<calc>2+2</calc>` in an answer is replaced with the exact result.

That last pair is the practical version of an API call inside an AI workspace: a documented, narrow contract between the model's text and the app's code.
