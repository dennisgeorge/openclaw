#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# install-local.sh — bootstrap + install OpenClaw from a locally built .tgz
#
# Does the same job as the official https://openclaw.ai/install.sh one-liner
# but installs from a local tarball instead of the npm registry.
#
# Usage (one-liner from the repo root, after building):
#
#   bash scripts/install-local.sh
#
# Or with flags:
#
#   bash scripts/install-local.sh --tgz ./openclaw-2026.2.15.tgz
#   bash scripts/install-local.sh --no-onboard --verbose
#   bash scripts/install-local.sh --skip-build          # skip pnpm build, just pack + install
#   bash scripts/install-local.sh --dry-run
#
# Environment variables (override flags):
#
#   OPENCLAW_LOCAL_TGZ=<path>     Path to an existing .tgz (skips build+pack)
#   OPENCLAW_NO_ONBOARD=1         Skip onboarding
#   OPENCLAW_DRY_RUN=1            Print actions only
#   OPENCLAW_VERBOSE=1            Enable debug output
#   SHARP_IGNORE_GLOBAL_LIBVIPS   Control sharp/libvips (default: 1)
# ---------------------------------------------------------------------------
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
DRY_RUN="${OPENCLAW_DRY_RUN:-0}"
VERBOSE="${OPENCLAW_VERBOSE:-0}"
NO_ONBOARD="${OPENCLAW_NO_ONBOARD:-0}"
SKIP_BUILD="${OPENCLAW_SKIP_BUILD:-0}"
TGZ_PATH="${OPENCLAW_LOCAL_TGZ:-}"
export SHARP_IGNORE_GLOBAL_LIBVIPS="${SHARP_IGNORE_GLOBAL_LIBVIPS:-1}"

# ── Parse flags ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tgz)        TGZ_PATH="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-onboard) NO_ONBOARD=1; shift ;;
    --onboard)    NO_ONBOARD=0; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --verbose)    VERBOSE=1; shift ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/install-local.sh [OPTIONS]

Bootstrap the local environment and install OpenClaw from a locally built
tarball. Mirrors the official install.sh but uses your local build.

Options:
  --tgz <path>    Use an existing .tgz (skip build + pack)
  --skip-build    Skip "pnpm build && pnpm ui:build"; only run npm pack
  --no-onboard    Skip onboarding after install
  --onboard       Run onboarding after install (default when TTY)
  --dry-run       Print what would happen without doing it
  --verbose       Enable debug output
  -h, --help      Show this help

Environment variables:
  OPENCLAW_LOCAL_TGZ        Path to existing .tgz
  OPENCLAW_NO_ONBOARD=1     Skip onboarding
  OPENCLAW_SKIP_BUILD=1     Skip build step
  OPENCLAW_DRY_RUN=1        Dry-run mode
  OPENCLAW_VERBOSE=1        Verbose mode
USAGE
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ "$VERBOSE" == "1" ]] && set -x

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
error() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '\033[0;36m[dry-run]\033[0m %s\n' "$*"
  else
    "$@"
  fi
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

# ── Locate repo root ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../package.json" && -f "$SCRIPT_DIR/../pnpm-workspace.yaml" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [[ -f "./package.json" && -f "./pnpm-workspace.yaml" ]]; then
  REPO_ROOT="$(pwd)"
else
  error "Could not find OpenClaw repo root. Run this script from the repo or from scripts/."
fi
info "Repo root: $REPO_ROOT"

# ── Step 1: Detect OS ────────────────────────────────────────────────────────
info "Detecting OS"
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      error "Unsupported OS: $OS. Use macOS, Linux, or WSL." ;;
esac
echo "  Platform: $PLATFORM"

# ── Step 2: Ensure Node.js 22+ ───────────────────────────────────────────────
info "Checking Node.js"
NEED_NODE=0
if command_exists node; then
  NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [[ "$NODE_MAJOR" -lt 22 ]]; then
    warn "Node $NODE_MAJOR found, but >=22 is required."
    NEED_NODE=1
  else
    echo "  Node $(node --version) — OK"
  fi
else
  warn "Node.js not found."
  NEED_NODE=1
fi

if [[ "$NEED_NODE" == "1" ]]; then
  info "Installing Node.js 22"
  if [[ "$PLATFORM" == "macos" ]]; then
    if ! command_exists brew; then
      info "Installing Homebrew first..."
      run /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    run brew install node@22
    # Homebrew keg-only: link it
    run brew link --overwrite node@22 2>/dev/null || true
  else
    # Linux — try NodeSource
    if command_exists apt-get; then
      info "Installing Node 22 via NodeSource (apt)"
      run curl -fsSL https://deb.nodesource.com/setup_22.x | run sudo -E bash -
      run sudo apt-get install -y nodejs
    elif command_exists dnf; then
      info "Installing Node 22 via NodeSource (dnf)"
      run curl -fsSL https://rpm.nodesource.com/setup_22.x | run sudo bash -
      run sudo dnf install -y nodejs
    elif command_exists yum; then
      info "Installing Node 22 via NodeSource (yum)"
      run curl -fsSL https://rpm.nodesource.com/setup_22.x | run sudo bash -
      run sudo yum install -y nodejs
    else
      error "No supported package manager found (apt/dnf/yum). Install Node 22+ manually."
    fi
  fi
fi

# ── Step 3: Ensure Git ───────────────────────────────────────────────────────
info "Checking Git"
if command_exists git; then
  echo "  git $(git --version | awk '{print $3}') — OK"
else
  warn "Git not found. Installing..."
  if [[ "$PLATFORM" == "macos" ]]; then
    run brew install git
  elif command_exists apt-get; then
    run sudo apt-get install -y git
  elif command_exists dnf; then
    run sudo dnf install -y git
  elif command_exists yum; then
    run sudo yum install -y git
  else
    error "Could not install git automatically. Install it manually."
  fi
fi

# ── Step 4: Ensure pnpm (needed for build) ───────────────────────────────────
if [[ -z "$TGZ_PATH" && "$SKIP_BUILD" != "1" ]]; then
  info "Checking pnpm"
  if command_exists pnpm; then
    echo "  pnpm $(pnpm --version) — OK"
  else
    info "Installing pnpm via corepack"
    run corepack enable
    run corepack prepare pnpm@latest --activate
  fi
fi

# ── Step 5: Build (unless --skip-build or --tgz provided) ────────────────────
if [[ -z "$TGZ_PATH" ]]; then
  cd "$REPO_ROOT"

  if [[ "$SKIP_BUILD" != "1" ]]; then
    info "Installing dependencies"
    run pnpm install

    info "Building OpenClaw"
    run pnpm build

    info "Building UI"
    run pnpm ui:build
  fi

  # ── Step 6: Pack ────────────────────────────────────────────────────────────
  info "Creating tarball (npm pack)"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] npm pack"
    TGZ_PATH="$REPO_ROOT/openclaw-0.0.0.tgz"
  else
    PACK_OUTPUT="$(npm pack --silent 2>/dev/null | tail -n 1 | tr -d '\r')"
    TGZ_PATH="$REPO_ROOT/$PACK_OUTPUT"
    if [[ ! -f "$TGZ_PATH" ]]; then
      error "npm pack did not produce a tarball (expected $TGZ_PATH)"
    fi
  fi
fi

# Resolve to absolute path
TGZ_PATH="$(cd "$(dirname "$TGZ_PATH")" && pwd)/$(basename "$TGZ_PATH")"
info "Tarball: $TGZ_PATH"

if [[ "$DRY_RUN" != "1" && ! -f "$TGZ_PATH" ]]; then
  error "Tarball not found: $TGZ_PATH"
fi

# ── Step 7: Fix npm prefix on Linux (avoid EACCES) ───────────────────────────
if [[ "$PLATFORM" == "linux" && "$(id -u)" -ne 0 ]]; then
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || echo "")"
  if [[ -n "$NPM_PREFIX" && ! -w "$NPM_PREFIX/lib" ]]; then
    info "npm global prefix ($NPM_PREFIX) is not writable; switching to ~/.npm-global"
    mkdir -p "$HOME/.npm-global"
    run npm config set prefix "$HOME/.npm-global"
    export PATH="$HOME/.npm-global/bin:$PATH"
    # Append to shell rc files if they exist
    for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
      if [[ -f "$rc" ]] && ! grep -q 'npm-global' "$rc" 2>/dev/null; then
        echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$rc"
      fi
    done
  fi
fi

# ── Step 8: Install globally from tarball ─────────────────────────────────────
info "Installing OpenClaw globally from tarball"
NPM_FLAGS=(install -g "$TGZ_PATH")
[[ "$VERBOSE" == "1" ]] && NPM_FLAGS+=(--loglevel verbose) || NPM_FLAGS+=(--loglevel error)
run npm "${NPM_FLAGS[@]}"

# ── Step 9: Verify ───────────────────────────────────────────────────────────
if [[ "$DRY_RUN" != "1" ]]; then
  info "Verifying installation"
  if ! command_exists openclaw; then
    warn "'openclaw' not found on PATH. You may need to open a new terminal."
    warn "Check: npm config get prefix"
  else
    INSTALLED_VERSION="$(openclaw --version 2>/dev/null | head -n 1 | tr -d '\r')"
    echo "  openclaw $INSTALLED_VERSION — installed"
  fi
fi

# ── Step 10: Post-install doctor ──────────────────────────────────────────────
if [[ "$DRY_RUN" != "1" ]] && command_exists openclaw; then
  info "Running openclaw doctor (non-interactive)"
  openclaw doctor --non-interactive || warn "doctor exited with warnings (non-fatal)"
fi

# ── Step 11: Onboarding ──────────────────────────────────────────────────────
if [[ "$NO_ONBOARD" != "1" && "$DRY_RUN" != "1" ]] && command_exists openclaw; then
  if [[ -t 0 && -t 1 ]]; then
    info "Starting onboarding wizard"
    openclaw onboard --install-daemon || warn "onboarding exited early (non-fatal)"
  else
    echo "  Skipping onboarding (no TTY). Run 'openclaw onboard' later."
  fi
else
  [[ "$NO_ONBOARD" == "1" ]] && echo "  Onboarding skipped (--no-onboard)."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
info "Done! OpenClaw installed from local build."
echo ""
echo "  Next steps:"
echo "    openclaw onboard --install-daemon   # if you skipped onboarding"
echo "    openclaw gateway --verbose           # start the gateway"
echo "    openclaw doctor                      # check your setup"
echo ""
