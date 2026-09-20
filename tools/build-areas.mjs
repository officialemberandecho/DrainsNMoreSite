#!/usr/bin/env node
/**
 * build-areas.mjs — generates the service-area pages and everything that lists them.
 *
 *   node tools/build-areas.mjs          write files
 *   node tools/build-areas.mjs --check  exit 1 if anything is out of date or invalid
 *
 * Source of truth (edit these, never the generated HTML):
 *   content/areas/<slug>.json   one file per location
 *   content/regions.json        how the areas hub groups locations
 *   content/services.json       the service pages (used by lists and the services hub)
 *   content/hubs.json           copy for /areas/ and /services/
 *   content/redirects.json      every retired URL and where it now points
 *
 * Generated:
 *   areas/<slug>/index.html, areas/index.html, services/index.html, sitemap/index.html
 *   one redirect stub per entry in redirects.json
 *   partials/areas-list.html (footer) and partials/areas-chips.html (homepage)
 *
 * Header, footer, breadcrumb, CTA rail and JSON-LD are filled in afterwards by
 * build-partials.mjs and build-schema.mjs — run tools/build.mjs to do all of it.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const SITE = 'https://drainsnmorellc.com';
const BUSINESS_ID = `${SITE}/#business`;
const LOGO = `${SITE}/assets/images/Drains_N_More_LLC_Logo.png`;
const CALLRAIL = 'https://cdn.callrail.com/companies/194184050/fc7cba9b3848cc47d844/12/swap.js';
const ACCESS_KEY = '8988b1a8-2b9b-45f8-bfa8-f615e274b4f2';
const CARD_KEYS = ['wh', 'toilet', 'smoke', 'dig', 'gas', 'repipe'];

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const areas = readdirSync(join(ROOT, 'content/areas'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ ...readJson(`content/areas/${f}`), _file: f }))
  .sort((a, b) => a.order - b.order);
const regions = readJson('content/regions.json');
const services = readJson('content/services.json');
const hubs = readJson('content/hubs.json');
const redirects = readJson('content/redirects.json');
const bySlug = new Map(areas.map((a) => [a.slug, a]));

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const problems = [];
const bad = (where, msg) => problems.push(`${where}: ${msg}`);

const titleFor = (a) => {
  if (a.title) return a.title;
  for (const tail of ['24/7 Drain Cleaning & Water Heaters', '24/7 Emergency Plumbing']) {
    const t = `${a.name} Plumber | ${tail}`;
    if (t.length <= 60) return t;
  }
  return `${a.name} Plumber | ${'24/7 Emergency Plumbing'}`;
};

const wordCount = (a) => [a.about.paras.join(' '), a.services.cards.map((c) => c.p).join(' '), a.faq.items.map((f) => f.a).join(' ')].join(' ').split(/\s+/).length;

const seen = { slug: new Set(), order: new Set(), title: new Set(), description: new Set() };
for (const a of areas) {
  const w = `content/areas/${a._file}`;
  if (a.slug + '.json' !== a._file) bad(w, `slug "${a.slug}" must match the file name`);
  if (!/^[a-z0-9-]+$/.test(a.slug)) bad(w, 'slug may only contain a-z, 0-9 and hyphens');
  for (const k of ['name', 'label', 'chip', 'tile', 'blurb', 'description']) if (!a[k] || typeof a[k] !== 'string') bad(w, `missing "${k}"`);
  if (!regions.some((r) => r.key === a.region)) bad(w, `unknown region "${a.region}"`);
  if (!Number.isInteger(a.order)) bad(w, '"order" must be a whole number');
  for (const [k, set] of Object.entries(seen)) {
    const v = k === 'title' ? titleFor(a) : a[k];
    if (set.has(v)) bad(w, `duplicate ${k}: ${v}`);
    set.add(v);
  }
  if (a.description && a.description.length > 155) bad(w, `description is ${a.description.length} chars (max 155)`);
  if (titleFor(a).length > 60) bad(w, `title is ${titleFor(a).length} chars (max 60)`);
  if (a.blurb && a.blurb.length > 170) bad(w, `blurb is ${a.blurb.length} chars (max 170)`);
  if (!a.hero || a.hero.bullets?.length !== 3) bad(w, 'hero.bullets must have exactly 3 items');
  if (!a.about || a.about.paras?.length < 2) bad(w, 'about.paras needs at least 2 paragraphs');
  if (a.about?.chips?.length !== 8) bad(w, 'about.chips must have exactly 8 items');
  const keys = (a.services?.cards ?? []).map((c) => c.key);
  if (keys.length !== 6 || CARD_KEYS.some((k) => !keys.includes(k))) bad(w, `services.cards must contain exactly the six services: ${CARD_KEYS.join(', ')}`);
  if (!(a.faq?.items?.length >= 4 && a.faq.items.length <= 6)) bad(w, 'faq.items must have 4 to 6 questions');
  const links = a.nearby?.links ?? [];
  if (links.length < 3) bad(w, 'nearby.links needs at least 3 areas');
  for (const s of links) { if (!bySlug.has(s)) bad(w, `nearby link "${s}" is not an existing area`); if (s === a.slug) bad(w, 'nearby link points at itself'); }
  if (!a.contact?.h2 || !a.contact?.p) bad(w, 'contact needs h2 and p');
  const words = wordCount(a);
  if (words < 800) bad(w, `only ${words} words of body content (minimum 800)`);
}

// No two area pages may share more than MAX_OVERLAP of their 5-word phrases.
const MAX_OVERLAP = 0.06;
const bodyText = (a) => [a.about.paras.join(' '), a.services.cards.map((c) => `${c.h3} ${c.p}`).join(' '), a.faq.items.map((f) => `${f.q} ${f.a}`).join(' ')].join(' ').toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
const shingles = (text) => { const w = text.split(' '); const s = new Set(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s; };
const phrases = areas.map((a) => ({ slug: a.slug, set: shingles(bodyText(a)) }));
for (let i = 0; i < phrases.length; i++) for (let j = i + 1; j < phrases.length; j++) {
  let shared = 0;
  for (const p of phrases[i].set) if (phrases[j].set.has(p)) shared += 1;
  const ratio = shared / Math.min(phrases[i].set.size, phrases[j].set.size);
  if (ratio > MAX_OVERLAP) bad('content/areas', `${phrases[i].slug} and ${phrases[j].slug} share ${(ratio * 100).toFixed(1)}% of their wording (max ${MAX_OVERLAP * 100}%): rewrite one of them`);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const SERVICE_LINK = {
  wh: ['/services/water-heater-repair/', 'About water heater service'],
  smoke: ['/services/smoke-testing/', 'How smoke testing works'],
  dig: ['/services/sewer-line-repair/', 'Sewer line repair options'],
  gas: ['/services/gas-line-services/', 'About gas line services'],
  toilet: ['#contact', 'Request a toilet install'],
  repipe: ['#contact', 'Request a repipe estimate'],
};
const OFFER_NAME = { wh: 'Water heater repair and installation', toilet: 'Toilet installation', smoke: 'Smoke testing', dig: 'Plumbing excavation services', gas: 'Gas line repiping', repipe: 'Whole-home repiping' };
const ICON = { wh: '🚿', toilet: '🚽', smoke: '🔎', dig: '⛏️', gas: '🔥', repipe: '🔧' };

function hero(h, tile) {
  return `    <section class="relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-slate-100 py-16 sm:py-24">
      <div class="mx-auto grid max-w-7xl gap-10 px-4 md:grid-cols-2 md:items-center">
        <div>
          <p class="mb-4 text-xs font-extrabold uppercase tracking-[0.2em] text-brand-600">${esc(h.eyebrow)}</p>
          <h1 class="max-w-xl text-4xl font-black tracking-[-0.06em] text-slate-900 text-shadow-soft sm:text-5xl">${esc(h.h1)}</h1>
          <p class="mt-5 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">${esc(h.sub)}</p>
          <div class="mt-7 flex flex-col gap-3 sm:flex-row">
            <a href="#contact" class="inline-flex items-center justify-center rounded-full bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-brand-600">Request Service</a>
            <a href="tel:+18167051538" class="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50">Call Now</a>
          </div>
          <div class="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            <div class="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm"><div class="text-2xl font-black text-brand-600">24/7</div><div class="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Emergency</div></div>
            <div class="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm"><div class="text-2xl font-black text-brand-600">Same-Day</div><div class="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Service</div></div>
            <div class="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm"><div class="text-2xl font-black text-brand-600">Local</div><div class="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">${esc(tile)}</div></div>
          </div>
        </div>
        <div class="relative">
          <div class="rounded-[2rem] border border-slate-200 bg-slate-900 p-6 text-white shadow-soft sm:p-8">
            <div class="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">${esc(h.badge)}</div>
            <h2 class="mt-5 text-2xl font-black tracking-[-0.05em] sm:text-3xl">${esc(h.sideH2)}</h2>
            <div class="mt-6 space-y-3">
${h.bullets.map((b) => `              <div class="flex items-center gap-2"><span class="text-brand-400">&#10003;</span><span class="text-sm font-semibold">${esc(b)}</span></div>`).join('\n')}
            </div>
          </div>
          <div class="absolute -bottom-5 right-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-soft sm:right-8">
            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Call now</div>
            <a href="tel:+18167051538" class="mt-1 block text-base font-black text-slate-900">(816) 705-1538</a>
          </div>
        </div>
      </div>
    </section>`;
}

const heading = (eyebrow, h2, extra = '') => `<p class="mb-3 text-xs font-extrabold uppercase tracking-[0.2em] text-brand-600">${esc(eyebrow)}</p>
          <h2 class="text-3xl font-black tracking-[-0.06em] text-slate-900 sm:text-4xl">${esc(h2)}</h2>${extra}`;

function localSection(a) {
  const s = a.about;
  return `    <section id="local" class="mx-auto max-w-7xl px-4 py-16 sm:py-20">
      <div class="grid gap-10 md:grid-cols-2 md:items-start stack-in-column">
        <div>
          ${heading(s.eyebrow, s.h2)}
${s.paras.map((p, i) => `          <p class="${i === 0 ? 'mt-5' : 'mt-4'} text-base leading-7 text-slate-600">${esc(p)}</p>`).join('\n')}
        </div>
        <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 class="text-xl font-black text-slate-900">${esc(s.sideTitle)}</h3>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
${s.chips.map((x) => `            <div class="city-chip rounded-2xl border border-slate-300 bg-white p-3 text-sm font-semibold text-slate-900">${esc(x)}</div>`).join('\n')}
          </div>
        </div>
      </div>
    </section>`;
}

function serviceCards(a) {
  const s = a.services;
  return `    <section id="services" class="bg-slate-100 py-16 sm:py-20">
      <div class="mx-auto max-w-7xl px-4">
        <div class="mb-10 max-w-2xl">
          ${heading(s.eyebrow, s.h2)}
        </div>
        <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
${s.cards.map((k) => {
    const [href, label] = SERVICE_LINK[k.key];
    return `          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">${ICON[k.key]}</div><h3 class="text-xl font-black text-slate-900">${esc(k.h3)}</h3><p class="mt-3 text-base leading-7 text-slate-600">${esc(k.p)}</p><a href="${href}" class="mt-4 inline-flex text-sm font-bold text-brand-600 hover:underline">${label}</a></article>`;
  }).join('\n')}
        </div>
      </div>
    </section>`;
}

function faqSection(faq) {
  return `    <section id="faq" class="mx-auto max-w-7xl px-4 py-16 sm:py-20">
      <div class="mb-8 max-w-2xl">
        ${heading('Common questions', faq.h2)}
      </div>
      <div class="grid gap-5 md:grid-cols-2">
${faq.items.map((f) => `        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 class="text-lg font-black text-slate-900">${esc(f.q)}</h3><p class="mt-3 text-base leading-7 text-slate-600">${esc(f.a)}</p></article>`).join('\n')}
      </div>
    </section>`;
}

function contactSection(slug, subject, c, tail = { href: '/areas/', label: 'All service areas' }) {
  return `    <section id="contact" class="mx-auto max-w-7xl px-4 py-16 sm:py-20">
      <div class="grid gap-8 rounded-[2rem] bg-slate-900 p-6 text-white shadow-soft md:grid-cols-[1.2fr_0.8fr] md:p-10">
        <div>
          <p class="mb-3 text-xs font-extrabold uppercase tracking-[0.2em] text-sky-200">Emergency Plumbing Now</p>
          <h2 class="text-3xl font-black tracking-[-0.06em] sm:text-4xl">${esc(c.h2)}</h2>
          <p class="mt-4 max-w-xl text-base leading-7 text-slate-300">${esc(c.p)}</p>
          <div class="mt-6 flex flex-wrap gap-3">
            <a href="tel:+18167051538" class="inline-flex items-center justify-center rounded-full bg-brand-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-600">Call (816) 705-1538</a>
            <a href="sms:+18167051538?body=Hi%20Drains%20N%20More%20LLC,%20I%20need%20a%20plumbing%20estimate." class="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-5 py-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-400/20">Text us</a>
            <a href="${tail.href}" class="inline-flex items-center justify-center rounded-full border border-slate-700 bg-white/5 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10">${esc(tail.label)}</a>
          </div>
        </div>
        <form data-lead-form class="rounded-3xl border border-slate-700 bg-white/5 p-4 sm:p-5" action="https://api.web3forms.com/submit" method="POST">
          <div class="space-y-4">
            <input type="hidden" name="access_key" value="${ACCESS_KEY}" /><input type="hidden" name="subject" value="${esc(subject)}" /><input type="checkbox" name="botcheck" class="hidden" style="display:none !important;" tabindex="-1" autocomplete="off" aria-hidden="true" />
            <div><label for="name-${slug}" class="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-slate-300">Name</label><input id="name-${slug}" name="name" type="text" autocomplete="name" placeholder="Your name" class="w-full rounded-xl border border-slate-700 bg-slate-950/30 px-3 py-3 text-sm text-white placeholder:text-slate-400 focus:border-brand-400 focus:outline-none" required /></div>
            <div><label for="phone-${slug}" class="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-slate-300">Phone</label><input id="phone-${slug}" name="phone" type="tel" autocomplete="tel" placeholder="(555) 123-4567" class="w-full rounded-xl border border-slate-700 bg-slate-950/30 px-3 py-3 text-sm text-white placeholder:text-slate-400 focus:border-brand-400 focus:outline-none" required /></div>
            <button type="submit" class="inline-flex w-full items-center justify-center rounded-full bg-brand-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">Send Request</button><p data-form-status class="hidden" aria-live="polite"></p>
          </div>
        </form>
      </div>
    </section>`;
}

const listLinks = (links) => {
  const a = links.map(([h, t]) => `<a href="${h}" class="font-semibold text-brand-600 hover:underline">${esc(t)}</a>`);
  return a.length > 1 ? `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}` : a[0];
};

function relatedSection(heading2, lead, links) {
  return `    <section class="mx-auto max-w-7xl px-4 pb-16" aria-labelledby="related-services-heading">
      <h2 id="related-services-heading" class="text-3xl font-black">${esc(heading2)}</h2>
      <p class="mt-4 text-sm leading-7 text-slate-600">${esc(lead)} ${listLinks(links)}.</p>
      <div class="mt-5 flex flex-wrap gap-3 text-sm font-semibold">
${services.map((s) => `        <a class="rounded-full bg-slate-100 px-4 py-2" href="/services/${s.slug}/">${esc(s.name)}</a>`).join('\n')}
        <a class="rounded-full bg-slate-100 px-4 py-2" href="/areas/">All service areas</a>
      </div>
    </section>`;
}

const region = (p) => `    <!-- @partial ${p} -->\n    <!-- @endpartial -->`;
const layout = (sections) => `    <div class="layout-two-col">
      <div class="layout-main">
${sections.join('\n')}
      </div>
      <aside class="layout-aside" aria-label="Get a plumber now">
        <!-- @partial cta-rail -->
        <!-- @endpartial -->
      </aside>
    </div>`;

function shell({ title, description, url, ld, body }) {
  const t = esc(title);
  const d = esc(description);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
  <meta name="theme-color" content="#0a8cf0" />
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" href="/assets/images/favicon-96.png" type="image/png" sizes="96x96" />
  <link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png" />
  <link rel="preload" as="image" href="/assets/images/Drains_N_More_LLC_Logo.webp" fetchpriority="high" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Drains N More LLC" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${LOGO}" />
  <meta property="og:image:width" content="560" />
  <meta property="og:image:height" content="514" />
  <meta property="og:image:alt" content="Drains N More LLC logo" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${LOGO}" />
  <link rel="preconnect" href="https://cdn.callrail.com" crossorigin />
  <link rel="dns-prefetch" href="https://cdn.callrail.com" />
  <link rel="stylesheet" href="/css/tailwind.css" />
  <style>
    html { scroll-behavior: smooth; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .text-shadow-soft { text-shadow: 0 4px 18px rgba(11, 23, 41, 0.18); }
    .city-chip { transition: all 0.2s ease; }
    .city-chip:hover { transform: translateY(-1px); }
  </style>
  <script type="application/ld+json">
${JSON.stringify(ld, null, 2).split('\n').map((l) => '    ' + l).join('\n')}
  </script>
</head>
<body class="bg-slate-50 text-slate-900 antialiased">
  <!-- @partial header-page -->
  <!-- @endpartial -->
  <main id="top">
${body}
  </main>
  <!-- @partial footer-page -->
  <!-- @endpartial -->
  <!-- @partial mobile-cta -->
  <!-- @endpartial -->
  <script src="/js/main.js" defer></script>
  <script defer type="text/javascript" src="${CALLRAIL}"></script>
</body>
</html>
`;
}

const plumberSeed = (description, label) => ({ '@type': 'Plumber', '@id': BUSINESS_ID, name: 'Drains N More LLC', url: `${SITE}/`, description, areaServed: [label] });

function areaPage(a) {
  const url = `${SITE}/areas/${a.slug}/`;
  const nearby = a.nearby.links.map((s) => [`/areas/${s}/`, bySlug.get(s).name]);
  const body = [
    region('crumbs'),
    hero(a.hero, a.tile),
    layout([localSection(a), serviceCards(a), faqSection(a.faq)]),
    contactSection(a.slug, `New ${a.name} plumbing request`, a.contact),
    relatedSection(`${a.name} plumbing services`, a.nearby.lead, nearby),
  ].join('\n');
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      plumberSeed(a.description, a.label),
      {
        '@type': 'Service', '@id': `${url}#services`, name: `Plumbing services in ${a.label}`, serviceType: 'Plumbing', url,
        provider: { '@id': BUSINESS_ID }, areaServed: { '@type': 'Place', name: a.label },
        hasOfferCatalog: { '@type': 'OfferCatalog', name: `Plumbing services in ${a.name}`, itemListElement: a.services.cards.map((k) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: OFFER_NAME[k.key] } })) },
      },
      { '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: a.faq.items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  };
  return shell({ title: titleFor(a), description: a.description, url, ld, body });
}

const card = (href, h3, p, cta) => `          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 class="text-xl font-black text-slate-900"><a href="${href}" class="hover:text-brand-600">${esc(h3)}</a></h3><p class="mt-3 text-base leading-7 text-slate-600">${esc(p)}</p><a href="${href}" class="mt-4 inline-flex text-sm font-bold text-brand-600 hover:underline">${esc(cta)}</a></article>`;

function introSection(i) {
  return `    <section id="overview" class="mx-auto max-w-7xl px-4 py-16 sm:py-20">
      <div class="max-w-3xl">
        ${heading(i.eyebrow, i.h2)}
${i.paras.map((p, n) => `        <p class="${n === 0 ? 'mt-5' : 'mt-4'} text-base leading-7 text-slate-600">${esc(p)}</p>`).join('\n')}
      </div>
    </section>`;
}

function areasHub() {
  const h = hubs.areas;
  const url = `${SITE}/areas/`;
  const regionSections = regions.map((r) => {
    const list = areas.filter((a) => a.region === r.key);
    if (!list.length) return '';
    return `    <section id="${r.key}" class="${r.key === 'northland' || r.key === 'south-metro' ? 'bg-slate-100 ' : ''}py-16 sm:py-20">
      <div class="mx-auto max-w-7xl px-4">
        <div class="mb-8 max-w-3xl">
          ${heading(`${list.length} area${list.length === 1 ? '' : 's'}`, r.title, `\n          <p class="mt-4 text-base leading-7 text-slate-600">${esc(r.intro)}</p>`)}
        </div>
        <div class="grid gap-5 md:grid-cols-2">
${list.map((a) => card(`/areas/${a.slug}/`, `${a.name} plumber`, a.blurb, `View ${a.name} plumber page`)).join('\n')}
        </div>
      </div>
    </section>`;
  }).filter(Boolean);
  const body = [
    region('crumbs-hub'),
    hero(h.hero, h.tile),
    layout([introSection(h.intro), ...regionSections, faqSection(h.faq)]),
    contactSection('areas-hub', 'New service area plumbing request', h.contact, { href: '/services/', label: 'Our services' }),
    relatedSection('Plumbing services', 'Every service is available in every area. Learn more about', services.map((s) => [`/services/${s.slug}/`, s.name])),
  ].join('\n');
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      plumberSeed(h.description, 'Kansas City, MO'),
      {
        '@type': 'CollectionPage', '@id': `${url}#webpage`, url,
        mainEntity: { '@type': 'ItemList', name: 'Drains N More LLC service areas', numberOfItems: areas.length, itemListElement: areas.map((a, i) => ({ '@type': 'ListItem', position: i + 1, name: `${a.name} plumber`, url: `${SITE}/areas/${a.slug}/` })) },
      },
      { '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: h.faq.items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  };
  return shell({ title: h.title, description: h.description, url, ld, body });
}

function servicesHub() {
  const h = hubs.services;
  const url = `${SITE}/services/`;
  const main = `    <section id="services" class="bg-slate-100 py-16 sm:py-20">
      <div class="mx-auto max-w-7xl px-4">
        <div class="mb-10 max-w-2xl">
          ${heading('Service pages', 'Emergency and repair services in detail.')}
        </div>
        <div class="grid gap-5 md:grid-cols-2">
${services.map((s) => card(`/services/${s.slug}/`, s.name, s.blurb, `About ${s.name.toLowerCase()}`)).join('\n')}
        </div>
      </div>
    </section>
    <section id="also" class="mx-auto max-w-7xl px-4 py-16 sm:py-20">
      <div class="mb-8 max-w-2xl">
        ${heading('More services', h.also.h2)}
      </div>
      <div class="grid gap-5 md:grid-cols-2">
${h.also.cards.map((c) => `        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 class="text-xl font-black text-slate-900">${esc(c.h3)}</h3><p class="mt-3 text-base leading-7 text-slate-600">${esc(c.p)}</p><a href="#contact" class="mt-4 inline-flex text-sm font-bold text-brand-600 hover:underline">Ask about this service</a></article>`).join('\n')}
      </div>
    </section>`;
  const body = [
    region('crumbs-hub'),
    hero(h.hero, h.tile),
    layout([introSection(h.intro), main, faqSection(h.faq)]),
    contactSection('services-hub', 'New plumbing services request', h.contact, { href: '/areas/', label: 'Service areas' }),
    relatedSection('Where we work', 'Every service is available across our service areas, including', areas.slice(0, 5).map((a) => [`/areas/${a.slug}/`, a.name])),
  ].join('\n');
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      plumberSeed(h.description, 'Kansas City, MO'),
      {
        '@type': 'CollectionPage', '@id': `${url}#webpage`, url,
        mainEntity: { '@type': 'ItemList', name: 'Drains N More LLC plumbing services', numberOfItems: services.length, itemListElement: services.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s.name, url: `${SITE}/services/${s.slug}/` })) },
      },
      { '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: h.faq.items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  };
  return shell({ title: h.title, description: h.description, url, ld, body });
}

function sitemapPage() {
  const h = hubs.sitemap;
  const url = `${SITE}/sitemap/`;
  const list = (items) => `<ul class="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">\n${items.map(([href, label]) => `            <li><a href="${href}" class="font-semibold text-brand-600 hover:underline">${esc(label)}</a></li>`).join('\n')}\n          </ul>`;
  const block = (id, title, items, bg = '') => `    <section id="${id}" class="${bg}py-16 sm:py-20">
      <div class="mx-auto max-w-7xl px-4">
        <div class="max-w-3xl">
          ${heading(`${items.length} pages`, title)}
          ${list(items)}
        </div>
      </div>
    </section>`;
  const main = [
    ['/', 'Home'], ['/areas/', 'All service areas'], ['/services/', 'All plumbing services'], ['/sitemap/', 'Site map'],
    ['/#about', 'About Drains N More LLC'], ['/#reviews', 'Customer reviews'], ['/#contact', 'Contact and request service'],
  ];
  const svc = services.map((s) => [`/services/${s.slug}/`, s.name]);
  const sections = [
    block('main-pages', 'Main pages', main),
    block('all-services', 'Plumbing services', svc, 'bg-slate-100 '),
    ...regions.map((r, i) => block(r.key, `${r.title}`, areas.filter((a) => a.region === r.key).map((a) => [`/areas/${a.slug}/`, `${a.name} plumber`]), i % 2 === 0 ? '' : 'bg-slate-100 ')),
  ];
  const body = [
    region('crumbs-hub'),
    hero(h.hero, h.tile),
    layout(sections),
    contactSection('sitemap', 'New plumbing request from the site map', h.contact, { href: '/areas/', label: 'Service areas' }),
  ].join('\n');
  const all = [...main.slice(0, 3), ...svc, ...areas.map((a) => [`/areas/${a.slug}/`, `${a.name} plumber`])];
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      plumberSeed(h.description, 'Kansas City, MO'),
      {
        '@type': 'CollectionPage', '@id': `${url}#webpage`, url,
        mainEntity: { '@type': 'ItemList', name: 'Drains N More LLC site map', numberOfItems: all.length, itemListElement: all.map(([href, name], i) => ({ '@type': 'ListItem', position: i + 1, name, url: new URL(href, SITE).href })) },
      },
    ],
  };
  return shell({ title: h.title, description: h.description, url, ld, body });
}

function stub(entry) {
  const target = `${SITE}${entry.to}`;
  const canonical = target.replace(/#.*$/, '');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(entry.title)}</title>
    <link rel="canonical" href="${canonical}" />
    <meta http-equiv="refresh" content="0; url=${target}" />
  </head>
  <body>
    <p>This page has moved. <a href="${target}">Continue to Drains N More LLC</a>.</p>
  </body>
</html>
`;
}

const chip = 'city-chip rounded-2xl border border-white/10 bg-white/5 p-2.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10';
const outputs = new Map();

for (const a of areas) outputs.set(`areas/${a.slug}/index.html`, { kind: 'page', text: areaPage(a) });
outputs.set('areas/index.html', { kind: 'page', text: areasHub() });
outputs.set('services/index.html', { kind: 'page', text: servicesHub() });
outputs.set('sitemap/index.html', { kind: 'page', text: sitemapPage() });
for (const r of redirects) {
  const rel = r.from.endsWith('/') ? `${r.from.slice(1)}index.html` : r.from.slice(1);
  outputs.set(rel, { kind: 'stub', text: stub(r) });
}
outputs.set('partials/areas-list.html', {
  kind: 'partial',
  text: regions.map((r) => {
    const list = areas.filter((a) => a.region === r.key);
    return `<div>
  <a href="/areas/#${r.key}" class="inline-block py-2 text-xs font-bold uppercase tracking-wide text-slate-400 hover:text-white">${esc(r.short)}</a>
  <ul class="mt-3 flex flex-col">
${list.map((a) => `    <li><a href="/areas/${a.slug}/" class="block py-1.5 text-slate-200 hover:text-white">${esc(a.name)} Plumber</a></li>`).join('\n')}
  </ul>
</div>`;
  }).join('\n') + '\n',
});
outputs.set('partials/areas-chips.html', {
  kind: 'partial',
  text: `<a href="/areas/" class="${chip}">Kansas City, MO</a>\n${areas.map((a) => `<a href="/areas/${a.slug}/" class="${chip}">${esc(a.chip)}</a>`).join('\n')}\n`,
});

// redirects must land on something real
const generatedUrls = new Set([...outputs.keys()].filter((k) => k.endsWith('index.html')).map((k) => '/' + k.replace(/index\.html$/, '')));
const existingPages = (dir) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `/${dir}/${e.name}/`) : []);
const realUrls = new Set(['/', ...generatedUrls, ...existingPages('services')]);
for (const r of redirects) {
  const path = r.to.replace(/#.*$/, '');
  if (!realUrls.has(path)) bad('content/redirects.json', `${r.from} points at ${r.to}, which is not a page`);
  if (realUrls.has(r.from) && !['/services/'].includes(r.from) && !outputs.has(r.from.slice(1) + (r.from.endsWith('/') ? 'index.html' : ''))) bad('content/redirects.json', `${r.from} is a live page and cannot also be a redirect`);
}
for (const dir of existingPages('areas')) {
  const slug = dir.split('/')[2];
  if (!bySlug.has(slug)) bad(`areas/${slug}`, 'folder has no content/areas file (delete the folder or add the file)');
}

// ---------------------------------------------------------------------------
// Write or check
// ---------------------------------------------------------------------------
const strip = (t) => t
  .replace(/[ \t]*<!-- @partial ([\w-]+) -->[\s\S]*?<!-- @endpartial -->/g, '<!-- @partial $1 -->')
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '<LD/>');

if (problems.length) {
  console.error(`${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

let drift = 0;
let written = 0;
for (const [rel, out] of outputs) {
  const file = join(ROOT, rel);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const same = current !== null && (out.kind === 'page' ? strip(current) === strip(out.text) : current === out.text);
  if (same) continue;
  if (CHECK) { console.error(`  DRIFT   ${rel}`); drift += 1; continue; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out.text);
  written += 1;
}

if (drift) { console.error(`\n${drift} generated file(s) out of date — run: node tools/build.mjs`); process.exit(1); }
console.log(CHECK ? `Area pages are current (${areas.length} areas, ${redirects.length} redirects).` : `${areas.length} areas, ${redirects.length} redirects, ${written} file(s) written.`);
