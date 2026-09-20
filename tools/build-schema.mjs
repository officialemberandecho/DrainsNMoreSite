#!/usr/bin/env node
/**
 * build-schema.mjs — keeps the JSON-LD on every page consistent.
 *
 *   node tools/build-schema.mjs          rewrite the JSON-LD block on each page
 *   node tools/build-schema.mjs --check  exit 1 if any page has drifted
 *
 * The business details below are the single source of truth for name, phone,
 * address, hours and profiles. Everything page-specific (service areas,
 * offers, FAQs, reviews) is read from the page's existing block and left
 * alone. Each page also gets a WebSite and WebPage (or CollectionPage) node
 * so the graph links page -> site -> business, and its BreadcrumbList is
 * built from the visible breadcrumb so the two can never disagree.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SKIP_DIRS = new Set(['node_modules', '.git', 'partials', 'scripts', 'tools', 'assets', 'content']);

const SITE = 'https://drainsnmorellc.com';
const BUSINESS_ID = `${SITE}/#business`;
const WEBSITE_ID = `${SITE}/#website`;
const LOGO = `${SITE}/assets/images/Drains_N_More_LLC_Logo.png`;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const OPEN_ALL_DAY = { '@type': 'OpeningHoursSpecification', dayOfWeek: DAYS, opens: '00:00', closes: '23:59' };

const BUSINESS = {
  name: 'Drains N More LLC',
  telephone: '+1-816-705-1538',
  email: 'drainsnmorellc@gmail.com',
  description: 'Residential plumbing, drain cleaning, water heater, toilet, and repiping services in Kansas City, Missouri and nearby areas.',
  priceRange: '$$',
  address: { '@type': 'PostalAddress', addressLocality: 'Kansas City', addressRegion: 'MO', postalCode: '64118', addressCountry: 'US' },
  sameAs: ['https://g.page/r/CUETYwFSqc1xEAE', 'https://www.facebook.com/profile.php?id=61594243250978'],
};

const PAGE_TYPES = ['WebPage', 'CollectionPage'];
const OWNED = ['Plumber', 'WebSite', 'BreadcrumbList', ...PAGE_TYPES];
const JSON_LD = /(<script[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/;
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.html') ? [p] : [];
  });
}

const urlOf = (rel) => {
  if (rel === 'index.html') return `${SITE}/`;
  return `${SITE}/${rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel}`;
};

const PAGES = walk(ROOT)
  .map((f) => relative(ROOT, f).split(sep).join('/'))
  .filter((rel) => {
    if (rel === '404.html') return false;
    const html = readFileSync(join(ROOT, rel), 'utf8');
    return !/http-equiv="refresh"/i.test(html) && !/name="robots"[^>]*noindex/i.test(html) && JSON_LD.test(html);
  })
  .sort();

function serialize(original, data) {
  if (!original.includes('\n')) return JSON.stringify(data);
  const open = (original.match(/^\n?([ \t]*)\{/) || [])[1] ?? '';
  const close = (original.match(/\n([ \t]*)$/) || [])[1] ?? '';
  return '\n' + JSON.stringify(data, null, 2).split('\n').map((l) => open + l).join('\n') + '\n' + close;
}

/** BreadcrumbList from the page's visible breadcrumb, so markup and schema agree. */
function breadcrumbFrom(html, url, file) {
  const nav = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0];
  if (!nav) throw new Error(`${file}: no visible breadcrumb (run tools/build-partials.mjs first)`);
  const items = [...nav.matchAll(/<li(?![^>]*aria-hidden)[^>]*>([\s\S]*?)<\/li>/g)].map((m) => {
    const link = m[1].match(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    return link ? { name: decode(link[2].trim()), item: new URL(link[1], SITE).href } : { name: decode(m[1].replace(/<[^>]+>/g, '').trim()), item: url };
  });
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.item })),
  };
}

function build(file) {
  const before = readFileSync(join(ROOT, file), 'utf8');
  const match = before.match(JSON_LD);

  const url = urlOf(file);
  const isHome = file === 'index.html';
  const title = decode((before.match(/<title>([^<]*)<\/title>/) || [])[1] ?? BUSINESS.name);
  const description = decode((before.match(/name="description"\s+content="([^"]*)"/) || [])[1] ?? BUSINESS.description);

  const data = JSON.parse(match[2]);
  const graph = data['@graph'] ?? [data];
  const old = graph.find((n) => n['@type'] === 'Plumber');
  if (!old) throw new Error(`${file}: no Plumber node`);
  const oldPage = graph.find((n) => PAGE_TYPES.includes(n['@type']));

  const { '@context': _c, '@type': _t, '@id': _i, name: _n, url: _u, image: _im, logo: _l, telephone: _tel, email: _e, address: _a, sameAs: _s,
    description: ownDescription, priceRange: _p, openingHours: _oh, openingHoursSpecification: _ohs, contactPoint: _cp, ...pageSpecific } = old;

  const business = {
    '@type': 'Plumber',
    '@id': BUSINESS_ID,
    name: BUSINESS.name,
    url: `${SITE}/`,
    image: LOGO,
    logo: LOGO,
    telephone: BUSINESS.telephone,
    email: BUSINESS.email,
    address: BUSINESS.address,
    sameAs: BUSINESS.sameAs,
    description: ownDescription ?? BUSINESS.description,
    priceRange: BUSINESS.priceRange,
    openingHoursSpecification: OPEN_ALL_DAY,
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: BUSINESS.telephone,
      email: BUSINESS.email,
      contactType: 'customer service',
      availableLanguage: 'English',
      areaServed: 'US',
      hoursAvailable: OPEN_ALL_DAY,
    },
    ...pageSpecific,
  };

  const website = { '@type': 'WebSite', '@id': WEBSITE_ID, url: `${SITE}/`, name: BUSINESS.name, inLanguage: 'en-US', publisher: { '@id': BUSINESS_ID } };
  const breadcrumb = isHome ? null : breadcrumbFrom(before, url, file);
  const { '@type': pageType = 'WebPage', '@id': _pid, url: _pu, name: _pn, description: _pd, inLanguage: _pl, isPartOf: _po, about: _pa, breadcrumb: _pb, ...pageExtras } = oldPage ?? {};
  const webpage = {
    '@type': pageType,
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: 'en-US',
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': BUSINESS_ID },
    ...(breadcrumb ? { breadcrumb: { '@id': breadcrumb['@id'] } } : {}),
    ...pageExtras,
  };

  const rest = graph.filter((n) => !OWNED.includes(n['@type']));
  const out = { '@context': 'https://schema.org', '@graph': [business, website, webpage, ...(breadcrumb ? [breadcrumb] : []), ...rest] };
  const after = before.replace(JSON_LD, (_, open, body, close) => open + serialize(body, out) + close);
  return { before, after };
}

let drift = 0;
let written = 0;
for (const file of PAGES) {
  const { before, after } = build(file);
  if (before === after) continue;
  if (CHECK) { console.error(`  DRIFT   ${file} — run: node tools/build.mjs`); drift += 1; continue; }
  writeFileSync(join(ROOT, file), after);
  written += 1;
}

if (drift) { console.error(`\n${drift} page(s) out of date.`); process.exit(1); }
console.log(CHECK ? `Structured data is current (${PAGES.length} pages).` : `Structured data: ${PAGES.length} pages, ${written} rewritten.`);
