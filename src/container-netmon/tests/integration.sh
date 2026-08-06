#!/usr/bin/env bash
set -euo pipefail
IMAGE=${NETMON_TEST_IMAGE:-alpine:3.20}
NAME="netmon-test-$$"
OUT=$(mktemp); ERR=$(mktemp)
MON=""
cleanup(){ [[ -n "$MON" ]] && sudo kill -TERM "$MON" 2>/dev/null || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f "$OUT" "$ERR"; }
trap cleanup EXIT INT TERM
command -v docker >/dev/null || { echo "integration test requires the Docker CLI" >&2; exit 1; }
docker info >/dev/null 2>&1 || {
    echo "integration test requires a running Docker daemon accessible to the current user" >&2
    echo "check DOCKER_HOST or start Docker before retrying" >&2
    exit 1
}
docker run -d --name "$NAME" "$IMAGE" sleep 300 >/dev/null
PID=$(docker inspect --format '{{.State.Pid}}' "$NAME")
REL=$(awk -F: '$1 == "0" { print $3; exit }' "/proc/$PID/cgroup")
CGROUP_ID=$(stat -Lc '%i' "/sys/fs/cgroup$REL")
sudo ./container-netmon --cgroup-id "$CGROUP_ID" >"$OUT" 2>"$ERR" & MON=$!
sleep 2
docker exec "$NAME" sh -c 'nslookup example.com >/dev/null && wget -q -O /dev/null http://example.com/'
sleep 3
sudo kill -TERM "$MON"; wait "$MON" || true; MON=""
grep -q '^CONNECT ' "$OUT"
grep -q 'hostnames=[^[:space:]]' "$OUT"
echo "integration test passed"
