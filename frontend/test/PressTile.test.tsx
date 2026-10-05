/**
 * T058 — press-tile primitive coverage + theme-token drift guard.
 *
 * Part 1: PressTile, Button, Card (default `tile` variant) and Tab all carry
 * the shared `press-tile` class with the right tone classes (theme.md:
 * primary = coral, secondary/tabs = paper, active segment = paper,
 * inactive = transparent).
 *
 * Part 2: reads docs/design/theme.md, frontend/src/lib/theme.ts and the
 * `@theme` / `.press-tile` rules of frontend/src/index.css FROM DISK and
 * asserts all three carry the identical spec values — hex colors, 12px
 * radius, and the 4/6/0 hard-offset shadows. A drift in any one of the
 * three files fails the suite.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../src/components/primitives/Button';
import { Card } from '../src/components/primitives/Card';
import { PressTile } from '../src/components/primitives/PressTile';
import { Tab } from '../src/components/primitives/Tab';

// ---------------------------------------------------------------- part 1

describe('press-tile primitives (theme.md "Core primitive")', () => {
  it('PressTile carries the shared press-tile class and its tone class', () => {
    const { rerender } = render(<PressTile>rest</PressTile>);
    expect(screen.getByText('rest')).toHaveClass('press-tile');
    expect(screen.getByText('rest')).toHaveClass('bg-paper'); // default tone

    rerender(<PressTile tone="canvas">flat</PressTile>);
    expect(screen.getByText('flat')).toHaveClass('press-tile', 'bg-canvas');

    rerender(<PressTile tone="coral">accent</PressTile>);
    expect(screen.getByText('accent')).toHaveClass('press-tile', 'bg-coral');
  });

  it('Button carries press-tile; primary = bg-coral, secondary = bg-paper', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('press-tile', 'bg-coral');

    render(<Button variant="secondary">Undo</Button>);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveClass('press-tile', 'bg-paper');
  });

  it('Card (default tile variant) carries press-tile + bg-canvas', () => {
    render(<Card>Body</Card>);
    expect(screen.getByText('Body').parentElement).toHaveClass('press-tile', 'bg-canvas');
  });

  it('Tab carries press-tile; active = bg-paper, inactive = transparent', () => {
    render(
      <div>
        <Tab active>One</Tab>
        <Tab>Two</Tab>
      </div>,
    );
    expect(screen.getByRole('button', { name: 'One' })).toHaveClass(
      'press-tile',
      'bg-paper',
    );
    expect(screen.getByRole('button', { name: 'Two' })).toHaveClass(
      'press-tile',
      'bg-transparent',
    );
  });
});

// ---------------------------------------------------------------- part 2

/** The spec: docs/design/theme.md "Tailwind tokens" (authoritative). */
const SPEC = {
  colors: {
    canvas: '#FFFFFF',
    paper: '#FAF7F2',
    ink: '#111111',
    coral: '#FD9898',
    soft: '#FFE2DB',
  },
  radius: { tile: '12px' },
  shadow: {
    rest: '0 4px 0 #111111',
    hover: '0 6px 0 #111111',
    press: '0 0 0 #111111',
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const themeMd = readFileSync(resolve(repoRoot, 'docs', 'design', 'theme.md'), 'utf8');
const themeTs = readFileSync(resolve(here, '..', 'src', 'lib', 'theme.ts'), 'utf8');
const indexCss = readFileSync(resolve(here, '..', 'src', 'index.css'), 'utf8');

function tokensFromThemeMd(md: string) {
  const colorsLine = md.match(/^colors: (.+)$/m)?.[1] ?? '';
  const colors = Object.fromEntries(
    [...colorsLine.matchAll(/(canvas|paper|ink|coral|soft)\s+(#[0-9A-Fa-f]{6})/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  const tile = md.match(/borderRadius:\s*tile\s+(\S+)/)?.[1] ?? '';
  const shadowLine = md.match(/^boxShadow: (.+)$/m)?.[1] ?? '';
  const shadow = Object.fromEntries(
    [...shadowLine.matchAll(/(rest|hover|press)\s+([^,]+?)(?:,|$)/g)].map((m) => [
      m[1],
      m[2].trim().replace(/\s+/g, ' '),
    ]),
  );
  return { colors, radius: { tile }, shadow };
}

function tokensFromThemeTs(ts: string) {
  const colorsBody = ts.match(/colors:\s*\{([^}]*)\}/)?.[1] ?? '';
  const colors = Object.fromEntries(
    [...colorsBody.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  const tile = ts.match(/tile:\s*'([^']+)'/)?.[1] ?? '';
  const shadowBody = ts.match(/shadow:\s*\{([^}]*)\}/)?.[1] ?? '';
  const shadow = Object.fromEntries(
    [...shadowBody.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  return { colors, radius: { tile }, shadow };
}

function tokensFromIndexCss(css: string) {
  const themeBlock = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const colors = Object.fromEntries(
    [...themeBlock.matchAll(/--color-(\w+):\s*(#\w+);/g)].map((m) => [m[1], m[2]]),
  );
  const tile = themeBlock.match(/--radius-tile:\s*([^;]+);/)?.[1].trim() ?? '';
  const shadow = Object.fromEntries(
    [...themeBlock.matchAll(/--shadow-(\w+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
  return { colors, radius: { tile }, shadow };
}

describe('theme tokens identical across theme.md, theme.ts and index.css', () => {
  it('docs/design/theme.md carries the spec values', () => {
    expect(tokensFromThemeMd(themeMd)).toEqual(SPEC);
  });

  it('lib/theme.ts carries the spec values', () => {
    expect(tokensFromThemeTs(themeTs)).toEqual(SPEC);
  });

  it('index.css @theme carries the spec values', () => {
    expect(tokensFromIndexCss(indexCss)).toEqual(SPEC);
  });

  it('.press-tile rules are wired to the shared tokens', () => {
    const rest = indexCss.match(/\.press-tile\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rest).toContain('border: 2px solid var(--color-ink)');
    expect(rest).toContain('border-radius: var(--radius-tile)');
    expect(rest).toContain('box-shadow: var(--shadow-rest)');

    const hover = indexCss.match(/\.press-tile:hover\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(hover).toContain('box-shadow: var(--shadow-hover)');

    const active = indexCss.match(/\.press-tile:active\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(active).toContain('box-shadow: var(--shadow-press)');
  });
});
