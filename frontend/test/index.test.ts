/**
 * index.html shell checks: <title>, meta description and an INLINE SVG
 * data-URI favicon (no network request, no 404 — theme-check also verifies
 * it in a real browser).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

describe('frontend/index.html', () => {
  it('has a non-empty <title>', () => {
    expect(html).toMatch(/<title>[^<]+\s*<\/title>/);
  });

  it('has a meta description with real content', () => {
    expect(html).toMatch(/<meta(?=[^>]*name="description")(?=[^>]*content="[^"]{10,}")[^>]*>/s);
  });

  it('has an inline SVG data-URI <link rel="icon">', () => {
    expect(html).toMatch(/<link(?=[^>]*rel="icon")(?=[^>]*href="data:image\/svg\+xml)[^>]*>/s);
  });
});
