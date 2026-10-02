#!/usr/bin/env bash
# Rideau pre-live backup: tags both repos, dumps the database, downloads
# posters, records secret names, and writes checksums. See
# backup-rideau-pre-live.md for the full procedure this automates (points
# 1, 4 and 5). Run with --dry-run first.
set -euo pipefail

TAG="${TAG:-pre-live-2026-10-02}"
OUT_DIR="${OUT_DIR:-$PWD/backup-${TAG}}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

log()  { printf '%s\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
skip() { printf '  [skip] %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*" >&2; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }

: "${WEB_REPO:?Set WEB_REPO to the sds-ticketing-poc checkout path}"
: "${IOS_REPO:?Set IOS_REPO to the Inslapp checkout path}"

# ---------------------------------------------------------------------------
# 1. Repo preconditions + tagging
# ---------------------------------------------------------------------------
check_repo() {
  local name="$1" path="$2"
  log "== $name ($path) =="
  [[ -d "$path/.git" ]] || fail "$path is not a git repository"

  local branch
  branch=$(git -C "$path" rev-parse --abbrev-ref HEAD)
  [[ "$branch" == "main" ]] || fail "$name is on branch '$branch', expected 'main'"
  ok "on branch main"

  [[ -z "$(git -C "$path" status --porcelain)" ]] || fail "$name has uncommitted changes"
  ok "working tree clean"

  git -C "$path" fetch origin main --quiet
  local local_sha remote_sha
  local_sha=$(git -C "$path" rev-parse HEAD)
  remote_sha=$(git -C "$path" rev-parse origin/main)
  [[ "$local_sha" == "$remote_sha" ]] || fail "$name is not in sync with origin/main (local $local_sha, remote $remote_sha)"
  ok "in sync with origin/main"

  if git -C "$path" rev-parse "$TAG" >/dev/null 2>&1; then
    skip "tag $TAG already exists locally"
  elif (( DRY_RUN )); then
    skip "would create and push tag $TAG"
  else
    git -C "$path" tag -a "$TAG" -m "Rideau: komplett läge före skarp drift för Moon Movements"
    git -C "$path" push origin "$TAG"
    ok "tagged and pushed $TAG"
  fi

  if command -v gh >/dev/null 2>&1; then
    if (( DRY_RUN )); then
      skip "would create GitHub release for $TAG (gh available)"
    elif gh -R "$(git -C "$path" remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')" release view "$TAG" >/dev/null 2>&1; then
      skip "release $TAG already exists"
    else
      gh -R "$(git -C "$path" remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')" \
        release create "$TAG" --title "$TAG" --notes "Pre-live snapshot before Moon Movements goes live."
      ok "created GitHub release $TAG"
    fi
  else
    warn "gh not found — skipping GitHub release for $name"
  fi
}

check_repo "WEB_REPO" "$WEB_REPO"
check_repo "IOS_REPO" "$IOS_REPO"

if (( DRY_RUN )); then
  log "== dry run: remaining steps =="
else
  mkdir -p "$OUT_DIR"
fi

# ---------------------------------------------------------------------------
# 4. Database dump
# ---------------------------------------------------------------------------
log "== database dump =="
DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"
PG_DUMP_BIN="$(command -v pg_dump || true)"
[[ -z "$PG_DUMP_BIN" && -x /opt/homebrew/opt/libpq/bin/pg_dump ]] && PG_DUMP_BIN=/opt/homebrew/opt/libpq/bin/pg_dump

if [[ -z "$PG_DUMP_BIN" ]]; then
  warn "pg_dump not found (brew install libpq) — skipping database dump"
elif [[ -z "$DB_URL" ]]; then
  warn "SUPABASE_DB_URL/DATABASE_URL not set — skipping database dump"
elif (( DRY_RUN )); then
  skip "would run pg_dump (full + schema-only) with $PG_DUMP_BIN"
else
  "$PG_DUMP_BIN" "$DB_URL" --no-owner --no-privileges -f "$OUT_DIR/rideau-full-$(date +%F).sql"
  "$PG_DUMP_BIN" "$DB_URL" --schema-only --no-owner --no-privileges -f "$OUT_DIR/rideau-schema-$(date +%F).sql"
  ok "wrote full + schema dumps to $OUT_DIR"
fi

# ---------------------------------------------------------------------------
# 5. Storage — posters
# ---------------------------------------------------------------------------
log "== storage: posters =="
if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" ]]; then
  warn "SUPABASE_URL/SUPABASE_ANON_KEY not set — skipping posters download"
elif (( DRY_RUN )); then
  if curl -sf -o /dev/null -X POST "$SUPABASE_URL/storage/v1/object/list/posters" \
      -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" -d '{"limit":1,"prefix":""}'; then
    ok "posters bucket reachable (would download all files)"
  else
    warn "could not list posters bucket with given credentials"
  fi
else
  mkdir -p "$OUT_DIR/posters"
  poster_count=0
  # posters/<event-id>/<file>.png — list() returns folders (id:null) and
  # files (id set); recurse one level to reach the actual files.
  list_posters() {
    curl -sf -X POST "$SUPABASE_URL/storage/v1/object/list/posters" \
      -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" -d "{\"limit\":1000,\"prefix\":\"$1\"}"
  }
  for entry in $(list_posters "" | jq -r '.[].name'); do
    mkdir -p "$OUT_DIR/posters/$entry"
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      curl -sf "$SUPABASE_URL/storage/v1/object/posters/$entry/$file" \
        -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
        -o "$OUT_DIR/posters/$entry/$file"
      poster_count=$((poster_count + 1))
    done < <(list_posters "$entry/" | jq -r '.[].name')
  done
  ok "downloaded $poster_count poster file(s) to $OUT_DIR/posters"
fi

# ---------------------------------------------------------------------------
# Secret names (never values)
# ---------------------------------------------------------------------------
log "== secret names =="
if ! command -v supabase >/dev/null 2>&1; then
  warn "supabase CLI not found — skipping secrets list"
elif (( DRY_RUN )); then
  skip "would run 'supabase secrets list' and save names only"
else
  supabase secrets list | jq -r '.secrets[].name' > "$OUT_DIR/secret-names.txt" || warn "supabase secrets list failed (not linked?)"
  ok "wrote secret names to $OUT_DIR/secret-names.txt"
fi

# ---------------------------------------------------------------------------
# Checksums
# ---------------------------------------------------------------------------
if (( ! DRY_RUN )); then
  log "== checksums =="
  ( cd "$OUT_DIR" && find . -type f ! -name CHECKSUMS.txt -exec shasum -a 256 {} \; > CHECKSUMS.txt )
  ok "wrote $OUT_DIR/CHECKSUMS.txt"
fi

log ""
if (( DRY_RUN )); then
  log "Dry run complete. Re-run without --dry-run to perform the backup."
else
  log "Backup complete: $OUT_DIR"
  log "Reminder: do not commit $OUT_DIR to git — move dumps to encrypted storage (1Password / encrypted disk)."
fi
