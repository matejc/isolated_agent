#!/usr/bin/env bash

newest_file="$(find "$HOME/.claude/backups" -maxdepth 1 -type f -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"

if [ -f "$newest_file" ] && [ ! -f "$HOME/.claude.json" ]
then
    cp -v "$newest_file" "$HOME/.claude.json"
fi

exec claude "${@}"
