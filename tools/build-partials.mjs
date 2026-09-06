#!/usr/bin/env node
/**
 * build-partials.mjs — injects the shared chrome (header, nav, footer, mobile CTA)
 * into each page so those blocks live in exactly one place: partials/.
 *
 *   node tools/build-partials.mjs          rewrite pages in place
 *   node tools/build-partials.mjs --check  verify pages match partials; exit 1 if not
 *
 * How it works
 * ------------
 * Each page marks a region it wants filled:
 *
 *     <!-- @partial header-page -->
 *     ...generated, do not hand-edit...
 *     <!-- @endpartial -->
 *
 * The script replaces everything between the markers with the rendered partial.
 * That makes it idempotent: running it twice produces the same bytes, and the
 * pages stay directly servable, so nothing about the GitHub Pages deploy changes.
 *
 * Partials may include other partials with {{> name}} and use {{TOKEN}} values
 * from the PAGES table below.
 *
 * Nav links resolve themselves: for a target like `about`, if the page has its
 * own id="about" outside the generated regions the link stays on-page (#about),
 * otherwise it points at index.html#about. That is what keeps the homepage,
 * city pages and service pages each getting the correct nav without three
 * hand-maintained copies drifting apart.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// Nav targets, in menu order. Used only for link resolution; the markup lives
// in partials/nav-desktop.html and partials/nav-mobile.html.
const NAV_TARGETS = ['top', 'about', 'services', 'areas', 'reviews', 'contact'];

// ---------------------------------------------------------------------------
// Page table. `header`/`footer` name a partial; the rest are token values.
// ---------------------------------------------------------------------------
const city = (location, suffix) => ({
  header: 'header-page',
  footer: 'footer-page',
  LOCATION: location,
  TAGLINE: 'Emergency Plumber',
  FOOTER_SUFFIX: ` • ${suffix}`,
});

const service = (suffix) => ({
  header: 'header-page',
  footer: 'footer-page',
  LOCATION: 'Kansas City, MO',
  TAGLINE: 'Kansas City Plumbing',
  FOOTER_SUFFIX: ` • ${suffix}`,
});

const PAGES = {
  'index.html': {
    header: 'header-home',
    footer: 'footer-home',
    LOCATION: 'Kansas City, MO 64118',
    TAGLINE: 'Kansas City Plumbing',
    FOOTER_SUFFIX: '',
  },

  'blue-springs-plumber.html': city('Blue Springs, MO', 'Blue Springs Plumber'),
  'downtown-kansas-city-plumber.html': city('Downtown Kansas City, MO', 'Downtown Kansas City Plumber'),
  'independence-plumber.html': city('Independence, MO', 'Independence Plumber'),
  'lees-summit-plumber.html': city("Lee's Summit, MO", "Lee's Summit Plumber"),
  'midtown-kansas-city-plumber.html': city('Midtown Kansas City, MO', 'Midtown Kansas City Plumber'),
  'raytown-plumber.html': city('Raytown, MO', 'Raytown Plumber'),

  'emergency-drain-cleaning.html': service('Emergency Drain Cleaning'),
  'water-heater-repair.html': service('Water Heater Repair'),
  'sewer-line-repair.html': service('Sewer Line Repair'),
  'gas-line-services.html': service('Gas Line Services'),
  'smoke-testing.html': service('Smoke Testing'),
};

// ---------------------------------------------------------------------------

const partialCache = new Map();

function loadPartial(name) {
  if (!partialCache.has(name)) {
    const file = join(ROOT, 'partials', `${name}.html`);
    if (!existsSync(file)) throw new Error(`missing partial: partials/${name}.html`);
    partialCache.set(name, readFileSync(file, 'utf8').replace(/\n$/, ''));
  }
  return partialCache.get(name);
}

/** Re-indent every line after the first, so nested includes stay aligned. */
function indentBlock(text, indent) {
  return text
    .split('\n')
    .map((line, i) => (i === 0 || !line ? line : indent + line))
    .join('\n');
}

/** Expand {{> name}} includes, then substitute {{TOKEN}} values. */
function render(name, tokens, seen = []) {
  if (seen.includes(name)) throw new Error(`circular include: ${[...seen, name].join(' -> ')}`);
  let out = loadPartial(name);
  out = out.replace(/([ \t]*)\{\{>\s*([\w-]+)\s*\}\}/g, (_, indent, inner) =>
    indent + indentBlock(render(inner, tokens, [...seen, name]), indent)
  );
  out = out.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (!(key in tokens)) throw new Error(`${name}: no value for ${whole}`);
    return tokens[key];
  });
  return out;
}

const REGION = /([ \t]*)<!-- @partial ([\w-]+) -->\n[\s\S]*?<!-- @endpartial -->/g;

/** Strip generated regions so we only inspect the page's own hand-written markup. */
function ownMarkup(html) {
  return html.replace(REGION, '');
}

function linkTokens(html, pageName) {
  const own = ownMarkup(html);
  const tokens = {};
  for (const target of NAV_TARGETS) {
    const onPage = own.includes(`id="${target}"`);
    tokens[`L_${target}`] = onPage ? `#${target}` : `index.html#${target}`;
  }
  return tokens;
}

function build(pageName, config) {
  const file = join(ROOT, pageName);
  const before = readFileSync(file, 'utf8');

  const tokens = { ...config, ...linkTokens(before, pageName) };
  let regions = 0;

  const after = before.replace(REGION, (_, indent, name) => {
    regions += 1;
    const body = render(name, tokens)
      .split('\n')
      .map((line) => (line ? indent + line : line))
      .join('\n');
    return `${indent}<!-- @partial ${name} -->\n${body}\n${indent}<!-- @endpartial -->`;
  });

  return { file, before, after, regions, changed: before !== after };
}

let failures = 0;
let touched = 0;

for (const [pageName, config] of Object.entries(PAGES)) {
  if (!existsSync(join(ROOT, pageName))) {
    console.error(`  MISSING  ${pageName}`);
    failures += 1;
    continue;
  }

  const { file, after, regions, changed } = build(pageName, config);

  if (regions === 0) {
    console.error(`  NO MARKERS  ${pageName} — nothing injected`);
    failures += 1;
    continue;
  }

  if (CHECK) {
    if (changed) {
      console.error(`  DRIFT  ${pageName} (${regions} regions) — run: npm run build:html`);
      failures += 1;
    } else {
      console.log(`  ok     ${pageName} (${regions} regions)`);
    }
    continue;
  }

  if (changed) {
    writeFileSync(file, after);
    touched += 1;
    console.log(`  updated ${pageName} (${regions} regions)`);
  } else {
    console.log(`  ok      ${pageName} (${regions} regions)`);
  }
}

if (failures) {
  console.error(`\n${failures} problem(s).`);
  process.exit(1);
}
console.log(CHECK ? '\nAll pages match partials/.' : `\nDone. ${touched} file(s) rewritten.`);
