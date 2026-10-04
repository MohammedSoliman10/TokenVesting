# Theme: "Plinth" (light, tactile, outlined)

## Colors
- canvas  #FFFFFF  page/card background
- paper   #FAF7F2  secondary surfaces, rest-state tiles, page tint
- ink     #111111  text, 2px outlines, offset shadows
- coral   #FD9898  primary accent, primary buttons, pressed state
- soft    #FFE2DB  highlights, hover tiles, headline highlight marks

## Typography
- Display: Space Grotesk (headings, big numbers, buttons)
- Body: Inter (text, labels, tables)
- Headings: bold, tight leading. Key words get a soft-coral highlight box behind them.
- Small labels: uppercase, wide letter-spacing, small size, muted ink.

## Core primitive: stacked offset ("press tile")
- 2px solid ink border, 12px radius
- Hard ink shadow with NO blur, offset straight down
- Rest: shadow offset 4px
- Hover: shadow offset 6px, tile lifts, bg soft
- Press: shadow offset 0, tile translates down by the offset, bg coral
- Transition ~100ms. Used by buttons, cards, tabs, and the claim button.

## Components
- Primary button: coral bg, ink text, press-tile behavior
- Secondary button / tabs: paper bg, ink outline, press-tile behavior
- Segmented control: ink pill container, active segment is paper with ink text
- Cards: white bg, thin light-gray 1px border, 12px radius, uppercase label at top
- Pills/tags: rounded-full, paper bg, 1px border, small coral dot + uppercase label
- Status chips: soft bg with ink text and a small icon

## Layout and decoration
- Background: white with a faint dot grid
- Generous whitespace, left-aligned hero text
- Optional: corner crop marks around the page, logo tile
- No gradients, no blur shadows, no dark mode in v1

## Tailwind tokens
colors: canvas #FFFFFF, paper #FAF7F2, ink #111111, coral #FD9898, soft #FFE2DB
fontFamily: display Space Grotesk, body Inter
borderRadius: tile 12px
boxShadow: rest 0 4px 0 #111111, hover 0 6px 0 #111111, press 0 0 0 #111111
