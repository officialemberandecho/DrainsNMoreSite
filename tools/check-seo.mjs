#!/usr/bin/env node
/**
 * check-seo.mjs — guards the signals that decide whether Google can find,
 * crawl and index each page.
 *
 *   node tools/check-seo.mjs
 *
 * For every real page: one title (<= 60 chars), one description (<= 160),
 * exactly one H1, a self-referencing canonical, an indexable robots meta,
 * Open Graph tags, JSON-LD that parses, and a sitemap entry. It also checks
 * that the sitemap lists only real pages and that robots.txt points at the
 * sitemap without blocking anything.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://drainsnmorellc.com';
const SKIP_DIRS = new Set(['node_modules', '.git', 'partials', 'scripts', 'tools', 'assets', 'content']);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.html') ? [p] : [];
  });
}

const urlOf = (file) => {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (rel === 'index.html') return `${SITE}/`;
  return `${SITE}/${rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel}`;
};

const problems = [];
const bad = (url, msg) => problems.push(`${url}: ${msg}`);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

const sitemap = existsSync(join(ROOT, 'sitemap.xml')) ? readFileSync(join(ROOT, 'sitemap.xml'), 'utf8') : '';
const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
const real = new Set();
const titles = new Map();
const descriptions = new Map();

for (const file of walk(ROOT)) {
  const html = readFileSync(file, 'utf8');
  const url = urlOf(file);
  if (/http-equiv="refresh"/i.test(html) || file.endsWith('404.html') || /name="robots"[^>]*noindex/i.test(html)) continue;
  real.add(url);

  const title = decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? '');
  const desc = decode((html.match(/name="description"\s+content="([^"]*)"/) || [])[1] ?? '');
  const canonical = (html.match(/rel="canonical" href="([^"]*)"/) || [])[1];
  const robots = (html.match(/name="robots"\s+content="([^"]*)"/) || [])[1] ?? '';
  const h1s = (html.match(/<h1[\s>]/g) || []).length;

  if (titles.has(title)) bad(url, `same title as ${titles.get(title)}`); else titles.set(title, url);
  if (desc && descriptions.has(desc)) bad(url, `same description as ${descriptions.get(desc)}`); else if (desc) descriptions.set(desc, url);
  if ((html.match(/<title>/g) || []).length !== 1 || !title) bad(url, 'needs exactly one <title>');
  else if (title.length > 60) bad(url, `title is ${title.length} chars (max 60)`);
  if (!desc) bad(url, 'missing meta description');
  else if (desc.length > 160) bad(url, `description is ${desc.length} chars (max 160)`);
  if (h1s !== 1) bad(url, `has ${h1s} <h1> elements (need exactly 1)`);
  if (canonical !== url) bad(url, `canonical is ${canonical ?? 'missing'}, expected ${url}`);
  if (/noindex|nofollow/i.test(robots)) bad(url, `robots meta blocks indexing: ${robots}`);
  if (!/property="og:title"/.test(html) || !/property="og:image"/.test(html)) bad(url, 'missing Open Graph tags');
  if (!listed.has(url)) bad(url, 'not in sitemap.xml');

  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
  if (!ld.length) bad(url, 'no JSON-LD');
  for (const block of ld) { try { JSON.parse(block[1]); } catch { bad(url, 'JSON-LD does not parse'); } }
}

for (const url of listed) if (!real.has(url)) bad(url, 'in sitemap.xml but is not a real, indexable page');

const robotsTxt = existsSync(join(ROOT, 'robots.txt')) ? readFileSync(join(ROOT, 'robots.txt'), 'utf8') : '';
if (!robotsTxt.includes(`Sitemap: ${SITE}/sitemap.xml`)) problems.push('robots.txt: does not point at the sitemap');
if (/^Disallow:\s*\/?\s*$/im.test(robotsTxt) === false && /^Disallow:\s*\/\s*$/im.test(robotsTxt)) problems.push('robots.txt: blocks the whole site');
for (const line of robotsTxt.split('\n').filter((l) => /^Disallow:\s*\S/.test(l))) {
  const path = line.replace(/^Disallow:\s*/, '').trim();
  for (const url of real) if (new URL(url).pathname.startsWith(path)) problems.push(`robots.txt: "${line.trim()}" blocks ${url}`);
}

console.log(`${real.size} indexable pages, ${listed.size} in sitemap.`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('Crawl and indexing checks pass.');
