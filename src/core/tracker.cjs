// Every identity an entity has shown, oldest first. A transform keeps the entity
// and changes its card, and a card that was seen must not vanish when it does.
function identitiesOf(card, old) {
  const identities = old?.identities || [];
  const last = identities[identities.length - 1];
  if (!card.cardId) return identities;
  if (last?.cardId === card.cardId)
    // Same card: follow its art, so a later transformed row shows what was on screen.
    return card.variantId && card.variantId !== last.variantId
      ? [...identities.slice(0, -1), { ...last, variantId: card.variantId }]
      : identities;
  return [
    ...identities,
    { cardId: card.cardId, variantId: card.variantId ?? null, name: card.name },
  ];
}
// A row for an identity the entity no longer shows. Its stats belong to the new card.
function transformedRow(card, index) {
  const ids = card.identities;
  return {
    ...card,
    ...ids[index],
    status: 'transformed',
    cost: null,
    power: null,
    transformedFrom: ids[index - 1]?.name ?? null,
    transformedInto: ids[index + 1].name,
  };
}
// Rows from identity `from` on: the earlier identities as transformed, then the current card.
function identityRows(card, from = 0) {
  const ids = card.identities || [];
  if (ids.length < 2) return from === 0 ? [card] : [];
  const rows = [];
  for (let index = from; index < ids.length - 1; index++) rows.push(transformedRow(card, index));
  rows.push({ ...card, transformedFrom: ids[ids.length - 2].name });
  return rows;
}
class Tracker {
  constructor() {
    this.reset();
  }
  reset() {
    this.gameId = null;
    this.seen = new Map();
    this.history = [];
    this.deck = null;
  }
  update(snapshot) {
    if (!snapshot) {
      this.reset();
      return null;
    }
    if (snapshot.gameId !== this.gameId) {
      this.reset();
      this.gameId = snapshot.gameId;
      this.deck = snapshot.deck;
    }
    if (!this.deck || snapshot.ended) this.deck = snapshot.deck || this.deck;
    const present = new Set();
    for (const incoming of snapshot.cards) {
      present.add(incoming.entityId);
      const old = this.seen.get(incoming.entityId);
      const card = { ...incoming };
      // Remember an identity after a publicly revealed card returns to hand/deck.
      if (!card.cardId && old?.cardId) {
        card.cardId = old.cardId;
        card.variantId = old.variantId;
        card.name = old.name;
        card.cost = null;
        card.power = null;
        card.origin = old.origin;
        card.originKnown = old.originKnown;
      }
      card.identities = identitiesOf(card, old);
      if (old?.cardId) {
        const moved = old.status !== card.status || old.side !== card.side;
        const transform = old.cardId !== card.cardId;
        const record = (event) =>
          this.history.unshift({
            id: `${this.history.length}-${card.entityId}`,
            turn: snapshot.turn,
            cardId: card.cardId,
            name: card.name,
            side: card.side,
            origin: card.origin,
            ...event,
          });
        // A card can move and transform between two reads: keep both events.
        if (moved)
          record({
            ...(transform && { cardId: old.cardId, name: old.name }),
            from: old.status,
            to: card.status,
          });
        if (transform)
          record({ name: `${old.name} → ${card.name}`, from: card.status, to: 'transformed' });
      }
      this.seen.set(card.entityId, card);
    }
    // Keep seen opponent cards if Snap redacts/removes an entity, but do not
    // continue claiming its last zone as its current location.
    for (const [id, card] of this.seen)
      if (!present.has(id)) this.seen.set(id, { ...card, status: 'unknown' });
    this.history = this.history.slice(0, 80);
    const cards = [...this.seen.values()];
    const used = new Set();
    const deckRows = (this.deck?.cards || []).map((base, index) => {
      // Match by the first identity: a deck card that transformed still fills its slot.
      const match = cards.find(
        (c) =>
          (c.identities[0]?.cardId ?? c.cardId) === base.cardId &&
          c.origin === 'own' &&
          !used.has(c.entityId),
      );
      if (match) {
        used.add(match.entityId);
        // A card that changed back to its deck card is that card again.
        const row = match.cardId !== match.identities[0]?.cardId ? transformedRow(match, 0) : match;
        return { ...base, ...row, key: `deck-${index}`, stolen: match.side !== 'own' };
      }
      // The selected deck is known, but unobserved membership is an inference.
      return {
        ...base,
        key: `deck-${index}`,
        status: 'unseen',
        cost: null,
        power: null,
        side: 'own',
        inferred: true,
      };
    });
    // A transformed deck card keeps its deck slot, and what it became is added.
    const added = cards
      .filter((c) => c.side === 'own' && c.cardId)
      .flatMap((c) => {
        if (!used.has(c.entityId)) return identityRows(c);
        const rows = identityRows(c, 1);
        // Changed back: the current card is its deck slot, so list only what it was meanwhile.
        return c.cardId === c.identities[0]?.cardId ? rows.slice(0, -1) : rows;
      });
    // A known card still reveals the opponent's deck after we steal it.
    // Keep its current side so pile counts follow whoever owns it now.
    // Every identity the opponent's card has shown stays listed.
    const opponent = cards
      .filter((c) => c.cardId && c.origin === 'opponent')
      .flatMap((c) => identityRows(c));
    return {
      ...snapshot,
      deck: this.deck,
      cards,
      deckRows,
      added,
      opponent,
      history: this.history,
    };
  }
}
module.exports = { Tracker };
