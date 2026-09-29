'use strict';
// Visitor choices live only in this module. reset() also releases decrypted records on owner lock.
window.WhiskyJourney = (() => {
  const preferences = {liked:'좋았어요',neutral:'보통',disliked:'안 맞았어요'};
  const starters = [
    {id:'starter:jimbeam',name:'짐 빔 오리지널 (화이트 라벨)',english:'Jim Beam Original',aliases:['Jim Beam White Label','짐빔 화이트','짐빔 화이트 라벨','짐빔 오리지널','짐 빔'],abv:40,catalog:{primary_type:'버번',origin:'미국'},reference_profile:{'오크':1,'바닐라':1,'스파이스':1,'단맛':1},source_url:'https://www.jimbeam.com/bourbons/jim-beam'},
    {id:'starter:ballantines',name:'발렌타인 파이니스트',english:'Ballantine’s Finest',aliases:["Ballantine's Finest",'Ballantines Finest'],abv:40,catalog:{primary_type:'블렌디드',origin:'스카치 위스키'},reference_profile:{'단맛':1,'스파이스':1,'로스팅':1,'사과':1,'바닐라':1},source_url:'https://www.ballantines.com/en/range/ballantines-finest/'},
    {id:'starter:jameson',name:'제임슨 오리지널',english:'Jameson Original',aliases:['Jameson Irish Whiskey','제임슨','제임슨 아이리시 위스키'],abv:40,catalog:{primary_type:'아이리시 위스키',origin:'아일랜드'},reference_profile:{'꽃':1,'스파이스':1,'오크':1,'바닐라':1,'로스팅':1,'단맛':1},source_url:'https://www.jamesonwhiskey.com/en-us/our-whiskey/jameson-irish-whiskey/'},
    {id:'starter:chivas',name:'시바스 리갈 12년',english:'Chivas Regal 12',aliases:['Chivas 12','Chivas Regal 12 Year Old','시바스 리갈 12'],abv:40,catalog:{primary_type:'블렌디드',origin:'스카치 위스키'},reference_profile:{'허브':1,'단맛':1,'과일':1,'바닐라':1,'로스팅':1},source_url:'https://www.chivas.com/en-us/collection/chivas-12/'}
  ].map(row => ({...row,category:'위스키',starter:true,is_collection:false}));
  let host = null, records = [], catalog = [], references = [], byId = new Map(), openReview = null;
  let selected = new Map(), query = '', priceBand = '', bottleBudget = '', routeBudget = '', result = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => new Intl.NumberFormat('ko-KR').format(value) + '원';
  const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const $ = selector => host.querySelector(selector);
  function price(record) {
    const value = Discovery.bottlePrice(record);
    return positive(value) ? value : null;
  }
  function priceText(record) {
    const value = price(record);
    return value === null ? '보틀 가격 확인 필요' : `보틀 기록가 ${money(value)} · ${record.published || '기록일 미확인'}${record.published ? ' 리뷰' : ''}`;
  }
  function spec(record) {
    return `${positive(record.abv) ? record.abv+'%' : '도수 미확인'} · ${positive(record.volume) ? record.volume+' ml' : '용량 미확인'}`;
  }
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
    return `<label class="wj-choice${checked ? ' is-selected' : ''}"><input type="checkbox" data-choose="${esc(record.id)}"${checked ? ' checked' : ''}${!checked && selected.size >= 12 ? ' disabled' : ''}><span><strong>${esc(record.name)}</strong><small>${esc(record.english || '')}</small><small>${esc(record.starter ? `${spec(record)} · 공식 설명 기준` : `${spec(record)} · ${priceText(record)}`)}</small></span><span class="wj-check" aria-hidden="true">${checked ? '선택함' : '선택'}</span></label>${record.starter ? `<p class="wj-source"><a href="${esc(record.source_url)}" target="_blank" rel="noopener noreferrer">제조사 제품 설명 ↗</a> · 확인 2026-09-30</p>` : ''}`;
  }
  function renderChoices() {
    const visible = catalog.filter(row => match(row) && withinBand(row));
    $('[data-catalog]').innerHTML = visible.length ? visible.map(choice).join('') : '<p class="wj-empty">이 검색·가격 조건에 맞는 리뷰 제품이 없습니다. 검색어나 가격대를 넓혀 보세요.</p>';
    $('[data-catalog-count]').textContent = `${visible.length}개`;
    const visibleReferences = references.filter(match);
    $('[data-references]').innerHTML = visibleReferences.length ? visibleReferences.map(choice).join('') : `<p class="wj-empty">${references.length ? '검색어에 맞는 기준 제품이 없습니다.' : '네 기준 제품 모두 리뷰 목록에 있어 실제 리뷰 제품으로 선택할 수 있습니다.'}</p>`;
  }
  function renderSelected() {
    $('[data-selection-count]').textContent = `${selected.size} / 12개`;
    $('[data-selected]').innerHTML = selected.size ? [...selected].map(([id,preference]) => {
      const record = byId.get(id);
      return `<div class="wj-selected-row"><div><strong>${esc(record.name)}</strong><small>${record.starter ? '미리뷰 기준 제품' : '작성자 리뷰 제품'}</small></div><label><span class="wj-sr-only">${esc(record.name)}에 대한 내 경험</span><select data-preference="${esc(id)}">${Object.entries(preferences).map(([value,label]) => `<option value="${value}"${preference === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" class="wj-remove" data-remove="${esc(id)}" aria-label="${esc(record.name)} 선택 해제">해제 ×</button></div>`;
    }).join('') : '<p class="wj-empty">마셔 본 제품을 골라 주세요. 선택하면 각 제품의 경험을 표시할 수 있습니다.</p>';
  }
  function costText(cost) {
    const known = positive(cost?.knownTotal) ? cost.knownTotal : 0;
    const unknown = Number.isInteger(cost?.unknownCount) && cost.unknownCount > 0 ? cost.unknownCount : 0;
    if (unknown) return `경로 누적: ${known ? money(known)+' + ' : ''}가격 미확인 ${unknown}개`;
    return `경로 누적: ${money(known)}`;
  }
  function nodeCard(node, depth = 1) {
    const record = node.record;
    const children = depth < 3 ? (node.children || []).slice(0,2) : [];
    return `<article class="wj-node"><div class="wj-node-top"><span class="wj-step">STEP ${depth}</span><span>${depth === 1 ? '첫 번째 한 잔' : node.mode === 'explore' ? '취향 넓히기' : '익숙한 향미'}</span></div><h4>${esc(record.name)}</h4>${record.english ? `<p class="wj-english">${esc(record.english)}</p>` : ''}<p class="wj-spec">${esc(spec(record))}</p><p class="wj-price">${esc(priceText(record))}</p><p class="wj-shared">공통 향미 · ${Array.isArray(node.shared) && node.shared.length ? node.shared.map(esc).join(' · ') : '확인된 공통 표현 없음'}</p>${node.reason ? `<p class="wj-node-reason">${esc(node.reason)}</p>` : ''}<p class="wj-cost">${esc(costText(node.cost))}<small>이미 마신 제품과 다른 선택지는 합산하지 않아요.</small></p>${!record.starter && byId.has(record.id) ? `<button type="button" class="wj-review" data-journey-open="${esc(record.id)}">리뷰 프로파일 보기 ↗</button>` : ''}${children.length ? `<details class="wj-next"><summary>이 제품도 좋았다면 <span>다음 선택 ${children.length}개</span></summary><ol class="wj-children">${children.map(child => `<li>${nodeCard(child,depth+1)}</li>`).join('')}</ol></details>` : `<p class="wj-route-end">${depth === 3 ? '세 번째 한 잔 · 이 경로의 끝' : '조건에 맞는 다음 제품이 없어 여기까지 제안해요.'}</p>`}</article>`;
  }
  function renderResult() {
    const target = $('[data-result]');
    if (!result) { target.innerHTML = '<p class="wj-result-hint">경험을 고르고 버튼을 누르면 버번 · 스카치 · 피트 세 갈래의 여정이 펼쳐집니다.</p>'; return; }
    const branches = Array.isArray(result.branches) ? result.branches : [];
    const hasNodes = branches.some(branch => branch.node);
    target.innerHTML = `<div class="wj-result-heading"><p class="wj-kicker">YOUR WHISKY JOURNEY</p><h3>한 잔에서, 다음 한 잔으로</h3><p>${esc(result.reason || (hasNodes ? '향미의 공통점과 차이로 이어 보는 탐색 경로입니다.' : '선택한 경험과 예산에 맞는 제품이 없습니다. 조건을 넓혀 보세요.'))}</p>${hasNodes ? `<p>${result.anchorMode === 'liked' ? '좋았던 제품의 향미를 중심으로 연결했어요.' : '아직 좋아요가 없어, 마셔 본 경험을 출발점으로 삼았어요.'} 이후 단계는 ‘이 제품도 좋았다면’의 조건부 제안이며, 미래의 취향이나 만족도를 확정하지 않습니다.</p>` : ''}</div>${branches.length ? `<div class="wj-tree">${branches.slice(0,3).map(branch => `<section class="wj-branch"><h3>${esc(branch.label)}</h3>${branch.node ? nodeCard(branch.node) : '<div class="wj-branch-empty">이 갈래는 현재 경험·향미·예산 조건에 맞는 제품이 부족합니다.</div>'}</section>`).join('')}</div>` : ''}`;
  }
  function invalidate() {
    if (!result) return;
    result = null;
    $('[data-result]').innerHTML = '<p class="wj-result-hint">선택이나 예산이 바뀌었어요. ‘나의 위스키 트리 펼치기’를 다시 눌러 주세요.</p>';
  }
  function announce(message) { $('[data-status]').textContent = message; }
  function budgetValue(raw) {
    if (raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 1 && value <= 1000000000 && Number.isInteger(value) ? value : NaN;
  }
  function submit(event) {
    event.preventDefault();
    const bottle = $('[data-budget="bottle"]')?.validity?.badInput ? NaN : budgetValue(bottleBudget), route = $('[data-budget="route"]')?.validity?.badInput ? NaN : budgetValue(routeBudget);
    if (Number.isNaN(bottle) || Number.isNaN(route)) {
      announce('예산은 1원 이상 10억 원 이하의 정수로 입력하거나 비워 주세요.');
      $(Number.isNaN(bottle) ? '[data-budget="bottle"]' : '[data-budget="route"]').focus();
      return;
    }
    result = Discovery.journey(records,{selections:[...selected].map(([id,preference]) => ({id,preference})),bottleBudget:bottle,routeBudget:route});
    renderResult();
    announce(result.branches?.some(branch => branch.node) ? '위스키 여정을 펼쳤어요. 아래 세 갈래에서 다음 선택을 살펴보세요.' : '조건에 맞는 여정을 찾지 못했어요. 아래 안내를 확인해 주세요.');
    $('[data-result]').focus();
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || !host.contains(button)) return;
    if (button.dataset.journeyOpen && byId.has(button.dataset.journeyOpen) && !byId.get(button.dataset.journeyOpen).starter) openReview?.(button.dataset.journeyOpen);
    if (button.dataset.remove) {
      selected.delete(button.dataset.remove); invalidate(); renderChoices(); renderSelected(); announce('선택을 해제했어요.');
    }
    if (button.hasAttribute('data-clear')) {
      selected.clear(); query = ''; priceBand = ''; bottleBudget = ''; routeBudget = ''; result = null;
      render(); announce('선택과 예산을 초기화했어요.'); $('[data-query]').focus();
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
      announce(`${selected.size}개를 선택했어요. 아래에서 좋았어요 · 보통 · 안 맞았어요를 표시해 주세요.`);
    }
    if (target.dataset.preference && selected.has(target.dataset.preference) && Object.hasOwn(preferences,target.value)) {
      selected.set(target.dataset.preference,target.value); invalidate(); announce('내 경험을 반영했어요. 트리를 다시 펼쳐 주세요.');
    }
    if (target.hasAttribute('data-price-band')) { priceBand = target.value; renderChoices(); }
  }
  function input(event) {
    const target = event.target;
    if (target.hasAttribute('data-query')) { query = target.value.trim(); renderChoices(); }
    if (target.dataset.budget) {
      if (target.dataset.budget === 'bottle') bottleBudget = target.value; else routeBudget = target.value;
      invalidate();
    }
  }
  function render() {
    host.classList.add('whisky-journey');
    host.innerHTML = `<header class="wj-heading"><p class="wj-kicker">TASTE, THEN TAKE A TURN</p><h2>나의 위스키 여정</h2><p>마셔 본 한 잔과 나의 경험에서 시작해요.<br>버번 · 스카치 · 피트, 세 갈래로 최대 세 잔의 다음 선택을 만나 보세요.</p></header><form class="wj-form" novalidate><section class="wj-experience"><div class="wj-section-title"><h3><span>01</span> 마셔 본 위스키</h3><button type="button" class="wj-clear" data-clear>선택 초기화</button></div><p class="wj-help">마셔 본 제품을 최대 12개 선택해 주세요. 처음에는 ‘보통’으로 담겨요.</p><div class="wj-filters"><label>제품명 검색<input type="search" data-query value="${esc(query)}" placeholder="한글 또는 영문 제품명" autocomplete="off"></label><label>리뷰 보틀 기록가<select data-price-band>${[['','가격대 전체'],['under50','5만 원 미만'],['50to100','5만~10만 원 미만'],['100to200','10만~20만 원 미만'],['over200','20만 원 이상']].map(([value,label]) => `<option value="${value}"${value === priceBand ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div><p class="wj-help">가격대를 지정하면 보틀 가격이 확인된 작성자 리뷰만 표시해요. 선택한 제품은 검색·가격 필터를 바꿔도 유지됩니다.</p><div class="wj-list-heading"><h4>작성자가 기록한 위스키</h4><span data-catalog-count></span></div><div class="wj-catalog" data-catalog></div><details class="wj-reference-section" open><summary>처음의 기준이 될 네 가지 위스키 <small>공식 설명 기반 · 미리뷰 기준 제품</small></summary><p class="wj-help">작성자 리뷰에 없는 입문 제품도 출발점으로 고를 수 있어요. 제조사의 향미 표현은 작성자 시음 기록보다 약한 근거이며, 향미 강도나 향·맛·여운 단계별 점수가 아닙니다. 기준 제품에는 보틀 가격을 추정하지 않고 가격대 필터를 적용하지 않아요.</p><div class="wj-references" data-references></div></details><div class="wj-list-heading"><h4>내가 마셔 본 위스키</h4><span data-selection-count></span></div><div class="wj-selected" data-selected></div><p class="wj-help">‘좋았어요’를 중심으로 연결하고, 없으면 마셔 본 경험에서 탐색을 시작해요. ‘안 맞았어요’의 겹치는 향미는 조심스럽게 반영해요.</p></section><section class="wj-budget-section"><div class="wj-section-title"><h3><span>02</span> 다음 한 잔의 예산 <small>선택 사항</small></h3></div><div class="wj-budgets"><label>보틀 한 개 예산 (원)<input type="number" data-budget="bottle" value="${esc(bottleBudget)}" min="0" max="1000000000" step="1000" inputmode="numeric" placeholder="비워 두면 제한 없음"></label><label>한 경로의 총예산 (원)<input type="number" data-budget="route" value="${esc(routeBudget)}" min="0" max="1000000000" step="1000" inputmode="numeric" placeholder="비워 두면 제한 없음"></label></div><p class="wj-help">한 경로는 각 단계에서 하나씩 고른 최대 세 잔입니다. 예산을 지정하면 보틀 가격 미확인 제품은 제외돼요.</p><button type="submit" class="wj-build">나의 위스키 트리 펼치기 <span aria-hidden="true">↗</span></button><p class="wj-privacy">나의 경험은 이 화면의 메모리에만 남고 작성자의 평가나 기록을 바꾸지 않아요. 새로고침하면 사라집니다.</p></section></form><p class="wj-status" data-status role="status" aria-live="polite"></p><section class="wj-results" data-result tabindex="-1" aria-label="나의 위스키 여정 결과"></section><aside class="wj-method"><h3>이 여정을 읽는 방법</h3><p>표시 금액은 작성자 리뷰의 보틀 구매 기록가이며 현재 판매가가 아닙니다. 리뷰 날짜가 구매일과 다를 수 있고, 샘플·미니어처·세트 가격은 보틀 가격으로 환산하지 않아요. 경로 누적은 지금까지 이어 온 선택만 더하며, 대안으로 제시된 다른 가지는 합산하지 않습니다.</p><p>향미 표현의 공통점으로 고르는 참고용 제안입니다. 개인 별점과 추정 만족도를 취향으로 사용하지 않으며, 숫자가 없는 향미를 0점으로 취급하지 않습니다. 피트 갈래는 확인된 제품 분류·태그를 따르고, 향미 수치만으로 피트 제품을 판정하지 않아요.</p></aside>`;
    renderChoices(); renderSelected(); renderResult();
  }
  function detach() {
    if (!host) return;
    host.onclick = null; host.onchange = null; host.oninput = null; host.onsubmit = null;
  }
  function mount(element, sourceRecords, reviewCallback) {
    if (!element) return;
    detach(); host = element;
    catalog = (Array.isArray(sourceRecords) ? sourceRecords : []).filter(row => !row.starter && !row.is_collection && row.category === '위스키');
    catalog = catalog.filter((row,index,rows) => rows.findIndex(other => Discovery.productKey(other) === Discovery.productKey(row)) === index).slice().sort((a,b) => String(a.name).localeCompare(String(b.name),'ko'));
    const catalogNames = new Set(catalog.flatMap(row => [normalized(row.name),normalized(row.english)]).filter(Boolean));
    references = starters.filter(row => ![row.name,row.english,...row.aliases].some(name => catalogNames.has(normalized(name))));
    records = [...catalog,...references]; byId = new Map(records.map(row => [row.id,row]));
    selected = new Map([...selected].filter(([id]) => byId.has(id)));
    openReview = typeof reviewCallback === 'function' ? reviewCallback : null;
    result = null;
    render(); host.onclick = click; host.onchange = change; host.oninput = input; host.onsubmit = submit;
  }
  function reset() {
    detach(); if (host) host.innerHTML = '';
    host = null; records = []; catalog = []; references = []; byId.clear(); openReview = null;
    selected.clear(); query = ''; priceBand = ''; bottleBudget = ''; routeBudget = ''; result = null;
  }
  return Object.freeze({mount,reset});
})();
