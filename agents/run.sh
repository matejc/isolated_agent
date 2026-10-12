#!/usr/bin/env bash

set -e
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

run_agent() {
    agentName="$1"
    agentVersion="$2"
    workspaceMountSource="$3"
    extraDockerArgs=("${@:4}")
    dockerName="isolated_$agentName"

    docker rm -f "$dockerName" || true

    docker build "${AGENTS_DIR:-"$SCRIPT_DIR"}/$agentName" --build-arg "VERSION=$agentVersion" -t "$dockerName"

    docker run --name "$dockerName" \
        -v "$workspaceMountSource:/workspace/$(basename "$workspaceMountSource")" \
        "${extraDockerArgs[@]}" \
        -it "$dockerName"
}

agentName="${1?"Error: missing supported agent name as first argument:$(echo; find "${AGENTS_DIR:-"$SCRIPT_DIR"}" -maxdepth 1 -mindepth 1 -type d -printf '%f\n')"}"
workspaceMountSource="$(realpath "${2?"Error: missing workspace mount source as second argument!"}")"
sessionHash="$(echo "$workspaceMountSource" | sha256sum | cut -d ' ' -f1)"
extraArgs=("${@:3}")
stateDir="${AGENT_STATE_DIR:-"${XDG_STATE_HOME:-"$HOME/.local/state"}/isolated_agent/$agentName"}"
case "$agentName" in
    "crush")
        agentVersion="${CRUSH_VERSION:-$(curl -fsSL https://api.github.com/repos/charmbracelet/crush/releases/latest | jq -r '.tag_name')}"
        extraDockerArgs=(
            -v "$stateDir/config:/root/.config/crush"
            -v "$stateDir/state:/root/.local/state/crush"
            -v "$stateDir/share:/root/.local/share/crush"
            -v "$stateDir/cache:/root/.cache/crush"
            -v "$stateDir/sessions/$sessionHash:/workspace/.crush"
            "${extraArgs[@]}"
        )
        ;;
    "codex")
        agentVersion="${CODEX_VERSION:-$(curl -fsSL https://registry.npmjs.org/@openai/codex/latest | jq -r '.version')}"
        extraDockerArgs=(
            -v "$stateDir:/root/.codex"
            "${extraArgs[@]}"
        )
        ;;
    "pi")
        agentVersion="${PI_VERSION:-$(curl -fsSL https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest | jq -r '.version')}"
        extraDockerArgs=(
            -v "$stateDir:/root/.pi"
            "${extraArgs[@]}"
        )
        ;;
    "claude-code")
        agentVersion="${CLAUDE_CODE_VERSION:-$(curl -fsSL https://registry.npmjs.org/@anthropic-ai/claude-code/latest | jq -r '.version')}"
        extraDockerArgs=(
            -v "$stateDir:/root/.claude"
            "${extraArgs[@]}"
        )
        mkdir -p "$stateDir"
        if [ ! -f "$stateDir/.claude.json" ]
        then
            echo '{}' > "$stateDir/.claude.json"
        fi
        ;;
    "code")
        agentVersion="${CODE_VERSION:-$(curl -fsSL https://registry.npmjs.org/@just-every/code/latest | jq -r '.version')}"
        extraDockerArgs=(
            -v "$stateDir:/root/.code"
            "${extraArgs[@]}"
        )
        ;;
    "opencode")
        agentVersion="${OPENCODE_VERSION:-$(curl -fsSL 'https://hub.docker.com/v2/repositories/openeuler/opencode/tags?page_size=100&ordering=last_updated' | jq -r '.results | map(select(.name != "latest"))[0].name')}"
        extraDockerArgs=(
            -v "$stateDir/config:/root/.config/opencode"
            -v "$stateDir/state:/root/.local/state/opencode"
            -v "$stateDir/share:/root/.local/share/opencode"
            -v "$stateDir/cache:/root/.cache/opencode"
            "${extraArgs[@]}"
        )
        ;;
    "cursor")
        agentVersion="latest"
        extraDockerArgs=(
            -v "$stateDir/config:/root/.config/cursor"
            -v "$stateDir/home:/root/.cursor"
            "${extraArgs[@]}"
        )
        ;;
    *)
        echo "Error: agent with name '$agentName' does not exist!" >&2
        exit 1
        ;;
esac
run_agent "$agentName" "$agentVersion" "$workspaceMountSource" "${extraDockerArgs[@]}"
