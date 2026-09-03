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
        statusNode.textContent = 'We could not send your request. Please call (816) 703-9800.';
        statusNode.className = 'mt-3 text-sm font-semibold text-red-300';
      }
    } finally {
      leadForm.removeAttribute('aria-busy');
      if (submitButton) submitButton.disabled = false;
    }
  });
}
