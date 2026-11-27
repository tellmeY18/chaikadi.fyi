#!/usr/bin/env bash
# Share the current WiFi uplink as an AP that blocks the STUN ports used by
# Chaikadi, so a phone can exercise the join-screen connection diagnosis.
set -euo pipefail

SSID=${STUN_HOTSPOT_SSID:-ChaiNoStun}
PASS=${STUN_HOTSPOT_PASS:-testpass123}
COUNTRY=${STUN_HOTSPOT_COUNTRY:-US}
BAND=${STUN_HOTSPOT_BAND:-}
CHANNEL=${STUN_HOTSPOT_CHANNEL:-}
AP_IFACE=ap0
STUN_HOSTS=(stun.l.google.com stun1.l.google.com stun.cloudflare.com global.stun.twilio.com)
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

Overrides: STUN_HOTSPOT_SSID, STUN_HOTSPOT_PASS, STUN_HOTSPOT_COUNTRY,
           STUN_HOTSPOT_BAND (2.4|5), STUN_HOTSPOT_CHANNEL
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

wifi_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/;/\\;/g' -e 's/,/\\,/g' -e 's/:/\\:/g'
}

show_qr() {
  local payload="WIFI:T:WPA;S:$(wifi_escape "$SSID");P:$(wifi_escape "$PASS");;"
  echo "Scan to join ${SSID}:"
  if command -v qrencode >/dev/null; then
    qrencode -t ANSIUTF8 "$payload" || echo "$payload"
  else
    echo "$payload"
  fi
}

client_net() {
  local net
  net=$(ip -4 -o addr show dev "$AP_IFACE" 2>/dev/null | awk '{print $4}' | head -1)
  printf '%s\n' "${net:-192.168.12.0/24}"
}

add_rule() {
  local port=$1 net
  net=$(client_net)
  # Drop forwarded STUN and redirect anything still routed to a closed port.
  iptables -C FORWARD -s "$net" -p udp --dport "$port" -j DROP 2>/dev/null || \
    iptables -I FORWARD -s "$net" -p udp --dport "$port" -j DROP
  iptables -t nat -C PREROUTING -s "$net" -p udp --dport "$port" -j REDIRECT --to-ports 9 2>/dev/null || \
    iptables -t nat -I PREROUTING -s "$net" -p udp --dport "$port" -j REDIRECT --to-ports 9
}

del_rule() {
  local port=$1 net
  net=$(client_net)
  while iptables -C FORWARD -s "$net" -p udp --dport "$port" -j DROP 2>/dev/null; do
    iptables -D FORWARD -s "$net" -p udp --dport "$port" -j DROP
  done
  while iptables -t nat -C PREROUTING -s "$net" -p udp --dport "$port" -j REDIRECT --to-ports 9 2>/dev/null; do
    iptables -t nat -D PREROUTING -s "$net" -p udp --dport "$port" -j REDIRECT --to-ports 9
  done
}

# Point create_ap's dnsmasq at the known STUN names so WebRTC cannot resolve
# a reachable server even if a packet slips past the firewall rules.
block_stun_dns() {
  local conf confdir host
  conf=$(ps -eo args= | awk '/dnsmasq .*-C \/tmp\/create_ap/ {for (i=1;i<=NF;i++) if ($i=="-C") {print $(i+1); exit}}')
  [[ -n "$conf" && -f "$conf" ]] || return 0
  for host in "${STUN_HOSTS[@]}"; do
    grep -q "^address=/${host}/" "$conf" || echo "address=/${host}/0.0.0.0" >>"$conf"
  done
  confdir=${conf%/*}
  if [[ -f "$confdir/dnsmasq.pid" ]]; then
    kill -HUP "$(<"$confdir/dnsmasq.pid")" 2>/dev/null || true
  fi
}

start() {
  local dev freq channel band
  dev=$(uplink)
  freq=$(frequency "$dev")
  [[ -n "$freq" ]] || { echo "$dev is not associated; connect it to WiFi first" >&2; exit 1; }
  channel=${CHANNEL:-$(channel_for "$freq")}
  band=${BAND:-$(band_for "$freq")}
  if [[ "$band" != 2.4 && "$band" != 5 ]]; then
    echo "invalid STUN_HOTSPOT_BAND: $band (use 2.4 or 5)" >&2
    exit 2
  fi

  if ip link show "$AP_IFACE" >/dev/null 2>&1; then
    echo "$AP_IFACE already exists; run 'stun-hotspot stop' first" >&2
    exit 1
  fi

  mkdir -p /tmp/opencode
  printf '%s\n' "$dev" >"$STATEFILE"
  create_ap -c "$channel" --freq-band "$band" --country "$COUNTRY" --isolate-clients --daemon \
    --pidfile "$PIDFILE" --logfile "$LOGFILE" \
    "$dev" "$dev" "$SSID" "$PASS"

  # Wait until create_ap has finished NAT setup: it inserts its own ACCEPT
  # rules with -I, which would otherwise land above our DROP rules.
  local ready=0
  for _ in {1..150}; do
    if ip link show "$AP_IFACE" >/dev/null 2>&1 && grep -q 'Sharing Internet using method' "$LOGFILE" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 0.1
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "AP did not finish setup; see $LOGFILE" >&2
    exit 1
  fi
  # create_ap writes these as root; make them readable by `stun-hotspot status`.
  chmod 644 "$PIDFILE" "$LOGFILE" 2>/dev/null || true

  # Inserted after create_ap, so these DROP rules sit above its ACCEPT rules.
  add_rule 3478
  add_rule 19302
  block_stun_dns

  cat <<EOF
AP "${SSID}" is up on channel ${channel} via ${dev} (${AP_IFACE}).
STUN UDP 3478/19302 and the STUN hostnames are blocked for AP clients.

On the phone:
  1. Join ${SSID} (password: ${PASS}).
  2. Settings -> Developer options -> Run self-test.
  3. Join a room; the failure banner should explain the STUN problem.

Logs: ${LOGFILE}
Stop with: stun-hotspot stop
EOF
  show_qr
}

stop() {
  del_rule 3478
  del_rule 19302
  if ip link show "$AP_IFACE" >/dev/null 2>&1 || [[ -f "$PIDFILE" ]]; then
    create_ap --stop "$AP_IFACE" || true
  fi
  create_ap --fix-unmanaged >/dev/null 2>&1 || true
  rm -f "$STATEFILE" "$PIDFILE"
  echo 'STUN-blocking AP stopped.'
}

status() {
  echo '--- stun-hotspot ---'
  if ip link show "$AP_IFACE" >/dev/null 2>&1; then
    if [[ -r "$PIDFILE" ]]; then echo "running (pid $(<"$PIDFILE"))"; else echo 'running'; fi
  else
    echo 'not running'
  fi
  if [[ -r "$STATEFILE" ]]; then echo "uplink: $(<"$STATEFILE")"; fi
  echo "--- ${AP_IFACE} ---"
  ip -br address show dev "$AP_IFACE" 2>/dev/null || echo 'not up'
  if [[ -r "$LOGFILE" ]]; then
    echo "--- ${LOGFILE} (last 20) ---"
    tail -n 20 "$LOGFILE"
  fi
}

"$command_name"
