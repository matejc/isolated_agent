const state = {
  events: [],
  paused: false,
  queued: [],
};

const typeColor = d3.scaleOrdinal()
  .domain(['EXEC', 'RO', 'RW', 'CONNECT'])
  .range(['var(--exec)', 'var(--ro)', 'var(--rw)', 'var(--connect)'])
  .unknown('var(--other)');

const els = {
  status: document.querySelector('#status'),
  totalCount: document.querySelector('#totalCount'),
  execCount: document.querySelector('#execCount'),
  readCount: document.querySelector('#readCount'),
  connectCount: document.querySelector('#connectCount'),
  typeFilter: document.querySelector('#typeFilter'),
  commandFilter: document.querySelector('#commandFilter'),
  textFilter: document.querySelector('#textFilter'),
  windowFilter: document.querySelector('#windowFilter'),
  pauseButton: document.querySelector('#pauseButton'),
  clearButton: document.querySelector('#clearButton'),
  graphMeta: document.querySelector('#graphMeta'),
  rateMeta: document.querySelector('#rateMeta'),
  commandMeta: document.querySelector('#commandMeta'),
  tableMeta: document.querySelector('#tableMeta'),
  table: document.querySelector('#eventsTable'),
  tooltip: document.querySelector('#tooltip'),
};

const graphSvg = d3.select('#graph');
const timelineSvg = d3.select('#timeline');
const commandsSvg = d3.select('#commands');

for (const el of [els.typeFilter, els.commandFilter, els.textFilter, els.windowFilter]) {
  el.addEventListener('input', render);
}

els.pauseButton.addEventListener('click', () => {
  state.paused = !state.paused;
  if (!state.paused && state.queued.length) {
    state.events.push(...state.queued.splice(0));
    trimEvents();
  }
  els.pauseButton.textContent = state.paused ? 'Resume' : 'Pause';
  render();
});

els.clearButton.addEventListener('click', async () => {
  await fetch('/api/events', { method: 'DELETE' });
});

await loadSnapshot();
connectStream();
render();

async function loadSnapshot() {
  const response = await fetch('/api/events');
  const data = await response.json();
  state.events = data.events || [];
}

function connectStream() {
  const source = new EventSource('/api/events/stream');
  source.addEventListener('open', () => setStatus('Connected'));
  source.addEventListener('error', () => setStatus('Reconnecting'));
  source.addEventListener('snapshot', (event) => {
    state.events = JSON.parse(event.data || '[]');
    trimEvents();
    render();
  });
  source.addEventListener('events', (event) => {
    const incoming = JSON.parse(event.data || '[]');
    if (state.paused) state.queued.push(...incoming);
    else state.events.push(...incoming);
    trimEvents();
    render();
  });
  source.addEventListener('clear', () => {
    state.events = [];
    state.queued = [];
    render();
  });
}

function setStatus(text) {
  const queued = state.queued.length ? `, ${state.queued.length} queued` : '';
  els.status.textContent = `${text} - ${state.events.length} events${queued}`;
}

function trimEvents() {
  if (state.events.length > 5000) state.events.splice(0, state.events.length - 5000);
}

function filteredEvents() {
  const limit = Number(els.windowFilter.value);
  const type = els.typeFilter.value;
  const command = els.commandFilter.value.trim().toLowerCase();
  const text = els.textFilter.value.trim().toLowerCase();

  return state.events.slice(-limit).filter((event) => {
    if (type !== 'all' && event.type !== type) return false;
    if (command && !(event.comm || '').toLowerCase().includes(command)) return false;
    if (text) {
      const haystack = [event.path, event.file, event.args, event.dst, event.hostnames, event.raw]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}

function render() {
  updateTypeFilter();
  const visible = filteredEvents();
  renderStats(visible);
  renderGraph(visible);
  renderTimeline(visible);
  renderCommands(visible);
  renderTable(visible);
  setStatus(state.paused ? 'Paused' : 'Connected');
}

function updateTypeFilter() {
  const current = els.typeFilter.value;
  const types = ['all', ...new Set(state.events.map((event) => event.type).filter(Boolean).sort())];
  els.typeFilter.replaceChildren(...types.map((type) => new Option(type === 'all' ? 'All' : type, type)));
  els.typeFilter.value = types.includes(current) ? current : 'all';
}

function renderStats(events) {
  els.totalCount.textContent = events.length.toLocaleString();
  els.execCount.textContent = countType(events, 'EXEC').toLocaleString();
  els.readCount.textContent = countType(events, 'RO').toLocaleString();
  els.connectCount.textContent = countType(events, 'CONNECT').toLocaleString();
}

function countType(events, type) {
  return events.filter((event) => event.type === type).length;
}

function renderGraph(events) {
  const svg = graphSvg;
  const { width, height } = dimensions(svg.node());
  svg.attr('viewBox', [0, 0, width, height]);
  svg.selectAll('*').remove();

  const processIdentityByPid = buildProcessIdentityIndex(state.events);
  const nodesById = new Map();
  const linksById = new Map();

  for (const event of events) {
    const processIdentity = processIdentityFor(event, processIdentityByPid);
    const processId = `process:${processIdentity.key}`;
    ensureNode(nodesById, processId, processIdentity.label, 'process', event);

    if (event.type !== 'EXEC') {
      const target = graphTargetFor(event);
      const targetId = graphTargetId(event, target, processId);
      ensureNode(nodesById, targetId, target.label, event.type, event);
      ensureLink(linksById, processId, targetId, event.type, event);
    }

    if (event.ppid) {
      const parentIdentity = processIdentityByPid.get(event.ppid) || {
        key: `pid:${event.ppid}`,
        label: 'unknown parent',
      };
      const parentId = `process:${parentIdentity.key}`;
      ensureNode(nodesById, parentId, parentIdentity.label, 'parent', event);
      if (parentId !== processId) {
        ensureLink(linksById, parentId, processId, 'PPID', event);
      }
    }
  }

  const nodes = [...nodesById.values()];
  const links = [...linksById.values()];
  els.graphMeta.textContent = `${events.length} events, ${nodes.length} nodes, ${links.length} links`;

  if (!nodes.length) {
    drawEmpty(svg, width, height, 'Post event lines to see process links');
    return;
  }

  const zoomLayer = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.45, 3]).on('zoom', ({ transform }) => zoomLayer.attr('transform', transform)));

  const link = zoomLayer.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', 'link')
    .attr('stroke-width', (d) => d.type === 'PPID' ? 1 : 1.8)
    .attr('stroke', (d) => d.type === 'PPID' ? '#6c7780' : typeColor(d.type));

  const node = zoomLayer.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'node');

  node.append('circle')
    .attr('r', (d) => d.kind === 'process' ? 12 : 8)
    .attr('fill', (d) => d.kind === 'process' ? '#edf2f4' : typeColor(d.kind))
    .attr('stroke', '#101214')
    .attr('stroke-width', 2);

  node.append('text')
    .attr('x', 13)
    .attr('y', 4)
    .text((d) => compactLabel(d.label));

  node.on('mousemove', (event, d) => showTooltip(event, nodeTooltip(d)))
    .on('mouseleave', hideTooltip);

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance((d) => d.type === 'PPID' ? 155 : 225).strength(0.55))
    .force('charge', d3.forceManyBody().strength(-450).distanceMax(850))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('x', d3.forceX(width / 2).strength(0.02))
    .force('y', d3.forceY(height / 2).strength(0.02))
    .force('collision', d3.forceCollide().radius(46).strength(0.9).iterations(2))
    .on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

  node.call(drag(simulation));
}

function ensureNode(map, id, label, kind, event) {
  if (!map.has(id)) map.set(id, { id, label, kind, count: 0, samples: [] });
  const node = map.get(id);
  if (node.kind === 'parent' && kind === 'process') {
    node.kind = 'process';
    node.label = label;
  }
  node.count += 1;
  if (node.samples.length < 3) node.samples.push(event.raw);
}

function ensureLink(map, source, target, type, event) {
  const id = `${type}:${source}->${target}`;
  if (!map.has(id)) map.set(id, { source, target, type, count: 0, event });
  map.get(id).count += 1;
}

function buildProcessIdentityIndex(events) {
  const index = new Map();
  const candidatesByPid = new Map();

  for (const event of events) {
    if (event.type === 'EXEC' && event.host_pid && event.file) {
      if (!candidatesByPid.has(event.host_pid)) candidatesByPid.set(event.host_pid, []);
      candidatesByPid.get(event.host_pid).push(event);
    }
  }

  for (const [pid, candidates] of candidatesByPid) {
    const executablePath = selectExecutablePath(candidates);
    index.set(pid, { key: `path:${executablePath}`, label: executablePath });
  }

  // In EXEC records, comm names the calling task and ppid identifies that
  // parent. Use it when the parent's executable path is not present.
  for (const event of events) {
    if (event.type === 'EXEC' && event.ppid && !index.has(event.ppid) && event.comm) {
      index.set(event.ppid, { key: `comm:${event.comm}`, label: event.comm });
    }
  }

  // Some processes have activity records but no EXEC record in the retained
  // history. Group those by their observed comm value instead.
  for (const event of events) {
    if (event.host_pid && !index.has(event.host_pid) && event.comm) {
      index.set(event.host_pid, { key: `comm:${event.comm}`, label: event.comm });
    }
  }

  return index;
}

function processIdentityFor(event, processIdentityByPid) {
  if (event.host_pid && processIdentityByPid.has(event.host_pid)) return processIdentityByPid.get(event.host_pid);
  if (event.comm) return { key: `comm:${event.comm}`, label: event.comm };
  const command = commandFromArgs(event.args) || basename(event.file);
  if (command) return { key: `command:${command}`, label: command };
  return { key: `pid:${event.host_pid || 'unknown'}`, label: 'unknown process' };
}

function selectExecutablePath(events) {
  return [...events].sort((a, b) => executablePathScore(b) - executablePathScore(a))[0].file;
}

function executablePathScore(event) {
  const file = String(event.file || '');
  const command = basename(commandFromArgs(event.args));
  let score = basename(file) === command ? 10 : 0;
  if (file.startsWith('/usr/bin/')) score += 50;
  else if (file.startsWith('/bin/')) score += 45;
  else if (file.startsWith('/usr/local/bin/')) score += 40;
  else if (file.startsWith('/usr/sbin/')) score += 35;
  else if (file.startsWith('/sbin/')) score += 30;
  else if (file.startsWith('/usr/local/sbin/')) score += 25;
  if (file.startsWith('/tmp/')) score -= 20;
  return score;
}

function graphTargetFor(event) {
  if (event.type === 'RO' || event.type === 'RW') {
    const directory = parentDirectoryFor(event.path || event.file);
    return {
      key: directory,
      label: `${event.type} ${directory}`,
    };
  }

  const target = targetFor(event);
  return { key: target, label: target };
}

function graphTargetId(event, target, processId) {
  if (event.type === 'RO' || event.type === 'RW') {
    return `${event.type}:${processId}:${target.key}`;
  }
  return `${event.type}:${target.key}`;
}

function commandFromArgs(args) {
  return String(args || '').trim().split(/\s+/, 1)[0] || '';
}

function basename(filePath) {
  const normalized = String(filePath || '').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function parentDirectoryFor(filePath) {
  if (!filePath) return 'unknown directory';
  const normalized = String(filePath).replace(/\/+/g, '/').replace(/\/+$/, '');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex > 0) return normalized.slice(0, slashIndex);
  if (slashIndex === 0) return '/';
  return '.';
}

function targetFor(event) {
  if (event.type === 'CONNECT') {
    return event.hostnames ? event.hostnames + ":" + destinationPort(event.dst) : event.dst || 'unknown destination';
  }
  return event.path || event.file || event.args || 'empty path';
}

function destinationPort(destination) {
  if (!destination) return '';
  return String(destination).match(/:(\d+)$/)?.[1];
}

function renderTimeline(events) {
  const svg = timelineSvg;
  const { width, height } = dimensions(svg.node());
  const margin = { top: 18, right: 18, bottom: 32, left: 42 };
  svg.attr('viewBox', [0, 0, width, height]);
  svg.selectAll('*').remove();

  const dated = events.filter((event) => event.time).map((event) => ({ ...event, date: new Date(event.time) }));
  els.rateMeta.textContent = `${dated.length} timed`;
  if (!dated.length) {
    drawEmpty(svg, width, height, 'Timed events appear here');
    return;
  }

  const extent = d3.extent(dated, (d) => d.date);
  if (+extent[0] === +extent[1]) extent[1] = new Date(+extent[0] + 1000);
  const x = d3.scaleTime().domain(extent).range([margin.left, width - margin.right]);
  const bins = d3.bin().value((d) => d.date).domain(x.domain()).thresholds(40)(dated);
  const y = d3.scaleLinear().domain([0, d3.max(bins, (d) => d.length) || 1]).nice().range([height - margin.bottom, margin.top]);

  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(5));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5));

  svg.append('g')
    .selectAll('rect')
    .data(bins)
    .join('rect')
    .attr('x', (d) => x(d.x0) + 1)
    .attr('y', (d) => y(d.length))
    .attr('width', (d) => Math.max(1, x(d.x1) - x(d.x0) - 1))
    .attr('height', (d) => y(0) - y(d.length))
    .attr('fill', '#7cc8b8');
}

function renderCommands(events) {
  const svg = commandsSvg;
  const { width, height } = dimensions(svg.node());
  const margin = { top: 18, right: 22, bottom: 28, left: 118 };
  svg.attr('viewBox', [0, 0, width, height]);
  svg.selectAll('*').remove();

  const rows = d3.rollups(events, (v) => v.length, (d) => d.comm || 'unknown')
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 10);
  els.commandMeta.textContent = `${rows.length} shown`;

  if (!rows.length) {
    drawEmpty(svg, width, height, 'Command counts appear here');
    return;
  }

  const y = d3.scaleBand().domain(rows.map((d) => d[0])).range([margin.top, height - margin.bottom]).padding(0.22);
  const x = d3.scaleLinear().domain([0, d3.max(rows, (d) => d[1]) || 1]).nice().range([margin.left, width - margin.right]);

  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(5));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).tickSizeOuter(0));

  svg.append('g')
    .selectAll('rect')
    .data(rows)
    .join('rect')
    .attr('x', margin.left)
    .attr('y', (d) => y(d[0]))
    .attr('width', (d) => x(d[1]) - margin.left)
    .attr('height', y.bandwidth())
    .attr('rx', 3)
    .attr('fill', '#f2b84b');

  svg.append('g')
    .selectAll('text')
    .data(rows)
    .join('text')
    .attr('x', (d) => x(d[1]) + 6)
    .attr('y', (d) => y(d[0]) + y.bandwidth() / 2 + 4)
    .attr('fill', 'var(--muted)')
    .attr('font-size', 11)
    .text((d) => d[1]);
}

function renderTable(events) {
  const rows = events.slice(-160).reverse();
  els.tableMeta.textContent = `${rows.length} rows`;
  els.table.replaceChildren(...rows.map((event) => {
    const tr = document.createElement('tr');
    const target = targetFor(event);
    tr.innerHTML = `
      <td title="${escapeHtml(event.time || event.receivedAt || '')}">${formatTime(event.time || event.receivedAt)}</td>
      <td><span class="pill" style="background:${typeColor(event.type)}">${escapeHtml(event.type)}</span></td>
      <td>${escapeHtml(event.host_pid ?? '')}</td>
      <td title="${escapeHtml(event.comm || '')}">${escapeHtml(event.comm || '')}</td>
      <td title="${escapeHtml(event.raw || '')}">${escapeHtml(target)}</td>
    `;
    return tr;
  }));
}

function dimensions(node) {
  const rect = node.getBoundingClientRect();
  return { width: Math.max(320, rect.width), height: Math.max(260, rect.height) };
}

function drawEmpty(svg, width, height, message) {
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--muted)')
    .attr('font-size', 13)
    .text(message);
}

function compactLabel(label) {
  const flat = String(label).replace(/\n/g, ' ');
  const accessLabel = flat.match(/^(RO|RW)\s+(.+)$/);
  if (accessLabel) return `${accessLabel[1]} ${compactPath(accessLabel[2], 30)}`;
  if (flat.length <= 36) return flat;
  return compactPath(flat, 36);
}

function compactPath(value, maxLength) {
  if (value.length <= maxLength) return value;
  const parts = value.split('/').filter(Boolean);
  return parts.length > 2 ? `/${parts.slice(-2).join('/')}` : `${value.slice(0, maxLength - 3)}...`;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(+date)) return value;
  return date.toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function nodeTooltip(d) {
  return `<strong>${escapeHtml(d.label)}</strong><br>${escapeHtml(d.kind)} - ${d.count} events<br>${d.samples.map(escapeHtml).join('<br>')}`;
}

function showTooltip(event, html) {
  els.tooltip.hidden = false;
  els.tooltip.innerHTML = html;
  els.tooltip.style.left = `${Math.min(window.innerWidth - 440, event.clientX + 14)}px`;
  els.tooltip.style.top = `${Math.min(window.innerHeight - 180, event.clientY + 14)}px`;
}

function hideTooltip() {
  els.tooltip.hidden = true;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function drag(simulation) {
  return d3.drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on('drag', (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
}
