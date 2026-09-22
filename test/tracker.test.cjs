const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSnapshot, readDecks } = require('../src/core/snapshot.cjs');
const { Tracker } = require('../src/core/tracker.cjs');
function fixture() {
  return {
    RemoteGame: {
      ClientGameInfo: { LocalPlayerEntityId: 7 },
      GameState: {
        $id: 'game',
        Id: 'match-a',
        Turn: 3,
        TotalTurns: 6,
        _players: [
          {
            $id: 'own',
            EntityId: 7,
            PlayerInfo: { AccountId: 'local' },
            Deck: { $id: 'deck', EntityId: 8, ZoneId: 'Deck', _cards: [{ $ref: 'hidden' }] },
            Hand: { $id: 'hand', ZoneId: 'Hand', _cards: [] },
          },
          {
            $id: 'enemy',
            EntityId: 2,
            PlayerInfo: { AccountId: 'enemy' },
            Deck: { $id: 'enemydeck', EntityId: 3, ZoneId: 'Deck', _cards: [] },
            Hand: { $id: 'enemyhand', ZoneId: 'Hand', _cards: [] },
          },
        ],
        _entityIdToEntity: {
          20: {
            $id: 'hidden',
            $type: 'CubeGame.Card, Logic',
            EntityId: 20,
            Owner: { $ref: 'own' },
            _zone: { $ref: 'deck' },
          },
          21: {
            $type: 'CubeGame.Card, Logic',
            EntityId: 21,
            CardDefId: 'Morbius',
            Owner: { $ref: 'enemy' },
            _zone: { $id: 'location', ZoneId: 'Location' },
            _previousZone: { $ref: 'enemyhand' },
            Revealed: true,
            StartedInDeckEntityId: 3,
            Cost: { Value: 2 },
            Power: { Value: 8 },
          },
          22: {
            $type: 'CubeGame.Card, Logic',
            EntityId: 22,
            CardDefId: 'SecretCard',
            Owner: { $ref: 'enemy' },
            _zone: { $ref: 'enemyhand' },
            StartedInDeckEntityId: 3,
          },
          23: {
            $type: 'CubeGame.Card, Logic',
            EntityId: 23,
            CardDefId: 'Wolverine',
            Owner: { $ref: 'own' },
            _zone: { $id: 'grave', ZoneId: 'Graveyard' },
            _previousZone: { $ref: 'hand' },
            StartedInDeckEntityId: 8,
            Power: { Value: 0 },
            Cost: { Value: 2 },
          },
          24: {
            $type: 'CubeGame.Card, Logic',
            EntityId: 24,
            CardDefId: 'Deadpool',
            Owner: { $ref: 'own' },
            _zone: { $ref: 'grave' },
            _previousZone: { $ref: 'location' },
            StartedInDeckEntityId: 8,
            Power: { Value: -1 },
            Cost: { Value: 1 },
          },
        },
      },
    },
  };
}
const deck = {
  name: 'Test',
  cards: ['Wolverine', 'Deadpool', 'Venom'].map((cardId) => ({ cardId, name: cardId })),
};
test('resolves Newtonsoft forward/cyclic references, local player need not be first', () => {
  const raw = fixture();
  raw.RemoteGame.GameState._players.reverse();
  const state = parseSnapshot(raw, deck);
  assert.equal(state.players.own.deckCount, 1);
  assert.equal(state.cards[1].side, 'opponent');
  assert.doesNotThrow(() => JSON.stringify(state));
});
test('redacts hidden opponent identity and numbers even if present in raw state', () => {
  const raw = fixture();
  const hidden = raw.RemoteGame.GameState._entityIdToEntity[22];
  hidden.Cost = { Value: 6 };
  hidden.Power = { Value: 99 };
  const card = parseSnapshot(raw, deck).cards.find((c) => c.entityId === 22);
  assert.equal(card.cardId, null);
  assert.equal(card.power, null);
  assert.equal(card.cost, null);
});
test('does not reveal an unrevealed card staged on the board', () => {
  const raw = fixture();
  raw.RemoteGame.GameState._entityIdToEntity[21].Revealed = false;
  const card = parseSnapshot(raw, deck).cards.find((c) => c.entityId === 21);
  assert.equal(card.cardId, null);
  assert.equal(card.status, 'staged');
});
test('classifies graveyard from previous zone and preserves zero/negative stats', () => {
  const state = parseSnapshot(fixture(), deck);
  const discard = state.cards.find((c) => c.entityId === 23),
    destroy = state.cards.find((c) => c.entityId === 24);
  assert.equal(discard.status, 'discarded');
  assert.equal(discard.power, 0);
  assert.equal(destroy.status, 'destroyed');
  assert.equal(destroy.power, -1);
});
test('unknown graveyard cause is not invented', () => {
  const raw = fixture();
  delete raw.RemoteGame.GameState._entityIdToEntity[23]._previousZone;
  assert.equal(parseSnapshot(raw, deck).cards.find((c) => c.entityId === 23).status, 'graveyard');
});
test('never reads the enemy full postgame deck', () => {
  const raw = fixture();
  raw.RemoteGame.GameState.ClientResultMessage = {
    GameId: 'match-a',
    GameResultAccountItems: [
      { AccountId: 'enemy', Deck: { Cards: [{ CardDefId: 'SecretEnding' }] } },
      { AccountId: 'local', Deck: { Name: 'Own', Cards: [{ CardDefId: 'Venom' }] } },
    ],
  };
  const parsed = parseSnapshot(raw, deck);
  assert.equal(parsed.deck.name, 'Own');
  assert.ok(!JSON.stringify(parsed).includes('SecretEnding'));
});
test('revival removes the card from current discard, keeps observed movement', () => {
  const tracker = new Tracker(),
    raw = fixture();
  tracker.update(parseSnapshot(raw, deck));
  raw.RemoteGame.GameState._entityIdToEntity[24]._zone = { $id: 'grave', ZoneId: 'Graveyard' };
  raw.RemoteGame.GameState._entityIdToEntity[23]._zone = { $ref: 'location' };
  raw.RemoteGame.GameState._entityIdToEntity[23].Revealed = true;
  const state = tracker.update(parseSnapshot(raw, deck));
  assert.equal(state.cards.filter((c) => c.status === 'discarded').length, 0);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].from, 'discarded');
  tracker.update(parseSnapshot(raw, deck));
  assert.equal(tracker.history.length, 1);
});
test('remembers revealed opponent cards returned to hand without inventing power', () => {
  const tracker = new Tracker(),
    raw = fixture();
  tracker.update(parseSnapshot(raw, deck));
  const card = raw.RemoteGame.GameState._entityIdToEntity[21];
  card._zone = { $ref: 'enemyhand' };
  delete card.CardDefId;
  card.Revealed = false;
  const result = tracker.update(parseSnapshot(raw, deck)).opponent.find((c) => c.entityId === 21);
  assert.equal(result.cardId, 'Morbius');
  assert.equal(result.status, 'hand');
  assert.equal(result.power, null);
});
test('stolen original deck cards remain accounted for', () => {
  const raw = fixture();
  raw.RemoteGame.GameState._entityIdToEntity[23].Owner = { $ref: 'enemy' };
  const state = new Tracker().update(parseSnapshot(raw, deck));
  assert.equal(state.deckRows[0].stolen, true);
  assert.equal(state.deckRows[0].status, 'discarded');
  assert.equal(state.added.length, 0);
});
test('stealing a hidden enemy card reveals it in both opponent deck and our added cards', () => {
  const raw = fixture(),
    tracker = new Tracker(),
    card = raw.RemoteGame.GameState._entityIdToEntity[22];
  card.CardDefId = 'SpiderHam';
  card.ArtVariantDefId = 'SpiderHam_02';
  let state = tracker.update(parseSnapshot(raw, deck));
  assert.ok(!state.opponent.some((c) => c.cardId === 'SpiderHam'));
  card.Owner = { $ref: 'own' };
  card._zone = { $ref: 'hand' };
  for (const zone of ['Hand', 'Location', 'Graveyard']) {
    card._zone = { ZoneId: zone };
    card._previousZone = { ZoneId: 'Hand' };
    card.Revealed = zone === 'Location';
    state = tracker.update(parseSnapshot(raw, deck));
    const stolen = state.opponent.filter((c) => c.entityId === 22);
    assert.equal(stolen.length, 1);
    assert.equal(stolen[0].cardId, 'SpiderHam');
    assert.equal(stolen[0].variantId, 'SpiderHam_02');
    assert.equal(stolen[0].side, 'own');
    assert.equal(stolen[0].origin, 'opponent');
    assert.ok(state.added.some((c) => c.entityId === 22));
    assert.ok(!state.deckRows.some((c) => c.entityId === 22));
    assert.ok(
      !state.opponent.some(
        (c) => c.entityId === 22 && c.side === 'opponent' && c.status === 'discarded',
      ),
    );
  }
  // Returning a stolen card to an enemy hidden zone must not lose the identity.
  card.Owner = { $ref: 'enemy' };
  card._zone = { $ref: 'enemyhand' };
  card._previousZone = { ZoneId: 'Location' };
  card.Revealed = false;
  delete card.CardDefId;
  state = tracker.update(parseSnapshot(raw, deck));
  assert.equal(state.opponent.filter((c) => c.entityId === 22).length, 1);
  assert.equal(state.opponent.find((c) => c.entityId === 22).cardId, 'SpiderHam');
  assert.ok(!state.added.some((c) => c.entityId === 22));
});
test('generated duplicate cannot consume an original deck slot', () => {
  const raw = fixture();
  const card = structuredClone(raw.RemoteGame.GameState._entityIdToEntity[23]);
  card.EntityId = 99;
  delete card.StartedInDeckEntityId;
  raw.RemoteGame.GameState._entityIdToEntity[99] = card;
  const state = new Tracker().update(parseSnapshot(raw, deck));
  assert.equal(state.deckRows[0].entityId, 23);
  assert.equal(state.added.length, 1);
  assert.equal(state.added[0].entityId, 99);
});
test('unobserved deck identity is marked uncertain, not asserted as remaining', () => {
  const result = new Tracker().update(parseSnapshot(fixture(), deck));
  assert.equal(result.deckRows[2].status, 'unseen');
  assert.equal(result.deckRows[2].inferred, true);
});
test('removed entities no longer claim their old zone', () => {
  const raw = fixture(),
    tracker = new Tracker();
  tracker.update(parseSnapshot(raw, deck));
  delete raw.RemoteGame.GameState._entityIdToEntity[21];
  assert.equal(tracker.update(parseSnapshot(raw, deck)).opponent[0].status, 'unknown');
});
test('resets for new games and empty lobby, including opponent knowledge', () => {
  const tracker = new Tracker(),
    raw = fixture();
  tracker.update(parseSnapshot(raw, deck));
  raw.RemoteGame.GameState.Id = 'match-b';
  delete raw.RemoteGame.GameState._entityIdToEntity[21];
  assert.equal(tracker.update(parseSnapshot(raw, deck)).opponent.length, 0);
  tracker.update(null);
  assert.equal(tracker.seen.size, 0);
});
test('reads collection decks using embedded cards or CardIds', () => {
  const result = readDecks({
    ServerState: {
      Cards: [{ Id: 'a', CardDefId: 'Venom' }],
      Decks: [{ Id: 'd', Name: 'Test', CardIds: ['a'] }],
    },
  });
  assert.equal(result[0].cards[0].cardId, 'Venom');
});
module.exports = { fixture, deck };
test('variants come from the equipped deck and visible cards only', () => {
  const decks = readDecks({
    Cards: [{ Id: 'a', CardDefId: 'Venom', ArtVariantDefId: 'Venom_02' }],
    Decks: [
      {
        Cards: [
          { CardDefId: 'Deadpool', ArtVariantDefId: 'Deadpool_03' },
          { CardDefId: 'Venom', ArtVariantDefId: 'Venom_02' },
        ],
      },
      { CardIds: ['a'] },
    ],
  });
  assert.equal(decks[0].cards[0].variantId, 'Deadpool_03');
  assert.equal(decks[1].cards[0].variantId, 'Venom_02');
  const raw = fixture(),
    entities = raw.RemoteGame.GameState._entityIdToEntity;
  entities[21].ArtVariantDefId = 'Morbius_02';
  entities[22].ArtVariantDefId = 'SecretCard_01';
  const tracker = new Tracker();
  let state = tracker.update(parseSnapshot(raw, decks[0]));
  assert.equal(state.opponent[0].variantId, 'Morbius_02');
  assert.equal(state.cards.find((c) => c.entityId === 22).variantId, null);
  assert.equal(state.deckRows[0].variantId, null); // Observed base art overrides deck metadata.
  assert.equal(state.deckRows[1].variantId, 'Venom_02'); // Unseen deck row keeps equipped art.
  entities[21]._zone = { $ref: 'enemyhand' };
  entities[21].Revealed = false;
  delete entities[21].CardDefId;
  state = tracker.update(parseSnapshot(raw, decks[0]));
  assert.equal(state.opponent[0].variantId, 'Morbius_02');
  entities[21].CardDefId = 'Venom';
  entities[21].Revealed = true;
  entities[21].ArtVariantDefId = 'None';
  state = tracker.update(parseSnapshot(raw, decks[0]));
  assert.equal(state.opponent[0].variantId, null);
});
test('incomplete or duplicated player roster during a second game is rejected without throwing', () => {
  for (const kind of ['duplicate', 'missing', 'unresolved', 'noLocalId']) {
    const raw = fixture();
    raw.RemoteGame.GameState.Id = 'match-b';
    if (kind === 'duplicate') raw.RemoteGame.GameState._players[1] = { $ref: 'own' };
    if (kind === 'missing') raw.RemoteGame.GameState._players.pop();
    if (kind === 'unresolved') raw.RemoteGame.GameState._players[1] = { $ref: 'not-created-yet' };
    if (kind === 'noLocalId') delete raw.RemoteGame.ClientGameInfo.LocalPlayerEntityId;
    assert.equal(parseSnapshot(raw), null);
  }
});

test('opponent deck excludes generated cards and cards stolen from our deck', () => {
  const tracker = new Tracker(),
    raw = fixture(),
    entities = raw.RemoteGame.GameState._entityIdToEntity;
  for (const [id, cardId, origin] of [
    [90, 'Rock', 0],
    [91, 'Vibranium', 0],
    [92, 'Morbius', 0],
    [93, 'Wolverine', 8],
  ]) {
    entities[id] = {
      ...structuredClone(entities[21]),
      EntityId: id,
      CardDefId: cardId,
      StartedInDeckEntityId: origin,
    };
  }
  let state = tracker.update(parseSnapshot(raw, deck));
  assert.deepEqual(
    state.opponent.map((c) => c.entityId),
    [21],
  );
  // Retain observations internally, so our own generated cards still work.
  assert.equal(state.cards.filter((c) => c.side === 'opponent' && c.cardId).length, 5);
  entities[90]._zone = { ZoneId: 'Graveyard' };
  entities[90]._previousZone = { ZoneId: 'Hand' };
  entities[21]._zone = { ZoneId: 'Graveyard' };
  entities[21]._previousZone = { ZoneId: 'Hand' };
  state = tracker.update(parseSnapshot(raw, deck));
  assert.deepEqual(
    state.opponent.filter((c) => c.status === 'discarded').map((c) => c.cardId),
    ['Morbius'],
  );
  assert.deepEqual(
    state.history
      .filter((h) => h.side === 'opponent' && h.origin === 'opponent')
      .map((h) => h.cardId),
    ['Morbius'],
  );
  entities[90].Owner = { $ref: 'own' };
  state = tracker.update(parseSnapshot(raw, deck));
  assert.ok(state.added.some((c) => c.cardId === 'Rock'));
});
