/**
 * "Plinth" theme tokens as values (docs/design/theme.md, task T014).
 *
 * The CSS-side tokens live in `frontend/src/index.css` (`@theme`); this module
 * mirrors them for code that needs the values (tests, charts, inline styles)
 * so drift is visible in one place.
 */
export const theme = {
  colors: {
    canvas: '#FFFFFF',
    paper: '#FAF7F2',
    ink: '#111111',
    coral: '#FD9898',
    soft: '#FFE2DB',
  },
  fontFamily: {
    display: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
    body: '"Inter", ui-sans-serif, system-ui, sans-serif',
  },
  radius: {
    tile: '12px',
  },
  shadow: {
    rest: '0 4px 0 #111111',
    hover: '0 6px 0 #111111',
    press: '0 0 0 #111111',
  },
  pressTransitionMs: 100,
} as const;

/**
 * Class implementing the core primitive (2px ink outline, 12px radius, hard
 * offset shadow rest 4px / hover 6px / press 0). Defined in `index.css`.
 */
export const pressTileClass = 'press-tile';

/** Tiny class-name joiner — keeps JSX readable without a runtime dependency. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
