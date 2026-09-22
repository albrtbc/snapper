const { Tracker } = require('./core/tracker.cjs');
const ids = [
  'Deadpool',
  'X23',
  'NicoMinoru',
  'Wolverine',
  'Carnage',
  'BuckyBarnes',
  'Killmonger',
  'Venom',
  'Deathlok',
  'ShangChi',
  'Knull',
  'Death',
];
function demoState() {
  const states = [
    'destroyed',
    'played',
    'hand',
    'played',
    'played',
    'destroyed',
    'hand',
    'deck',
    'discarded',
    'deck',
    'hand',
    'deck',
  ];
  const costs = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 6, 8];
  const cards = ids.map((id, i) => ({
    entityId: i + 20,
    cardId: id,
    name: id.replace(/([a-z])([A-Z])/g, '$1 $2'),
    status: states[i],
    side: 'own',
    origin: 'own',
    originKnown: true,
    cost: costs[i],
    power: [4, 2, 2, 4, 6, 1, 3, 3, 5, 3, 12, 12][i],
  }));
  for (const [i, id] of ['Blade', 'Morbius', 'LadySif', 'Swarm', 'Apocalypse'].entries())
    cards.push({
      entityId: 100 + i,
      cardId: id,
      name: id.replace(/([a-z])([A-Z])/g, '$1 $2'),
      status: i === 3 ? 'discarded' : i === 4 ? 'hand' : 'played',
      side: 'opponent',
      origin: 'opponent',
      originKnown: true,
      cost: [1, 2, 3, 2, 6][i],
      power: [3, 8, 5, 3, 17][i],
    });
  const match = new Tracker().update({
    gameId: 'demo',
    turn: 4,
    totalTurns: 6,
    cubes: 2,
    ended: false,
    initiative: 'own',
    deck: {
      name: 'Destroy · Demo',
      cards: ids.map((cardId) => ({ cardId, name: cardId.replace(/([a-z])([A-Z])/g, '$1 $2') })),
    },
    cards,
    players: { own: { deckCount: 3, handCount: 3 }, opponent: { deckCount: 5, handCount: 4 } },
  });
  return { status: 'demo', message: 'Demo · sample data', updatedAt: Date.now(), match, decks: [] };
}
module.exports = { demoState };
