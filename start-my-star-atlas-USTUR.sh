#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/viktor/.openclaw/workspace-neo/projects/my-star-atlas-USTUR"
PROFILE="USTUR"
export PATH="/home/viktor/.nvm/versions/node/v22.22.0/bin:$PATH"
export ELECTRON_ENABLE_LOGGING=0
export LIBGL_ALWAYS_SOFTWARE=1

if [ -S /mnt/wslg/.X11-unix/X0 ]; then
  export DISPLAY=:0
fi
if [ -S /mnt/wslg/runtime-dir/wayland-0 ]; then
  export WAYLAND_DISPLAY=wayland-0
fi
if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d /mnt/wslg/runtime-dir ]; then
  export XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir
fi

cd "$APP_DIR"

if [ ! -x "$APP_DIR/node_modules/.bin/electron" ]; then
  npm install
fi

mkdir -p analysis
stdout_log="analysis/electron-stdout-${PROFILE}.log"
stderr_log="analysis/electron-stderr-${PROFILE}.log"
pid_file="analysis/electron-${PROFILE}.pid"

if [ -f "$pid_file" ]; then
  existing=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "$existing" ] && kill -0 "$existing" 2>/dev/null; then
    printf 'My Star Atlas (%s) is already running (pid %s).\n' "$PROFILE" "$existing"
    printf 'Stop it first with: kill %s\n' "$existing"
    exit 0
  fi
  rm -f "$pid_file"
fi

printf 'Launching My Star Atlas (%s) in background...\n' "$PROFILE"
setsid nohup ./node_modules/.bin/electron . --profile "$PROFILE" --disable-gpu --disable-software-rasterizer \
  >"$stdout_log" 2>"$stderr_log" </dev/null &
electron_pid=$!
disown
echo "$electron_pid" > "$pid_file"

sleep 2
if ! kill -0 "$electron_pid" 2>/dev/null; then
  printf '\nMy Star Atlas (%s) exited within 2s of start. See %s.\n' "$PROFILE" "$stderr_log"
  rm -f "$pid_file"
  exit 1
fi

printf '\nMy Star Atlas (%s) launched (pid %s).\n' "$PROFILE" "$electron_pid"
printf '  stdout: %s\n  stderr: %s\n  pid:    %s\n' "$stdout_log" "$stderr_log" "$pid_file"
printf '\nYou can close this window. To stop the app: kill %s\n' "$electron_pid"
