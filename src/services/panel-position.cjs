const validPosition = (position) =>
  position &&
  Number.isFinite(position.x) &&
  Number.isFinite(position.y) &&
  Math.abs(position.x) < 100000 &&
  Math.abs(position.y) < 100000;
function relativePosition(panel, game) {
  return game
    ? { relativeTo: 'game', x: panel.x - game.x, y: panel.y - game.y }
    : { x: panel.x, y: panel.y };
}
function absolutePosition(saved, game, fallback) {
  if (!validPosition(saved)) return fallback;
  return saved.relativeTo === 'game'
    ? { x: Math.round(game.x + saved.x), y: Math.round(game.y + saved.y) }
    : { x: Math.round(saved.x), y: Math.round(saved.y) };
}
module.exports = { relativePosition, absolutePosition, validPosition };
