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
      if (
        old?.cardId &&
        (old.status !== card.status || old.side !== card.side || old.cardId !== card.cardId)
      ) {
        this.history.unshift({
          id: `${this.history.length}-${card.entityId}`,
          turn: snapshot.turn,
          cardId: card.cardId,
          name: card.name,
          side: card.side,
          origin: card.origin,
          from: old.status,
          to: card.status,
        });
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
      const match = cards.find(
        (c) => c.cardId === base.cardId && c.origin === 'own' && !used.has(c.entityId),
      );
      if (match) {
        used.add(match.entityId);
        return { ...base, ...match, key: `deck-${index}`, stolen: match.side !== 'own' };
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
    const added = cards.filter((c) => c.side === 'own' && c.cardId && !used.has(c.entityId));
    // A known card still reveals the opponent's deck after we steal it.
    // Keep its current side so pile counts follow whoever owns it now.
    const opponent = cards.filter((c) => c.cardId && c.origin === 'opponent');
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
