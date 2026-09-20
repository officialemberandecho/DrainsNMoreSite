const navToggle = document.querySelector('[data-nav-toggle]');
const navMenu = document.querySelector('[data-nav]');
const yearNode = document.getElementById('year');

if (navToggle && navMenu) {
  if (!navMenu.id) navMenu.id = 'mobile-menu';
  navToggle.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle('hidden');
    navToggle.setAttribute('aria-expanded', String(!isOpen));
  });

  for (const link of navMenu.querySelectorAll('a')) {
    link.addEventListener('click', () => {
      navMenu.classList.add('hidden');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  }
}

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

for (const leadForm of document.querySelectorAll('[data-lead-form]')) {
  leadForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(leadForm);
    const statusNode = leadForm.querySelector('[data-form-status]');
    const submitButton = leadForm.querySelector('[type="submit"]');

    if (statusNode) {
      statusNode.textContent = 'Sending your request...';
      statusNode.className = 'mt-3 text-sm text-slate-300';
    }
    leadForm.setAttribute('aria-busy', 'true');
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch(leadForm.action, {
        method: 'POST',
        body: formData
      });
      const result = await response.json().catch(() => ({ success: false }));

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Unable to send your request.');
      }

      leadForm.reset();
      if (statusNode) {
        statusNode.textContent = 'Request sent. We will contact you shortly.';
        statusNode.className = 'mt-3 text-sm font-semibold text-emerald-300';
      }
    } catch (error) {
      if (statusNode) {
        statusNode.textContent = 'We could not send your request. Please call (816) 705-1538.';
        statusNode.className = 'mt-3 text-sm font-semibold text-red-300';
      }
    } finally {
      leadForm.removeAttribute('aria-busy');
      if (submitButton) submitButton.disabled = false;
    }
  });
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const siteHeader = document.querySelector('header.sticky');

if (siteHeader) {
  const compactHeader = window.matchMedia('(max-width: 1279px)');
  let lastY = window.scrollY;
  let userScrollUntil = 0;
  const markUserScroll = () => { userScrollUntil = performance.now() + 700; };
  for (const type of ['touchstart', 'touchmove', 'wheel', 'keydown']) window.addEventListener(type, markUserScroll, { passive: true });

  const syncHeader = () => {
    const y = window.scrollY;
    const menuOpen = navToggle && navToggle.getAttribute('aria-expanded') === 'true';
    siteHeader.classList.toggle('is-scrolled', y > 8);
    if (Math.abs(y - lastY) > 240) {
      siteHeader.classList.remove('is-hidden');
    } else if (performance.now() > userScrollUntil) {
      // scroll restored by the browser, an anchor jump, or a layout nudge: never hide the header for these
      if (y <= 160) siteHeader.classList.remove('is-hidden');
    } else if (compactHeader.matches && !menuOpen && y > 160 && y - lastY > 6) {
      siteHeader.classList.add('is-hidden');
    } else if (y < lastY - 6 || y <= 160 || menuOpen || !compactHeader.matches) {
      siteHeader.classList.remove('is-hidden');
    }
    lastY = y;
  };

  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });
}

if (!reducedMotion) {
  const progress = document.createElement('div');
  progress.className = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);

  let framePending = false;
  const paintProgress = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? Math.min(window.scrollY / max, 1) : 0})`;
    framePending = false;
  };

  window.addEventListener('scroll', () => {
    if (!framePending) {
      framePending = true;
      requestAnimationFrame(paintProgress);
    }
  }, { passive: true });
  window.addEventListener('resize', paintProgress);
  paintProgress();
}

if (!reducedMotion && 'IntersectionObserver' in window) {
  const hero = document.querySelector('main > section');
  const found = [...document.querySelectorAll(
    'main :is(section, aside) :is(h2, p.uppercase, article, .city-chip, form, .cta-rail, [class*="rounded-3xl"], [class*="rounded-[2rem]"])'
  )].filter((el) => el.offsetParent !== null && !(hero && hero.contains(el)));
  const targets = found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
  const seenPerParent = new Map();

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      observer.unobserve(el);
      el.classList.add('is-shown');
      el.addEventListener('transitionend', () => {
        el.classList.remove('reveal-pending', 'is-shown');
        el.style.removeProperty('--rv-delay');
      }, { once: true });
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  for (const el of targets) {
    if (el.getBoundingClientRect().top < window.innerHeight) continue;
    const order = seenPerParent.get(el.parentElement) ?? 0;
    seenPerParent.set(el.parentElement, order + 1);
    el.style.setProperty('--rv-delay', `${Math.min(order, 5) * 70}ms`);
    el.classList.add('reveal-pending');
    observer.observe(el);
  }
}

for (const backLink of document.querySelectorAll('[data-back]')) {
  backLink.addEventListener('click', (event) => {
    if (document.referrer.startsWith(window.location.origin) && window.history.length > 1) {
      event.preventDefault();
      window.history.back();
    }
  });
}
