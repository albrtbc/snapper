const { discoverStates } = require('../src/services/paths.cjs');
const { StateReader } = require('../src/services/reader.cjs');
const { gameRunning } = require('../src/services/game.cjs');
(async () => {
  const directory = discoverStates(process.argv[2]);
  console.log('Folder:', directory || 'not found');
  console.log('Game running:', await gameRunning());
  if (!directory) {
    process.exitCode = 1;
    return;
  }
  const reader = new StateReader(directory);
  await reader.poll();
  const { match, status, message } = reader.state;
  console.log('Status:', status, message);
  if (match) {
    console.log('Turn:', match.turn, 'Finished:', match.ended);
    console.log(
      'Own cards:',
      match.deckRows.length,
      'Other:',
      match.added.length,
      'Opponent cards seen:',
      match.opponent.length,
    );
    for (const side of ['own', 'opponent']) {
      console.log(
        side,
        Object.fromEntries(
          ['hand', 'deck', 'played', 'discarded', 'destroyed', 'graveyard'].map((zone) => [
            zone,
            match.cards.filter((c) => c.side === side && c.status === zone).length,
          ]),
        ),
      );
    }
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
