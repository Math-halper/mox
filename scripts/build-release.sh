#!/usr/bin/env bash
#
# Build everything you need to hand mox to a customer.
#
#   ./scripts/build-release.sh
#   ./scripts/build-release.sh --base-url https://yourdomain.com/downloads
#
# Produces, in dist/:
#   mox-<version>.tar.gz   the product (application + installer)
#   mox-<version>.sha256   checksum, publish this next to it
#   install.sh             the one-liner installer, pointed at your tarball
#   RELEASE.md             the checklist for shipping it
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_URL="https://example.com/downloads"
VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) shift; BASE_URL="${1:?--base-url needs a URL}" ;;
    --version) shift; VERSION="${1:?--version needs a value}" ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo "0.0.0")"
fi
BASE_URL="${BASE_URL%/}"
NAME="mox-$VERSION"
DIST="$ROOT/dist"
STAGE="$ROOT/build/$NAME"

command -v tar >/dev/null || { echo "tar is required" >&2; exit 1; }

echo "==> typecheck + tests"
if [ -x "$ROOT/node_modules/.bin/tsc" ]; then
  "$ROOT/node_modules/.bin/tsc" --noEmit
else
  echo "  (skipping typecheck: npm install first)"
fi
if [ -x "$ROOT/node_modules/.bin/tsc" ]; then
  node --disable-warning=ExperimentalWarning --test test/*.test.ts >/dev/null
  echo "  tests passed"
fi

echo "==> staging $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE"
for item in src bin install.sh LICENSE README.md docs examples package.json; do
  [ -e "$ROOT/$item" ] || continue
  cp -R "$ROOT/$item" "$STAGE/"
done
chmod +x "$STAGE/install.sh" "$STAGE/bin/mox"

# Nothing generated or personal should ship.
find "$STAGE" -name ".DS_Store" -delete 2>/dev/null || true
find "$STAGE" -name "*.log" -delete 2>/dev/null || true
rm -rf "$STAGE/src/app/__pycache__" 2>/dev/null || true

echo "==> packing"
mkdir -p "$DIST"
rm -f "$DIST/$NAME.tar.gz" "$DIST/$NAME.sha256"
tar -czf "$DIST/$NAME.tar.gz" -C "$ROOT/build" "$NAME"
( cd "$DIST" && sha256sum "$NAME.tar.gz" > "$NAME.sha256" )

TARBALL_URL="$BASE_URL/$NAME.tar.gz"
SUMFILE_URL="$BASE_URL/$NAME.sha256"

echo "==> writing the customer installer"
sed -e "s|^SOURCE_URL_DEFAULT=.*|SOURCE_URL_DEFAULT=\"$TARBALL_URL\"|" \
    -e "s|^SUMFILE_URL_DEFAULT=.*|SUMFILE_URL_DEFAULT=\"$SUMFILE_URL\"|" \
    "$ROOT/install.sh" > "$DIST/install.sh"
chmod +x "$DIST/install.sh"
grep -q "$TARBALL_URL" "$DIST/install.sh" || { echo "installer patch failed" >&2; exit 1; }

cat > "$DIST/RELEASE.md" <<RELEASE
# mox $VERSION — release notes for the person shipping this

Built $(date -u +"%Y-%m-%dT%H:%M:%SZ") from $(git rev-parse --short HEAD 2>/dev/null || echo "unknown commit").

## Files to publish

| File | Purpose |
|---|---|
| \`$NAME.tar.gz\` | the whole product: app + installer |
| \`$NAME.sha256\` | checksum, publish alongside |
| \`install.sh\` | the one-liner, already pointed at the tarball |

Put them at the paths you passed with \`--base-url\` (currently \`$BASE_URL\`).

## What you tell the customer

\`\`\`bash
curl -fsSL $BASE_URL/install.sh | bash
\`\`\`

Then they open **mox** from the Mint application menu, or run \`mox app\`.

## Before you publish

- [ ] \`install.sh\` really downloads \`$TARBALL_URL\` — test the exact command from a clean VM.
- [ ] Checksum on the download page matches \`cat $NAME.sha256\`.
- [ ] Say out loud what the buyer must supply: a local model (Ollama + ~5 GB), and the RAM to run it.
- [ ] State your support policy and refunds in writing.
- [ ] Decide on a license for *your* distribution (the code is MIT — you may sell it; see LICENSING.md).
- [ ] If you sign releases: sign the tarball and publish the public key.

## Sanity run on a fresh machine

\`\`\`bash
tar -tzf $NAME.tar.gz | head
curl -fsSL $BASE_URL/install.sh | bash
mox --version
mox doctor
mox app
\`\`\`
RELEASE

echo
echo "==> done"
ls -la "$DIST"
echo
echo "Publish $DIST/$NAME.tar.gz, $DIST/$NAME.sha256 and $DIST/install.sh at $BASE_URL"
echo "Customers run:  curl -fsSL $BASE_URL/install.sh | bash"
