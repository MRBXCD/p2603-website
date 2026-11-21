'use strict';

// AGT project page: plain JS, no dependencies.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// ---------------- navigation: active tab follows the scroll position, scroll-to-top appears after 300px ----------------
(function navigation() {
  const tabs = [...document.querySelectorAll('.nav-tab')];
  const anchors = [['top', 'top'], ['abstract', 'top'], ['videos', 'videos'], ['results', 'results'], ['findings', 'results'],
    ['dataset', 'method'], ['method', 'method'], ['citation', 'method']]
    .map(([id, tab]) => [document.getElementById(id), tab]).filter(([node]) => node);
  const scrollButton = document.getElementById('scroll-top');
  let queued = false;
  function update() {
    queued = false;
    let current = 'top';
    anchors.forEach(([node, tab]) => { if (node.getBoundingClientRect().top <= 140) current = tab; });
    tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.spy === current));
    if (scrollButton) scrollButton.classList.toggle('visible', window.scrollY > 300);
  }
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, {passive: true});
  if (scrollButton) scrollButton.addEventListener('click', () => window.scrollTo({top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth'}));
  update();
})();

// ---------------- grid videos: one video per case with every method side by side, buttons switch the case ----------------
(function gridPlayers() {
  const source = document.getElementById('grid-data');
  if (!source) return;
  const groups = JSON.parse(source.textContent);

  function makePlayer(mount, group) {
    const state = {index: 0, paused: reduceMotion.matches, visible: false};
    mount.innerHTML =
      '<div class="gv-head"><h3 class="gv-title"></h3><div class="gv-cases" role="group"></div></div>' +
      '<div class="gv-scroll"><div class="gv-stage"><video muted loop playsinline preload="metadata"></video></div></div>';
    mount.querySelector('.gv-title').textContent = group.title;
    const stage = mount.querySelector('.gv-stage');
    const video = stage.querySelector('video');
    const cases = mount.querySelector('.gv-cases');
    cases.setAttribute('aria-label', group.title + ': choose a clip');
    stage.style.aspectRatio = group.width + ' / ' + group.height;
    video.muted = true;
    video.setAttribute('aria-label', group.title + ', from left to right and top to bottom: ' + group.cells.map(cell => cell.label).join(', '));

    // Labels sit on top of the cells of the video; the frame around the last cell marks our method.
    group.cells.forEach(cell => {
      const box = document.createElement('div');
      box.className = 'gv-cell' + (cell.ours ? ' is-ours' : '');
      box.style.cssText = `left:${cell.x}%;top:${cell.y}%;width:${cell.w}%;height:${cell.h}%`;
      const label = document.createElement('span');
      label.className = 'gv-label';
      label.textContent = cell.label;
      box.appendChild(label);
      stage.appendChild(box);
    });

    const button = document.createElement('button');
    button.className = 'gv-playbtn';
    button.type = 'button';
    button.addEventListener('click', () => { state.paused = !state.paused; refresh(); });
    stage.appendChild(button);

    function refresh() {
      if (state.paused || !state.visible || document.hidden) video.pause(); else video.play().catch(() => {});
      button.innerHTML = icon(state.paused ? 'play' : 'pause');
      button.setAttribute('aria-label', state.paused ? 'Play' : 'Pause');
    }
    function show(index) {
      state.index = index;
      const item = group.cases[index];
      stage.classList.add('is-switching');
      video.poster = item.poster;
      video.src = item.src;
      video.load();
      video.addEventListener('loadeddata', () => stage.classList.remove('is-switching'), {once: true});
      [...cases.children].forEach((node, k) => {
        node.classList.toggle('is-active', k === index);
        node.setAttribute('aria-pressed', String(k === index));
      });
      refresh();
    }
    group.cases.forEach((item, index) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'gv-case';
      pill.textContent = item.label;
      pill.addEventListener('click', () => { if (index !== state.index) show(index); });
      cases.appendChild(pill);
    });
    if (group.cases.length < 2) cases.hidden = true;

    show(0);
    // A video that is scrolled off screen does not decode.
    new IntersectionObserver(entries => {
      state.visible = entries[0].isIntersecting;
      refresh();
    }, {threshold: 0.1}).observe(stage);
    document.addEventListener('visibilitychange', refresh);
  }

  document.querySelectorAll('[data-grid]').forEach(mount => {
    const group = groups[mount.dataset.grid];
    if (group) makePlayer(mount, group); else mount.hidden = true;
  });
})();

// ---------------- results explorer: horizontal bars read from the main results table ----------------
(function resultsExplorer() {
  const table = document.getElementById('main-table');
  const host = document.getElementById('re-chart');
  if (!table || !host) return;
  const tooltip = document.getElementById('re-tooltip');
  const tableView = document.getElementById('re-table');
  const tableButton = document.getElementById('re-table-btn');

  const GROUP_INFO = [
    {color: 'var(--region-full)', desc: 'All pixels of the held-out frames.'},
    {color: 'var(--region-obs)', desc: 'Pixels whose scene point is seen by at least one input frame, so their content can be reconstructed from the input.'},
    {color: 'var(--region-unobs)', desc: 'Pixels behind the occluder that no input frame observes. Recovering them is inpainting rather than reconstruction, so DISTS replaces SSIM here.'},
    {color: 'var(--region-depth)', desc: 'Depth of the reconstructed scene on the held-out frames.'},
  ];
  const UNITS = {PSNR: 'dB'};

  // Columns: the first header row groups the metric columns of the second one.
  const [groupRow, metricRow] = table.tHead.rows;
  const metricCells = [...metricRow.cells];
  const groups = [];
  let column = 0;
  [...groupRow.cells].slice(1).forEach((cell, index) => {
    const metrics = [];
    for (let k = 0; k < cell.colSpan; k++, column++) {
      const text = metricCells[column].textContent.trim();
      const name = text.replace(/[↑↓]/g, '');
      metrics.push({name, column, higherBetter: text.includes('↑'), unit: UNITS[name] || ''});
    }
    groups.push(Object.assign({name: cell.textContent.trim(), metrics}, GROUP_INFO[index]));
  });
  const methods = [...table.tBodies[0].rows].map(row => {
    const cells = [...row.cells].slice(1).map(cell => cell.textContent.trim());
    return {
      name: row.cells[0].textContent.trim().replace(' (Ours)', ''),
      ours: row.classList.contains('ours') || row.classList.contains('variant'),
      final: row.classList.contains('ours'),
      text: cells,
      values: cells.map(parseFloat),
    };
  });
  const final = methods.find(method => method.final);

  const state = {group: 0, metric: 0, table: false};
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent, text) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text != null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };
  const decimals = text => (text.split('.')[1] || '').length;
  function niceTicks(max, count) {
    const raw = max / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / magnitude;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
    const ticks = [];
    for (let t = 0; t <= max + 1e-9; t += step) ticks.push(+t.toFixed(10));
    return ticks;
  }
  // Square at the baseline, rounded at the data end.
  function barPath(x0, y, w, h, r) {
    const rr = Math.min(r, w, h / 2);
    return `M${x0} ${y}H${x0 + w - rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}V${y + h - rr}a${rr} ${rr} 0 0 1 -${rr} ${rr}H${x0}Z`;
  }

  function buttons(hostId, className, items, active, onPick, decorate) {
    const box = document.getElementById(hostId);
    box.innerHTML = '';
    items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className + (index === active ? ' is-active' : '');
      button.setAttribute('aria-pressed', String(index === active));
      button.textContent = item.name;
      if (decorate) decorate(button, item);
      button.addEventListener('click', () => onPick(index));
      box.appendChild(button);
    });
  }

  function renderChart(group, metric) {
    host.innerHTML = '';
    const places = Math.max(...methods.map(method => decimals(method.text[metric.column])));
    const fmt = value => value.toFixed(places);
    const values = methods.map(method => method.values[metric.column]);

    const W = Math.max(340, Math.round(host.clientWidth || 780));
    const compact = W < 560;
    const mL = compact ? 122 : 148, mR = 56, mT = 10, mB = 40;
    const barH = 16, groupH = 32;
    const plotW = W - mL - mR, plotH = methods.length * groupH, H = plotH + mT + mB;
    const axisMax = Math.max(...values) * 1.14;
    const x = value => mL + value / axisMax * plotW;

    const svg = el('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': `${group.name} ${metric.name} of each method. ` + methods.map((method, i) => `${method.name} ${fmt(values[i])}`).join(', ')}, host);
    niceTicks(axisMax, compact ? 3 : 5).forEach(tick => {
      el('line', {class: tick === 0 ? 'base' : 'grid', x1: x(tick), x2: x(tick), y1: mT, y2: mT + plotH}, svg);
      el('text', {class: 'tick', x: x(tick), y: mT + plotH + 16, 'text-anchor': 'middle'}, svg, String(+tick.toFixed(4)));
    });
    el('text', {class: 'cap', x: mL + plotW / 2, y: H - 6, 'text-anchor': 'middle'}, svg,
      (metric.unit ? metric.unit + '  ·  ' : '') + (metric.higherBetter ? 'higher is better ↑' : 'lower is better ↓'));

    methods.forEach((method, i) => {
      const top = mT + i * groupH + (groupH - barH) / 2;
      const w = Math.max(values[i] / axisMax * plotW, 0.75);
      el('text', {class: 'name' + (method.ours ? ' ours' : ''), x: mL - 10, y: top + barH - 3.5, 'text-anchor': 'end'}, svg, method.name);
      const bar = el('path', {class: 'bar ' + (method.ours ? 'ours' : 'prior'), d: barPath(mL, top, w, barH, 4)}, svg);
      el('text', {class: 'val' + (method.ours ? ' ours' : ''), x: mL + w + 6, y: top + barH - 3.5}, svg, fmt(values[i]));
      // The hover target is larger than the mark.
      const hit = el('rect', {class: 'hit', x: 0, y: top - 6, width: W, height: barH + 12}, svg);
      hit.addEventListener('pointermove', event => {
        let html = `<b>${method.name}</b><br>${group.name} ${metric.name}: <b>${fmt(values[i])}</b> <span class="unit">${metric.unit}</span>`;
        if (!method.final) {
          const delta = final.values[metric.column] - values[i];
          html += `<br>AGT: ${fmt(final.values[metric.column])} (${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))})`;
        }
        tooltip.innerHTML = html;
        tooltip.style.opacity = 1;
        const box = host.getBoundingClientRect();
        tooltip.style.left = Math.max(0, Math.min(event.clientX - box.left + 14, box.width - tooltip.offsetWidth - 4)) + 'px';
        tooltip.style.top = (event.clientY - box.top + 14) + 'px';
        bar.classList.add('is-hover');
      });
      hit.addEventListener('pointerleave', () => { tooltip.style.opacity = 0; bar.classList.remove('is-hover'); });
    });
  }

  function render() {
    const group = groups[state.group];
    const metric = group.metrics[state.metric];
    buttons('re-tabs', 're-tab', groups, state.group, index => { state.group = index; state.metric = 0; render(); },
      (button, item) => button.style.setProperty('--dim-color', item.color));
    buttons('re-metrics', 're-pill', group.metrics, state.metric, index => { state.metric = index; render(); });
    const title = document.getElementById('re-title');
    title.innerHTML = '<span class="re-code"></span>';
    title.firstChild.textContent = group.name;
    title.firstChild.style.setProperty('--dim-color', group.color);
    title.append(metric.name);
    document.getElementById('re-desc').textContent = group.desc;
    const legend = document.getElementById('re-legend');
    legend.innerHTML =
      '<span class="re-key"><span class="re-swatch ours"></span>AGT (ours)</span>' +
      '<span class="re-key"><span class="re-swatch prior"></span>Prior methods</span>';
    legend.hidden = state.table;
    host.parentElement.hidden = state.table;
    tableView.hidden = !state.table;
    tableButton.innerHTML = state.table ? `${icon('chart')}<span>Chart</span>` : `${icon('table')}<span>Data table</span>`;
    tableButton.setAttribute('aria-pressed', String(state.table));
    if (!state.table) renderChart(group, metric);
  }
  tableButton.addEventListener('click', () => { state.table = !state.table; render(); });
  let resizeTimer = 0, lastWidth = host.clientWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.table && host.clientWidth !== lastWidth) { lastWidth = host.clientWidth; render(); }
    }, 150);
  });
  render();
})();

// ---------------- enlarged paper figures ----------------
(function figures() {
  const dialog = document.getElementById('figure-dialog');
  const image = document.getElementById('figure-image');
  if (!dialog) return;
  document.querySelectorAll('.figure-open').forEach(button => button.addEventListener('click', () => {
    const source = button.querySelector('img');
    document.getElementById('figure-title').textContent = button.dataset.figureTitle;
    image.src = source.currentSrc || source.src;
    image.alt = source.alt;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    dialog.querySelector('.figure-viewport').scrollTo(0, 0);
  }));
  document.getElementById('figure-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { document.body.style.overflow = ''; });
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
})();

// ---------------- copy the citation; where the clipboard is refused, select the text instead ----------------
(function citation() {
  const button = document.getElementById('copy-bibtex');
  if (!button) return;
  const label = button.querySelector('.copy-text');
  const code = document.getElementById('bibtex-code');
  const flash = text => { label.textContent = text; setTimeout(() => { label.textContent = 'Copy'; }, 2000); };
  const select = () => {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    flash('Selected');
  };
  button.addEventListener('click', () => {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code.textContent).then(() => flash('Copied!'), select);
    else select();
  });
})();
