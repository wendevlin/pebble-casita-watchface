#!/usr/bin/env bash
#
# Installs the built .pbw in the Pebble emulator and captures one screenshot per
# scenario (themes, expressions, badge counts, Quick View, disconnected).
#
#   tools/emulator-screenshots.sh <platform> <out-dir>
#
# Requires a prior `bun run build`. Each scenario pushes its state with the
# emulator controls and an AppMessage (which also forces a redraw), so the
# shots are deterministic apart from the phone-side weather fetch.
set -euo pipefail

platform="${1:?platform (emery|gabbro)}"
out="${2:?output directory}"
mkdir -p "$out"

emu=(--emulator "$platform")
pbw=$(ls build/*.pbw | head -n 1)

# `pebble build` numbers the package.json messageKeys from 10000 in order;
# send-app-message only takes those numbers, so map NAME=VALUE -> 100xx=VALUE.
declare -A KEY
i=10000
for name in $(python3 -c 'import json; print(" ".join(json.load(open("package.json"))["pebble"]["messageKeys"]))'); do
  KEY[$name]=$i
  i=$((i + 1))
done
msg() {
  local args=() a
  for a in "$@"; do
    if [[ "$a" == *=* ]]; then args+=("${KEY[${a%%=*}]:?unknown key ${a%%=*}}=${a#*=}"); else args+=("$a"); fi
  done
  pebble send-app-message "${emu[@]}" "${args[@]}" >/dev/null
}
# Emulator controls the older platforms' firmware may not answer (emu-steps,
# emu-bt-connection on basalt/chalk/diorite): note it and carry on.
ctl() {
  if ! pebble "$@" "${emu[@]}" >/dev/null 2>&1; then
    echo "note: '$1' is not supported by the $platform emulator"
    return 1
  fi
}
# The battery badge refreshes on the minute redraw, not on battery events, so
# give the emulated battery a moment before the next message forces a redraw.
battery() { ctl emu-battery --percent "$1" || true; sleep 2; }
shot() {
  sleep 2
  pebble screenshot --no-open "${emu[@]}" "$out/${platform}-$1.png" >/dev/null
  echo "captured $out/${platform}-$1.png"
}

pebble install "${emu[@]}" "$pbw"
# Let PebbleKit JS send its startup settings before ours override them.
sleep 8

ctl emu-time-format --format 24h || true
battery 80
ctl emu-steps 4321 || true
ctl emu-set-time 08:55:00 || true

all_badges=(SHOW_DATE=1 SHOW_WEATHER=1 SHOW_STEPS=1 SHOW_BATTERY=1 SHOW_HOME_TEMP=1)

msg --int THEME=0 WEATHER_TEMP=136 HA_TEMP=214 "${all_badges[@]}" --string BADGE_ORDER=dwsbh
shot light-5-badges

msg --int THEME=1
shot dark-5-badges

msg --int THEME=0 SHOW_BATTERY=0 SHOW_HOME_TEMP=0
shot light-3-badges

battery 15
msg --int THEME=1 SHOW_STEPS=0 SHOW_WEATHER=0 SHOW_BATTERY=1 --string BADGE_ORDER=bdwsh
shot dark-2-badges-low-battery

battery 55
msg --int THEME=0 WEATHER_TEMP=324 "${all_badges[@]}" --string BADGE_ORDER=dwsbh
shot light-sweating

# Readings older than an hour show as "--", so re-send both temperatures
# after moving the clock.
ctl emu-set-time 23:10:00 || true
msg --int THEME=1 WEATHER_TEMP=-53 HA_TEMP=214
shot dark-sleeping

ctl emu-time-format --format 12h || true
ctl emu-set-time 13:07:00 || true
msg --int THEME=0 WEATHER_TEMP=181 HA_TEMP=214
shot light-12h

if ctl emu-set-timeline-quick-view on; then
  msg --int THEME=0
  shot light-quick-view
  ctl emu-set-timeline-quick-view off || true
fi

# On the older emulator firmware (basalt, chalk, diorite) dropping Bluetooth
# also drops the link the screenshot travels over, so this shot is best-effort.
if ctl emu-bt-connection --connected no; then
  shot light-disconnected || echo "note: no disconnected screenshot on the $platform emulator"
  ctl emu-bt-connection --connected yes || true
fi
