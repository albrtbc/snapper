// Newtonsoft serializes a graph, not a tree. Resolve references lazily so
// cyclic Game/Owner/Zone links never reach the renderer or JSON.stringify.
function graph(root) {
  const ids = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$id) ids.set(String(value.$id), value);
    for (const child of Object.values(value)) visit(child);
  }
  visit(root);
  return (value) => (value?.$ref ? ids.get(String(value.$ref)) || {} : value || {});
}
const list = (value) =>
  Array.isArray(value) ? value : Array.isArray(value?.$values) ? value.$values : [];
const validId = (value) => typeof value === 'string' && value !== 'None' && value !== '';
const variantId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(value) && value !== 'None'
    ? value
    : null;
const deckCard = (card) => ({
  cardId: card.CardDefId,
  name: label(card.CardDefId),
  variantId: variantId(card.ArtVariantDefId),
});
const label = (id) => id.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

function readDecks(collection) {
  const col = collection?.ServerState || collection || {};
  const byId = new Map(list(col.Cards).map((card) => [card.Id, card]));
  return list(col.Decks).map((deck) => ({
    id: deck.Id,
    name: deck.Name || 'My deck',
    cards: (list(deck.Cards).length
      ? list(deck.Cards)
      : list(deck.CardIds).map((id) => byId.get(id))
    )
      .filter((card) => validId(card?.CardDefId))
      .map(deckCard),
  }));
}

function parseSnapshot(raw, selectedDeck = null) {
  const resolve = graph(raw);
  const remote = resolve(raw?.RemoteGame);
  const game = resolve(remote.GameState);
  const localId = resolve(remote.ClientGameInfo).LocalPlayerEntityId;
  const players = list(game._players).map(resolve);
  if (
    !game.Id ||
    !Number.isInteger(localId) ||
    localId <= 0 ||
    players.length !== 2 ||
    players.some((p) => !Number.isInteger(p.EntityId) || p.EntityId <= 0) ||
    players[0].EntityId === players[1].EntityId ||
    !players.some((p) => p.EntityId === localId)
  )
    return null;
  const local = players.find((p) => p.EntityId === localId);
  const enemy = players.find((p) => p.EntityId !== localId);
  const result = resolve(game.ClientResultMessage);
  const accountId = resolve(local.PlayerInfo).AccountId;
  const ownResult = accountId
    ? list(result.GameResultAccountItems)
        .map(resolve)
        .find((p) => p.AccountId === accountId)
    : null;
  // End-of-game data may contain the opponent's full deck. Never use it.
  const finalDeck = ownResult ? resolve(ownResult.Deck) : null;
  const deck = list(finalDeck?.Cards).length
    ? {
        id: finalDeck.Id,
        name: finalDeck.Name || selectedDeck?.name || 'My deck',
        cards: list(finalDeck.Cards)
          .map(resolve)
          .filter((c) => validId(c.CardDefId))
          .map(deckCard),
      }
    : selectedDeck;
  const ownDeckId = resolve(local.Deck).EntityId;
  const enemyDeckId = resolve(enemy.Deck).EntityId;
  const entities = Object.entries(resolve(game._entityIdToEntity))
    .filter(([k]) => !k.startsWith('$'))
    .map(([, v]) => resolve(v));
  const cards = entities
    .filter((entity) => entity.$type?.startsWith('CubeGame.Card,'))
    .map((card) => {
      const zone = resolve(card._zone),
        previous = resolve(card._previousZone);
      const owner = resolve(card.Owner).EntityId;
      const side = owner === localId ? 'own' : owner === enemy.EntityId ? 'opponent' : null;
      const zoneId = zone.ZoneId;
      let status =
        { Deck: 'deck', Hand: 'hand', Location: 'played', Banished: 'banished', SetAside: 'aside' }[
          zoneId
        ] || 'unknown';
      if (zoneId === 'Graveyard')
        status =
          previous.ZoneId === 'Hand'
            ? 'discarded'
            : ['Location', 'Deck'].includes(previous.ZoneId)
              ? 'destroyed'
              : 'graveyard';
      if (status === 'played' && !card.Revealed) status = 'staged';
      const known = validId(card.CardDefId);
      // Only retain public identities on the opponent side. Hidden cards with a
      // definition present in an internal snapshot are still not public cards.
      const visible =
        side === 'own' ||
        card.Revealed === true ||
        ['discarded', 'destroyed', 'graveyard', 'banished'].includes(status) ||
        list(card._visibleToPlayerEntityIds).includes(localId) ||
        (status === 'hand' && previous.ZoneId === 'Graveyard');
      const number = (field, fallback) => {
        const stat = resolve(card[field]);
        return known && visible
          ? typeof stat.Value === 'number'
            ? stat.Value
            : (fallback ?? 0)
          : null;
      };
      const origin = card.StartedInDeckEntityId;
      return {
        entityId: card.EntityId,
        side,
        cardId: known && visible ? card.CardDefId : null,
        variantId: known && visible ? variantId(card.ArtVariantDefId) : null,
        name: known && visible ? label(card.CardDefId) : 'Hidden card',
        status,
        cost: number('Cost', card.DefCost),
        power: number('Power', card.DefPower),
        revealed: !!card.Revealed,
        turn: card.TurnRevealed || null,
        origin: origin === ownDeckId ? 'own' : origin === enemyDeckId ? 'opponent' : 'generated',
        // A missing origin on redacted entities is not evidence of generation.
        originKnown: !!origin || (known && visible && side === 'own'),
        previousStatus:
          { Hand: 'hand', Location: 'played', Deck: 'deck', Graveyard: 'graveyard' }[
            previous.ZoneId
          ] || null,
      };
    })
    .filter((c) => c.side && c.status !== 'aside');
  return {
    gameId: game.Id,
    turn: game.Turn || 0,
    totalTurns: game.TotalTurns || 6,
    cubes: game.CubeValue || 1,
    ended: !!result.GameId,
    initiative: game.PlayerWithInitiativeEntityId === localId ? 'own' : 'opponent',
    deck,
    cards,
    players: {
      own: {
        name: 'Your deck',
        deckCount: list(resolve(local.Deck)._cards).length,
        handCount: list(resolve(local.Hand)._cards).length,
      },
      opponent: {
        name: 'Opponent',
        deckCount: list(resolve(enemy.Deck)._cards).length,
        handCount: list(resolve(enemy.Hand)._cards).length,
      },
    },
  };
}
module.exports = { graph, list, validId, label, readDecks, parseSnapshot };
