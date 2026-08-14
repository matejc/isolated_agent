const state = {
  events: [],
  paused: false,
  queued: [],
  eventsRevision: 0,
};

let graphSimulation = null;
const graphPositions = new Map();
let graphTopologySignature = null;
let renderFrame = null;
let processIdentityRevision = -1;
let processIdentityByPid = new Map();
let typeFilterRevision = -1;
let availableTypes = ['all'];
const MAX_ACCESS_TARGETS_PER_PROCESS = 12;
const ACCESS_FILE_DETAIL_TARGET = 8;

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
  el.addEventListener('input', scheduleRender);
}

els.pauseButton.addEventListener('click', () => {
  state.paused = !state.paused;
  if (!state.paused && state.queued.length) {
    state.events.push(...state.queued.splice(0));
    trimEvents();
    markEventsChanged();
  }
  els.pauseButton.textContent = state.paused ? 'Resume' : 'Pause';
  scheduleRender();
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
    markEventsChanged();
    scheduleRender();
  });
  source.addEventListener('events', (event) => {
    const incoming = JSON.parse(event.data || '[]');
    if (state.paused) state.queued.push(...incoming);
    else {
      state.events.push(...incoming);
      markEventsChanged();
    }
    trimEvents();
    scheduleRender();
  });
  source.addEventListener('clear', () => {
    state.events = [];
    state.queued = [];
    graphPositions.clear();
    graphTopologySignature = null;
    markEventsChanged();
    scheduleRender();
  });
}

function setStatus(text) {
  const queued = state.queued.length ? `, ${state.queued.length} queued` : '';
  els.status.textContent = `${text} - ${state.events.length} events${queued}`;
}

function trimEvents() {
  if (state.events.length > 5000) state.events.splice(0, state.events.length - 5000);
}

function markEventsChanged() {
  state.eventsRevision += 1;
}

function scheduleRender() {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    render();
  });
}

function filteredEvents() {
  const limit = Number(els.windowFilter.value);
  const type = els.typeFilter.value;
  const command = els.commandFilter.value.trim().toLowerCase();
  const text = els.textFilter.value.trim().toLowerCase();

  return diverseEvents(state.events, limit).filter((event) => {
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

function diverseEvents(events, limit) {
  if (events.length <= limit) return events;

  const identityByPid = getProcessIdentityIndex();
  const keys = events.map((event) => eventRelationshipKey(event, identityByPid));
  const counts = d3.rollup(keys, (values) => values.length, (key) => key);
  const keep = new Uint8Array(events.length);
  keep.fill(1);
  let removals = events.length - limit;

  // Remove the oldest redundant examples while retaining the newest example
  // of every relationship whenever the limit permits it.
  for (let index = 0; index < events.length && removals > 0; index += 1) {
    const key = keys[index];
    if (counts.get(key) <= 1) continue;
    keep[index] = 0;
    counts.set(key, counts.get(key) - 1);
    removals -= 1;
  }

  // If unique relationships alone exceed the cap, fall back to oldest-first.
  for (let index = 0; index < events.length && removals > 0; index += 1) {
    if (!keep[index]) continue;
    keep[index] = 0;
    removals -= 1;
  }

  return events.filter((_, index) => keep[index]);
}

function eventRelationshipKey(event, identityByPid) {
  const processIdentity = processIdentityFor(event, identityByPid);
  const processKey = processIdentity.key;

  if (event.type === 'EXEC') {
    const parentKey = event.ppid ? identityByPid.get(event.ppid)?.key || `pid:${event.ppid}` : 'none';
    return `EXEC:${parentKey}->${processKey}`;
  }
  if (event.type === 'RO' || event.type === 'RW') {
    return `${event.type}:${processKey}:${event.path || event.file || 'unknown file'}`;
  }
  if (event.type === 'CONNECT') {
    return `CONNECT:${processKey}:${String(event.protocol || 'unknown').toUpperCase()}:${targetFor(event)}`;
  }
  return `${event.type}:${processKey}:${targetFor(event)}`;
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
  if (typeFilterRevision !== state.eventsRevision) {
    availableTypes = ['all', ...new Set(state.events.map((event) => event.type).filter(Boolean).sort())];
    els.typeFilter.replaceChildren(...availableTypes.map((type) => new Option(type === 'all' ? 'All' : type, type)));
    typeFilterRevision = state.eventsRevision;
  }
  els.typeFilter.value = availableTypes.includes(current) ? current : 'all';
}

function renderStats(events) {
  const counts = { EXEC: 0, RO: 0, CONNECT: 0 };
  for (const event of events) {
    if (Object.hasOwn(counts, event.type)) counts[event.type] += 1;
  }
  els.totalCount.textContent = events.length.toLocaleString();
  els.execCount.textContent = counts.EXEC.toLocaleString();
  els.readCount.textContent = counts.RO.toLocaleString();
  els.connectCount.textContent = counts.CONNECT.toLocaleString();
}

function renderGraph(events) {
  const svg = graphSvg;
  const { width, height } = dimensions(svg.node());
  svg.attr('viewBox', [0, 0, width, height]);

  const identityByPid = getProcessIdentityIndex();
  const accessDirectoryRollups = buildAccessDirectoryRollups(events, identityByPid);
  const nodesById = new Map();
  const linksById = new Map();

  for (const event of events) {
    const processIdentity = processIdentityFor(event, identityByPid);
    const processId = `process:${processIdentity.key}`;
    ensureNode(nodesById, processId, processIdentity.label, 'process', event);

    if (event.type !== 'EXEC') {
      const target = graphTargetFor(event, processId, accessDirectoryRollups);
      const targetId = graphTargetId(event, target, processId);
      ensureNode(nodesById, targetId, target.label, event.type, event);
      ensureLink(linksById, processId, targetId, event.type, event);
    }

    if (event.ppid) {
      const parentIdentity = identityByPid.get(event.ppid);
      if (parentIdentity) {
        const parentId = `process:${parentIdentity.key}`;
        ensureNode(nodesById, parentId, parentIdentity.label, 'parent', event);
        if (parentId !== processId) {
          ensureLink(linksById, parentId, processId, 'PPID', event);
        }
      }
    }
  }

  const nodes = [...nodesById.values()];
  const links = [...linksById.values()];
  const nodesWithObservedParents = new Set(
    links.filter((link) => link.type === 'PPID').map((link) => link.target),
  );
  let restoredNodeCount = 0;
  for (const node of nodes) {
    node.isRoot = (node.kind === 'process' || node.kind === 'parent') && !nodesWithObservedParents.has(node.id);
    const saved = graphPositions.get(node.id);
    if (saved) {
      node.x = saved.x;
      node.y = saved.y;
      restoredNodeCount += 1;
    }
  }
  assignComponentCenters(nodes, links, width, height);
  els.graphMeta.textContent = `${events.length} events, ${nodes.length} nodes, ${links.length} links`;

  const topologySignature = JSON.stringify({
    nodes: nodes.map((node) => [node.id, node.label, node.kind, node.isRoot]).sort(),
    links: links.map((link) => [link.id, link.source, link.target, link.type]).sort(),
  });

  if (topologySignature === graphTopologySignature) {
    svg.selectAll('.node').each(function updateNode(d) {
      const updated = nodesById.get(d.id);
      if (!updated) return;
      d.count = updated.count;
      d.samples = updated.samples;
    });
    return;
  }

  graphTopologySignature = topologySignature;
  graphSimulation?.stop();
  graphSimulation = null;
  svg.selectAll('*').remove();

  if (!nodes.length) {
    drawEmpty(svg, width, height, 'Post event lines to see process links');
    return;
  }

  const zoomLayer = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.45, 3]).on('zoom', ({ transform }) => zoomLayer.attr('transform', transform)));

  zoomLayer.append('defs')
    .append('marker')
    .attr('id', 'graph-arrowhead')
    .attr('viewBox', '0 -5 24 10')
    .attr('refX', 22)
    .attr('refY', 0)
    .attr('markerWidth', 24)
    .attr('markerHeight', 10)
    .attr('orient', 'auto')
    .attr('markerUnits', 'userSpaceOnUse')
    .append('path')
    .attr('d', 'M0,-4L9,0L0,4Z')
    .attr('fill', '#6c7780');

  const link = zoomLayer.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', 'link')
    .attr('stroke-width', (d) => d.type === 'PPID' ? 1 : 1.8)
    .attr('stroke', (d) => d.type === 'PPID' ? '#6c7780' : typeColor(d.type))
    .attr('marker-end', (d) => d.type === 'PPID' ? 'url(#graph-arrowhead)' : null);

  const node = zoomLayer.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'node');

  node.append('circle')
    .attr('r', (d) => d.kind === 'process' || d.kind === 'parent' ? 12 : 8)
    .attr('fill', (d) => d.kind === 'process' || d.kind === 'parent' ? '#edf2f4' : typeColor(d.kind))
    .attr('stroke', (d) => d.isRoot ? 'var(--other)' : '#101214')
    .attr('stroke-width', (d) => d.isRoot ? 4 : 2);

  node.append('text')
    .attr('x', 13)
    .attr('y', 4)
    .text((d) => compactLabel(d.label));

  node.on('mousemove', (event, d) => showTooltip(event, nodeTooltip(d)))
    .on('mouseleave', hideTooltip);

  graphSimulation = d3.forceSimulation(nodes)
    .alpha(restoredNodeCount ? 0.35 : 1)
    .force('link', d3.forceLink(links).id((d) => d.id).distance((d) => d.type === 'PPID' ? 540 : 150).strength(0.55))
    .force('charge', d3.forceManyBody().strength(-450).distanceMax(850))
    .force('processSeparation', d3.forceManyBody()
      .strength((d) => d.kind === 'process' || d.kind === 'parent' ? -1350 : 0)
      .distanceMax(1400))
    .force('x', d3.forceX((d) => d.componentX).strength(0.08))
    .force('y', d3.forceY((d) => d.componentY).strength(0.08))
    .force('collision', d3.forceCollide().radius(46).strength(0.9).iterations(2))
    .on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      for (const d of nodes) graphPositions.set(d.id, { x: d.x, y: d.y });
    });

  node.call(drag(graphSimulation));
}

function getProcessIdentityIndex() {
  if (processIdentityRevision !== state.eventsRevision) {
    processIdentityByPid = buildProcessIdentityIndex(state.events);
    processIdentityRevision = state.eventsRevision;
  }
  return processIdentityByPid;
}

function ensureNode(map, id, label, kind, event) {
  if (!map.has(id)) map.set(id, { id, label, kind, isRoot: false, count: 0, samples: [] });
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

function assignComponentCenters(nodes, links, width, height) {
  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };

  for (const link of links) {
    const sourceRoot = find(link.source);
    const targetRoot = find(link.target);
    if (sourceRoot !== targetRoot) parent.set(targetRoot, sourceRoot);
  }

  const components = d3.groups(nodes, (node) => find(node.id))
    .map(([, members]) => members)
    .sort((a, b) => d3.descending(a.length, b.length));
  const columns = Math.max(1, Math.ceil(Math.sqrt(components.length * width / height)));
  const rows = Math.ceil(components.length / columns);

  components.forEach((members, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const componentX = (column + 0.5) * width / columns;
    const componentY = (row + 0.5) * height / rows;
    for (const node of members) {
      node.componentX = componentX;
      node.componentY = componentY;
    }
  });
}

function buildProcessIdentityIndex(events) {
  const index = new Map();
  const bestExecByPid = new Map();
  const activityNameByPid = new Map();

  for (const event of events) {
    if (event.type === 'EXEC' && event.host_pid && event.file) {
      const current = bestExecByPid.get(event.host_pid);
      const score = executablePathScore(event);
      if (!current || score > current.score) {
        bestExecByPid.set(event.host_pid, { event, score });
      }
    }
    if (event.host_pid && event.comm && !activityNameByPid.has(event.host_pid)) {
      activityNameByPid.set(event.host_pid, event.comm);
    }
  }

  for (const [pid, candidate] of bestExecByPid) {
    const executablePath = candidate.event.file;
    index.set(pid, { key: `path:${executablePath}`, label: executablePath });
  }

  // Some processes have activity records but no EXEC record in the retained
  // history. Group those by their observed comm value instead.
  for (const [pid, comm] of activityNameByPid) {
    if (!index.has(pid)) index.set(pid, { key: `comm:${comm}`, label: comm });
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

function buildAccessDirectoryRollups(events, identityByPid) {
  const directoriesByGroup = new Map();
  const filesByGroup = new Map();

  for (const event of events) {
    if (event.type !== 'RO' && event.type !== 'RW') continue;
    const processIdentity = processIdentityFor(event, identityByPid);
    const processId = `process:${processIdentity.key}`;
    const groupId = `${processId}:${event.type}`;
    const file = event.path || event.file || 'unknown file';
    const directory = parentDirectoryFor(file);
    if (!directoriesByGroup.has(groupId)) directoriesByGroup.set(groupId, new Set());
    if (!filesByGroup.has(groupId)) filesByGroup.set(groupId, new Set());
    directoriesByGroup.get(groupId).add(directory);
    filesByGroup.get(groupId).add(file);
  }

  const rollups = new Map();
  for (const [groupId, directories] of directoriesByGroup) {
    const currentByOriginal = new Map([...directories].map((directory) => [directory, directory]));
    let distinct = new Set(currentByOriginal.values());

    while (distinct.size > MAX_ACCESS_TARGETS_PER_PROCESS) {
      let changed = false;
      for (const [original, current] of currentByOriginal) {
        const candidate = parentDirectoryFor(current);
        const parent = current !== '/' && candidate === '/' ? current : candidate;
        if (parent !== current) changed = true;
        currentByOriginal.set(original, parent);
      }
      distinct = new Set(currentByOriginal.values());
      if (!changed) break;
    }

    for (const [original, directory] of currentByOriginal) {
      rollups.set(`${groupId}:${original}`, {
        directory,
        aggregated: true,
      });
    }

    // When directory grouping leaves a sparse graph, promote individual files
    // until the group has at most ACCESS_FILE_DETAIL_TARGET total targets.
    if (distinct.size < ACCESS_FILE_DETAIL_TARGET) {
      const files = [...filesByGroup.get(groupId)].sort();
      const targetByFile = new Map(files.map((file) => [
        file,
        currentByOriginal.get(parentDirectoryFor(file)),
      ]));

      for (const file of files) {
        const previous = targetByFile.get(file);
        targetByFile.set(file, file);
        if (new Set(targetByFile.values()).size > ACCESS_FILE_DETAIL_TARGET) {
          targetByFile.set(file, previous);
        }
      }

      const remainingDirectoryTargets = new Set(
        [...targetByFile].filter(([file, target]) => file !== target).map(([, target]) => target),
      );
      for (const [file, target] of targetByFile) {
        if (file === target) {
          rollups.set(`file:${groupId}:${file}`, { directory: file, aggregated: false });
        }
      }
      for (const [original, directory] of currentByOriginal) {
        if (remainingDirectoryTargets.has(directory)) {
          rollups.get(`${groupId}:${original}`).aggregated = true;
        }
      }
    }
  }

  return rollups;
}

function graphTargetFor(event, processId, accessDirectoryRollups) {
  if (event.type === 'RO' || event.type === 'RW') {
    const file = event.path || event.file || 'unknown file';
    const directory = parentDirectoryFor(file);
    const groupId = `${processId}:${event.type}`;
    const rollup = accessDirectoryRollups.get(`file:${groupId}:${file}`)
      || accessDirectoryRollups.get(`${groupId}:${directory}`);
    const rolledUp = rollup?.directory || directory;
    const displayTarget = rollup?.aggregated
      ? (rolledUp === '/' ? '/*' : `${rolledUp}/*`)
      : rolledUp;
    return {
      key: rolledUp,
      label: `${event.type} ${displayTarget}`,
    };
  }

  const target = targetFor(event);
  if (event.type === 'CONNECT') {
    const protocol = String(event.protocol || 'unknown').toUpperCase();
    return { key: `${protocol}:${target}`, label: `${protocol} ${target}` };
  }
  return { key: target, label: target };
}

function graphTargetId(event, target, processId) {
  if (event.type === 'RO' || event.type === 'RW' || event.type === 'CONNECT') {
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

  const dated = events.filter((event) => event.time).map((event) => new Date(event.time));
  els.rateMeta.textContent = `${dated.length} timed`;
  if (!dated.length) {
    drawEmpty(svg, width, height, 'Timed events appear here');
    return;
  }

  const extent = d3.extent(dated);
  if (+extent[0] === +extent[1]) extent[1] = new Date(+extent[0] + 1000);
  const x = d3.scaleTime().domain(extent).range([margin.left, width - margin.right]);
  const bins = d3.bin().domain(x.domain()).thresholds(40)(dated);
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
  if (parts.length > 1) {
    const parent = parts.at(-2);
    const filename = parts.at(-1);
    const dot = filename.lastIndexOf('.');
    const extension = dot > 0 && filename.length - dot <= 10 ? filename.slice(dot) : '';
    const stem = extension ? filename.slice(0, dot) : filename;
    const prefix = `.../${parent}/`;
    const stemLength = Math.max(3, maxLength - prefix.length - extension.length - 1);
    const compactFilename = stem.length > stemLength
      ? `${stem.slice(0, stemLength)}*${extension}`
      : filename;
    const compact = `${prefix}${compactFilename}`;
    if (compact.length <= maxLength) return compact;

    const parentLength = Math.max(3, maxLength - compactFilename.length - 6);
    return `.../${parent.slice(0, parentLength)}*/${compactFilename}`;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(+date)) return value;
  return date.toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function nodeTooltip(d) {
  const nodeKind = d.kind === 'parent' ? 'process' : d.kind;
  const role = d.isRoot ? `${nodeKind}, root command (no observed parent)` : nodeKind;
  return `<strong>${escapeHtml(d.label)}</strong><br>${escapeHtml(role)} - ${d.count} events<br>${d.samples.map(escapeHtml).join('<br>')}`;
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
      graphPositions.set(d.id, { x: event.x, y: event.y });
    })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
      graphPositions.set(d.id, { x: d.x, y: d.y });
    });
}
