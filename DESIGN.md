---
name: Snapper
description: Full card grids beside Marvel Snap on Linux.
colors:
  bg: '#19171f'
  surface: '#24212c'
  line: '#3b3646'
  text: '#f5f2f8'
  muted: '#bbb3c6'
  accent: '#a9d6f9'
  opponent: '#edcb9f'
  hand: '#d4e8b8'
  discard: '#dfbdec'
  destroy: '#edbb9f'
  filter-active: '#3b3348'
  filter-hover: '#342c40'
  portrait: '#29232f'
  counter-bg: '#211e28'
  pile-bg: '#25212d'
  cost: '#164597'
  power: '#aa500d'
  settings-bg: '#101824'
  settings-surface: '#192638'
  settings-connection: '#1c2b3e'
  settings-line: '#304158'
  settings-text: '#edf3fa'
  settings-muted: '#a7b6c9'
  settings-accent: '#91c9f3'
  settings-primary-hover: '#bcdef7'
  settings-secondary-border: '#405572'
  settings-secondary-text: '#d6e1ef'
  settings-secondary-hover: '#233348'
  settings-success: '#bedb9a'
  settings-error: '#f1b295'
typography:
  body:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: 12px
    lineHeight: 1.4
  title:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 700
  card-name:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 650
    lineHeight: 1.1
  card-number:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 800
    lineHeight: 1
  label:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: 11px
  settings-body:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: 14px
    lineHeight: 1.55
  action:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.5
rounded:
  control: 3px
  field: 4px
  power: 5px
  panel: 6px
spacing:
  column-gap: 2px
  outer-inset: 3px
  control-gap: 4px
  row-gap: 2px
  small: 8px
  inset: 10px
  regular: 12px
components:
  button-primary:
    backgroundColor: '{colors.settings-accent}'
    textColor: '{colors.settings-bg}'
    typography: '{typography.action}'
    rounded: '{rounded.field}'
    padding: 8px 12px
  button-secondary:
    backgroundColor: transparent
    textColor: '{colors.settings-secondary-text}'
    typography: '{typography.action}'
    rounded: '{rounded.field}'
    padding: 8px 12px
  filter:
    backgroundColor: transparent
    textColor: '{colors.muted}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: 4px 8px
  filter-active:
    backgroundColor: '{colors.filter-active}'
    textColor: '{colors.text}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: 4px 8px
  panel:
    backgroundColor: '{colors.bg}'
    textColor: '{colors.text}'
    rounded: '{rounded.panel}'
  header-tool:
    backgroundColor: transparent
    textColor: '{colors.muted}'
    rounded: '{rounded.control}'
    padding: 4px
  card-fallback:
    backgroundColor: '{colors.portrait}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    typography: '{typography.card-name}'
---

# Design System: Snapper

## Overview

**Creative North Star: "Untapped full-card grid"**

Snapper follows the user's Untapped screenshot for its overlay composition. Large card images fill four columns inside dark movable panels. Remaining own-deck cards retain their art colors; drawn, played and other cards outside our deck are gray. The opponent keeps its existing state styling. English controls stay small, and card names keep their original spelling.

The implemented overlay uses plum-black backgrounds, pale blue for the player and warm amber for the rival. Settings retains its existing blue-black palette and wider text layout. The interface is HTML, CSS and JavaScript in native Linux Electron windows, built directly in code without a generated comp.

**Key Characteristics:**

- Four full-card columns at the default panel width.
- Bright remaining own-deck art, gray drawn or played cards, and ability text on hover.
- Adjacent discard and destroy groups with counts and card images.
- Visible header controls and a separate settings window for connection status.

This record describes the built overlay and settings files under `src/ui/`, plus native sizing in `src/main.cjs`. The accepted reference is the user-supplied Untapped screenshot. Finish review disposition was ship for `artifacts/grid-own.png`, `artifacts/grid-opponent.png`, `artifacts/grid-own-110.png` and `artifacts/grid-opponent-110.png`. These captures use demonstration data and establish presentation only. They do not verify a live game.

## Colors

Overlay neutrals are plum-black, with a slightly lighter header and pale lavender text. The frontmatter owns the extracted color values. Settings neutrals remain blue-black, with blue-gray text and borders.

The primary overlay accent is pale blue on the player's identity and focus outlines. Warm amber identifies the opponent. Discard lilac and destroy peach identify pile headings. In our main deck grid, remaining cards keep their art colors; cards outside the deck lose color and brightness. Opponent styling is unchanged.

Cost badges use blue with a pale blue border. Power badges use orange with a pale gold border. These card statistics are independent of panel ownership. Settings has its own blue action accent, green confirmation and peach errors.

## Typography

System sans serif keeps the controls compact. The overlay uses tabular numbers for stable counters. Titles use the title role; metadata and history use the label role. Counter numbers are 16px with line-height 1. Cost and power use the heavier card-number role.

Loaded art already contains the card name, so the separate name is hidden. If art is disabled or unavailable, the complete name appears near the bottom of the card and wraps anywhere. The accessible card description retains the full name, zone, cost, power and known origin, including an inference notice when appropriate. The tooltip shows only the ability description.

Settings uses its larger body role, a 27px heading, 15px section headings and 11px monospace paths. At its narrow breakpoint the heading becomes 25px. Long paths wrap anywhere; panel titles truncate with ellipsis.

## Layout

Each native overlay is 416px wide at 100% scale. The body's 3px inset surrounds a bordered panel. Header and scrollable content form a vertical flex layout. The native width is `round(416 * scale)`, so 110% produces 458px; Electron zoom uses the same scale. Height follows the visible panel, capped at `round(850 * scale)` and the game bounds minus 40px. The CSS height limit is independent of the current native height so panels can grow again when cards arrive. Transparent space below the panel is outside the native window. Card tooltips fit inside the current panel, opening upward when needed; they never resize it. Only control tooltips on a minimized panel may temporarily expand the native window. Default placement is 18px from each horizontal game edge and 24px below its top edge.

The main card grid has four equal columns, 2px between rows and 2px between columns, with 6px 7px 5px padding. Each card has a .74 width-to-height aspect ratio. At the default width, the four columns make cards approximately 97px wide. Compact mode changes card lists to five columns and reduces statistic type to 13px. It is an optional density control, not a viewport breakpoint.

Discarded, Destroyed and Banished groups share one horizontal grid row with equal-width columns and a 4px gap. A graveyard group joins the same row when present. Each pile keeps a two-column card grid, including in compact mode, so no pile starts beneath another.

Settings opens at 650 by 740px with a 480 by 580px minimum. Its page scrolls vertically, with a 650px maximum content width and 28px 32px 24px padding. At 500px or below, padding becomes 24px 20px and the small brand descriptor disappears. Actions wrap. This is a native desktop interface with no mobile layout.

## Elevation & Depth

Thin borders and darker or lighter fills separate content. Neither the CSS panel nor the native overlay has a shadow. Card names and statistics use a small black text shadow to remain readable over art. No reveal animation or transition is defined in the current overlay stylesheet.

Native opacity affects the entire window. Settings allows 65% through 100%; the default is 96%. The outside of the panel stays transparent. The app uses software rendering and does not depend on GPU effects.

## Shapes

Panels and settings connection blocks have 6px rounded corners. Tools and card fallbacks use 3px corners. Settings buttons and paths use 4px corners. Cost badges are circular; power badges have 5px corners. One-pixel borders separate groups without outlining every card.

Header and pile icons use inline SVG. Header strokes have rounded ends and joins. Keep accessible labels on icon-only controls.

## Components

The header places identity on the left and lock, settings and minimize tools on the right. Headers always drag the window, including while locked; tool buttons exclude themselves from dragging. Panels start interactive so scrolling and card tooltips work directly. Optional locked card areas pass clicks to the game while headers remain accessible. On Linux, an X11 ShapeInput region keeps the header permanently interactive and excludes the locked card area. Window-local regions survive movement and focus changes without polling the cursor. Pointer capture is released on mouse-up, cancellation or loss of capture; a focus change alone does not interrupt an ongoing drag. Positions persist as pixel offsets from the game window’s top-left corner, including negative offsets. Both panels follow game geometry every 100ms, even while hidden, and retain offsets through restarts and scale changes. Legacy absolute positions migrate once using the detected game rectangle. Automatic following never writes new offsets; dragging a panel updates its chosen offset. Minimize hides content but retains the header.

Header tools have transparent backgrounds and muted icons. Hover adds a plum fill and white icon. Overlay buttons and disclosure summaries use a two-pixel accent focus outline with a two-pixel offset. Disabled buttons halve opacity. Settings focus uses a three-pixel offset.

The entire deck is always shown without filter tabs. Deck panels sort by ascending current cost, using cached base costs for unseen cards. Equal costs sort by card name. The opponent panel shows observed cards originating in the opponent’s deck only. Cards stolen from that deck remain in the opponent grid and also appear in our Added section; pile counts use current ownership. Generated cards and cards originating in our deck are excluded from its grid, piles and history. Our own added-card section remains unchanged. Deck and hand counters replace the visible panel title in the header. There is no separate counter strip. The panel retains its accessible own/opponent name and colored icon. Deck names, turn, cubes and status text are omitted from the overlay.

Cards give most of their area to art. Images fit within the full card height with object-fit: contain, using a 124% wide box shifted left 12% to remove horizontal transparent margins. No negative vertical offset is used, so bottom names remain visible. Cost and power sit in the upper corners. Missing art leaves the complete text name on a dark rectangular fallback, not initials. Our main deck grid applies grayscale, .66 brightness and .65 opacity to cards outside our deck, including stolen cards; their statistic badges use grayscale and .48 opacity. Deck and unseen cards stay bright, and a card returned to our deck becomes bright again. Separate piles and added cards stay in color. The opponent retains its original styling. Cards have no bottom state label or check mark. Their state remains in accessible descriptions and the named piles. Hover or keyboard focus opens a 13px ability tooltip without a card-name heading; Escape, scrolling or leaving the card and tooltip dismisses it. Ability labels such as On Reveal:, Ongoing: and Activate: are bold inline, using the same font size as the body. English ability text comes from Snap.fan, cached for 24 hours with offline reuse. Loading and unavailable states are explicit.

Pile summaries show an icon, title and count. Nonempty piles start open and retain the user's disclosure choice; empty piles start closed and contain None. Discard and destroy summaries remain present at zero. Movement history is a separate native disclosure with up to 15 recent visible transitions.

Connection status appears in settings, with no overlay footer. Lobby clears the previous match and hides the opponent window. The selected deck stays visible in full color. Both panels hide while an avatar menu is open and respect manual visibility settings.

Settings uses filled primary actions, outlined secondary actions, native accent-colored ranges and checkboxes. Scale runs from 75% through 140% in 5% steps. The connection block pairs a dot with written status. Save feedback, path errors and shortcut errors have dedicated status text. Card art is cached locally after retrieval from Snap.fan. Settings includes “Use in-game variants”, off by default. When enabled, equipped deck variants and observed in-game variants select their matching illustration; missing variants fall back to base art. Base and variant cache entries are separate. Finishes, borders and animation are not reproduced.

## Do's and Don'ts

- Do keep four full-card columns in the default overlay and five in the optional compact grid.
- Do preserve header tools while the card area scrolls.
- Do retain complete card names as the image fallback and in accessible descriptions.
- Do keep the settings palette separate from the overlay palette.
- Do label live reads, saved states, lost signal, lobby and demonstration data truthfully.

- Don't restore text-heavy portrait rows or duplicate every name beneath loaded card art.
- Don't show unknown opponent identities or its hidden full deck.
- Don't treat a bright inferred own-deck card as a confirmed current deck location.
- Don't merge movement history with current discard or destroy contents.
- Don't claim live-game verification from demonstration captures or add decorative panel shadows.

## Focus visibility

Settings → Panels includes an opt-in checkbox, “Hide panels when Marvel Snap is
not focused”. It shares Save settings with the existing preferences. Focusing
another app hides both overlays without clearing match data or manual hide.
Game and Snapper windows permit visibility. If focus is unavailable, the enabled
option keeps panels hidden and settings explains how to restore them.
