#!/usr/bin/env bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

docker rm -f isolated_opencode || true

OPENCODE_VERSION="${OPENCODE_VERSION:-$(curl -fsSL 'https://hub.docker.com/v2/repositories/openeuler/opencode/tags?page_size=100&ordering=last_updated' | jq -r '.results | map(select(.name != "latest"))[0].name')}"
docker build "$SCRIPT_DIR" --build-arg "VERSION=$OPENCODE_VERSION" -t isolated_opencode

docker run --name isolated_opencode \
    -v "$SCRIPT_DIR/state/config:/root/.config/opencode" \
    -v "$SCRIPT_DIR/state/state:/root/.local/state/opencode" \
    -v "$SCRIPT_DIR/state/share:/root/.local/share/opencode" \
    -v "$SCRIPT_DIR/state/cache:/root/.cache/opencode" \
    -v "${1?"Missing first argument: Path to workdir!"}:/workspace" \
    "${@:2}" \
    -it isolated_opencode
