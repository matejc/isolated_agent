#!/usr/bin/env bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

docker rm -f isolated_opencode || true
docker build "$SCRIPT_DIR" --build-arg "VERSION=${OPENCODE_VERSION:-latest}" -t isolated_opencode
docker run --name isolated_opencode \
    -v "$SCRIPT_DIR/state/config:/root/.config/opencode" \
    -v "$SCRIPT_DIR/state/state:/root/.local/state/opencode" \
    -v "$SCRIPT_DIR/state/share:/root/.local/share/opencode" \
    -v "$SCRIPT_DIR/state/cache:/root/.cache/opencode" \
    -v "${1?"Missing first argument: Path to workdir!"}:/workspace" \
    "${@:2}" \
    -it isolated_opencode
