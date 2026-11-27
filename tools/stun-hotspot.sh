#!/usr/bin/env bash
# Share the current WiFi uplink as an AP that blocks the STUN ports used by
# Chaikadi, so a phone can exercise the join-screen connection diagnosis.
set -euo pipefail

SSID=${STUN_HOTSPOT_SSID:-ChaiNoStun}
PASS=${STUN_HOTSPOT_PASS:-testpass123}
AP_IFACE=ap0
PIDFILE=/tmp/opencode/stun-hotspot.pid
LOGFILE=/tmp/opencode/stun-hotspot.log
STATEFILE=/tmp/opencode/stun-hotspot.uplink

usage() {
  cat >&2 <<EOF
Usage: stun-hotspot {start|status|stop}

start   Share the current WiFi as "${SSID}" on the same channel, isolate
        clients, and drop UDP 3478/19302 from the AP to the uplink.
status  Show the running AP, its address, and the latest log lines.
stop    Remove the firewall rules and stop the AP.

Overrides: STUN_HOTSPOT_SSID, STUN_HOTSPOT_PASS
EOF
}

need() { command -v "$1" >/dev/null || { echo "missing command: $1" >&2; exit 1; }; }
for tool in ip iw iptables create_ap; do need "$tool"; done

command_name=${1:-status}
[[ $# -le 1 ]] || { usage; exit 2; }
case "$command_name" in
  start|stop|status) ;;
  -h|--help|help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

# Only start/stop need root; status is safe to run as the normal dev user.
if [[ "$command_name" != status && ${EUID:-$(id -u)} -ne 0 ]]; then
  sudo -v
  exec sudo env PATH="$PATH" "$0" "$@"
fi

uplink() {
  local dev
  dev=$(ip -o -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)
  if [[ -z "$dev" || ! -d "/sys/class/net/$dev/phy80211" ]]; then
    echo 'no wireless uplink found; connect this machine to WiFi first' >&2
    return 1
  fi
  printf '%s\n' "$dev"
}

frequency() {
  iw dev "$1" link 2>/dev/null | awk '/^[[:space:]]*freq:/ {print $2; exit}'
}

channel_for() {
  local freq
  freq=$(printf '%.0f' "$1")
  if (( freq >= 5950 )); then echo $(( (freq - 5950) / 5 ));
  elif (( freq >= 5000 )); then echo $(( (freq - 5000) / 5 ));
  else echo $(( (freq - 2407) / 5 )); fi
}

band_for() {
  local freq
  freq=$(printf '%.0f' "$1")
  if (( freq >= 5000 )); then echo 5; else echo 2.4; fi
}

add_rule() {
  iptables -C FORWARD -i "$AP_IFACE" -o "$1" -p udp --dport "$2" -j DROP 2>/dev/null || \
    iptables -I FORWARD -i "$AP_IFACE" -o "$1" -p udp --dport "$2" -j DROP
}

del_rule() {
  while iptables -C FORWARD -i "$AP_IFACE" -o "$1" -p udp --dport "$2" -j DROP 2>/dev/null; do
    iptables -D FORWARD -i "$AP_IFACE" -o "$1" -p udp --dport "$2" -j DROP
  done
}

start() {
  local dev freq channel band
  dev=$(uplink)
  freq=$(frequency "$dev")
  [[ -n "$freq" ]] || { echo "$dev is not associated; connect it to WiFi first" >&2; exit 1; }
  channel=$(channel_for "$freq")
  band=$(band_for "$freq")

  if ip link show "$AP_IFACE" >/dev/null 2>&1; then
    echo "$AP_IFACE already exists; run 'stun-hotspot stop' first" >&2
    exit 1
  fi

  mkdir -p /tmp/opencode
  printf '%s\n' "$dev" >"$STATEFILE"
  create_ap -c "$channel" --freq-band "$band" --isolate-clients --daemon \
    --pidfile "$PIDFILE" --logfile "$LOGFILE" --fix-unmanaged \
    "$dev" "$dev" "$SSID" "$PASS"

  local ready=0
  for _ in {1..50}; do
    if ip link show "$AP_IFACE" >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.1
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "AP did not start; see $LOGFILE" >&2
    exit 1
  fi

  # Inserted after create_ap, so these DROP rules sit above its ACCEPT rules.
  add_rule "$dev" 3478
  add_rule "$dev" 19302

  cat <<EOF
AP "${SSID}" is up on channel ${channel} via ${dev} (${AP_IFACE}).
STUN UDP 3478 and 19302 are blocked from ${AP_IFACE} to ${dev}.

On the phone:
  1. Join ${SSID} (password: ${PASS}).
  2. Settings -> Developer options -> Run self-test.
  3. Join a room; the failure banner should explain the STUN problem.

Logs: ${LOGFILE}
Stop with: stun-hotspot stop
EOF
}

stop() {
  local dev
  if [[ -f "$STATEFILE" ]]; then dev=$(<"$STATEFILE"); else dev=$(uplink || true); fi
  if [[ -n "$dev" ]]; then
    del_rule "$dev" 3478
    del_rule "$dev" 19302
  fi
  if ip link show "$AP_IFACE" >/dev/null 2>&1 || [[ -f "$PIDFILE" ]]; then
    create_ap --stop "$AP_IFACE" || true
  fi
  rm -f "$STATEFILE" "$PIDFILE"
  echo 'STUN-blocking AP stopped.'
}

status() {
  echo '--- stun-hotspot ---'
  if [[ -f "$PIDFILE" ]]; then echo "pid: $(<"$PIDFILE")"; else echo 'not running'; fi
  if [[ -f "$STATEFILE" ]]; then echo "uplink: $(<"$STATEFILE")"; fi
  echo "--- ${AP_IFACE} ---"
  ip -br address show dev "$AP_IFACE" 2>/dev/null || echo 'not up'
  if [[ -f "$LOGFILE" ]]; then
    echo "--- ${LOGFILE} (last 20) ---"
    tail -n 20 "$LOGFILE"
  fi
}

"$command_name"
