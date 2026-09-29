'use strict';
// Visitor choices live only in this module. reset() releases records and image callbacks.
window.WhiskyJourney = (() => {
  const preferences = {liked:'좋았어요',neutral:'보통',disliked:'안 맞았어요'};
  const pageSize = 24;
  let host = null, catalog = [], byId = new Map(), openReview = null, photo = null, hydrateImages = null;
  let selected = new Map(), query = '', priceBand = '', visibleLimit = pageSize, result = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const sentences = value => String(value ?? '').trim().split(/(?<=[.!?])\s+/).filter(Boolean).map(sentence => `<span class="wj-sentence">${esc(sentence)}</span>`).join(' ');
  const money = value => new Intl.NumberFormat('ko-KR').format(value) + '원';
  const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const $ = selector => host.querySelector(selector);
  const strength = record => positive(record.abv) ? `${record.abv}%` : '도수 미확인';
  function price(record) {
    const value = Discovery.bottlePrice(record);
    return positive(value) ? value : null;
  }
  function priceText(record) {
    const value = price(record);
    return value === null ? '보틀 가격 미확인' : money(value);
  }
  function picture(record) {
    // Only host-provided renderers may supply image markup; record text is escaped below.
    return `<span class="wj-photo" aria-hidden="true">${photo ? photo(record) : '<span class="photo-placeholder">사진 미확인</span>'}</span>`;
  }
  function hydrate(root) { if (hydrateImages) hydrateImages(root); }
  function match(record) {
    return !query || [record.name,record.english,...(record.aliases || [])].some(name => normalized(name).includes(normalized(query)));
  }
  function withinBand(record) {
    if (!priceBand) return true;
    const value = price(record);
    if (value === null) return false;
    if (priceBand === 'under50') return value < 50000;
    if (priceBand === '50to100') return value >= 50000 && value < 100000;
    if (priceBand === '100to200') return value >= 100000 && value < 200000;
    return value >= 200000;
  }
  function choice(record) {
    const checked = selected.has(record.id);
    return `<label class="wj-choice${checked ? ' is-selected' : ''}"><input type="checkbox" data-choose="${esc(record.id)}"${checked ? ' checked' : ''}${!checked && selected.size >= 12 ? ' disabled' : ''}>${picture(record)}<span class="wj-choice-copy"><strong>${esc(record.name)}</strong><span class="wj-abv">${esc(strength(record))}</span><span class="wj-price">${esc(priceText(record))}</span></span></label>`;
  }
  function renderChoices() {
    const visible = catalog.filter(row => match(row) && withinBand(row));
    const shown = visible.slice(0,visibleLimit), target = $('[data-catalog]');
    target.innerHTML = shown.length ? shown.map(choice).join('') : '<p class="wj-empty">검색·가격 조건에 맞는 제품이 없습니다.</p>';
    $('[data-catalog-count]').textContent = `${visible.length}개`;
    const more = $('[data-more]');
    more.hidden = shown.length >= visible.length;
    more.textContent = `더 보기 (${shown.length} / ${visible.length})`;
    hydrate(target);
  }
  function renderSelected() {
    $('[data-selection-count]').textContent = `${selected.size} / 12개`;
    $('[data-selected]').innerHTML = selected.size ? [...selected].map(([id,preference]) => {
      const record = byId.get(id);
      return `<div class="wj-selected-row"><strong>${esc(record.name)}</strong><label><span class="wj-sr-only">${esc(record.name)}에 대한 내 경험</span><select data-preference="${esc(id)}">${Object.entries(preferences).map(([value,label]) => `<option value="${value}"${preference === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" class="wj-remove" data-remove="${esc(id)}" aria-label="${esc(record.name)} 선택 해제">×</button></div>`;
    }).join('') : '<p class="wj-empty">마셔 본 위스키를 골라 주세요.</p>';
  }
  function notes(record) {
    // Unmeasured/zero specific fruits must not hide a positive generic fruit note.
    const source = {features:record.features,fruit_features:(record.fruit_features || []).filter(feature => positive(feature.value))};
    return `<dl class="wj-notes">${[['nose','N','향'],['palate','P','맛'],['finish','F','여운']].map(([stage,letter,label]) => {
      const top = Object.entries(Discovery.profile(source,stage)).filter(([,value]) => positive(value)).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0],'ko'))[0];
      return `<div class="wj-note"><dt><span class="wj-stage-letter" lang="en">${letter}</span>${label}</dt><dd>${esc(top?.[0] || '미확인')}</dd></div>`;
    }).join('')}</dl>`;
  }
  function nodeCard(node, depth = 1) {
    const record = node.record;
    const children = depth < 3 ? (node.children || []).slice(0,2) : [];
    return `<article class="wj-node"><div class="wj-node-top"><span class="wj-step">STEP ${depth}</span><span>${depth === 1 ? '첫 추천' : node.mode === 'explore' ? '취향 넓히기' : '익숙한 향미'}</span></div><details class="wj-card-details"><summary>${picture(record)}<strong class="wj-name">${esc(record.name)}</strong><span class="wj-abv">${esc(strength(record))}</span>${notes(record)}<span class="wj-detail-hint">자세히 보기 <span aria-hidden="true">＋</span></span></summary><div class="wj-card-body"><p class="wj-price">보틀 기록가 · ${esc(priceText(record))}</p><p class="wj-record-date">${esc(record.published || '기록일 미확인')}${record.published ? ' 리뷰' : ''} · 현재 판매가와 다를 수 있어요.</p>${node.reason ? `<p class="wj-node-reason">${sentences(node.reason)}</p>` : ''}${byId.has(record.id) ? `<button type="button" class="wj-review" data-journey-open="${esc(record.id)}">리뷰 상세 ↗</button>` : ''}</div></details>${children.length ? `<details class="wj-next"><summary>다음 추천 ${children.length}개 <span>이 제품도 좋았다면</span></summary><ol class="wj-children">${children.map(child => `<li>${nodeCard(child,depth+1)}</li>`).join('')}</ol></details>` : depth === 3 ? '<p class="wj-route-end">세 번째 추천</p>' : '<p class="wj-route-end">이 갈래는 여기까지</p>'}</article>`;
  }
  function renderResult() {
    const target = $('[data-result]');
    if (!result) { target.innerHTML = ''; return; }
    const branches = Array.isArray(result.branches) ? result.branches : [];
    const hasNodes = branches.some(branch => branch.node);
    target.innerHTML = hasNodes ? `<div class="wj-result-heading"><h3>다음 한 잔</h3><p>사진을 누르면 자세히 볼 수 있어요.</p></div><div class="wj-tree">${branches.slice(0,3).map(branch => `<section class="wj-branch"><h3>${esc(branch.label)}</h3>${branch.node ? nodeCard(branch.node) : '<p class="wj-branch-empty">현재 조건에 맞는 추천이 없어요.</p>'}</section>`).join('')}</div>` : `<p class="wj-result-hint">${sentences(result.reason || '추천할 제품이 없습니다. 다른 제품을 골라 주세요.')}</p>`;
    hydrate(target);
  }
  function invalidate() {
    if (!result) return;
    result = null;
    $('[data-result]').innerHTML = '<p class="wj-result-hint">선택이 바뀌었어요. ‘추천받기’를 다시 눌러 주세요.</p>';
  }
  function announce(message) { $('[data-status]').textContent = message; }
  function submit(event) {
    event.preventDefault();
    result = Discovery.journey(catalog,{selections:[...selected].map(([id,preference]) => ({id,preference}))});
    renderResult();
    announce(result.branches?.some(branch => branch.node) ? '추천이 준비됐어요.' : '아래 안내를 확인해 주세요.');
    $('[data-result]').focus();
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || !host.contains(button)) return;
    if (button.dataset.journeyOpen && byId.has(button.dataset.journeyOpen)) openReview?.(button.dataset.journeyOpen);
    if (button.dataset.remove) {
      const removed = button.dataset.remove;
      selected.delete(removed); invalidate(); renderChoices(); renderSelected(); announce('선택을 해제했어요.');
      const input = [...host.querySelectorAll('[data-choose]')].find(input => input.dataset.choose === removed);
      (input || $('[data-query]')).focus();
    }
    if (button.hasAttribute('data-more')) {
      const firstNew = catalog.filter(row => match(row) && withinBand(row))[visibleLimit];
      visibleLimit += pageSize; renderChoices();
      [...host.querySelectorAll('[data-choose]')].find(input => input.dataset.choose === firstNew?.id)?.focus();
    }
    if (button.hasAttribute('data-clear')) {
      selected.clear(); query = ''; priceBand = ''; visibleLimit = pageSize; result = null;
      render(); announce('선택을 초기화했어요.'); $('[data-query]').focus();
    }
  }
  function change(event) {
    const target = event.target;
    if (target.dataset.choose) {
      const id = target.dataset.choose;
      if (!byId.has(id)) return;
      if (target.checked && !selected.has(id) && selected.size >= 12) { target.checked = false; announce('한 번에 12개까지 선택할 수 있어요.'); return; }
      if (target.checked) selected.set(id,selected.get(id) || 'neutral'); else selected.delete(id);
      invalidate(); renderChoices(); renderSelected();
      [...host.querySelectorAll('[data-choose]')].find(input => input.dataset.choose === id)?.focus();
      announce(`${selected.size}개를 선택했어요.`);
    }
    if (target.dataset.preference && selected.has(target.dataset.preference) && Object.hasOwn(preferences,target.value)) {
      selected.set(target.dataset.preference,target.value); invalidate(); announce('취향을 반영했어요.');
    }
    if (target.hasAttribute('data-price-band')) { priceBand = target.value; visibleLimit = pageSize; renderChoices(); }
  }
  function input(event) {
    if (event.target.hasAttribute('data-query')) { query = event.target.value.trim(); visibleLimit = pageSize; renderChoices(); }
  }
  function render() {
    host.classList.add('whisky-journey');
    host.innerHTML = `<form class="wj-form" novalidate><div class="wj-section-title"><h3>마셔 본 위스키</h3><button type="button" class="wj-clear" data-clear>선택 초기화</button></div><div class="wj-filters"><label><span class="wj-sr-only">제품명 검색</span><input type="search" data-query value="${esc(query)}" placeholder="제품명 검색" autocomplete="off"></label><label><span class="wj-sr-only">리뷰 보틀 기록가</span><select data-price-band>${[['','가격대 전체'],['under50','5만 원 미만'],['50to100','5만~10만 원 미만'],['100to200','10만~20만 원 미만'],['over200','20만 원 이상']].map(([value,label]) => `<option value="${value}"${value === priceBand ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="wj-list-heading"><span>리뷰 보틀 기록가 기준</span><span data-catalog-count></span></div><div class="wj-catalog" data-catalog></div><button type="button" class="wj-more" data-more hidden>더 보기</button><div class="wj-selection"><div class="wj-list-heading"><h4>선택한 위스키</h4><span data-selection-count></span></div><div class="wj-selected" data-selected></div><button type="submit" class="wj-build">추천받기 <span aria-hidden="true">↗</span></button></div></form><p class="wj-status" data-status role="status" aria-live="polite"></p><section class="wj-results" data-result tabindex="-1" aria-label="위스키 추천 결과"></section><details class="wj-method"><summary>추천 기준 · 이용 안내</summary><p>${sentences('좋았던 향미를 중심으로 추천해요. ‘보통’은 경험 기준, ‘안 맞았어요’는 겹치는 향미를 줄이는 기준입니다. 다음 단계는 앞 제품도 좋았다는 가정으로 이어집니다.')}</p><p>${sentences('향·맛·여운은 각 단계에서 가장 뚜렷하게 기록된 특징 하나씩을 보여줘요. 가격은 리뷰 당시 보틀 기록가이며, 미확인 가격은 추정하지 않아요.')}</p><p>${sentences('선택은 이 화면에서만 사용하며 새로고침하면 사라집니다. 작성자의 평가나 기록은 바뀌지 않아요.')}</p></details>`;
    renderChoices(); renderSelected(); renderResult();
  }
  function detach() {
    if (!host) return;
    host.onclick = null; host.onchange = null; host.oninput = null; host.onsubmit = null;
  }
  function mount(element, sourceRecords, reviewCallback, imageOptions = {}) {
    if (!element) return;
    detach(); host = element;
    const seen = new Set();
    catalog = (Array.isArray(sourceRecords) ? sourceRecords : []).filter(row => {
      if (!row || row.starter || row.is_collection || row.category !== '위스키') return false;
      const key = Discovery.productKey(row);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice().sort((a,b) => String(a.name).localeCompare(String(b.name),'ko'));
    byId = new Map(catalog.map(row => [row.id,row]));
    selected = new Map([...selected].filter(([id]) => byId.has(id)));
    openReview = typeof reviewCallback === 'function' ? reviewCallback : null;
    photo = typeof imageOptions?.photo === 'function' ? imageOptions.photo : null;
    hydrateImages = typeof imageOptions?.hydrateImages === 'function' ? imageOptions.hydrateImages : null;
    result = null;
    render(); host.onclick = click; host.onchange = change; host.oninput = input; host.onsubmit = submit;
  }
  function reset() {
    detach(); if (host) host.innerHTML = '';
    host = null; catalog = []; byId.clear(); openReview = null; photo = null; hydrateImages = null;
    selected.clear(); query = ''; priceBand = ''; visibleLimit = pageSize; result = null;
  }
  return Object.freeze({mount,reset});
})();
