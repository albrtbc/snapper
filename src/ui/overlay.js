const api = window.snapper;
const $ = (id) => document.getElementById(id);
const side = new URLSearchParams(location.search).get('side') || 'own';
const labels = {
  deck: 'Deck',
  unseen: 'Unseen',
  hand: 'Hand',
  played: 'Played',
  staged: 'Staged',
  discarded: 'Discarded',
  destroyed: 'Destroyed',
  banished: 'Banished',
  graveyard: 'Graveyard',
  unknown: 'Seen',
};
const paths = {
  hand: 'M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 4-3 6-7 6-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-2l3 4',
  played: 'm5 12 4 4L19 6',
  staged: 'M8 5v14l11-7Z',
  discarded: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  destroyed: 'M8 17H6v-5a7 7 0 1 1 12 0v5h-2v4H8Zm0-7h1m6 0h1M12 13v2',
  banished: 'M5 5l14 14M19 5 5 19',
  graveyard: 'M6 21V8a6 6 0 0 1 12 0v13M3 21h18M9 8h6M12 5v7',
  unknown: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
};
let current,
  lastRender = '',
  minimized = false;
const artCache = new Map(),
  openPiles = new Map([
    ['discarded', true],
    ['destroyed', true],
  ]);
$('panel').classList.toggle('opponent', side === 'opponent');
$('title').textContent = side === 'own' ? 'Your deck' : 'Opponent';
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
function icon(kind) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(s.namespaceURI, 'path');
  p.setAttribute('d', paths[kind] || paths.unknown);
  s.append(p);
  return s;
}
async function image(card, node) {
  const id = card.cardId,
    variant = current?.settings?.gameArt ? card.variantId : null;
  const key = JSON.stringify([id, variant]);
  if (!current?.settings?.images || !id) return;
  if (!artCache.has(key)) artCache.set(key, api.art(id, variant));
  const src = await artCache.get(key);
  if (!src) {
    artCache.delete(key);
    return;
  }
  if (!node.isConnected) return;
  const img = el('img');
  img.alt = '';
  img.src = src;
  img.loading = 'lazy';
  img.addEventListener('load', () => node.classList.add('has-art'));
  img.addEventListener('error', () => {
    img.remove();
    node.classList.remove('has-art');
  });
  node.replaceChildren(img);
}
const tooltip = $('card-tooltip'),
  infoCache = new Map(),
  baseCosts = new Map(),
  rowCards = new WeakMap();
let sortFrame;
function sortList(target) {
  const rows = Array.from(target.children).filter((node) => rowCards.has(node));
  const cost = (card) =>
    Number.isFinite(card.cost) ? card.cost : (baseCosts.get(card.cardId) ?? Infinity);
  const ordered = [...rows].sort(
    (a, b) =>
      cost(rowCards.get(a)) - cost(rowCards.get(b)) ||
      rowCards.get(a).name.localeCompare(rowCards.get(b).name, 'en'),
  );
  if (ordered.some((node, index) => node !== rows[index])) target.append(...ordered);
}
function getCardInfo(id) {
  if (!infoCache.has(id))
    infoCache.set(
      id,
      api
        .cardInfo(id)
        .catch(() => null)
        .then((info) => {
          if (Number.isFinite(info?.baseCost)) {
            baseCosts.set(id, info.baseCost);
            if (!sortFrame)
              sortFrame = requestAnimationFrame(() => {
                sortFrame = null;
                document.querySelectorAll('.card-list').forEach(sortList);
                if (!tooltip.hidden) placeTooltip();
              });
          }
          return info;
        }),
    );
  return infoCache.get(id);
}
let tooltipOwner = null,
  tooltipTimer,
  hoverPoint = null;
document.addEventListener('pointermove', (event) => {
  hoverPoint = { x: event.clientX, y: event.clientY };
});
document.addEventListener('pointerleave', () => {
  hoverPoint = null;
  hideTooltip();
});
function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipOwner?.removeAttribute('aria-describedby');
  tooltipOwner = null;
  tooltip.hidden = true;
  reportInputLayout();
}
function scheduleTooltipHide() {
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(hideTooltip, 140);
}
function setAbilityText(text) {
  // Build text nodes so cached ability text is never interpreted as HTML.
  const parts = text.split(
    /(\b(?:On Reveal|Ongoing|Activate|Game Start|Start of Turn|End of Turn|Quickdraw|When Destroyed|When Discarded):)/g,
  );
  $('tooltip-ability').replaceChildren(
    ...parts.map((part, index) =>
      index % 2 ? el('strong', '', part) : document.createTextNode(part),
    ),
  );
}
function placeTooltip() {
  if (!tooltipOwner?.isConnected) {
    hideTooltip();
    return;
  }
  const rect = tooltipOwner.getBoundingClientRect();
  // Anchor to the panel, not the changing native viewport. Bottom-row hovers
  // must open upward without growing the window or moving its input region.
  const limit = current?.panelHeightLimit || innerHeight;
  const availableHeight = minimized
    ? limit
    : Math.min(limit, $('panel').getBoundingClientRect().bottom + 3);
  tooltip.style.maxHeight = Math.max(1, availableHeight - 16) + 'px';
  tooltip.style.left = Math.max(8, Math.min(rect.x, innerWidth - tooltip.offsetWidth - 8)) + 'px';
  const below = rect.bottom + 8;
  const top =
    below + tooltip.offsetHeight <= availableHeight - 8
      ? below
      : rect.top - tooltip.offsetHeight - 8;
  tooltip.style.top = Math.max(8, Math.min(top, availableHeight - tooltip.offsetHeight - 8)) + 'px';
  reportInputLayout();
}
async function showTooltip(item, card) {
  if (current?.locked) return;
  clearTimeout(tooltipTimer);
  if (tooltipOwner === item) return;
  tooltipOwner?.removeAttribute('aria-describedby');
  tooltipOwner = item;
  tooltip.classList.remove('control-tooltip');
  $('tooltip-ability').hidden = false;
  item.setAttribute('aria-describedby', 'card-tooltip');
  $('tooltip-name').hidden = true;
  $('tooltip-name').textContent = '';
  $('tooltip-ability').textContent = 'Loading ability…';
  tooltip.hidden = false;
  placeTooltip();
  const info = await getCardInfo(card.cardId);
  if (tooltipOwner !== item || !item.isConnected) return;
  setAbilityText(info?.text || 'Could not load the ability. Hover again to retry.');
  $('tooltip-ability').lang = info?.language || 'en';
  if (!info) infoCache.delete(card.cardId);
  placeTooltip();
}
function showControlTooltip(button) {
  hideTooltip();
  tooltipOwner = button;
  button.setAttribute('aria-describedby', 'card-tooltip');
  tooltip.classList.add('control-tooltip');
  $('tooltip-name').hidden = false;
  $('tooltip-name').textContent = button.getAttribute('aria-label');
  $('tooltip-ability').textContent = button.id === 'lock' ? 'Ctrl+Shift+L' : '';
  $('tooltip-ability').hidden = button.id !== 'lock';
  $('tooltip-ability').lang = 'en';
  tooltip.hidden = false;
  placeTooltip();
}
for (const button of document.querySelectorAll('.tools button')) {
  button.addEventListener('pointerenter', () => showControlTooltip(button));
  button.addEventListener('focus', () => showControlTooltip(button));
  button.addEventListener('pointerleave', scheduleTooltipHide);
  button.addEventListener('blur', hideTooltip);
  button.addEventListener('pointerdown', hideTooltip);
  button.addEventListener('click', hideTooltip);
}
window.addEventListener('resize', () => {
  if (!tooltip.hidden) placeTooltip();
});
function restoreHover() {
  if (!hoverPoint || current?.locked) return;
  queueMicrotask(() =>
    document
      .elementFromPoint(hoverPoint.x, hoverPoint.y)
      ?.closest('.card-row')
      ?.dispatchEvent(new Event('pointerenter')),
  );
}
tooltip.addEventListener('pointerenter', () => clearTimeout(tooltipTimer));
tooltip.addEventListener('pointerleave', scheduleTooltipHide);
$('content').addEventListener('scroll', () => {
  hoverPoint = null;
  hideTooltip();
});
window.addEventListener('blur', () => {
  hoverPoint = null;
  hideTooltip();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideTooltip();
});
function row(card) {
  const item = el('div', 'card-row');
  rowCards.set(item, card);
  if (!Number.isFinite(card.cost) && card.cardId) queueMicrotask(() => getCardInfo(card.cardId));
  item.dataset.status = card.status;
  item.dataset.cardId = card.cardId;
  item.tabIndex = 0;
  item.classList.toggle(
    'outside-deck',
    side === 'own' && (card.stolen || !['deck', 'unseen'].includes(card.status)),
  );
  const origin = card.stolen
    ? ' · Stolen by opponent'
    : card.originKnown && card.origin === 'generated'
      ? ' · Generated'
      : card.originKnown && card.origin !== card.side
        ? ' · From opponent’s deck'
        : '';
  const description = `${card.name} · ${labels[card.status] || 'Seen'}${card.cost != null ? ` · Cost ${card.cost}` : ''}${card.power != null ? ` · Power ${card.power}` : ''}${origin}${card.inferred ? ' · Selected deck card not yet observed; its location is unconfirmed' : ''}`;
  item.setAttribute('role', 'group');
  item.setAttribute('aria-label', description);
  item.addEventListener('pointerenter', () => showTooltip(item, card));
  item.addEventListener('pointerleave', scheduleTooltipHide);
  item.addEventListener('focus', () => showTooltip(item, card));
  item.addEventListener('blur', hideTooltip);
  const portrait = el('div', 'portrait');
  const info = el('div', 'card-info');
  info.append(el('div', 'card-name', card.name));
  item.append(portrait, info);
  if (card.cost != null) item.append(el('span', 'cost', String(card.cost)));
  if (card.power != null) item.append(el('span', 'power', String(card.power)));
  queueMicrotask(() => image(card, portrait));
  return item;
}
function renderList(target, cards, empty) {
  target.replaceChildren(...cards.map((c) => row(c)));
  if (!cards.length) target.append(el('div', 'empty', empty));
  sortList(target);
}
function pile(status, cards) {
  const d = el('details', `pile ${status}${cards.length ? '' : ' empty-pile'}`);
  d.open = cards.length > 0 && (openPiles.get(status) ?? true);
  const s = el('summary');
  s.append(
    icon(status),
    document.createTextNode(
      {
        discarded: 'Discarded',
        destroyed: 'Destroyed',
        banished: 'Banished',
        graveyard: 'Graveyard',
      }[status],
    ),
    el('b', '', String(cards.length)),
  );
  d.append(s);
  if (cards.length) {
    const list = el('div', 'card-list');
    list.append(...cards.map((c) => row(c)));
    sortList(list);
    d.append(list);
  } else d.append(el('div', 'pile-empty', 'None'));
  d.addEventListener('toggle', () => {
    if (cards.length) openPiles.set(status, d.open);
  });
  return d;
}
function render(state) {
  current = state;
  document.documentElement.style.setProperty('--panel-height-limit', state.panelHeightLimit + 'px');
  $('panel').classList.toggle('locked', state.locked);
  $('panel').classList.toggle('compact', state.settings?.compact);
  const lockLabel = state.locked ? 'Enable panel interaction' : 'Pass clicks to the game';
  $('lock').setAttribute('aria-label', lockLabel);
  if (tooltipOwner === $('lock')) {
    $('tooltip-name').textContent = lockLabel;
    placeTooltip();
  }
  $('lock').setAttribute('aria-pressed', String(state.locked));
  $('lock-icon').setAttribute(
    'd',
    state.locked
      ? 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z M12 14v3'
      : 'M7 10V7a5 5 0 0 1 10 0M5 10h14v11H5Z M12 14v3',
  );
  if (state.locked && !tooltipOwner?.closest('.tools')) hideTooltip();
  const signature = JSON.stringify([
    state.match,
    state.selectedDeck,
    state.status,
    state.settings?.images,
    state.settings?.gameArt,
    state.settings?.compact,
  ]);
  if (signature === lastRender) return;
  lastRender = signature;
  if (!tooltipOwner?.closest('.tools')) hideTooltip();
  const match = state.match;
  $('extra').replaceChildren();
  $('piles').replaceChildren();
  $('history').replaceChildren();
  if (!match) {
    $('counters').replaceChildren();
    $('counters').hidden = true;
    const cards =
      side === 'own'
        ? (state.selectedDeck?.cards || []).map((c) => ({ ...c, status: 'unseen' }))
        : [];
    renderList(
      $('cards'),
      cards,
      side === 'own' ? 'Select a deck in Snap.' : 'Waiting for opponent',
    );
    $('history-section').hidden = true;
    restoreHover();
    return;
  }
  $('counters').hidden = false;
  $('counters').replaceChildren();
  for (const [name, value] of [
    ['Deck', match.players[side].deckCount],
    ['Hand', match.players[side].handCount],
  ]) {
    const c = el('div', 'counter');
    c.append(el('span', '', name), el('b', '', String(value)));
    $('counters').append(c);
  }
  const cards = side === 'own' ? match.deckRows : match.opponent;
  renderList($('cards'), cards, side === 'opponent' ? 'No cards seen yet' : 'No cards');
  if (side === 'own' && match.added.length) {
    $('extra').append(el('div', 'group-title', 'Added'));
    const list = el('div', 'card-list');
    list.append(...match.added.map((c) => row(c)));
    sortList(list);
    $('extra').append(list);
  }
  const pileCards = side === 'own' ? match.cards : match.opponent;
  for (const status of ['discarded', 'destroyed', 'banished', 'graveyard']) {
    const items = pileCards.filter((c) => c.side === side && c.status === status && c.cardId);
    if (items.length || ['discarded', 'destroyed'].includes(status))
      $('piles').append(pile(status, items));
  }
  const history = match.history.filter(
    (h) => h.side === side && (side === 'own' || h.origin === 'opponent'),
  );
  $('history-section').hidden = !history.length;
  $('history-count').textContent = history.length;
  restoreHover();
  for (const event of history.slice(0, 15)) {
    const h = el('div', 'history-row');
    h.append(
      document.createTextNode(`T${event.turn} · `),
      el('b', '', event.name),
      document.createTextNode(` · ${labels[event.from]} → ${labels[event.to]}`),
    );
    $('history').append(h);
  }
}
$('minimize').onclick = () => {
  minimized = !minimized;
  $('content').hidden = minimized;
  $('minimize').setAttribute('aria-expanded', String(!minimized));
  $('minimize').setAttribute('aria-label', minimized ? 'Expand panel' : 'Minimize panel');
};
$('settings').onclick = () => api.openSettings();
$('lock').onclick = () => api.toggleLock();
const header = document.querySelector('.panel-header');
let dragPointer = null;
function endDrag() {
  const pointer = dragPointer;
  dragPointer = null;
  if (pointer === null) return;
  if (header.hasPointerCapture(pointer)) header.releasePointerCapture(pointer);
  api.endDrag();
}
header.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button')) return;
  hideTooltip();
  endDrag();
  dragPointer = event.pointerId;
  header.setPointerCapture(event.pointerId);
  api.startDrag({ x: event.screenX, y: event.screenY });
  event.preventDefault();
});
header.addEventListener('pointermove', (event) => {
  if (dragPointer !== event.pointerId || !header.hasPointerCapture(event.pointerId)) return;
  if (!(event.buttons & 1)) {
    endDrag();
    return;
  }
  api.moveDrag({ x: event.screenX, y: event.screenY });
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  header.addEventListener(name, endDrag);
function reportInputLayout() {
  const rect = (node) => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  api.inputLayout({
    header: rect(header),
    panel: rect($('panel')),
    tooltip: tooltip.hidden ? null : rect(tooltip),
    tooltipCanExpand: minimized && !!tooltipOwner?.closest('.tools'),
  });
}
const layoutObserver = new ResizeObserver(reportInputLayout);
for (const node of [$('panel'), header]) layoutObserver.observe(node);
if (api) {
  api.subscribe(render);
  api.getState().then(render);
}
