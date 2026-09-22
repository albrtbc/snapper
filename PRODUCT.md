# Snapper

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop overlay hosted by a native Linux Electron process. Marvel Snap runs in Steam/Proton.

## Stack

Delegated by the user: Electron, plain JavaScript and CSS. No server account required.

## Users

Marvel Snap players who need to see their remaining cards, played cards, and the opponent's revealed cards while playing.

## Product purpose

Two compact panels that start with the game, keep the board clear, and show card images and current zones at a glance.

## Capabilities and constraints

Read the live game state externally through read-only /proc memory on the supported Linux/Proton build; fall back to local Newtonsoft JSON snapshots. Never reveal identities from the opponent's full result deck or hidden entities. Preserve known identities across returns, ownership changes and transformations. Distinguish current graveyard contents from observed transition history. Report live status in settings only when the worker supplies recent reads. The game controls fallback file frequency. Clear the previous match on returning to the lobby.

## Brand commitments

The user specified LTD2 Smart Overlay, Untapped and Marvel Snap Zone as references. Use the user's Untapped screenshot as the composition reference: large full card art in a grid, remaining own-deck cards in color, drawn or played own-deck cards gray, sparse text, discard/destroy counts with images. Preserve dark movable panels. English throughout the interface and original card names. Build directly in code, as requested.

## Evidence on hand

Reference implementation: ../ltd2-smart-overlay/Data/overlay.css and overlay.js. Local Marvel Snap version 57.17 snapshots were inspected on 2026-09-21. Raw snapshots contain account information and must not be committed or uploaded.
