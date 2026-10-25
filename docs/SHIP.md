# Shipping mox as a product

One command builds a release. One command installs it. The rest of this page is
the part that isn't code: what you are actually selling, and what you must tell
the buyer.

## Build the release

```bash
npm install                       # dev dependencies only (typecheck + tests)
./scripts/build-release.sh --base-url https://yourdomain.com/downloads
```

You get, in `dist/`:

| File | What it is |
|---|---|
| `mox-0.2.0.tar.gz` | the product: app, tools, installer (~90 KB) |
| `mox-0.2.0.sha256` | checksum — publish it next to the tarball |
| `install.sh` | the one-liner installer, already pointed at your tarball |
| `RELEASE.md` | the pre-flight checklist, regenerated each build |

Upload the tarball, the checksum, and `install.sh` to `--base-url`. Your customer runs:

```bash
curl -fsSL https://yourdomain.com/downloads/install.sh | bash
```

That installs into `~/.local` with no root, verifies the checksum, creates a
starter assistant folder at `~/mox-assistant`, and adds **mox** to the Mint
application menu. They click it and the chat window opens.

## What the buyer has to supply

Be explicit about this on the sales page, or you will spend your support budget
explaining it:

- **A local model.** mox ships no weights. The app detects Ollama, LM Studio, or
  llama.cpp; if none is running, the window shows exactly what to start. The
  installer offers to install Ollama and pull `qwen3:8b` (~5 GB).
- **Hardware.** An 8B model at 4-bit wants about 6–8 GB of RAM; a 14B wants
  12–16 GB. A machine with 8 GB total can run a 4B model, slowly. Say so.
- **Disk.** Node (~30 MB if downloaded), the app (~1 MB), the model (4–10 GB).

## What you are selling (be honest about this too)

The code is MIT-licensed and publicly readable. Nobody is buying the source.
What they are buying is:

1. **The setup being done** — Node, sandbox, menu entry, model wiring, a folder that already works.
2. **The folder format** — an assistant whose identity, knowledge, skills, and memory are plain files they can edit.
3. **The guardrails** — approvals before anything mutates, credential blocking, a sandbox, full run traces.
4. **Support** — that you answer questions and ship fixes.

The intelligence comes from whatever model they run. If you claim "our AI" is
smarter than `ollama run qwen3:8b`, a technical buyer will notice. Selling the
packaging, the folder, and the setup is a real product; selling a wrapper as a
breakthrough is how you get refund requests.

## Pricing and support (decisions, not code)

- Price the **setup and support**, not the tokens — you pay nothing per query.
- State what support includes: email? how many hours? refund window? Put it in writing.
- Decide your update policy: does a license include updates forever, for a year, or not at all?
- Keep a changelog (git log is fine) and tell buyers when the window or policy changes.

## Checksums, signing, trust

The generated `install.sh` verifies the tarball against your published
`.sha256`. Anything you publish can be verified by hand:

```bash
sha256sum -c mox-0.2.0.sha256
```

For a serious release, also sign:

```bash
gpg --detach-sign --armor dist/mox-0.2.0.tar.gz
# publish dist/mox-0.2.0.tar.gz.asc and your public key fingerprint
```

Tell buyers where the checksums come from (your site, over HTTPS). A checksum on
the same page as a compromised download protects nothing.

## Other formats

- **`.deb`** — build with `dpkg-deb` for `/opt/mox` if you want `apt install mox`. You then own the Node dependency (Ubuntu 24.04 has 18.x), which is why the default installer downloads its own. Only worth it if you also host an apt repository.
- **Flatpak / Snap** — sandboxing conflicts with mox's own `bwrap` sandbox and with reading the user's project folders. Extra work, worse UX; skip unless a store listing is the point.
- **Preloaded machine** — the realistic "sell it" path for non-technical buyers: a laptop or VM with Ollama, a model, and mox preinstalled. That's a hardware margin business, not a software one.

## Before every release

```bash
npm test                       # 64 tests: policy, tools, agent, self, tiny LM, app server, CLI e2e
./node_modules/.bin/tsc --noEmit
./scripts/build-release.sh --base-url https://yourdomain.com/downloads
```

Then, on a clean VM (not your dev box):

```bash
curl -fsSL https://yourdomain.com/downloads/install.sh | bash
mox doctor          # model server, sandbox, tools
mox app             # the window opens from the menu
```

And check the three things buyers actually hit first: no model running, an old
Node, and a locked-down user namespace (Mint 22). All three should produce a
sentence a human can act on, not a stack trace.
