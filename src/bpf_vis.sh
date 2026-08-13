#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
VIS_DIR="$SCRIPT_DIR/visualization"
VISUALIZATION="node $SCRIPT_DIR/visualization/server.js"
BPF_LOG="$SCRIPT_DIR/bpf_log.sh"

usage()
{
    echo "usage: $0 CONTAINER" >&2
    echo "example: $0 my-container" >&2
}

children=()
cleanup()
{
    local child
    trap - EXIT INT TERM
    for child in "${children[@]}"; do
        kill -TERM "$child" 2>/dev/null || true
    done
    for child in "${children[@]}"; do
        wait "$child" 2>/dev/null || true
    done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ $# -lt 1 ]]; then
    usage
    exit 2
fi

container=$1
shift

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }

if [ ! -d "$VIS_DIR/node_modules" ]
then
    ( cd "$VIS_DIR" && npm install; ) >&2
fi
$VISUALIZATION &
children+=("$!")

"$BPF_LOG" "$container" |
while IFS= read -r line; do
    [[ -n $line ]] || continue
    printf '%s\n' "$line" |
        tee /dev/stderr |
        curl -sS -o /dev/null --data-binary @- http://127.0.0.1:3000/api/events
done &
children+=("$!")

wait -n "${children[@]}"
