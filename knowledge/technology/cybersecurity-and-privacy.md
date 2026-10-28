# Cybersecurity and privacy

Security protects data from unauthorized access, change, or loss. Privacy is about who is allowed to know what about you, and on what terms.

## The core goals (CIA)

- Confidentiality: only authorized people can read data (encryption, access control).
- Integrity: data is accurate and unaltered (hashes, signatures, checksums).
- Availability: systems work when needed (backups, redundancy, protection from denial of service).

Add authentication (proving identity), authorization (what an identity may do), and non-repudiation (proof an action happened).

## Threats

- Malware: viruses, worms, trojans, ransomware, spyware, rootkits.
- Phishing and social engineering: impersonation by email, text, or phone; urgency and authority are the levers.
- Credential attacks: password spraying, credential stuffing, brute force, session hijacking.
- Injection: SQL injection, cross-site scripting (XSS), command injection — untrusted input reaching an interpreter.
- Man-in-the-middle: interception on untrusted networks.
- Denial of service: flooding a service with traffic.
- Supply chain: a compromised dependency, installer, or update.
- Insider threat, misconfiguration, and simple human error.

## Defenses

- Strong unique passwords and a password manager; multi-factor authentication (MFA) — a hardware key or authenticator app beats SMS.
- Encryption in transit (TLS) and at rest (full-disk or database encryption). End-to-end encryption keeps keys only on endpoints.
- Keep software patched; most breaches exploit known, fixable flaws.
- Least privilege: accounts get only the access they need. Separate admin accounts from daily use.
- Backups: follow 3-2-1 — three copies, two media, one offsite; test restores.
- Network defenses: firewalls, segmented networks, VPNs, and monitoring.
- Application defenses: validate and encode input, parameterized queries, secure session cookies, rate limiting.
- Logging and monitoring: detect anomalies early; keep audit trails.

## Cryptography essentials

- Symmetric encryption (AES) uses one shared key; fast, used for bulk data.
- Asymmetric encryption (RSA, elliptic curves) uses a public key to encrypt or verify and a private key to decrypt or sign; used for key exchange and signatures.
- Hashing (SHA-256) is one-way and fixed-length; used for integrity and password storage with salts. Salting prevents precomputed rainbow tables; slow hashes (bcrypt, scrypt, Argon2) resist brute force.
- TLS combines both: asymmetric handshake to agree on a symmetric session key, then fast encrypted traffic.
- A digital signature proves origin and integrity.
- Never invent your own cryptography.

## Common vulnerabilities to recognize

- Weak or reused passwords; no MFA.
- Unpatched systems and default credentials.
- Overly broad permissions and unencrypted storage.
- Injection because input is concatenated into queries or commands.
- Secrets committed to source code or shipped in client-side JavaScript.

## Privacy fundamentals

- Data minimization: collect only what you need, keep it only as long as necessary.
- Consent should be informed and revocable.
- Purpose limitation: data collected for one reason should not be silently reused.
- Anonymization is hard; combining datasets re-identifies people. Pseudonymization is weaker but useful.
- Tracking: cookies, fingerprinting (screen size, fonts, canvas), and pixels follow behavior across sites. Blockers and privacy-focused browsers reduce this.
- Metadata (who, when, where) can be as revealing as content.
- Threat modeling: what do you protect, from whom, and what happens if it fails?

## Personal practices

Use a password manager, enable MFA everywhere important, update devices, lock screens, encrypt disks, review app permissions, avoid reusing recovery answers, check URLs before logging in, and treat urgent unsolicited requests as suspicious. Cover camera and mic only if it fits your threat model — software controls matter more.

## Local-first privacy

Apps that run models in your browser or on your device can process text without sending it to a server. That does not make them automatically private: it depends on what else the page loads, what gets cached, and whether storage is cleared. Check whether the app makes network requests while you type, and whether the model and runtime are served from the same origin.

## Incident response

Prepare, detect, contain, eradicate, recover, and learn. Change compromised passwords from a clean device, revoke sessions, check for persistence, and notify affected people as required. Preserve logs before wiping a machine.
