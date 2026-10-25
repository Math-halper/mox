#!/usr/bin/env bash
#
# mox installer for Linux (tested against Linux Mint / Ubuntu 22.04–24.04).
#
#   ./install.sh                 interactive install into ~/.local
#   ./install.sh --yes           no prompts (for scripts)
#   ./install.sh --uninstall     remove the launcher and app copy
#
# Everything except the optional bubblewrap/Ollama packages is installed
# inside your home directory. No root, no system directories, no sudo.
#
set -euo pipefail

APP_NAME="mox"
# When run from a checkout, install that code. When piped (curl ... | bash),
# there is no checkout, so a source snapshot is downloaded instead.
SRC_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
CLEANUP_DIR=""
SOURCE_URL_DEFAULT="https://api.github.com/repos/Math-halper/mox/tarball"
PREFIX="${MOX_PREFIX:-$HOME/.local}"
APP_ROOT="$PREFIX/share/mox"
APP_DIR="$APP_ROOT/app"
NODE_DIR="$APP_ROOT/node"
BIN_DIR="$PREFIX/bin"
LAUNCHER="$BIN_DIR/mox"
REQUIRED_NODE_MAJOR=22
REQUIRED_NODE_MINOR=18

ASSUME_YES=0
WITH_NODE=1
WITH_SANDBOX=1
WITH_OLLAMA=0
UNINSTALL=0
QUIET=0

# ------------------------------------------------------------------ output

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

step()  { [ "$QUIET" = 1 ] || printf '\n%s==>%s %s%s%s\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
ok()    { [ "$QUIET" = 1 ] || printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
info()  { [ "$QUIET" = 1 ] || printf '  %s·%s %s\n' "$C_DIM" "$C_RESET" "$*"; }
warn()  { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()   { printf '\n%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# ------------------------------------------------------------------ helpers

have() { command -v "$1" >/dev/null 2>&1; }

fetch() {
  # fetch <url> — body to stdout
  if have curl; then curl -fsSL --max-time 300 "$1"
  elif have wget; then wget -q -O - "$1"
  else die "need curl or wget to download"
  fi
}

prompt_yes() {
  # prompt_yes "question" -> 0 yes, 1 no
  [ "$ASSUME_YES" = 1 ] && return 0
  [ -t 0 ] || return 1
  printf '  %s?%s %s %s[y/N]%s ' "$C_YELLOW" "$C_RESET" "$1" "$C_DIM" "$C_RESET" >&2
  local reply=""
  read -r reply || true
  case "${reply:-}" in y|Y|yes|YES) return 0;; *) return 1;; esac
}

prompt_confirm() {
  # Like prompt_yes, but a human must actually be there. Used before anything
  # that runs a remote install script, so `--yes` can never pull that trigger.
  [ -t 0 ] || return 1
  [ "$ASSUME_YES" = 1 ] && return 1
  prompt_yes "$1"
}

sudo_ready() {
  # Can we run sudo without hanging a non-interactive session?
  sudo -n true 2>/dev/null && return 0
  [ -t 0 ] && return 0
  return 1
}

usage() {
  cat <<EOF
${C_BOLD}mox installer${C_RESET}

Usage: ./install.sh [options]

Options:
  -y, --yes          assume yes for prompts (non-interactive)
  --prefix DIR       install under DIR (default: \$HOME/.local)
  --no-node          never download a private Node.js copy
  --no-sandbox       skip bubblewrap setup
  --with-ollama      install Ollama if no local model server is found
  --uninstall        remove the installed copy and launcher
  -q, --quiet        less output
  -h, --help         this text

Environment:
  MOX_PREFIX         same as --prefix
  MOX_SOURCE_URL     where to fetch mox from when not run inside a checkout
  NO_COLOR           disable colored output

Installs to:
  $BIN_DIR/mox            launcher
  $APP_DIR                application copy (self-contained)
  $NODE_DIR               private Node.js, only if your system one is too old
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -y|--yes) ASSUME_YES=1 ;;
      --prefix) shift; [ $# -gt 0 ] || die "--prefix needs a directory"; PREFIX="$1"
                APP_ROOT="$PREFIX/share/mox"; APP_DIR="$APP_ROOT/app"; NODE_DIR="$APP_ROOT/node"
                BIN_DIR="$PREFIX/bin"; LAUNCHER="$BIN_DIR/mox" ;;
      --no-node) WITH_NODE=0 ;;
      --no-sandbox) WITH_SANDBOX=0 ;;
      --with-ollama) WITH_OLLAMA=1 ;;
      --uninstall) UNINSTALL=1 ;;
      -q|--quiet) QUIET=1 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $1 (try --help)" ;;
    esac
    shift
  done
}

# ------------------------------------------------------------------ node

node_version() {
  have node || return 1
  node -v 2>/dev/null | sed 's/^v//'
}

version_ge() {
  # version_ge 22.18 22.18 -> 0
  local have_v="$1" want_major="$2" want_minor="$3"
  local major minor
  major="${have_v%%.*}"
  minor="$(printf '%s' "$have_v" | cut -d. -f2)"
  [ "$major" -gt "$want_major" ] && return 0
  [ "$major" -lt "$want_major" ] && return 1
  [ "${minor:-0}" -ge "$want_minor" ] && return 0
  return 1
}

system_node_ok() {
  local v
  v="$(node_version)" || return 1
  version_ge "$v" "$REQUIRED_NODE_MAJOR" "$REQUIRED_NODE_MINOR"
}

install_private_node() {
  have tar || die "tar is required"
  have xz || die "xz-utils is required (sudo apt install xz-utils)"

  local arch
  case "$(uname -m)" in
    x86_64|amd64) arch="linux-x64" ;;
    aarch64|arm64) arch="linux-arm64" ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac

  info "looking up the current Node.js 22.x release…"
  local sums file sum url
  sums="$(fetch https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt)" \
    || die "could not reach nodejs.org to download Node.js"
  file="$(printf '%s\n' "$sums" | grep -E "node-v[0-9.]+-${arch}\.tar\.xz$" | head -n1 | awk '{print $2}')"
  sum="$(printf '%s\n' "$sums" | grep -E "node-v[0-9.]+-${arch}\.tar\.xz$" | head -n1 | awk '{print $1}')"
  [ -n "$file" ] && [ -n "$sum" ] || die "could not find a Node.js $REQUIRED_NODE_MAJOR.x build for $arch"

  url="https://nodejs.org/dist/latest-v22.x/$file"
  local tmp
  tmp="$(mktemp -d)"

  info "downloading $file (~30 MB)…"
  if have curl; then curl -fsSL --max-time 900 -o "$tmp/$file" "$url"
  else wget -q -O "$tmp/$file" "$url"; fi || die "download failed"

  info "verifying checksum…"
  printf '%s  %s\n' "$sum" "$tmp/$file" | sha256sum -c - >/dev/null 2>&1 \
    || die "checksum mismatch — refusing to install a corrupted Node.js"

  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
  ok "installed private Node.js $("$NODE_DIR/bin/node" -v) at $NODE_DIR"
}

setup_node() {
  step "Node.js"
  if system_node_ok; then
    ok "system Node.js v$(node_version) is new enough (need ≥ $REQUIRED_NODE_MAJOR.$REQUIRED_NODE_MINOR)"
    return 0
  fi

  local found="not installed"
  if have node; then found="v$(node_version) is too old"; fi
  info "system Node.js: $found"

  if [ "$WITH_NODE" != 1 ]; then
    die "mox needs Node.js ≥ $REQUIRED_NODE_MAJOR.$REQUIRED_NODE_MINOR. Install it and re-run (or drop --no-node)."
  fi
  info "installing a private copy — your system Node.js is left untouched"
  install_private_node
}

# ------------------------------------------------------------------ app

resolve_source() {
  if [ -n "$SRC_DIR" ] && [ -f "$SRC_DIR/src/cli.ts" ]; then
    return 0
  fi
  step "Fetching mox"
  local url="${MOX_SOURCE_URL:-$SOURCE_URL_DEFAULT}"
  local tmp
  tmp="$(mktemp -d)"
  CLEANUP_DIR="$tmp"
  have tar || die "tar is required"

  info "downloading from $url"
  if have curl; then
    curl -fsSL --max-time 300 -o "$tmp/mox.tar.gz" "$url" || die "could not download mox from $url"
  elif have wget; then
    wget -q --timeout=300 -O "$tmp/mox.tar.gz" "$url" || die "could not download mox from $url"
  else
    die "need curl or wget to download mox"
  fi

  mkdir -p "$tmp/src-tree"
  tar -xzf "$tmp/mox.tar.gz" -C "$tmp/src-tree" --strip-components=1 \
    || die "downloaded archive could not be unpacked"
  if [ ! -f "$tmp/src-tree/src/cli.ts" ]; then
    warn "the archive at $url does not contain the mox application"
    printf '  %sEither run the installer from a git checkout:%s\n' "$C_DIM" "$C_RESET" >&2
    printf '    git clone https://github.com/Math-halper/mox && cd mox && ./install.sh\n' >&2
    printf '  %sor point it at a tarball that contains src/cli.ts:%s\n' "$C_DIM" "$C_RESET" >&2
    printf '    MOX_SOURCE_URL=<url> bash install.sh\n' >&2
    die "no mox source found"
  fi
  SRC_DIR="$tmp/src-tree"
  ok "source ready"
}

copy_app() {
  step "Installing mox"
  [ -f "$SRC_DIR/src/cli.ts" ] || die "mox source not found (pass MOX_SOURCE_URL or run from a checkout)"

  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  cp -R "$SRC_DIR/src" "$APP_DIR/src"
  cp -R "$SRC_DIR/bin" "$APP_DIR/bin"
  cp "$SRC_DIR/package.json" "$APP_DIR/package.json"
  [ -f "$SRC_DIR/LICENSE" ] && cp "$SRC_DIR/LICENSE" "$APP_DIR/LICENSE"
  [ -f "$SRC_DIR/README.md" ] && cp "$SRC_DIR/README.md" "$APP_DIR/README.md"
  [ -d "$SRC_DIR/docs" ] && cp -R "$SRC_DIR/docs" "$APP_DIR/docs"
  chmod +x "$APP_DIR/bin/mox"
  # The app has zero runtime dependencies, so there is nothing to npm install.
  ok "application copied to $APP_DIR"
}

write_launcher() {
  step "Launcher"
  mkdir -p "$BIN_DIR"
  cat > "$LAUNCHER" <<EOF
#!/bin/sh
# Generated by mox install.sh — re-run the installer to update.
APP="$APP_DIR"
PRIVATE_NODE="$NODE_DIR/bin"
if [ -x "\$PRIVATE_NODE/node" ]; then
  PATH="\$PRIVATE_NODE:\$PATH"
  export PATH
fi
if ! command -v node >/dev/null 2>&1; then
  echo "mox: node not found on PATH. Re-run the mox installer." >&2
  exit 127
fi
exec node --disable-warning=ExperimentalWarning "\$APP/src/cli.ts" "\$@"
EOF
  chmod +x "$LAUNCHER"
  ok "wrote $LAUNCHER"

  if [ -x "$LAUNCHER" ]; then
    local v
    v="$("$LAUNCHER" --version 2>/dev/null || echo "")"
    if [ -n "$v" ]; then ok "launcher works (mox $v)"
    else warn "launcher did not run cleanly — try: $LAUNCHER doctor"; fi
  fi
}

setup_path() {
  step "PATH"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ok "$BIN_DIR is already on PATH"; return 0 ;;
  esac
  warn "$BIN_DIR is not on PATH in this shell"

  case "$BIN_DIR" in
    "$HOME"/*) ;;
    *) info "$BIN_DIR is outside \$HOME — add it to PATH yourself"; return 0 ;;
  esac

  local profile="$HOME/.profile"
  local marker="# mox: user binaries"
  if [ -f "$profile" ] && grep -qF "$marker" "$profile"; then
    ok "PATH entry already present in $profile"
  else
    {
      printf '\n%s\n' "$marker"
      printf 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac\n'
      printf 'export PATH\n'
    } >> "$profile"
    ok "added $BIN_DIR to PATH in $profile"
  fi
  info "open a new terminal (or run: . \"$profile\") to use 'mox' everywhere"
}

# ------------------------------------------------------------------ sandbox

bwrap_works() {
  have bwrap || return 1
  bwrap --ro-bind / / --dev /dev --proc /proc --die-with-parent -- true >/dev/null 2>&1
}

userns_blocked() {
  local restrict clone
  restrict="$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)"
  clone="$(sysctl -n kernel.unprivileged_userns_clone 2>/dev/null || echo 1)"
  [ "$restrict" = "1" ] || [ "$clone" = "0" ]
}

fix_userns() {
  warn "your kernel blocks unprivileged user namespaces, which bubblewrap needs"
  info "Ubuntu 24.04 / Linux Mint 22 restrict them via AppArmor; without this,"
  info "mox falls back to policy-only approvals with no filesystem confinement."
  printf '\n  The fix writes /etc/sysctl.d/60-mox-userns.conf and reloads sysctl.\n'
  printf '  Trade-off: unprivileged user namespaces are what the restriction limits,\n'
  printf '  so this slightly widens local attack surface. Remove the file to revert.\n\n'

  if ! prompt_yes "Apply the sysctl fix now (needs sudo)?"; then
    warn "skipping — mox will run without the OS sandbox until this is fixed"
    return 0
  fi

  local restrict clone tmp
  restrict="$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)"
  clone="$(sysctl -n kernel.unprivileged_userns_clone 2>/dev/null || echo 1)"
  tmp="$(mktemp)"
  {
    printf '# written by the mox installer: lets bubblewrap sandbox unprivileged processes\n'
    [ "$restrict" = "1" ] && printf 'kernel.apparmor_restrict_unprivileged_userns=0\n'
    [ "$clone" = "0" ] && printf 'kernel.unprivileged_userns_clone=1\n'
  } > "$tmp"
  if sudo_ready; then
    sudo install -m 0644 "$tmp" /etc/sysctl.d/60-mox-userns.conf && sudo sysctl --system >/dev/null 2>&1 || true
  else
    warn "no terminal for a sudo prompt; run this yourself:"
    printf '    sudo cp %s /etc/sysctl.d/60-mox-userns.conf && sudo sysctl --system\n' "$tmp"
  fi
  rm -f "$tmp"

  if bwrap_works; then ok "bubblewrap works now"; else warn "still blocked — a reboot may be needed"; fi
}

setup_sandbox() {
  step "Sandbox (bubblewrap)"
  if [ "$WITH_SANDBOX" != 1 ]; then
    info "skipped (--no-sandbox)"
    return 0
  fi
  if bwrap_works; then
    ok "bubblewrap is installed and working"
    return 0
  fi

  if ! have bwrap; then
    if have apt-get; then
      if ! sudo_ready; then
        warn "need sudo to install bubblewrap, but no terminal is available"
        info "run this yourself: sudo apt install bubblewrap"
        return 0
      fi
      if prompt_yes "Install bubblewrap with apt (needs sudo)?"; then
        sudo apt-get update -qq || warn "apt update failed, trying install anyway"
        if sudo apt-get install -y bubblewrap; then ok "installed bubblewrap"
        else warn "apt install failed — mox will run without the OS sandbox"; return 0; fi
      else
        warn "skipped — install it later with: sudo apt install bubblewrap"
        return 0
      fi
    else
      warn "no apt-get found — install bubblewrap with your package manager"
      return 0
    fi
  fi

  if bwrap_works; then
    ok "bubblewrap works"
  elif userns_blocked; then
    fix_userns
  else
    warn "bubblewrap is installed but cannot create a sandbox on this kernel"
    info "mox will still run; policy-only approvals remain in force"
  fi
}

# ------------------------------------------------------------------ model

model_server_up() {
  # model_server_up <url>
  if have curl; then curl -fsS --max-time 2 "$1" >/dev/null 2>&1
  else wget -q --timeout=2 -O /dev/null "$1" >/dev/null 2>&1
  fi
}

any_server_up() {
  model_server_up "http://127.0.0.1:11434/api/tags" && { echo ollama; return 0; }
  model_server_up "http://127.0.0.1:1234/v1/models" && { echo lmstudio; return 0; }
  model_server_up "http://127.0.0.1:8080/v1/models" && { echo llamacpp; return 0; }
  return 1
}

setup_model() {
  step "Local model server"
  local found
  if found="$(any_server_up)"; then
    case "$found" in
      ollama) ok "Ollama is running on http://127.0.0.1:11434" ;;
      lmstudio) ok "LM Studio is running on http://127.0.0.1:1234" ;;
      llamacpp) ok "llama.cpp is running on http://127.0.0.1:8080" ;;
    esac
    if [ "$found" = ollama ] && have ollama; then
      local models
      models="$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' | head -n 5)"
      if [ -z "$models" ]; then
        warn "Ollama is running but has no models yet"
        if prompt_confirm "Download qwen3:8b now? (~5 GB, one time)"; then
          ollama pull qwen3:8b && ok "qwen3:8b ready" || warn "pull failed — run: ollama pull qwen3:8b"
        else
          info "get one later with: ollama pull qwen3:8b"
        fi
      else
        info "available models: $(echo "$models" | tr '\n' ' ')"
        info "pick one with: mox --model ${models%%$'\n'*} \"your task\""
      fi
    fi
    return 0
  fi

  if have ollama; then
    warn "Ollama is installed but not responding"
    info "start it with: ollama serve   (or: sudo systemctl start ollama)"
    info "then: ollama pull qwen3:8b"
    return 0
  fi

  warn "no local model server found on 11434, 1234, or 8080"
  info "mox needs one: it is the 'brain'. Nothing works without it."
  info "easiest: Ollama. Recommended model for most machines: qwen3:8b (~5 GB)."

  if [ "$WITH_OLLAMA" = 1 ]; then
    install_ollama
  elif prompt_confirm "Install Ollama now with its official installer (ollama.com/install.sh, needs sudo)?"; then
    install_ollama
  else
    info "install it yourself later:"
    info "  curl -fsSL https://ollama.com/install.sh | sh"
    info "  ollama pull qwen3:8b"
  fi
}

install_ollama() {
  info "running the official Ollama installer…"
  if have curl; then
    if curl -fsSL https://ollama.com/install.sh | sh; then
      ok "Ollama installed"
      if prompt_confirm "Download qwen3:8b now? (~5 GB, one time)"; then
        ollama pull qwen3:8b && ok "qwen3:8b ready" || warn "pull failed — run: ollama pull qwen3:8b"
      else
        info "download a model with: ollama pull qwen3:8b"
      fi
    else
      warn "Ollama install failed — see https://ollama.com/download"
    fi
  else
    warn "curl not found; install Ollama from https://ollama.com/download"
  fi
}

# ------------------------------------------------------------------ finish

finish() {
  step "Done"
  if [ -x "$LAUNCHER" ]; then
    printf '\n  %stry it:%s\n' "$C_BOLD" "$C_RESET"
    printf '    cd ~/some/project\n'
    printf '    mox init                    %s# optional per-project config%s\n' "$C_DIM" "$C_RESET"
    printf '    mox doctor                  %s# check model, sandbox, tools%s\n' "$C_DIM" "$C_RESET"
    printf '    mox "explain this repo"     %s# first real task%s\n' "$C_DIM" "$C_RESET"
    printf '    mox chat                    %s# interactive%s\n' "$C_DIM" "$C_RESET"
    printf '\n  %srun logs:%s <project>/.mox/runs   %sbrowse:%s mox runs\n' "$C_BOLD" "$C_RESET" "$C_BOLD" "$C_RESET"
  fi
  printf '\n'
}

uninstall() {
  step "Uninstalling mox"
  if [ -e "$LAUNCHER" ]; then rm -f "$LAUNCHER"; ok "removed $LAUNCHER"; else info "no launcher at $LAUNCHER"; fi
  if [ -d "$APP_ROOT" ]; then rm -rf "$APP_ROOT"; ok "removed $APP_ROOT"; else info "no app dir at $APP_ROOT"; fi
  info "left alone: bubblewrap (system package), Ollama, and any .mox/ folders in your projects"
  printf '\n'
  exit 0
}

# ------------------------------------------------------------------ main

cleanup() { [ -n "$CLEANUP_DIR" ] && rm -rf "$CLEANUP_DIR"; }

main() {
  parse_args "$@"

  if [ "$UNINSTALL" = 1 ]; then uninstall; fi

  [ "$(uname -s)" = "Linux" ] || [ "$(uname -s)" = "Darwin" ] || die "this installer supports Linux and macOS"

  printf '\n%s%smox installer%s  %sinstalling to %s%s\n' \
    "$C_BOLD" "$C_BLUE" "$C_RESET" "$C_DIM" "$PREFIX" "$C_RESET"

  setup_node
  resolve_source
  copy_app
  write_launcher
  setup_path
  setup_sandbox
  setup_model
  finish

  if [ -x "$LAUNCHER" ]; then
    # A final real check, but never fail the install because of it.
    "$LAUNCHER" doctor 2>&1 | sed 's/^/  /' || true
  fi
  cleanup
}

main "$@"
