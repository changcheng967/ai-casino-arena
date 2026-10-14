#!/usr/bin/env bash
# Arena heartbeat — truly continuous play.
#
# Polls /api/tick every POLL_SECONDS. Each poll either:
#   - starts a ~25s work tick (if the DB lease is free), or
#   - no-ops instantly while a tick is already running.
# With a short poll interval the next tick starts within seconds of the
# previous one finishing → near-100% duty cycle, no pauses.
#
# Usage:
#   TICK_URL="https://your-app.vercel.app/api/tick?t=SECRET" ./scripts/heartbeat.sh
#
# Optional env:
#   POLL_SECONDS  (default 5) — how often to check whether a tick can start
#
# Run it forever on a VPS with systemd (see README) or in tmux/screen.

set -u
TICK_URL="${TICK_URL:?set TICK_URL=https://<app>.vercel.app/api/tick?t=<CRON_SECRET>}"
POLL_SECONDS="${POLL_SECONDS:-5}"

echo "[heartbeat] starting — poll every ${POLL_SECONDS}s"
fails=0
while true; do
  if out=$(curl -s -m 55 "$TICK_URL" 2>/dev/null); then
    fails=0
    # log only interesting results (skip lease no-ops to keep logs clean)
    case "$out" in
      *'"queued":true'*) ;;
      *'"ran":true'*) echo "[heartbeat] $(date -u +%H:%M:%S) tick: $out" ;;
      *) echo "[heartbeat] $(date -u +%H:%M:%S) $out" ;;
    esac
  else
    fails=$((fails + 1))
    echo "[heartbeat] $(date -u +%H:%M:%S) request failed (streak $fails)"
    # back off after repeated failures so a dead endpoint isn't hammered
    if [ "$fails" -ge 5 ]; then
      sleep 30
    fi
  fi
  sleep "$POLL_SECONDS"
done
