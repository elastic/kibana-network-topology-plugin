#!/usr/bin/env bash
# One-shot setup for a Kibana + network-topology plugin development environment.
#
# What it does:
#   1. Clones Kibana at v8.19.12 (skipped if already present).
#   2. Clones this plugin into <kibana>/plugins/networkTopology (skipped if present).
#   3. Runs `yarn kbn bootstrap` (with the Node version pinned by Kibana's .nvmrc).
#   4. Writes a multi-root code workspace file (.code-workspace) at the parent directory.
#      The format is understood by VSCode, Cursor, and other VSCode-compatible editors.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/elastic/kibana-network-topology-plugin/main/scripts/bootstrap.sh | bash
#   curl -fsSL <url>/bootstrap.sh | bash -s -- --no-workspace
#   curl -fsSL <url>/bootstrap.sh | bash -s -- --dir ~/dev/network-topology
#
# Or run locally after downloading:
#   bash bootstrap.sh [flags]
#
# Flags:
#   --dir <path>      Parent directory for the setup. Default: current working dir.
#   --kibana <path>   Reuse an existing Kibana checkout instead of cloning.
#   --no-bootstrap    Skip `yarn kbn bootstrap`.
#   --no-workspace    Skip writing the code workspace file.
#   -h, --help        Show this help.

set -euo pipefail

# Reset bash's built-in elapsed-time counter so we can report total runtime at the end.
SECONDS=0

KIBANA_VERSION_TAG="v8.19.12"
KIBANA_REPO_URL="https://github.com/elastic/kibana.git"
PLUGIN_ID="networkTopology"
PLUGIN_REPO_URL="https://github.com/elastic/kibana-network-topology-plugin.git"
WORKSPACE_FILE_NAME="network-topology.code-workspace"

usage() {
  cat <<EOF
One-shot setup for a Kibana + ${PLUGIN_ID} plugin development environment.

Usage:
  bootstrap.sh [--dir <path>] [--kibana <path>] [--no-bootstrap] [--no-workspace]

Via curl:
  curl -fsSL <url>/bootstrap.sh | bash
  curl -fsSL <url>/bootstrap.sh | bash -s -- --no-workspace

Flags:
  --dir <path>      Parent directory for the setup. Default: current working dir.
  --kibana <path>   Reuse an existing Kibana checkout instead of cloning a fresh one.
  --no-bootstrap    Skip 'yarn kbn bootstrap'.
  --no-workspace    Skip writing the code workspace file (.code-workspace).
  -h, --help        Show this help.
EOF
  exit "${1:-0}"
}

err()  { printf 'error: %s\n' "$*" >&2; }
warn() { printf 'warning: %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "required command not found: $1"
    exit 1
  fi
}

# Clone with retries for transient network failures and friendlier auth errors.
# Usage: clone_repo <url> <dest> [extra git clone args...]
clone_repo() {
  local url="$1" dest="$2"
  shift 2
  local log rc attempt
  local max_attempts=3
  log=$(mktemp -t bootstrap-clone.XXXXXX)
  trap 'rm -f "$log"' RETURN

  for attempt in $(seq 1 "$max_attempts"); do
    if [ "$attempt" -gt 1 ]; then
      info "Retrying clone (attempt $attempt of $max_attempts) after a brief pause..."
      sleep $((attempt * 3))
    fi

    # Clean any partial dir from a previous failed attempt before retrying.
    [ -e "$dest" ] && rm -rf "$dest"

    set +e
    git clone "$@" "$url" "$dest" 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    set -e

    [ "$rc" -eq 0 ] && return 0

    # Auth failure: don't retry, show guidance.
    if grep -qiE 'authentication failed|could not read username|permission denied \(publickey\)|requested url returned error: 40[13]' "$log"; then
      err ""
      err "Cloning $url failed due to a credentials issue."
      err ""
      err "If the repo is private, set up GitHub auth first. Easiest path:"
      err "  gh auth login                    # then re-run this script"
      err ""
      err "Alternative: configure git credentials manually"
      err "  - HTTPS: https://docs.github.com/en/get-started/getting-started-with-git/caching-your-github-credentials-in-git"
      err "  - SSH:   https://docs.github.com/en/authentication/connecting-to-github-with-ssh"
      return "$rc"
    fi

    # Transient network failure: retry.
    if grep -qiE 'rpc failed|early eof|unexpected disconnect|operation timed out|connection reset|could not resolve host|transferred a partial file|the remote end hung up' "$log"; then
      warn "Clone failed with what looks like a transient network error."
      continue
    fi

    # Unknown failure: don't retry.
    return "$rc"
  done

  err ""
  err "Clone failed after $max_attempts attempts. If your network is flaky, try a shallow clone manually:"
  err "  git clone --depth 1 $* $url $dest"
  return "$rc"
}

# Resolve to absolute physical path. Works for paths that don't yet exist.
resolve_path() {
  local p="$1"
  if [ -d "$p" ]; then
    (cd "$p" && pwd -P)
  else
    local parent base
    parent=$(dirname "$p")
    base=$(basename "$p")
    mkdir -p "$parent"
    printf '%s/%s\n' "$(cd "$parent" && pwd -P)" "$base"
  fi
}

# Parse args.
DIR=""
KIBANA_PATH_ARG=""
DO_BOOTSTRAP=1
DO_WORKSPACE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)           DIR="${2:-}"; shift 2 ;;
    --dir=*)         DIR="${1#*=}"; shift ;;
    --kibana)        KIBANA_PATH_ARG="${2:-}"; shift 2 ;;
    --kibana=*)      KIBANA_PATH_ARG="${1#*=}"; shift ;;
    --no-bootstrap)  DO_BOOTSTRAP=0; shift ;;
    --no-workspace)  DO_WORKSPACE=0; shift ;;
    -h|--help)       usage 0 ;;
    *)               err "unknown flag: $1"; usage 1 ;;
  esac
done

require_cmd git

# Resolve Kibana path and parent directory.
if [ -n "$KIBANA_PATH_ARG" ]; then
  if [ -n "$DIR" ]; then
    warn "--dir is ignored when --kibana is provided (DIR is forced to the parent of the Kibana path)."
  fi
  KIBANA_PATH=$(resolve_path "$KIBANA_PATH_ARG")
  DIR=$(dirname "$KIBANA_PATH")
else
  if [ -z "$DIR" ]; then
    DIR=$(pwd -P)
  fi
  DIR=$(resolve_path "$DIR")
  KIBANA_PATH="$DIR/kibana"
fi

PLUGIN_PATH="$KIBANA_PATH/plugins/$PLUGIN_ID"
WORKSPACE_PATH="$DIR/$WORKSPACE_FILE_NAME"

info "Setup directory : $DIR"
info "Kibana path     : $KIBANA_PATH"
info "Plugin path     : $PLUGIN_PATH"
echo

# Step 1: Kibana checkout.
if [ -d "$KIBANA_PATH" ]; then
  if ! grep -q '"name": "kibana"' "$KIBANA_PATH/package.json" 2>/dev/null; then
    err "$KIBANA_PATH exists but does not look like a Kibana checkout."
    exit 1
  fi
  info "Kibana checkout already exists — skipping clone."
  if [ -d "$KIBANA_PATH/.git" ]; then
    CURRENT_REF=$(git -C "$KIBANA_PATH" describe --tags --always 2>/dev/null || echo "unknown")
    case "$CURRENT_REF" in
      "$KIBANA_VERSION_TAG"*) ;;
      *) warn "Kibana is at '$CURRENT_REF', target is '$KIBANA_VERSION_TAG'. Continuing." ;;
    esac
  fi
else
  info "Cloning Kibana into $KIBANA_PATH (partial clone at $KIBANA_VERSION_TAG)..."
  # --filter=blob:none avoids downloading every blob in history upfront (multi-GB
  # without it). Missing blobs are fetched on demand. --branch <tag> lands HEAD
  # on the version we want without a separate checkout.
  clone_repo "$KIBANA_REPO_URL" "$KIBANA_PATH" --filter=blob:none --branch "$KIBANA_VERSION_TAG"
fi

# Step 2: Plugin checkout.
if [ -d "$PLUGIN_PATH" ]; then
  if [ -d "$PLUGIN_PATH/.git" ] || [ -f "$PLUGIN_PATH/.git" ]; then
    info "Plugin checkout already exists — skipping clone."
  else
    err "$PLUGIN_PATH exists but is not a git repo. Remove it manually and re-run."
    exit 1
  fi
else
  mkdir -p "$KIBANA_PATH/plugins"
  info "Cloning plugin into $PLUGIN_PATH..."
  clone_repo "$PLUGIN_REPO_URL" "$PLUGIN_PATH"
fi

# Step 3: Bootstrap Kibana.
if [ "$DO_BOOTSTRAP" -eq 1 ]; then
  info "Running 'yarn kbn bootstrap' in $KIBANA_PATH..."
  # Align Node version with Kibana's .nvmrc — bootstrap fails on a mismatch.
  # nvm is a shell function, so source it before use; subshell keeps PATH changes local.
  (
    # nvm refuses to run if PREFIX is set (e.g. by Homebrew shellenv).
    unset PREFIX
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      # shellcheck disable=SC1091
      . "$NVM_DIR/nvm.sh"
    elif command -v brew >/dev/null 2>&1 && [ -s "$(brew --prefix nvm 2>/dev/null)/nvm.sh" ]; then
      # shellcheck disable=SC1091
      . "$(brew --prefix nvm)/nvm.sh"
    else
      err "nvm not found. Install nvm (https://github.com/nvm-sh/nvm) or run 'yarn kbn bootstrap' manually."
      exit 1
    fi
    cd "$KIBANA_PATH"
    nvm use
    yarn kbn bootstrap
  )
else
  info "Skipping 'yarn kbn bootstrap' (--no-bootstrap)."
fi

# Step 4: code workspace file (.code-workspace) — works with VSCode, Cursor, etc.
if [ "$DO_WORKSPACE" -eq 1 ]; then
  if [ -e "$WORKSPACE_PATH" ]; then
    info "Workspace file already exists at $WORKSPACE_PATH — leaving it alone."
  else
    KIBANA_REL="${KIBANA_PATH#"$DIR"/}"
    PLUGIN_REL="$KIBANA_REL/plugins/$PLUGIN_ID"
    cat > "$WORKSPACE_PATH" <<EOF
{
  "folders": [
    { "name": "Kibana", "path": "$KIBANA_REL" },
    { "name": "Plugin (network-topology)", "path": "$PLUGIN_REL" }
  ]
}
EOF
    info "Wrote workspace file: $WORKSPACE_PATH"
  fi
else
  info "Skipping workspace file (--no-workspace)."
fi

# Format total runtime as "Xm Ys" or "Ys" if under a minute.
if [ "$SECONDS" -lt 60 ]; then
  ELAPSED="${SECONDS}s"
else
  ELAPSED="$((SECONDS / 60))m $((SECONDS % 60))s"
fi

cat <<EOF

Done in $ELAPSED.

Open the workspace in your editor (VSCode, Cursor, ...):
  code "$WORKSPACE_PATH"     # or: cursor "$WORKSPACE_PATH"

EOF
