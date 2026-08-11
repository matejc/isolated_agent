import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });
const clients = new Set();
const events = [];
const MAX_EVENTS = Number.parseInt(process.env.MAX_EVENTS || '5000', 10);
const PORT = Number.parseInt(process.env.PORT || '3000', 10);

app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
  done(null, body);
});

app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
});

app.get('/graph', async (_request, reply) => {
  return reply.sendFile('index.html');
});

app.get('/vendor/d3/d3.min.js', async (_request, reply) => {
  return reply.sendFile('d3.min.js', path.join(__dirname, 'node_modules/d3/dist'));
});

app.get('/api/events', async () => ({ events }));

app.get('/api/events/stream', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(events)}\n\n`);

  const keepalive = setInterval(() => {
    reply.raw.write(': keepalive\n\n');
  }, 25000);

  clients.add(reply.raw);
  request.raw.on('close', () => {
    clearInterval(keepalive);
    clients.delete(reply.raw);
  });
});

app.post('/api/events', async (request, reply) => {
  const body = typeof request.body === 'string' ? request.body : '';
  const parsed = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLine)
    .filter(Boolean);

  if (parsed.length === 0) {
    return reply.code(400).send({ accepted: 0, error: 'No valid event lines found.' });
  }

  events.push(...parsed);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  broadcast(parsed);
  return { accepted: parsed.length, total: events.length };
});

app.delete('/api/events', async () => {
  events.length = 0;
  broadcast([], 'clear');
  return { total: 0 };
});

function parseLine(line) {
  const firstSpace = line.indexOf(' ');
  if (firstSpace === -1) return null;

  const type = line.slice(0, firstSpace).trim();
  const fields = parseFields(line.slice(firstSpace + 1));
  const normalizedTime = normalizeTimestamp(fields.time);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    raw: line,
    type,
    receivedAt: new Date().toISOString(),
    ...fields,
    time: normalizedTime,
    raw_time: fields.time,
    host_pid: toNumber(fields.host_pid),
    ppid: toNumber(fields.ppid),
    tid: toNumber(fields.tid),
    uid: toNumber(fields.uid),
  };
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const millisecondIso = value.replace(/\.(\d{3})\d+(Z|[+-]\d\d:?\d\d)$/, '.$1$2');
  const timestamp = Date.parse(millisecondIso);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function parseFields(text) {
  const matches = [...text.matchAll(/(?:^|\s)([A-Za-z_][\w]*)=/g)];
  const fields = {};

  for (let i = 0; i < matches.length; i += 1) {
    const key = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    fields[key] = text.slice(start, end).trim();
  }

  return fields;
}

function toNumber(value) {
  if (value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function broadcast(payload, event = 'events') {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(frame);
  }
}

try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
