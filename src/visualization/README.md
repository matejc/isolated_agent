# System Event Stream Visualization

A local D3 dashboard for process, file-read, and network-connect audit lines.

## Run

```bash
cd visualization
npm install
npm start
```

Open http://localhost:3000 for the dashboard, or http://localhost:3000/graph for a fullscreen graph-only view.

## Add Events From A Pipe

Post newline-delimited log lines to the ingest endpoint:

```bash
cat sample.log | curl -sS -X POST --data-binary @- http://localhost:3000/api/events
```

For a long-running producer, keep batching with `xargs` or another line buffer:

```bash
tail -f audit.log | xargs -r -L 50 sh -c 'printf "%s\n" "$@" | curl -sS -X POST --data-binary @- http://localhost:3000/api/events >/dev/null' sh
```

Each POST can contain one line or many lines. Connected browser sessions update live through server-sent events.

## API

- `POST /api/events`: Accepts raw newline-delimited event text.
- `GET /api/events`: Returns the current server buffer as JSON.
- `GET /api/events/stream`: Browser live-update stream.
- `DELETE /api/events`: Clears the current server buffer.

The server keeps the latest `MAX_EVENTS` entries, defaulting to `5000`.
