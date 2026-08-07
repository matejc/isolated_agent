#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
NETMON_DIR="$SCRIPT_DIR/netmon"
NETMON="$NETMON_DIR/netmon"
AUDIT="$SCRIPT_DIR/audit.bt"

usage()
{
    echo "usage: $0 CONTAINER [netmon options]" >&2
    echo "example: $0 my-container --dns-cache-max 8192" >&2
}

resolve_container_cgroup()
{
    local container=$1 running pid rel path

    read -r running pid < <(
        docker inspect --format '{{.State.Running}} {{.State.Pid}}' "$container"
    ) || return 1
    if [[ $running != true || ! $pid =~ ^[1-9][0-9]*$ ]]; then
        echo "container is not running: $container" >&2
        return 1
    fi

    rel=$(awk -F: '$1 == "0" { print $3; exit }' "/proc/$pid/cgroup")
    if [[ -z $rel ]]; then
        echo "cannot resolve cgroup v2 path for container PID $pid" >&2
        return 1
    fi
    path="/sys/fs/cgroup$rel"
    if [[ ! -d $path ]]; then
        echo "container cgroup does not exist: $path" >&2
        return 1
    fi

    stat -Lc '%i' "$path"
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

command -v docker >/dev/null || { echo "docker CLI is required" >&2; exit 1; }
command -v bpftrace >/dev/null || { echo "bpftrace is required" >&2; exit 1; }
command -v make >/dev/null || { echo "make is required" >&2; exit 1; }
[[ -r $AUDIT ]] || { echo "missing bpftrace program: $AUDIT" >&2; exit 1; }

# This is incremental and does no work when the executable is up to date.
make -C "$NETMON_DIR" >&2
[[ -x $NETMON ]] || { echo "missing network monitor executable: $NETMON" >&2; exit 1; }

cgroup_id=$(resolve_container_cgroup "$container")
sudo -v

echo "starting container audit and network monitor for $container (cgroup ID $cgroup_id)" >&2

sudo env TZ=UTC bpftrace "$AUDIT" "$cgroup_id" &
children+=("$!")

sudo "$NETMON" --cgroup-id "$cgroup_id" "$@" &
children+=("$!")

set +e
wait -n "${children[@]}"
status=$?
set -e

if [[ $status -ne 0 ]]; then
    echo "a monitor exited with status $status; stopping the other monitor" >&2
else
    echo "a monitor exited; stopping the other monitor" >&2
fi
exit "$status"
