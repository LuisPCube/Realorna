#!/bin/sh
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$app_dir"
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then exit 0; fi
npm run dev >>/tmp/realorna-startup.log 2>&1 &
