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
  $('data-status').textContent = state.message;
  $('path').textContent = state.statesPath || 'Folder not found';
  $('shortcut-errors').textContent = (state.shortcuts || []).some((s) => !s.registered)
    ? 'A shortcut is unavailable. Use the tray icon to control the panels.'
    : '';
  if (!initialized) {
    for (const id of ['scale', 'opacity']) $(id).value = state.settings[id];
    for (const id of ['compact', 'images', 'gameArt']) $(id).checked = state.settings[id];
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
  });
  $('saved').textContent = 'Settings saved.';
};
$('choose').onclick = async () => {
  const result = await api.choosePath();
  $('path-error').textContent = result?.error || '';
};
$('auto').onclick = () => api.autoPath();
$('position').onclick = () => api.resetPosition();
api.subscribe(render);
api.getState().then(render);
