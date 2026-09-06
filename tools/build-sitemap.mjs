#!/usr/bin/env node
/**
 * build-sitemap.mjs — derives sitemap.xml from the pages that actually exist.
 *
 *   node tools/build-sitemap.mjs          rewrite sitemap.xml
 *   node tools/build-sitemap.mjs --check  verify it is current; exit 1 if not
 *
 * Why generate it
 * ---------------
 * The hand-maintained sitemap drifted: every page had been rewritten while
 * lastmod still read the date of an older edit. A stale lastmod on a
 * substantially changed page is worse than none, because it tells crawlers
 * nothing happened.
 *
 * A page is included when it is a real, indexable page. Excluded:
 *   - 404.html and anything with robots noindex (e.g. /review/, the QR gateway)
 *   - the legacy WordPress redirect stubs (meta http-equiv="refresh")
 *   - partials/ and node_modules/
 *
 * lastmod comes from the last commit that touched the file, or today if the
 * file has uncommitted changes, so it reflects the content rather than the
 * moment the sitemap happened to be regenerated.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://drainsnmorellc.com';
const OUT = join(ROOT, 'sitemap.xml');
const CHECK = process.argv.includes('--check');

const SKIP_DIRS = new Set(['node_modules', '.git', 'partials', 'tools', 'assets', 'css', 'js', '.vscode']);
const SKIP_FILES = new Set(['404.html']);

// Priority by URL shape. First match wins; anything unmatched gets the default.
const PRIORITY = [
  [/^\/$/, '1.0'],
  [/-plumber\.html$/, '0.9'],
  [/^\/(emergency-drain-cleaning|water-heater-repair|sewer-line-repair)\.html$/, '0.8'],
  [/^\/(gas-line-services|smoke-testing)\.html$/, '0.7'],
];
const DEFAULT_PRIORITY = '0.7';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.html') && !SKIP_FILES.has(name)) out.push(full);
  }
  return out;
}

/** Real page, or something we deliberately keep out of the index? */
function isIndexable(html) {
  const robots = html.match(/name="robots"[^>]*content="([^"]*)"/i);
  if (robots && /noindex/i.test(robots[1])) return false;
  if (/http-equiv="refresh"/i.test(html)) return false; // legacy redirect stub
  return true;
}

function toUrl(file) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  return '/' + rel;
}

function lastmod(file) {
  const rel = relative(ROOT, file).split(sep).join('/');
  try {
    const dirty = execFileSync('git', ['status', '--porcelain', '--', rel], { cwd: ROOT }).toString().trim();
    if (dirty) return new Date().toISOString().slice(0, 10);
    const d = execFileSync('git', ['log', '-1', '--format=%ad', '--date=short', '--', rel], { cwd: ROOT })
      .toString().trim();
    if (d) return d;
  } catch {
    /* not a repo, or git unavailable — fall through */
  }
  return new Date(statSync(file).mtime).toISOString().slice(0, 10);
}

function priorityFor(url) {
  for (const [re, p] of PRIORITY) if (re.test(url)) return p;
  return DEFAULT_PRIORITY;
}

const pages = walk(ROOT)
  .filter((f) => isIndexable(readFileSync(f, 'utf8')))
  .map((f) => ({ url: toUrl(f), mod: lastmod(f) }))
  .sort((a, b) => (a.url === '/' ? -1 : b.url === '/' ? 1 : a.url.localeCompare(b.url)));

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  pages
    .map(
      ({ url, mod }) =>
        '  <url>\n' +
        `    <loc>${ORIGIN}${url}</loc>\n` +
        `    <lastmod>${mod}</lastmod>\n` +
        `    <priority>${priorityFor(url)}</priority>\n` +
        '  </url>\n'
    )
    .join('') +
  '</urlset>\n';

const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';

for (const { url, mod } of pages) {
  console.log(`  ${priorityFor(url).padEnd(4)} ${mod}  ${url}`);
}

if (CHECK) {
  if (current !== xml) {
    console.error('\nsitemap.xml is out of date — run: npm run build:sitemap');
    process.exit(1);
  }
  console.log(`\n${pages.length} URLs. sitemap.xml is current.`);
} else if (current !== xml) {
  writeFileSync(OUT, xml);
  console.log(`\n${pages.length} URLs. sitemap.xml updated.`);
} else {
  console.log(`\n${pages.length} URLs. sitemap.xml already current.`);
}
