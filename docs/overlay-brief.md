# Overlay

Mode: Operate. Two narrow panels on the sides of the game, each movable, collapsible and lockable. Preserve the user's named references rather than inventing a new visual identity.

## Direction contract

THESIS: Identify available and observed cards without looking away from the board.

OWN-WORLD: LTD2's blue-black panels and small system type; blue for own cards, warm amber for the opponent. Card art supplies visual identity.

STORY: Scan counts, identify a card by portrait, read its zone, expand a pile when needed.

FIRST VIEWPORT: Own deck at left, observed rival at right. Compact art rows, visible hand/deck counters, discarded and destroyed lists beneath. Status footer reports snapshot age. Configuration lives in a separate window.

FORM: User-pinned competitor convention and existing LTD2 visual reference; direct implementation requested.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Updated user direction, 2026-09-21

The user rejected the text-heavy rows and supplied an Untapped grid screenshot. Replace rows with full card art, four columns per 416px panel, gray pending cards, bright observed cards, small hand/status marks and adjacent discard/destroy groups. Preserve filters, image fallbacks, locked click-through behavior and history disclosure. Native desktop only; no mobile surface. Code-led build, no generated comp. Live mode requires fresh worker data; lobby clears the rival.

## Interaction update, 2026-09-21

Panels start interactive, accept wheel scrolling and can be dragged repeatedly from their headers without a focus prerequisite. Remove all per-card state labels/check marks and the old legend. Display ability text on hover or keyboard focus. Hide the rival in the lobby; hide both panels while either game avatar menu is open. Preserve saved positions and manual hide settings.

## Latest controls and density

All app copy is English. Always show the complete deck without filter tabs. Omit deck names, turn, cubes and the overlay status footer. Keep deck/hand counters and header controls. Button tooltips render inside the overlay above its content. Tighten card rows with a .84 aspect ratio and a 2px row gap while preserving image width.

## Own-deck tracking update, 2026-09-22

Keep remaining own-deck cards in full color. Gray out drawn, played and other cards outside our deck in the main grid, including stolen cards. Cards returned to our deck regain color. Keep opponent styling and the separate pile presentation unchanged.

## Full card names, 2026-09-22

Use a .74 card aspect ratio and fit images within the full available height without a negative top offset. Preserve card width while keeping the bottom names visible in main grids, added cards and piles, including compact mode.
