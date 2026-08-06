#!/usr/bin/env bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

docker rm -f isolated_codex || true
docker build "$SCRIPT_DIR" -t isolated_codex
docker run --rm --name isolated_codex \
    -v "$SCRIPT_DIR/state:/root/.codex" \
    -v "${1?"Missing first argument: Path to workdir!"}:/workspace" \
    "${@:2}" \
    -it isolated_codex
