#!/usr/bin/env node
/**
 * check-links.mjs — enforces the site's navigation rules.
 *
 *   node tools/check-links.mjs
 *
 *   1. Every real page is reachable from the homepage, and from any other page, within
 *      MAX_CLICKS clicks.
 *   2. Every inner page has a breadcrumb with Home and a Back link, and pages inside
 *      /areas/ or /services/ also link to their hub.
 *   3. Every internal link and #anchor points at something that exists.
 *
 * Redirect stubs (meta refresh), noindex utilities and 404.html are not counted as pages.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_CLICKS = 3;
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
  if (rel === 'index.html') return '/';
  return '/' + (rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel);
};

const pages = new Map();
for (const file of walk(ROOT)) {
  const html = readFileSync(file, 'utf8');
  const url = urlOf(file);
  const real = !/http-equiv="refresh"/i.test(html) && !/name="robots"[^>]*noindex/i.test(html) && url !== '/404.html';
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  pages.set(url, { url, html, real, ids });
}

function resolve(href) {
  if (!href || /^(tel:|sms:|mailto:|https?:|\/\/|javascript:)/i.test(href)) return null;
  const [path, hash] = href.split('#');
  let abs = path.replace(/^\.\//, '');
  if (!abs.startsWith('/')) abs = '/' + abs;
  if (abs === '/index.html') abs = '/';
  return { abs: path === '' ? null : abs, hash };
}

const problems = [];
const edges = new Map();
for (const page of pages.values()) {
  const body = page.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const out = new Set();
  for (const m of body.matchAll(/href="([^"]*)"/g)) {
    const r = resolve(m[1]);
    if (!r) continue;
    const targetUrl = r.abs ?? page.url;
    const target = pages.get(targetUrl) ?? pages.get(targetUrl.replace(/\/?$/, '/'));
    const isAsset = /\.(ico|png|jpg|jpeg|webp|svg|css|js|xml|txt)$/i.test(targetUrl);
    if (!target) {
      if (!isAsset && !existsSync(join(ROOT, targetUrl))) problems.push(`${page.url}: broken link ${m[1]}`);
      continue;
    }
    out.add(target.url);
    if (r.hash && !target.ids.has(r.hash)) problems.push(`${page.url}: missing anchor ${m[1]}`);
  }
  edges.set(page.url, out);
}

const depth = new Map([['/', 0]]);
const queue = ['/'];
while (queue.length) {
  const u = queue.shift();
  for (const v of edges.get(u) ?? []) {
    if (!depth.has(v) && pages.get(v)?.real) {
      depth.set(v, depth.get(u) + 1);
      queue.push(v);
    }
  }
}

const realPages = [...pages.values()].filter((p) => p.real).sort((a, b) => a.url.localeCompare(b.url));
console.log('  clicks  page');
for (const p of realPages) {
  const d = depth.get(p.url);
  console.log(`  ${String(d ?? 'NONE').padEnd(6)}  ${p.url}`);
  if (d === undefined) problems.push(`${p.url}: not reachable from the homepage`);
  else if (d > MAX_CLICKS) problems.push(`${p.url}: ${d} clicks from the homepage (limit ${MAX_CLICKS})`);

  if (p.url === '/') continue;
  const crumb = p.html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0];
  if (!crumb) { problems.push(`${p.url}: no breadcrumb`); continue; }
  if (!/href="\/"/.test(crumb)) problems.push(`${p.url}: breadcrumb has no link to Home`);
  if (!/data-back/.test(crumb)) problems.push(`${p.url}: breadcrumb has no Back link`);
  const inFolder = p.url.split('/').filter(Boolean).length >= 2;
  if (inFolder && !/href="\/(areas|services)\/"/.test(crumb)) problems.push(`${p.url}: breadcrumb has no link to its parent hub`);
}

// Stronger guarantee: from ANY real page, every other real page is within MAX_CLICKS clicks.
let worst = { d: 0 };
for (const start of realPages) {
  const dist = new Map([[start.url, 0]]);
  const q = [start.url];
  while (q.length) { const u = q.shift(); for (const v of edges.get(u) ?? []) if (!dist.has(v) && pages.get(v)?.real) { dist.set(v, dist.get(u) + 1); q.push(v); } }
  for (const p of realPages) {
    const d = dist.get(p.url);
    if (d === undefined || d > MAX_CLICKS) problems.push(`${start.url} cannot reach ${p.url} within ${MAX_CLICKS} clicks`);
    else if (d > worst.d) worst = { d, from: start.url, to: p.url };
  }
}
console.log(`From any page to any other page: at most ${worst.d} click${worst.d === 1 ? '' : 's'}.`);

const max = Math.max(...depth.values());
console.log(`\n${realPages.length} pages, deepest is ${max} click${max === 1 ? '' : 's'} from the homepage (limit ${MAX_CLICKS}).`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('Navigation rules pass.');
