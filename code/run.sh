#!/usr/bin/env bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

docker rm -f isolated_code || true
docker build "$SCRIPT_DIR" --build-arg "VERSION=${CODE_VERSION:-latest}" -t isolated_code
docker run --rm --name isolated_code \
    -v "$SCRIPT_DIR/state:/root/.code" \
    -v "${1?"Missing first argument: Path to workdir!"}:/workspace" \
    "${@:2}" \
    -it isolated_code
