const { isAbsolute } = require('node:path');
const { validPosition } = require('./panel-position.cjs');

const DEFAULTS = Object.freeze({
  scale: 1,
  opacity: 0.96,
  images: true,
  gameArt: false,
  compact: false,
  hideWhenUnfocused: false,
});
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function preferences(input) {
  const result = {};
  if (!isRecord(input)) return result;
  for (const [key, min, max] of [
    ['scale', 0.75, 1.4],
    ['opacity', 0.65, 1],
  ]) {
    if (Number.isFinite(input[key])) result[key] = Math.max(min, Math.min(max, input[key]));
  }
  for (const key of ['images', 'gameArt', 'compact', 'hideWhenUnfocused'])
    if (typeof input[key] === 'boolean') result[key] = input[key];
  return result;
}
function readSettings(input) {
  const settings = {
    ...DEFAULTS,
    statesPath: '',
    positions: {},
    layoutVersion: 2,
    ...preferences(input),
  };
  if (!isRecord(input)) return settings;
  if (
    typeof input.statesPath === 'string' &&
    input.statesPath.length < 4096 &&
    !input.statesPath.includes('\0') &&
    isAbsolute(input.statesPath)
  )
    settings.statesPath = input.statesPath;
  for (const side of ['own', 'opponent']) {
    const position = input.positions?.[side];
    if (!validPosition(position)) continue;
    settings.positions[side] = { x: position.x, y: position.y };
    if (position.relativeTo === 'game') settings.positions[side].relativeTo = 'game';
  }
  if (input.layoutVersion !== 2) settings.compact = false;
  return settings;
}
module.exports = { readSettings, preferences };
