const CONTACT_EMAIL = 'Adam.M.Roch13@gmail.com';

// Paste form-backend endpoints here (e.g. Formspree: 'https://formspree.io/f/abcdwxyz').
// While an endpoint is empty, that form falls back to opening the visitor's
// email client with everything pre-filled.
const ENDPOINTS: Record<string, string> = {
  message: '',
  giveaway: '',
};

let lastFocus: HTMLElement | null = null;
let openPanel: HTMLElement | null = null;

function getFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>('button, input, textarea, a[href]')
  ).filter((el) => !el.hasAttribute('disabled'));
}

function openModal(modal: HTMLElement): void {
  lastFocus = document.activeElement as HTMLElement | null;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  openPanel = modal.querySelector<HTMLElement>('.modal-panel');
  requestAnimationFrame(() => modal.classList.add('open'));
  openPanel?.querySelector<HTMLElement>('input, textarea')?.focus();
  document.addEventListener('keydown', onKeydown);
}

function closeModal(): void {
  const modal = openPanel?.closest<HTMLElement>('.modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.hidden = true;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onKeydown);
  openPanel = null;
  lastFocus?.focus();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    closeModal();
    return;
  }
  if (e.key !== 'Tab' || !openPanel) return;
  const items = getFocusable(openPanel);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

async function handleSubmit(form: HTMLFormElement): Promise<void> {
  const kind = form.dataset.form ?? 'message';
  const status = form.querySelector<HTMLElement>('.form-status');

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const data = new FormData(form);
  const endpoint = ENDPOINTS[kind];

  // no backend wired yet — compose an email instead so nothing is lost
  if (!endpoint) {
    const subject =
      kind === 'giveaway' ? 'Giveaway entry — adamroch.com' : 'Message from adamroch.com';
    const body = Array.from(data.entries())
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n');
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    if (status) {
      status.textContent = 'Opening your email app — press send there to finish.';
    }
    return;
  }

  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const originalLabel = submitBtn?.textContent ?? '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
  }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: data,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    form.reset();
    if (status) {
      status.textContent =
        kind === 'giveaway' ? "You're in. Good luck." : "Sent — I'll get back to you soon.";
    }
  } catch {
    if (status) {
      status.innerHTML = `Something went wrong — email me directly at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  }
}

export function initModals(): void {
  document.querySelectorAll<HTMLElement>('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.open;
      const modal = id ? document.getElementById(id) : null;
      if (modal) openModal(modal);
    });
  });
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });
  document.querySelectorAll<HTMLFormElement>('.modal-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void handleSubmit(form);
    });
  });
}
