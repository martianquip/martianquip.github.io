'use strict';
const WhiskyTree = (() => {
  const AXIS = 112, SLOT = 102, ROW = 180, HEAD = 62, CARD = 96, HEIGHT = 144, LEVELS = 6, MAX_BOTTLES = 10;
  const LEVEL_COLORS = ['#ffffff', '#fbfaf6', '#f3f5ee', '#ebf0e5', '#e3eadc', '#dbe4d2'];
  const COLUMN_GAP = 6;
  const LINEUP_COLORS = new Map([['버번','#aa6d2d'], ['라이','#37806a'], ['스카치','#536da1'], ['기타','#688259']]);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const uid = () => crypto.randomUUID();
  let root, records = [], byId = new Map(), doc, revision = 0, active, selected = null;
  let history = [], future = [], changed = 0, saved = 0, saving = false, error = '', timer, epoch = 0, loading;
  let search = '', filter = 'board', showPlaced = false, grid = false, dragId, dragColumnId, scrollTimer;
  const board = () => doc.boards.find(b => b.id === active) || doc.boards[0];
  const name = id => doc.labels[id] || byId.get(id)?.name || '리뷰를 찾을 수 없음';
  const photo = id => safeImage(byId.get(id)?.catalog?.photo_url);
  const recommended = id => doc.recommended.includes(id);
  const autoLineup = id => {
    const c = byId.get(id)?.catalog || {};
    if (c.primary_type === '라이') return '라이';
    if (['버번', '테네시'].includes(c.primary_type)) return '버번';
    return /스카치|scotch/i.test(c.origin || '') || c.country === '스코틀랜드' ? '스카치' : '기타';
  };
  const lineup = node => node.lineup || autoLineup(node.review_id);
  const lineupColor = value => (LINEUP_COLORS.get(value)
    || ['#8c5885','#426d91','#906437','#72713a'][Array.from(value).reduce((hash, ch) => (hash * 31 + ch.codePointAt(0)) >>> 0, 0) % 4]);
  function setRecommended(id, checked) {
    doc.recommended = doc.recommended.filter(value => value !== id);
    if (checked) doc.recommended.push(id);
  }
  const thumbsUp = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 10 11 2c2 0 3 2 2 5l-1 3h7a2 2 0 0 1 2 2l-1 8a2 2 0 0 1-2 2H7Zm0 0H3v12h4Z" fill="#f6c445" stroke="#94671a" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const settingsIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><polygon points="11.02,2.05 12.98,2.05 14.26,4.54 15.68,5.12 18.34,4.27 19.73,5.66 18.88,8.32 19.46,9.74 21.95,11.02 21.95,12.98 19.46,14.26 18.88,15.68 19.73,18.34 18.34,19.73 15.68,18.88 14.26,19.46 12.98,21.95 11.02,21.95 9.74,19.46 8.32,18.88 5.66,19.73 4.27,18.34 5.12,15.68 4.54,14.26 2.05,12.98 2.05,11.02 4.54,9.74 5.12,8.32 4.27,5.66 5.66,4.27 8.32,5.12 9.74,4.54"/><circle cx="12" cy="12" r="3"/></svg>';
  const removeIcon = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg>';
  function productControls(id, placed = false) {
    return `<div class="wt-card-actions"><button class="wt-more" data-edit-label="${e(id)}" aria-label="${e(name(id))} 제품 설정" aria-haspopup="dialog" title="이름·라인업·추천 설정">${settingsIcon}</button>${placed ? `<button class="wt-remove" data-remove="${e(id)}" aria-label="${e(name(id))} 풀로 돌려놓기" title="풀로 돌려놓기">${removeIcon}</button>` : ''}</div><button class="wt-recommend-badge ${recommended(id) ? 'active' : ''}" data-recommend="${e(id)}" aria-pressed="${recommended(id)}" aria-label="${e(name(id))} 추천" title="${recommended(id) ? '추천 해제' : '추천 제품으로 표시'}">${thumbsUp}</button>`;
  }
  function acceptDocument(result) {
    if (result.document?.version !== 3 || !Array.isArray(result.document.recommended)) throw Error('앱 실행 파일로 서버를 다시 시작한 뒤 새로고침해 주세요. 새 트리 저장 형식이 필요합니다.');
    doc = result.document; revision = result.revision;
  }
  const money = id => {
    const r = byId.get(id);
    return r?.price > 0 && r.catalog?.sample_type === '보틀' ? Number(r.price).toLocaleString('ko-KR') + '원' : '보틀 가격 미확인';
  };
  const rowNodes = (b, col, level) => b.nodes.filter(n => n.column_id === col && n.level === level);
  // Share occupied slot coordinates across levels without adding spare columns.
  const rowSlots = (b, col) => Math.max(1, ...b.nodes.filter(n => n.column_id === col).map(n => n.slot + 1));
  const rowEnd = (b, col, level) => Math.max(-1, ...rowNodes(b, col, level).map(n => n.slot)) + 1;
  const freeSlot = (b, col, level) => Array.from({length:MAX_BOTTLES}, (_, i) => i).find(i => !rowNodes(b, col, level).some(n => n.slot === i)) ?? -1;
  const additionSlot = (b, col, level) => {
    const next = rowEnd(b, col, level);
    return next < MAX_BOTTLES ? next : freeSlot(b, col, level);
  };
  function layout(b) {
    let width = AXIS;
    const positions = new Map();
    const columns = new Map(b.columns.map(col => {
      const left = width, nodes = b.nodes.filter(n => n.column_id === col.id);
      const lanes = [...new Set(nodes.map(lineup))].map(tag => {
        const members = nodes.filter(n => lineup(n) === tag);
        const rows = Array.from({length:LEVELS}, (_, level) => members.filter(n => n.level === level));
        const span = Math.max(1, ...rows.filter(r => r.length).map(r => Math.max(...r.map(n => n.slot)) - Math.min(...r.map(n => n.slot)) + 1));
        return {tag, rows, span, first:Math.min(...members.map(n => n.slot))};
      }).sort((a,z) => a.first-z.first || a.tag.localeCompare(z.tag,'ko'));
      let offset = 0;
      for (const lane of lanes) {
        for (const row of lane.rows) {
          if (!row.length) continue;
          const first = Math.min(...row.map(n => n.slot)), span = Math.max(...row.map(n => n.slot))-first+1;
          // Half-slot offsets are visual only: odd/even rows share the exact centre.
          for (const n of row) positions.set(n.review_id, left+12+(offset+(lane.span-span)/2+n.slot-first)*SLOT);
        }
        offset += lane.span + 1;
      }
      const size = Math.max(220, Math.max(1,offset-1)*SLOT+54); width += size;
      return [col.id, {left, width:size}];
    }));
    return {columns, positions, width};
  }
  function position(b, n, geometry) {
    let x = geometry.positions.get(n.review_id);
    if (x == null) {
      const row = rowNodes(b,n.column_id,n.level).sort((a,z)=>a.slot-z.slot);
      const exact = row.find(v=>v.slot===n.slot);
      const before = row.filter(v=>v.slot<n.slot).at(-1), after = row.find(v=>v.slot>n.slot);
      if (exact) x = geometry.positions.get(exact.review_id);
      else if (before && after) x = geometry.positions.get(before.review_id)+(geometry.positions.get(after.review_id)-geometry.positions.get(before.review_id))*(n.slot-before.slot)/(after.slot-before.slot);
      else if (before) x = geometry.positions.get(before.review_id)+(n.slot-before.slot)*SLOT;
      else if (after) x = geometry.positions.get(after.review_id)-(after.slot-n.slot)*SLOT;
      else x = geometry.columns.get(n.column_id).left+12+n.slot*SLOT;
    }
    return {x, y:HEAD+n.level*ROW+12};
  }
  const columnGaps = (b, geometry, height) => b.columns.slice(0, -1).map(col => {
    const bounds = geometry.columns.get(col.id);
    return `<rect class="wt-column-gap" x="${bounds.left + bounds.width - COLUMN_GAP}" y="0" width="${COLUMN_GAP}" height="${height}" fill="#fff"/>`;
  }).join('');

  function alignedNodes(b) {
    const result = b.nodes.map(n => ({...n}));
    for (const col of b.columns) {
      const nodes = result.filter(n => n.column_id === col.id);
      const lanes = [...new Set(nodes.map(lineup))].map(tag => {
        const members = nodes.filter(n => lineup(n) === tag);
        const rows = Array.from({length:LEVELS}, (_, level) => members.filter(n => n.level === level)).filter(row => row.length);
        const span = Math.max(...rows.map(row => Math.max(...row.map(n => n.slot)) - Math.min(...row.map(n => n.slot)) + 1));
        return {tag, rows, width:span, first:Math.min(...members.map(n => n.slot))};
      }).sort((a, z) => a.first - z.first || a.tag.localeCompare(z.tag, 'ko'));
      if (!lanes.length) continue;
      const total = lanes.reduce((sum, lane) => sum + lane.width, lanes.length - 1);
      if (total > MAX_BOTTLES) throw Error(`${col.name}: 라인업을 나누려면 10칸보다 넓은 공간이 필요합니다. 증류소 열을 나눠 주세요. 배치는 변경하지 않았습니다.`);
      let left = 0;
      for (const lane of lanes) {
        for (const row of lane.rows) {
          const first = Math.min(...row.map(n => n.slot)), span = Math.max(...row.map(n => n.slot)) - first + 1;
          const offset = left + Math.floor((lane.width - span) / 2) - first;
          row.forEach(n => {n.slot += offset;});
        }
        left += lane.width + 1;
      }
    }
    return result;
  }

  // Consecutive occupied slots form a group; an empty slot separates branches.
  function slotGroups(nodes) {
    const groups = [];
    for (const node of [...nodes].sort((a, b) => a.slot - b.slot)) {
      const previous = groups.at(-1);
      if (previous && node.slot === previous.at(-1).slot + 1) previous.push(node);
      else groups.push([node]);
    }
    return groups;
  }
  const groupSlot = group => (group[0].slot + group.at(-1).slot) / 2;
  // Preserve left-to-right branches within each lineup and distillery.
  function connections(b) {
    const result = [];
    for (const col of b.columns) {
      const columnNodes = b.nodes.filter(n => n.column_id === col.id);
      for (const tag of new Set(columnNodes.map(lineup))) {
        const nodes = columnNodes.filter(n => lineup(n) === tag);
        const levels = [...new Set(nodes.map(n => n.level))].sort((a, b) => a - b);
        for (let i = 1; i < levels.length; i++) {
          const sources = slotGroups(nodes.filter(n => n.level === levels[i - 1]));
          const targets = slotGroups(nodes.filter(n => n.level === levels[i]));
          const reverse = sources.length < targets.length;
          const more = reverse ? targets : sources, fewer = reverse ? sources : targets;
          let best = [], bestCost = Infinity;
          // At most five groups in ten slots: at most six contiguous partitions.
          // Every group stays connected; distance ties never add extra cross-links.
          const match = (start, index, pairs, cost) => {
            if (index === fewer.length) {
              if (cost < bestCost) {best = pairs; bestCost = cost;}
              return;
            }
            const limit = more.length - (fewer.length - index - 1);
            for (let end = start + 1; end <= limit; end++) {
              if (index === fewer.length - 1 && end !== more.length) continue;
              const group = more.slice(start, end), target = fewer[index];
              match(end, index + 1,
                pairs.concat(group.map(source => reverse ? [target, source] : [source, target])),
                cost + group.reduce((sum, source) => sum + Math.abs(groupSlot(source) - groupSlot(target)), 0));
            }
          };
          match(0, 0, [], 0);
          result.push(...best);
        }
      }
    }
    return result;
  }
  function taperedPath(a, z, startWidth, endWidth) {
    const dx = z.x - a.x, dy = z.y - a.y;
    // Angled control points avoid tight folds when wide groups meet in a short gap.
    const c1 = {x:a.x + dx * .25, y:a.y + dy * .55};
    const c2 = {x:z.x - dx * .25, y:z.y - dy * .55};
    const left = [], right = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, u = 1 - t;
      const x = u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * z.x;
      const y = u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * z.y;
      const tx = 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (z.x - c2.x);
      const ty = 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (z.y - c2.y);
      const half = (startWidth + (endWidth - startWidth) * t) / 2, length = Math.hypot(tx, ty) || 1;
      const nx = ty / length * half, ny = -tx / length * half;
      left.push(`${(x - nx).toFixed(2)} ${(y - ny).toFixed(2)}`);
      right.push(`${(x + nx).toFixed(2)} ${(y + ny).toFixed(2)}`);
    }
    return `M ${left.join(' L ')} L ${right.reverse().join(' L ')} Z`;
  }
  function treeLines(b, geometry) {
    const branches = new Map();
    for (const [source, target] of connections(b)) {
      if (!branches.has(source)) branches.set(source, []);
      branches.get(source).push(target);
    }
    const point = (node, from) => {
      const p = position(b, node, geometry);
      return {x:p.x + CARD / 2, y:p.y + (from ? HEIGHT + 3 : -3)};
    };
    const ribbon = (a, z, start, end, part) => `<path data-part="${part}" d="${taperedPath(a, z, start, end)}"/>`;
    return [...branches].map(([source, targets]) => {
      const starts = source.map(n => point(n, true)), y = starts[0].y, bottom = point(targets[0][0], false).y, gap = bottom - y;
      const hub = {x:starts.reduce((sum, p) => sum + p.x, 0) / starts.length, y:y + (source.length > 1 ? gap * .42 : 0)};
      let paths = source.length > 1 ? starts.map(p => ribbon(p, hub, 4.5, 2.8, 'source')).join('') : '';
      for (const target of targets) {
        const ends = target.map(n => point(n, false));
        const end = {x:ends.reduce((sum, p) => sum + p.x, 0) / ends.length, y:bottom - (target.length > 1 ? gap * .25 : 0)};
        paths += ribbon(hub, end, source.length > 1 ? 2.8 : 4.5, target.length > 1 ? 1.9 : 1.2, 'trunk');
        if (target.length > 1) paths += ends.map(p => ribbon(end, p, 1.9, 1.2, 'target')).join('');
      }
      const tag = lineup(source[0]);
      return `<g class="wt-branch" data-source-group="${e(source.map(n => n.review_id).join(','))}" data-lineup="${e(tag)}" fill="${lineupColor(tag)}">${paths}</g>`;
    }).join('');
  }
  function status() {
    if (!root?.isConnected) return;
    const el = root.querySelector('[data-save-status]');
    if (!el) return;
    el.textContent = error || (saving ? '저장 중…' : changed !== saved ? '저장 대기…' : '이 브라우저에 저장됨');
    el.classList.toggle('wt-error', !!error);
    root.querySelector('[data-wt="retry"]').hidden = !error;
    root.querySelector('[data-wt="reload"]').hidden = !error;
    root.querySelector('[data-wt="undo"]').disabled = !history.length;
    root.querySelector('[data-wt="redo"]').disabled = !future.length;
  }
  async function save() {
    clearTimeout(timer);
    if (!doc || saving || changed === saved) return;
    const turn = epoch, snapshot = changed;
    saving = true; error = ''; status();
    try {
      const answer = await api('/api/whisky-tree', {method:'POST', body:JSON.stringify({revision, document:copy(doc)})});
      if (turn !== epoch) return;
      revision = answer.revision; saved = snapshot;
    } catch (err) { if (turn === epoch) error = err.message; }
    finally {
      if (turn === epoch) {
        saving = false; status();
        if (!error && saved !== changed) timer = setTimeout(save, 100);
      }
    }
  }
  async function flush() {
    while (saving) await new Promise(resolve => setTimeout(resolve, 50));
    if (changed !== saved) await save();
    if (changed !== saved) throw Error(error || '트리 저장이 끝나면 다시 잠가 주세요.');
  }
  function change(fn) {
    history.push(copy(doc)); if (history.length > 40) history.shift(); future = [];
    fn(); changed++; clearTimeout(timer); if (!error) timer = setTimeout(save, 400); render();
  }
  function restore(undo) {
    const source = undo ? history : future, target = undo ? future : history;
    if (!source.length) return;
    target.push(copy(doc)); doc = source.pop(); changed++; selected = null;
    clearTimeout(timer); if (!error) timer = setTimeout(save, 400); render();
  }
  function imageCard(id) {
    return `<span class="wt-photo">${photo(id) ? `<img src="${e(photo(id))}" alt="${e(name(id))}" loading="lazy" draggable="false" referrerpolicy="no-referrer">` : '<span>사진 없음</span>'}</span>`;
  }
  function inKind(r, kind) {
    const type = r.catalog?.primary_type || '', origin = r.catalog?.origin || '';
    if (kind === 'bourbon') return ['버번', '라이', '테네시'].includes(type);
    if (kind === 'scotch') return /스카치|scotch/i.test(origin) || r.catalog?.country === '스코틀랜드';
    if (kind === 'other') return !inKind(r, 'bourbon') && !inKind(r, 'scotch');
    return true;
  }
  function pool() {
    if (!root?.isConnected || !doc) return;
    const b = board(), assigned = new Set(b.nodes.map(n => n.review_id));
    const query = search.toLocaleLowerCase().replace(/\s/g, '');
    const rows = records.filter(r => (showPlaced || !assigned.has(r.id)) && inKind(r, filter === 'board' ? b.kind : filter)
      && [name(r.id), r.name, r.english, r.catalog?.distillery].join(' ').toLocaleLowerCase().replace(/\s/g, '').includes(query));
    root.querySelector('[data-pool-count]').textContent = `${rows.length}병`;
    root.querySelector('.wt-pool-list').innerHTML = rows.length ? rows.map(r => `<article class="wt-pool-card ${recommended(r.id) ? 'wt-recommended' : ''} ${selected === r.id ? 'selected' : ''}" data-review="${e(r.id)}" draggable="true">
      <button class="wt-pick" data-pick="${e(r.id)}" aria-pressed="${selected === r.id}" aria-label="${e(name(r.id))} 배치 선택">${imageCard(r.id)}<span class="wt-bottle-name">${e(name(r.id))}</span></button>
      ${productControls(r.id)}
      <small>${assigned.has(r.id) ? '배치됨 · 이동 가능' : e(money(r.id))}</small></article>`).join('') : '<p class="wt-pool-empty">조건에 맞는 보틀이 없습니다. 검색어나 분류를 바꿔 보세요.</p>';
  }
  function render() {
    if (!root?.isConnected || !doc) return;
    const oldStage = root.querySelector('.wt-stage'), oldPool = root.querySelector('.wt-pool-list');
    const top = oldStage?.scrollTop, left = oldStage?.scrollLeft, poolLeft = oldPool?.scrollLeft || 0;
    const b = board(); active = b.id;
    const geometry = layout(b), width = geometry.width, height = HEAD + LEVELS * ROW;
    root.innerHTML = `<header class="wt-heading"><div><h1 lang="en">WHISKEY TREE BUILDER</h1><p>맨 위의 초심에서 시작해 아래로 내려갈수록 취향을 깊이 탐색합니다. 가로로는 증류소를 나눕니다.</p></div><div class="wt-save"><span data-save-status role="status" aria-live="polite"></span><button class="btn small" data-wt="retry" hidden>저장 재시도</button><button class="btn small" data-wt="reload" hidden>저장본 불러오기</button></div></header>
      <div class="wt-topline"><div class="wt-tabs" role="group" aria-label="위스키 보드">${doc.boards.map(item => `<button data-board="${e(item.id)}" aria-pressed="${item.id === b.id}" class="${item.id === b.id ? 'active' : ''}">${e(item.name)}<span>${item.nodes.length}</span></button>`).join('')}<button data-wt="add-board" aria-label="새 보드 추가">＋ 새 보드</button></div><div class="wt-exports"><button class="btn small" data-wt="png">이미지 저장</button><button class="btn small" data-wt="json">JSON 백업</button></div></div>
      <section class="wt-workbench" aria-label="위스키 트리 편집기"><div class="wt-tools"><div class="flex wrap"><button class="btn small" data-wt="board-settings">보드 설정</button><button class="btn small" data-wt="add-column" ${b.columns.length >= 12 ? 'disabled' : ''}>＋ 증류소</button><button class="btn small" data-wt="align-lineups" ${!b.nodes.length ? 'disabled' : ''} title="현재 보드를 라인업별로 정렬하고 같은 라인업 안의 연결선도 다시 계산합니다. 실행 취소할 수 있습니다.">라인업 정렬</button><span class="wt-capacity">0–5단계 · 라인업 중앙 정렬 · 최대 10병</span></div><div class="flex"><label class="wt-grid-switch"><input type="checkbox" data-grid ${grid ? 'checked' : ''}> 격자 보기</label><button class="btn small" data-wt="undo" aria-label="실행 취소">↶</button><button class="btn small" data-wt="redo" aria-label="다시 실행">↷</button></div></div>
      <div class="wt-lineup-legend" aria-label="라인업 안내">${[...new Set(b.nodes.map(lineup))].map(tag => `<span style="--lineup-color:${lineupColor(tag)}">${e(tag)}</span>`).join('')}<small>같은 라인업끼리 연결 · 톱니바퀴로 제품 설정 · 👍 나의 추천</small></div>
      <div class="wt-stage ${grid ? 'show-grid' : ''} ${selected ? 'is-selecting' : ''}" tabindex="0" aria-label="트리 캔버스. 보틀을 선택하고 빈 위치를 누르거나 드래그하세요."><div class="wt-canvas" style="width:${width}px;height:${height}px">
      <div class="wt-column-heads"><div class="wt-axis-title">DEPTH / LEVEL <span>↓ 초심에서 정점으로</span></div>
      ${b.columns.map((col, i) => `<div class="wt-column-title" data-column-drag="${e(col.id)}" draggable="true" style="left:${geometry.columns.get(col.id).left}px;width:${geometry.columns.get(col.id).width}px;${i < b.columns.length - 1 ? `border-right:${COLUMN_GAP}px solid #fff` : ''}" title="좌우로 드래그해 증류소 순서 변경"><span>${String(i + 1).padStart(2, '0')}</span><button data-column-edit="${e(col.id)}" title="증류소 이름·순서 수정">${e(col.name)} <small>✎</small></button><button class="wt-column-handle" data-column-move="${e(col.id)}" aria-label="${e(col.name)} 순서 이동" title="드래그 또는 좌우 방향키로 이동 · 누르면 순서 설정">⠿</button></div>`).join('')}</div>
      <div class="wt-level-axis" style="height:${LEVELS * ROW}px">${b.levels.map((level, i) => `<button class="wt-level-title" data-level-edit="${i}" style="top:${i * ROW}px;height:${ROW}px;background:${LEVEL_COLORS[i]}"><small>LEVEL ${String(i).padStart(2, '0')}</small><strong>${e(level.name)}</strong><span>${e(level.price || '가격대 자유 설정')}</span></button>`).join('')}</div>
      ${b.levels.map((_, i) => `<div class="wt-level-band" style="top:${HEAD + i * ROW}px;height:${ROW}px;background:${LEVEL_COLORS[i]}" aria-hidden="true"></div>`).join('')}
      <svg class="wt-lines" width="${width}" height="${height}" aria-hidden="true">${columnGaps(b, geometry, height)}${treeLines(b, geometry)}</svg>
      ${b.columns.map(col => b.levels.map((level, i) => {
        const slots = rowSlots(b, col.id), end = rowEnd(b, col.id, i), next = additionSlot(b, col.id, i);
        const row = rowNodes(b,col.id,i);
        const p = {x:row.length ? Math.max(...row.map(n=>position(b,n,geometry).x))+SLOT : geometry.columns.get(col.id).left+12, y:HEAD+i*ROW+12};
        return Array.from({length:slots}, (_, slot) => {
          const p = position(b, {column_id:col.id, level:i, slot}, geometry);
          if (p.x < geometry.columns.get(col.id).left+12 || p.x+CARD > geometry.columns.get(col.id).left+geometry.columns.get(col.id).width-COLUMN_GAP) return '';
          return `<button class="wt-cell" data-col="${e(col.id)}" data-level="${i}" data-slot="${slot}" style="left:${p.x}px;top:${p.y}px" aria-label="${e(col.name)} · ${e(level.name)} · ${slot + 1}번 위치">${slot === end ? '' : '<span>＋</span>'}</button>`;
        }).join('') + `<button class="wt-row-add ${next < 0 ? 'full' : ''}" data-col="${e(col.id)}" data-level="${i}" data-slot="${next}" style="left:${p.x}px;top:${p.y}px" aria-label="${e(col.name)} · ${e(level.name)} · ${next < 0 ? '최대 10병 배치됨' : '보틀 추가'}" title="${next < 0 ? '한 레벨에 최대 10병' : '여기에 놓으면 최대 10병까지 자동으로 늘어납니다'}"><span>${next < 0 ? '10/10' : '＋'}</span></button>`;
      }).join('')).join('')}
      ${b.nodes.map(n => { const p = position(b, n, geometry); return `<article class="wt-node ${recommended(n.review_id) ? 'wt-recommended' : ''} ${selected === n.review_id ? 'selected' : ''}" data-review="${e(n.review_id)}" data-col="${e(n.column_id)}" data-level="${n.level}" data-slot="${n.slot}" draggable="true" style="left:${p.x}px;top:${p.y}px" tabindex="0" aria-label="${e(name(n.review_id))}, ${e(b.columns.find(c => c.id === n.column_id).name)}, ${e(b.levels[n.level].name)}. 방향키로 이동, Delete로 풀에 돌려놓기">
        ${productControls(n.review_id, true)}<button class="wt-pick" data-pick="${e(n.review_id)}" aria-label="${e(name(n.review_id))} 이동 선택">${imageCard(n.review_id)}</button><button class="wt-bottle-name" data-edit-label="${e(n.review_id)}" title="제품 이름·라인업·추천 설정">${e(name(n.review_id))}</button></article>`; }).join('')}
      ${!b.nodes.length ? '<div class="wt-empty-canvas"><span>YOUR NEXT CHAPTER</span><strong>입문 보틀부터 놓아 보세요.</strong><p>첫 단계에서 시작해 아래로 이어 놓으면<br>취향을 깊이 탐색하는 트리가 만들어집니다.</p></div>' : ''}</div></div>
      <div class="wt-caption"><span data-selection-hint>${selected ? `${e(name(selected))} 선택됨 · 빈 위치 또는 레벨 오른쪽 ＋를 누르세요. Esc로 취소` : '붙여 놓으면 한 그룹 · 빈칸을 두면 별도 그룹 · ＋로 레벨당 최대 10병까지 배치'}</span><strong>${b.columns.length}개 트리 · ${b.nodes.length}병</strong></div>
      <section class="wt-pool" aria-label="내 보틀 사진 풀"><div class="wt-pool-toolbar"><div><strong>내 보틀 풀</strong> <span data-pool-count></span><small>드래그 또는 선택 후 배치</small></div><div class="wt-pool-filters"><input type="search" data-pool-search placeholder="보틀·증류소 검색" aria-label="보틀·증류소 검색" value="${e(search)}"><select data-pool-filter aria-label="보틀 분류">${[['board','현재 보드 분류'],['all','모든 위스키'],['bourbon','버번 & 라이'],['scotch','스카치'],['other','그 외 위스키']].map(([v, t]) => `<option value="${v}" ${filter === v ? 'selected' : ''}>${t}</option>`).join('')}</select><label><input type="checkbox" data-show-placed ${showPlaced ? 'checked' : ''}> 배치한 보틀도 보기</label></div></div><div class="wt-pool-list"></div></section></section>
      <p class="wt-footnote">사진과 원래 제품명은 내 리뷰에서 가져옵니다. 이름 수정은 트리 표시명에 적용됩니다. 가격대와 레벨은 직접 정하며 보틀 가격은 리뷰 당시 기록입니다. 저장한 트리는 DB 백업에 포함됩니다.</p>
      <dialog class="wt-dialog" aria-labelledby="wt-dialog-title"></dialog>`;
    pool(); status();
    const stage = root.querySelector('.wt-stage');
    stage.scrollTop = top ?? 0; stage.scrollLeft = left || 0;
    root.querySelector('.wt-pool-list').scrollLeft = poolLeft;
  }
  function select(id) {
    selected = selected === id ? null : id; render();
  }
  function place(id, col, level, slot) {
    const b = board(); if (!byId.has(id)) return;
    if (!b.columns.some(c => c.id === col) || level < 0 || level >= LEVELS) return;
    let occupant = b.nodes.find(n => n.column_id === col && n.level === level && n.slot === slot && n.review_id !== id);
    const old = b.nodes.find(n => n.review_id === id);
    if (occupant && !old) {slot = freeSlot(b, col, level); occupant = undefined;}
    if (slot < 0 || slot >= MAX_BOTTLES) return toast('한 증류소의 같은 레벨에는 최대 10병까지 놓을 수 있습니다.');
    if (old?.column_id === col && old.level === level && old.slot === slot) { selected = null; render(); return; }
    change(() => {
      if (occupant) Object.assign(occupant, {column_id:old.column_id, level:old.level, slot:old.slot});
      b.nodes = b.nodes.filter(n => n.review_id !== id);
      b.nodes.push({...old, review_id:id, column_id:col, level, slot}); selected = null;
    });
  }
  const input = (label, field, value, max = 100) => `<label class="field">${label}<input name="${field}" value="${e(value)}" maxlength="${max}" required></label>`;
  function modal(title, fields, submit, onSubmit, extra = '') {
    const dialog = root.querySelector('.wt-dialog');
    dialog.innerHTML = `<form><h2 id="wt-dialog-title">${title}</h2>${fields}<div class="wt-dialog-actions">${extra}<button type="button" class="btn" data-dialog-cancel>취소</button><button class="btn primary" type="submit">${submit}</button></div></form>`;
    dialog.querySelector('[data-dialog-cancel]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault(); event.stopPropagation();
      const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
      for (const el of form.querySelectorAll('input[required]')) if (!el.value.trim()) { el.setCustomValidity('이름을 입력하세요.'); el.reportValidity(); return; }
      dialog.close(); onSubmit(values);
    };
    dialog.oninput = event => event.target.setCustomValidity?.('');
    dialog.showModal();
    dialog.querySelector('input')?.select();
    return dialog;
  }
  function kindSelect(value) {
    return `<label class="field">보틀 풀의 기본 분류<select name="kind">${[['bourbon','버번 & 라이'],['scotch','스카치'],['other','그 외 위스키'],['all','모든 위스키']].map(([v, t]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  }
  function editLabel(id) {
    const node = board().nodes.find(n => n.review_id === id), presets = ['', '버번', '라이', '스카치', '기타'];
    const custom = node?.lineup && !presets.includes(node.lineup);
    const fields = node ? `<label class="field">이 보드의 라인업<select name="lineup">${presets.map(value => `<option value="${value}" ${!custom && (node.lineup || '') === value ? 'selected' : ''}>${value || `자동 분류 · ${autoLineup(id)}`}</option>`).join('')}<option value="custom" ${custom ? 'selected' : ''}>직접 입력</option></select></label><label class="field" data-custom-lineup ${custom ? '' : 'hidden'}>라인업 이름<input name="lineup_custom" maxlength="50" value="${e(custom ? node.lineup : '')}" ${custom ? 'required' : 'disabled'} placeholder="예: 한정판, 셰리, 피트"></label>` : `<p class="field-hint">현재 라인업: ${e(autoLineup(id))} · 트리에 배치한 뒤 변경할 수 있습니다.</p>`;
    const dialog = modal('제품 설정', `${imageCard(id)}${input('트리에 표시할 이름', 'name', name(id), 200)}${fields}<label class="wt-recommend-field"><input type="checkbox" name="recommended" ${recommended(id) ? 'checked' : ''}> 내가 추천하는 제품</label><p class="field-hint">이름과 추천 체크는 모든 보드에 공통 적용됩니다. 라인업은 이 보드의 배치에 적용됩니다.<br>원래 제품명: ${e(byId.get(id)?.name)}</p>`, '저장', values => {
      change(() => {
        doc.labels[id] = values.name.trim();
        if (node) node.lineup = values.lineup === 'custom' ? values.lineup_custom.trim() : values.lineup;
        setRecommended(id, values.recommended === 'on');
      });
      root.querySelector(`.wt-more[data-edit-label="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
    });
    const select = dialog.querySelector('[name="lineup"]');
    if (select) select.onchange = () => {
      const input = dialog.querySelector('[name="lineup_custom"]'), enabled = select.value === 'custom';
      input.parentElement.hidden = !enabled; input.disabled = !enabled; input.required = enabled;
      if (enabled) input.focus();
    };
  }
  function moveColumn(id, targetId, after) {
    const b = board(), source = b.columns.find(col => col.id === id);
    if (!source || id === targetId) return;
    const columns = b.columns.filter(col => col.id !== id), index = columns.findIndex(col => col.id === targetId);
    if (index < 0) return;
    columns.splice(index + (after ? 1 : 0), 0, source);
    if (columns.every((col, i) => col.id === b.columns[i].id)) return;
    change(() => {b.columns = columns;});
    toast(`${source.name} 증류소 순서를 변경했습니다.`);
  }
  function editColumn(id) {
    const b = board(), col = b.columns.find(c => c.id === id), index = b.columns.indexOf(col);
    const dialog = modal('증류소 트리 설정', input('트리 이름', 'name', col.name) + `<label class="field">열 순서<select name="order">${b.columns.map((c, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${i + 1}번째</option>`).join('')}</select></label><p class="field-hint">열을 삭제하면 배치한 보틀은 풀로 돌아갑니다. 실행 취소로 복원할 수 있습니다.</p>`, '저장', values => change(() => {col.name = values.name.trim(); b.columns.splice(index, 1); b.columns.splice(Number(values.order), 0, col);}), b.columns.length > 1 ? '<button type="button" class="btn wt-danger" data-delete>열 삭제</button>' : '');
    dialog.querySelector('[data-delete]')?.addEventListener('click', () => {dialog.close(); change(() => {b.columns = b.columns.filter(c => c.id !== id); b.nodes = b.nodes.filter(n => n.column_id !== id);});});
  }
  function editLevel(index) {
    const b = board(), level = b.levels[index];
    modal('가격 · 레벨 설정', input('레벨 이름', 'name', level.name, 50) + `<label class="field">가격대 · 선택 사항<input name="price" maxlength="60" value="${e(level.price)}" placeholder="예: 5~10만원"></label><p class="field-hint">레벨 0~5의 총 6단계입니다. 각 레벨의 이름과 가격대를 직접 정할 수 있습니다.</p>`, '저장', values => change(() => {Object.assign(level, {name:values.name.trim(), price:values.price.trim()});}));
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function backup() { download(new Blob([JSON.stringify({revision, document:doc}, null, 2)], {type:'application/json'}), 'whiskey-trees.json'); }
  async function exportImage() {
    const b = copy(board()), labels = copy(doc.labels), geometry = layout(b), width = geometry.width, height = HEAD + LEVELS * ROW;
    const recommendedIds = new Set(doc.recommended);
    b.nodes.forEach(node => {node.lineup = lineup(node);});
    const title = b.name, label = id => labels[id] || byId.get(id)?.name || '미확인';
    toast('보틀 사진을 담아 이미지를 만들고 있습니다…');
    let missing = 0;
    const pictures = new Map(await Promise.all(b.nodes.map(async n => {
      try {
        if (!photo(n.review_id)) throw Error('missing');
        const response = await fetch(photo(n.review_id), {credentials:'same-origin'}); if (!response.ok) throw Error('photo');
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw Error('photo');
        const value = await new Promise((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);});
        return [n.review_id, value];
      } catch {missing++; return [n.review_id, ''];}
    })));
    const measure = document.createElement('canvas').getContext('2d');
    const wrap = (value, x, y, size, limit = 10, maxLines = 3) => {
      measure.font = `${size}px "Malgun Gothic", sans-serif`;
      const lines = []; let line = '';
      for (const word of value.split(/\s+/)) {
        const next = line ? line + ' ' + word : word;
        if (measure.measureText(next).width <= limit * size) {line = next; continue;}
        if (line) lines.push(line); line = '';
        for (const char of word) {
          if (line && measure.measureText(line + char).width > limit * size) {lines.push(line); line = '';}
          line += char;
        }
      }
      if (line) lines.push(line);
      if (lines.length > maxLines) {
        const last = maxLines - 1;
        while (lines[last] && measure.measureText(lines[last] + '…').width > limit * size) lines[last] = Array.from(lines[last]).slice(0, -1).join('');
        lines[last] += '…';
      }
      return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}">${lines.slice(0, maxLines).map((line, i) => `<tspan x="${x}" dy="${i ? size + 3 : 0}">${e(line)}</tspan>`).join('')}</text>`;
    };
    const svgBadge = (n, p) => {
      return recommendedIds.has(n.review_id) ? `<g transform="translate(${p.x - 5} ${p.y - 10})"><rect width="28" height="28" rx="8" fill="#fff8db" stroke="#e4b44c"/><g transform="translate(3 3)">${thumbsUp}</g></g>` : '';
    };
    measure.font = '700 24px "Malgun Gothic", sans-serif';
    const headingChars = Array.from(title);
    while (headingChars.length && measure.measureText(headingChars.join('') + (headingChars.join('') === title ? '' : '…')).width > width - 56) headingChars.pop();
    const heading = headingChars.join('') + (headingChars.join('') === title ? '' : '…');
    const subtitle = width < 500 ? 'MARTIANQUIP · 위스키 트리' : 'MARTIANQUIP · 같은 라인업끼리 연결 · 노란 엄지: 나의 추천';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 106}" font-family="Malgun Gothic, sans-serif" fill="#283e35"><rect width="100%" height="100%" fill="#f8f7f2"/><text x="28" y="38" font-size="24" font-weight="700"><title>${e(title)}</title>${e(heading)}</text><text x="28" y="62" font-size="14" fill="#747e71">${e(subtitle)}</text><g transform="translate(0 78)">${b.levels.map((_, i) => `<rect x="0" y="${HEAD + i * ROW}" width="${width}" height="${ROW}" fill="${LEVEL_COLORS[i]}"/>`).join('')}${columnGaps(b, geometry, height)}${b.columns.map((c, i) => wrap(c.name, geometry.columns.get(c.id).left + (geometry.columns.get(c.id).width - (i < b.columns.length - 1 ? COLUMN_GAP : 0)) / 2, 28, 18, (geometry.columns.get(c.id).width - (i < b.columns.length - 1 ? COLUMN_GAP : 0) - 24) / 18, 2)).join('')}${b.levels.map((l, i) => {const y = HEAD + i * ROW + 55; return wrap(l.name, AXIS / 2, y, 13, 7) + wrap(l.price, AXIS / 2, y + 56, 10, 9);}).join('')}${treeLines(b, geometry)}${b.nodes.map(n => {const p = position(b, n, geometry), pic = pictures.get(n.review_id); return `<rect x="${p.x + 1}" y="${p.y + 1}" width="${CARD - 2}" height="${HEIGHT - 2}" rx="10" fill="#fffefa" stroke="${recommendedIds.has(n.review_id) ? '#dca933' : '#e8ecdf'}" stroke-width="${recommendedIds.has(n.review_id) ? 2 : 1}"/>${pic ? `<image href="${e(pic)}" x="${p.x + 4}" y="${p.y + 4}" width="88" height="88" preserveAspectRatio="xMidYMid meet"/>` : wrap('사진 없음', p.x + 48, p.y + 46, 12)}${svgBadge(n, p)}${wrap(label(n.review_id), p.x + 48, p.y + 106, 11, (CARD - 12) / 11)}`;}).join('')}</g></svg>`;
    {
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
      const canvas = document.createElement('canvas'), scale = Math.min(2, 8192 / Math.max(width, height + 106));
      canvas.width = width * scale; canvas.height = (height + 106) * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw Error('이미지를 만들지 못했습니다.');
      download(blob, title.replace(/[\\/:*?"<>|]/g, '_') + '-whiskey-tree.png');
      toast(missing ? `이미지 저장 완료 · 불러오지 못한 사진 ${missing}개는 빈칸으로 표시했습니다.` : '추천 리스트용 PNG 이미지를 저장했습니다.');
    }
  }
  function actions(action) {
    const b = board();
    if (action === 'align-lineups') {
      try {
        const nodes = alignedNodes(b);
        if (nodes.every((node, i) => node.slot === b.nodes[i].slot)) return toast('이미 라인업별로 정렬되어 있습니다.');
        change(() => {b.nodes = nodes; selected = null;});
        toast('라인업별로 정렬하고 연결선을 다시 계산했습니다. 실행 취소로 이전 배치를 복원할 수 있습니다.');
      } catch (err) {toast(err.message);}
      return;
    }
    if (action === 'undo' || action === 'redo') return restore(action === 'undo');
    if (action === 'retry') return save();
    if (action === 'json') return backup();
    if (action === 'png') return exportImage().catch(err => toast(err.message));
    if (action === 'reload') return modal('저장본 다시 불러오기', '<p>현재 작업을 JSON으로 백업한 뒤 PC에 저장된 버전을 불러옵니다.</p>', '백업 후 불러오기', async () => {
      if (saving) return toast('저장이 끝난 뒤 다시 시도하세요.');
      backup();
      try {const turn = epoch, result = await api('/api/whisky-tree'); if (turn !== epoch) return; acceptDocument(result); changed = saved = 0; history = []; future = []; error = ''; selected = null; render();} catch (err) {toast(err.message);}
    });
    if (action === 'add-column') return modal('새 증류소 트리', input('트리 이름', 'name', '', 100), '추가', values => change(() => b.columns.push({id:uid(), name:values.name.trim()})));
    if (action === 'add-board') {
      if (doc.boards.length >= 20) return toast('보드는 최대 20개까지 만들 수 있습니다.');
      return modal('새 위스키 보드', input('보드 이름', 'name', '') + kindSelect('all'), '만들기', values => change(() => {
        active = uid(); selected = null; search = ''; filter = 'board';
        doc.boards.push({id:active, name:values.name.trim(), kind:values.kind, columns:[{id:uid(), name:'새 증류소'}], levels:copy(b.levels), nodes:[]});
      }));
    }
    if (action === 'board-settings') {
      const dialog = modal('보드 설정', input('보드 이름', 'name', b.name) + kindSelect(b.kind) + '<p class="field-hint">보드는 버번·스카치 등 큰 분류, 각 열은 이름을 붙인 증류소 트리입니다. 삭제 후 실행 취소로 복원할 수 있습니다.</p>', '저장', values => change(() => {b.name = values.name.trim(); b.kind = values.kind;}), doc.boards.length > 1 ? '<button type="button" class="btn wt-danger" data-delete>보드 삭제</button>' : '');
      dialog.querySelector('[data-delete]')?.addEventListener('click', () => {dialog.close(); change(() => {doc.boards = doc.boards.filter(item => item.id !== b.id); selected = null;});});
    }
  }
  function stopDrag() {
    clearInterval(scrollTimer); scrollTimer = null; dragId = dragColumnId = null;
    root?.querySelector('.wt-stage')?.classList.remove('is-dragging');
    root?.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    root?.querySelector('.wt-pool')?.classList.remove('drag-over');
    root?.querySelectorAll('.column-drag-source,.column-drop-before,.column-drop-after').forEach(el => el.classList.remove('column-drag-source','column-drop-before','column-drop-after'));
  }
  function bind() {
    root.onclick = event => {
      const target = event.target.closest('button'); if (!target) return;
      const d = target.dataset;
      if (d.wt) actions(d.wt);
      else if (d.board) {active = d.board; selected = null; search = ''; render();}
      else if (d.recommend) {
        const scope = target.closest('.wt-node') ? '.wt-node' : '.wt-pool-card';
        change(() => setRecommended(d.recommend, !recommended(d.recommend)));
        if (event.detail === 0) root.querySelector(`${scope} [data-recommend="${CSS.escape(d.recommend)}"]`)?.focus({preventScroll:true});
      }
      else if (d.editLabel) editLabel(d.editLabel);
      else if (d.columnEdit) editColumn(d.columnEdit);
      else if (d.columnMove) editColumn(d.columnMove);
      else if (d.levelEdit != null) editLevel(Number(d.levelEdit));
      else if (d.remove) change(() => {board().nodes = board().nodes.filter(n => n.review_id !== d.remove); selected = null;});
      else if (d.pick) select(d.pick);
      else if (d.col && selected) place(selected, d.col, Number(d.level), Number(d.slot));
    };
    root.oninput = event => {if (event.target.matches('[data-pool-search]')) {search = event.target.value; pool();}};
    root.onchange = event => {
      const el = event.target;
      if (el.matches('[data-pool-filter]')) {filter = el.value; pool();}
      if (el.matches('[data-show-placed]')) {showPlaced = el.checked; pool();}
      if (el.matches('[data-grid]')) {grid = el.checked; root.querySelector('.wt-stage').classList.toggle('show-grid', grid);}
    };
    root.addEventListener('error', event => {if (event.target.matches?.('.wt-photo img')) event.target.outerHTML = '<span>사진 없음</span>';}, true);
    root.ondragstart = event => {
      stopDrag();
      const column = event.target.closest('[data-column-drag]');
      if (column) {
        dragColumnId = column.dataset.columnDrag;
        event.dataTransfer.setData('application/x-taste-atlas-column', dragColumnId); event.dataTransfer.effectAllowed = 'move';
        column.classList.add('column-drag-source'); return;
      }
      const card = event.target.closest('[data-review]'); if (!card) return;
      dragId = card.dataset.review; event.dataTransfer.setData('text/plain', dragId); event.dataTransfer.effectAllowed = 'move';
      root.querySelector('.wt-stage').classList.add('is-dragging');
    };
    let dragX = 0, dragY = 0;
    root.ondragover = event => {
      if (!dragId && !dragColumnId) return;
      const stage = root.querySelector('.wt-stage'), poolEl = event.target.closest('.wt-pool');
      if (!event.target.closest('.wt-stage') && (!poolEl || dragColumnId)) {
        clearInterval(scrollTimer); scrollTimer = null;
        root.querySelectorAll('.column-drop-before,.column-drop-after').forEach(el => el.classList.remove('column-drop-before','column-drop-after'));
        return;
      }
      event.preventDefault(); dragX = event.clientX; dragY = event.clientY;
      if (dragColumnId) {
        const column = event.target.closest('[data-column-drag]');
        event.dataTransfer.dropEffect = column ? 'move' : 'none';
        root.querySelectorAll('.column-drop-before,.column-drop-after').forEach(el => el.classList.remove('column-drop-before','column-drop-after'));
        if (column && column.dataset.columnDrag !== dragColumnId) {
          const rect = column.getBoundingClientRect();
          column.classList.add(dragX < rect.left + rect.width / 2 ? 'column-drop-before' : 'column-drop-after');
        }
      } else {
        event.dataTransfer.dropEffect = 'move';
        root.querySelector('.drag-over')?.classList.remove('drag-over');
        (event.target.closest('.wt-cell,.wt-row-add,.wt-node') || poolEl)?.classList.add('drag-over');
      }
      if (!scrollTimer) scrollTimer = setInterval(() => {
        const r = stage.getBoundingClientRect(); if (dragX < r.left || dragX > r.right || dragY < r.top || dragY > r.bottom) return;
        stage.scrollBy(dragX < r.left + 48 ? -14 : dragX > r.right - 48 ? 14 : 0, dragColumnId ? 0 : dragY < r.top + 48 ? -14 : dragY > r.bottom - 48 ? 14 : 0);
      }, 30);
    };
    root.ondrop = event => {
      if (dragColumnId) {
        event.preventDefault();
        const id = dragColumnId, target = event.target.closest('[data-column-drag]'), rect = target?.getBoundingClientRect();
        const after = rect && event.clientX >= rect.left + rect.width / 2;
        stopDrag();
        if (target) moveColumn(id, target.dataset.columnDrag, after);
        return;
      }
      if (!dragId) return; event.preventDefault();
      const id = dragId, cell = event.target.closest('.wt-cell,.wt-row-add'), node = event.target.closest('.wt-node');
      stopDrag(); scrollTimer = null;
      if (cell) place(id, cell.dataset.col, Number(cell.dataset.level), Number(cell.dataset.slot));
      else if (node) {const n = board().nodes.find(n => n.review_id === node.dataset.review); if (n) place(id, n.column_id, n.level, n.slot);}
      else if (event.target.closest('.wt-pool') && board().nodes.some(n => n.review_id === id)) change(() => {board().nodes = board().nodes.filter(n => n.review_id !== id); selected = null;});
    };
    root.ondragend = () => {stopDrag(); scrollTimer = null;};
    root.onkeydown = event => {
      if (event.target.matches('input,select,textarea') || event.target.closest('dialog')) return;
      if (event.key === 'Escape') {stopDrag(); selected = null; render(); return;}
      const handle = event.target.closest('[data-column-move]');
      if (handle && ['ArrowLeft','ArrowRight'].includes(event.key)) {
        event.preventDefault(); stopDrag();
        const id = handle.dataset.columnMove, columns = board().columns, index = columns.findIndex(col => col.id === id), delta = event.key === 'ArrowLeft' ? -1 : 1;
        if (columns[index + delta]) moveColumn(id, columns[index + delta].id, delta > 0);
        root.querySelector(`[data-column-move="${CSS.escape(id)}"]`)?.focus();
        return;
      }
      const element = event.target.closest('.wt-node'); if (!element || event.target.matches('button')) return;
      const b = board(), n = b.nodes.find(n => n.review_id === element.dataset.review); if (!n) return;
      if (['Delete','Backspace'].includes(event.key)) {event.preventDefault(); change(() => {b.nodes = b.nodes.filter(item => item !== n);}); return;}
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      let level = n.level, slot = n.slot, col = b.columns.findIndex(c => c.id === n.column_id);
      if (event.key === 'ArrowUp') level--; if (event.key === 'ArrowDown') level++;
      if (event.key === 'ArrowLeft') slot--; if (event.key === 'ArrowRight') slot++;
      if (slot < 0) {col--; if (col >= 0) slot = rowSlots(b, b.columns[col].id, level) - 1;}
      if (slot >= MAX_BOTTLES) {col++; slot = 0;}
      if (level < 0 || level >= b.levels.length || col < 0 || col >= b.columns.length) return;
      place(n.review_id, b.columns[col].id, level, slot);
      root.querySelector(`.wt-node[data-review="${CSS.escape(n.review_id)}"]`)?.focus();
    };
  }
  async function mount(el, items) {
    stopDrag(); root = el; records = items.filter(r => r.category === '위스키' && !r.is_collection); byId = new Map(records.map(r => [String(r.id), r]));
    const turn = epoch;
    root.innerHTML = '<div class="loading">나의 위스키 트리를 불러오고 있습니다…</div>';
    try {
      if (!doc) {
        loading ||= api('/api/whisky-tree'); const result = await loading;
        if (turn !== epoch || el !== root) return;
        acceptDocument(result); loading = null;
      }
      if (!el.isConnected || el !== root) return;
      bind(); render();
    } catch (err) {if (turn === epoch && el.isConnected) {loading = null; el.innerHTML = `<p class="notice">${e(err.message)}</p><button class="btn" data-load-retry>다시 불러오기</button>`; el.querySelector('button').onclick = () => mount(el, items);}}
  }
  window.addEventListener('beforeunload', event => {if (changed !== saved) {event.preventDefault(); event.returnValue = '';}});
  window.addEventListener('atlas-owner-locked', () => {
    epoch++; clearTimeout(timer); stopDrag(); scrollTimer = null; root?.querySelector('dialog')?.close();
    if (root?.isConnected) root.replaceChildren();
    doc = root = loading = undefined; records = []; byId.clear(); history = []; future = [];
    revision = changed = saved = 0; saving = false; error = ''; selected = active = null; search = ''; filter = 'board';
  });
  return {mount, connections, flush};
})();
