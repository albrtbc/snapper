const api = window.snapper,
  $ = (id) => document.getElementById(id);
let initialized = false;
function render(state) {
  $('game-status').textContent = state.demo
    ? 'Demo mode'
    : state.running
      ? 'Marvel Snap is running'
      : 'Waiting for Marvel Snap';
  $('dot').classList.toggle('connected', state.running);
  $('dot').classList.toggle(
    'warn',
    state.live?.ok === false && ['unsupported', 'denied'].includes(state.live.code),
  );
  $('data-status').textContent = state.message;
  $('path').textContent = state.statesPath || 'Folder not found';
  $('focus-unavailable').hidden =
    !state.settings.hideWhenUnfocused ||
    state.demo ||
    !state.running ||
    state.focusState !== 'unknown';
  $('shortcut-errors').textContent = (state.shortcuts || []).some((s) => !s.registered)
    ? 'A shortcut is unavailable. Use the tray icon to control the panels.'
    : '';
  if (!initialized) {
    for (const id of ['scale', 'opacity']) $(id).value = state.settings[id];
    for (const id of ['compact', 'images', 'gameArt', 'hideWhenUnfocused'])
      $(id).checked = state.settings[id];
    values();
    initialized = true;
  }
}
function values() {
  for (const id of ['scale', 'opacity'])
    $(id + '-value').textContent = Math.round(Number($(id).value) * 100) + '%';
}
for (const id of ['scale', 'opacity']) $(id).oninput = values;
$('save').onclick = async () => {
  await api.saveSettings({
    scale: Number($('scale').value),
    opacity: Number($('opacity').value),
    compact: $('compact').checked,
    images: $('images').checked,
    gameArt: $('gameArt').checked,
    hideWhenUnfocused: $('hideWhenUnfocused').checked,
  });
  $('saved').textContent = 'Settings saved.';
};
$('choose').onclick = async () => {
  const result = await api.choosePath();
  $('path-error').textContent = result?.error || '';
};
const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
$('update-cards').onclick = async () => {
  const button = $('update-cards'),
    status = $('cards-status');
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Updating card pool…';
  try {
    const result = await api.updateCards();
    if (result?.error) throw new Error(result.error);
    const waiting = result.placeholders;
    const parts = [
      `${count(result.cards, 'card')} · ${count(result.downloaded, 'new image')} · ${waiting.length} without art yet`,
    ];
    if (waiting.length)
      parts.push(
        `Waiting for art: ${waiting.slice(0, 10).join(', ')}${waiting.length > 10 ? `, and ${waiting.length - 10} more` : ''}`,
      );
    if (result.failed.length)
      parts.push(`${count(result.failed.length, 'image')} could not be checked`);
    status.textContent = parts.join('. ');
  } catch (error) {
    status.classList.add('error');
    status.textContent = `Card pool update failed: ${error?.message || error}`;
  } finally {
    button.disabled = false;
  }
};
$('auto').onclick = () => api.autoPath();
$('position').onclick = () => api.resetPosition();
api.subscribe(render);
api.getState().then(render);
