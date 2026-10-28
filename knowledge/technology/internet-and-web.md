# The internet and the web

The internet is a global network of networks. The web is one service on it: documents linked by hyperlinks and fetched over HTTP.

## How data moves

- IP (Internet Protocol) addresses and routes packets between networks. IPv4 has 32-bit addresses; IPv6 has 128-bit.
- TCP establishes a reliable, ordered connection and retransmits lost data; UDP is faster and connectionless, used for live video and games.
- DNS translates names like example.com into IP addresses through a hierarchy of resolvers.
- TLS encrypts traffic and authenticates servers using certificates, producing https.
- Routers forward packets between networks; ISPs connect homes and businesses to the backbone.
- Bandwidth is capacity; latency is delay; jitter is variation in delay.

## HTTP basics

A request has a method, a URL, headers, and optionally a body. A response has a status code, headers, and a body.

- Methods: GET (retrieve), POST (create/submit), PUT (replace), PATCH (modify), DELETE (remove), HEAD (metadata only).
- Status codes: 2xx success (200 OK, 201 Created, 204 No Content); 3xx redirect (301 permanent, 302 temporary, 304 not modified); 4xx client error (400 bad request, 401 unauthenticated, 403 forbidden, 404 not found, 429 too many requests); 5xx server error (500, 502 bad gateway, 503 unavailable).
- Headers: Content-Type, Content-Length, Cache-Control, Authorization, Cookie, User-Agent.
- Cookies and localStorage keep state, because HTTP itself is stateless.

## URLs

A URL has scheme, host, optional port, path, query string, and fragment:
https://shop.example.com:443/items/42?color=blue#reviews

## The browser pipeline

1. Resolve DNS, open a TLS connection.
2. Request the HTML document.
3. Parse HTML into the DOM; fetch CSS, scripts, images, and fonts.
4. Build the CSSOM, combine into a render tree, lay out, and paint.
5. Run JavaScript, which can modify the DOM and trigger re-render.
6. Cache assets, store cookies, and enforce same-origin restrictions.

JavaScript in a page is sandboxed: the same-origin policy stops one site's script from reading another site's data. CORS headers let servers explicitly permit cross-origin requests.

## How websites are built

- Static sites: HTML, CSS, and JavaScript files served as-is.
- Server-rendered apps: the server generates HTML per request.
- Single-page apps: JavaScript renders in the browser and calls APIs.
- APIs often return JSON over REST or GraphQL; WebSockets keep a live bidirectional connection.

## Web standards and addresses

HTML structures content, CSS styles it, and JavaScript adds behavior — the three layers of the web. Domains are registered through registrars and recorded in DNS; ICANN and IANA coordinate the global namespace. Certificates come from certificate authorities.

## Email, DNS, and other protocols

SMTP sends mail, IMAP/POP retrieve it. DNS records: A (IPv4), AAAA (IPv6), CNAME (alias), MX (mail), TXT (verification and policy), NS (nameservers), SRV (services). FTP/SFTP transfer files; SSH gives secure remote shells.

## Search and discovery

Crawlers follow links, index page content, and rank results by relevance, authority, freshness, and user signals. Search results are ranked guesses, not objective truth. Evaluate sources by author, date, citations, and whether other credible sources agree.

## Security on the open internet

- Never trust a page just because it uses https; the padlock means the connection is encrypted, not that the site is honest.
- Public Wi-Fi can be monitored; VPNs encrypt traffic to a provider but shift trust to that provider.
- Phishing works by impersonation and urgency. Verify through a second channel.
- Password reuse is the most common failure. Use unique passwords and a manager.
- Content delivery networks (CDNs) place copies of content near users; distributed denial-of-service (DDoS) attacks flood targets with traffic.
