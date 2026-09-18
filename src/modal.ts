// The two contact sheets: native <dialog> + showModal(). The lens canvas sits behind the
// DOM, so the top layer is fine. Ids, data-open/data-close, data-form and the Formspree
// endpoints are the contract other code relies on; keep them.

export const CONTACT_EMAIL = 'adam.m.roch13@gmail.com';

const ENDPOINTS: Record<string, string> = {
  message: 'https://formspree.io/f/mppaypyb',
  giveaway: 'https://formspree.io/f/mvkpwkwn',
};

const SUCCESS: Record<string, string> = {
  message: "Sent. I’ll write back.",
  giveaway: "You’re in.",
};

export interface ModalHooks {
  onOpen?(id: string, dialog: HTMLDialogElement): void;
  onClose?(id: string): void;
  onSuccess?(id: string): void;
}

function errorFor(field: HTMLInputElement | HTMLTextAreaElement): string {
  const v = field.validity;
  if (v.valueMissing) return 'REQUIRED';
  if (v.typeMismatch && field.type === 'email') return 'THAT DOES NOT LOOK LIKE AN EMAIL';
  return 'CHECK THIS FIELD';
}

function validate(form: HTMLFormElement): boolean {
  const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
  let firstBad: HTMLElement | null = null;
  for (const field of fields) {
    const ok = field.checkValidity();
    const slot = field.id ? document.getElementById(`${field.id}-error`) : null;
    if (ok) field.removeAttribute('aria-invalid');
    else field.setAttribute('aria-invalid', 'true');
    if (slot) slot.textContent = ok ? '' : errorFor(field);
    if (!ok && !firstBad) firstBad = field;
  }
  firstBad?.focus();
  return !firstBad;
}

async function submit(form: HTMLFormElement, hooks: ModalHooks): Promise<void> {
  const kind = form.dataset.form ?? 'message';
  const dialog = form.closest('dialog');
  const status = dialog?.querySelector<HTMLElement>('.form-status') ?? null;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!validate(form)) return;

  const endpoint = ENDPOINTS[kind];
  const data = new FormData(form);
  if (!endpoint) {
    // no backend wired: hand the visitor their email client with everything filled in
    const subject = kind === 'giveaway' ? 'Giveaway entry - adamroch.com' : 'Message from adamroch.com';
    const body = Array.from(data.entries())
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join('\n');
    location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return;
  }

  const label = button?.textContent ?? '';
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-sending');
    button.replaceChildren(Object.assign(document.createElement('span'), { className: 'dot' }), 'SENDING');
  }
  if (status) status.textContent = '';

  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: data });
    if (!res.ok) throw new Error(String(res.status));
    form.reset();
    form.hidden = true;
    if (status) {
      status.textContent = SUCCESS[kind] ?? 'Sent.';
      status.focus();
    }
    hooks.onSuccess?.(dialog?.id ?? kind);
  } catch {
    if (status) {
      status.replaceChildren(
        "That didn’t send. Email me instead: ",
        Object.assign(document.createElement('a'), { href: `mailto:${CONTACT_EMAIL}`, textContent: CONTACT_EMAIL })
      );
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.classList.remove('is-sending');
      button.textContent = label;
    }
  }
}

export function openModal(dialog: HTMLDialogElement, hooks: ModalHooks = {}): void {
  if (dialog.open) return;
  dialog.showModal();
  document.documentElement.classList.add('modal-open');
  hooks.onOpen?.(dialog.id, dialog);
}

export function closeModal(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
}

export function initModals(hooks: ModalHooks = {}): void {
  const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog'));
  if (dialogs.length === 0 || typeof HTMLDialogElement === 'undefined') return;

  for (const dialog of dialogs) {
    // scrim click: the dialog itself is the event target only outside .sheet-inner
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeModal(dialog);
    });
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('modal-open');
      // a sent message must not leave the sheet empty for the rest of the session
      const form = dialog.querySelector<HTMLFormElement>('form[data-form]');
      if (form) {
        form.hidden = false;
        form.querySelectorAll<HTMLElement>('[aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
        form.querySelectorAll<HTMLElement>('.field-error').forEach((p) => (p.textContent = ''));
      }
      const status = dialog.querySelector<HTMLElement>('.form-status');
      if (status) status.textContent = '';
      hooks.onClose?.(dialog.id);
    });
    dialog.querySelectorAll<HTMLElement>('[data-close]').forEach((el) => {
      el.addEventListener('click', () => closeModal(dialog));
    });
    const form = dialog.querySelector<HTMLFormElement>('form[data-form]');
    if (form) {
      form.noValidate = true; // inline errors instead of the browser bubble; native posting stays for no-JS
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void submit(form, hooks);
      });
      form.querySelectorAll<HTMLElement>('[aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
    }
  }

  document.querySelectorAll<HTMLElement>('[data-open]').forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      const id = trigger.dataset.open;
      const dialog = id ? (document.getElementById(id) as HTMLDialogElement | null) : null;
      if (!dialog || typeof dialog.showModal !== 'function') return; // anchors keep their href fallback
      e.preventDefault();
      openModal(dialog, hooks);
    });
  });
}
