#!/usr/bin/env node
/**
 * build.mjs — runs the whole site pipeline in the right order.
 *
 *   node tools/build.mjs          regenerate everything
 *   node tools/build.mjs --check  verify everything without writing (use before pushing)
 *
 * Order matters: pages are generated first, then header/footer/breadcrumb
 * partials are injected, then JSON-LD is built from the finished pages, then
 * CSS is compiled from every page, and the sitemap is written last.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const node = (script, ...args) => () => spawnSync('node', [join(ROOT, script), ...args], { cwd: ROOT, stdio: 'inherit' }).status === 0;

const tailwind = (out) => spawnSync('npx', ['tailwindcss', '-i', './tailwind-input.css', '-o', out, '--minify'], { cwd: ROOT, stdio: 'pipe' }).status === 0;
const css = () => {
  if (!CHECK) return tailwind('./css/tailwind.css') && (console.log('CSS compiled.'), true);
  const tmp = join(mkdtempSync(join(tmpdir(), 'css-')), 'tailwind.css');
  if (!tailwind(tmp)) return false;
  const same = readFileSync(tmp, 'utf8') === readFileSync(join(ROOT, 'css/tailwind.css'), 'utf8');
  console.log(same ? 'CSS is current.' : 'CSS is out of date — run: node tools/build.mjs');
  return same;
};

const steps = CHECK
  ? [
      node('tools/build-areas.mjs', '--check'),
      node('tools/build-partials.mjs', '--check'),
      node('tools/build-schema.mjs', '--check'),
      css,
      node('tools/build-sitemap.mjs', '--check'),
      node('tools/check-links.mjs'),
      node('tools/check-seo.mjs'),
    ]
  : [node('tools/build-areas.mjs'), node('tools/build-partials.mjs'), node('tools/build-schema.mjs'), css, node('tools/build-sitemap.mjs')];

let failed = 0;
for (const step of steps) if (!step()) { failed += 1; if (!CHECK) break; }
if (failed) { console.error(`\n${CHECK ? failed + ' check(s) failed' : 'Build stopped: fix the error above and run again.'}`); process.exit(1); }
console.log(CHECK ? '\nEverything is current and passes.' : '\nBuild complete.');
