#!/usr/bin/env bash

set -e
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

run_agent() {
    agentName="$1"
    agentVersion="$2"
    workspaceDir="$3"
    extraDockerArgs=("${@:4}")
    dockerName="isolated_$agentName"

    docker rm -f "$dockerName" || true

    docker build "$SCRIPT_DIR/$agentName" --build-arg "VERSION=$agentVersion" -t "$dockerName"

    docker run --name "$dockerName" \
        -v "${workspaceDir?"Error: missing first argument: Path to workdir!"}:/workspace" \
        "${extraDockerArgs[@]}" \
        -it "$dockerName"
}

agentName="${1?"Error: missing supported agent name as first argument!"}"
workspaceDir="${2?"Error: missing workspace dir as second argument!"}"
extraArgs=("${@:3}")
agentDir="$SCRIPT_DIR/$agentName"
case "$agentName" in
    "crush")
        agentVersion="${CRUSH_VERSION:-$(curl -fsSL https://api.github.com/repos/charmbracelet/crush/releases/latest | jq -r '.tag_name')}"
        extraDockerArgs=(
            -v "$agentDir/state/config:/root/.config/crush"
            -v "$agentDir/state/state:/root/.local/state/crush"
            -v "$agentDir/state/share:/root/.local/share/crush"
            -v "$agentDir/state/cache:/root/.cache/crush"
            "${extraArgs[@]}"
        )
        ;;
    "codex")
        agentVersion="${CODEX_VERSION:-$(curl -fsSL https://registry.npmjs.org/@openai/codex/latest | jq -r '.version')}"
        extraDockerArgs=(
            -v "$agentDir/state:/root/.codex"
            "${extraArgs[@]}"
        )
        ;;
    "code")
        agentVersion="${CODE_VERSION:-$(curl -fsSL https://registry.npmjs.org/@just-every/code/latest | jq -r '.version')}"
        extraDockerArgs=(
            -v "$agentDir/state:/root/.code"
            "${extraArgs[@]}"
        )
        ;;
    "opencode")
        agentVersion="${OPENCODE_VERSION:-$(curl -fsSL 'https://hub.docker.com/v2/repositories/openeuler/opencode/tags?page_size=100&ordering=last_updated' | jq -r '.results | map(select(.name != "latest"))[0].name')}"
        extraDockerArgs=(
            -v "$agentDir/state/config:/root/.config/opencode"
            -v "$agentDir/state/state:/root/.local/state/opencode"
            -v "$agentDir/state/share:/root/.local/share/opencode"
            -v "$agentDir/state/cache:/root/.cache/opencode"
            "${extraArgs[@]}"
        )
        ;;
esac
run_agent "$agentName" "$agentVersion" "$workspaceDir" "${extraDockerArgs[@]}"
