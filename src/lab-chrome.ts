/* ————— shared lab chrome: home link, index, design note, next link, status slot, preloader ————— */
// Dependency-free on purpose: no three, no gsap. Usable before any scene code runs.

import './lab-chrome.css';

export interface LabChromeOptions {
  index: number; // 1-based lab number
  total: number;
  title: string; // rendered in the page's display face
  next: { href: string; title: string };
  notePanelId?: string; // id of the page's own <aside hidden> design-note panel
  noteLabel?: string; // default 'Design note'
  status?: HTMLElement | string; // bottom-left slot: FPS / quality / analyser line
  skin?: string; // sets data-skin on .lc; built-ins: 'brackets', 'glass', 'chips' (space-separated ok)
}

export interface LabChrome {
  root: HTMLDivElement;
  setStatus(text: string): void;
  setNoteOpen(open: boolean): void;
  destroy(): void;
}

export interface PreloaderOptions {
  title: string;
  index: number;
  total: number;
  stages?: string[]; // optional auto stage labels, picked by progress fraction
}

export interface Preloader {
  el: HTMLDivElement;
  set(progress: number, stageLabel?: string): void; // 0..1, never moves backwards
  done(): Promise<void>; // call on the first real rendered frame
}

const NOTE_OUT_MS = 200; // must match [data-state='closing'] in lab-chrome.css
const RULE_MS = 400; // must match .lc-preloader-fill transition
const CURTAIN_MS = 600; // must match .lc-preloader transition
const LOADING_CLASS = 'lc-loading';

const pad = (n: number): string => String(n).padStart(2, '0');
const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function arrow(dir: 'left' | 'right'): string {
  const d = dir === 'left' ? 'M8.5 2.5 4 7l4.5 4.5M4 7h8' : 'M5.5 2.5 10 7l-4.5 4.5M10 7H2';
  return `<svg class="lc-arrow" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

function indexLabel(index: number, total: number): string {
  return `LAB <span class="lc-index-n">${pad(index)}</span> / ${pad(total)}`;
}

function raiseAll(): void {
  document.querySelectorAll('.lc[data-enter]').forEach((n) => n.removeAttribute('data-enter'));
}

/* ————— chrome ————— */

export function mountLabChrome(opts: LabChromeOptions): LabChrome {
  const html = document.documentElement;
  const root = document.createElement('div');
  root.className = 'lc';
  root.setAttribute('data-lc', '');
  root.setAttribute('data-enter', '');
  if (opts.skin) root.dataset.skin = opts.skin;

  const noteBtn = opts.notePanelId
    ? `<button class="lc-pill lc-label lc-note" type="button" aria-expanded="false" aria-controls="${esc(opts.notePanelId)}">${esc(opts.noteLabel ?? 'Design note')}</button>`
    : '';

  root.innerHTML = `
    <a class="lc-pill lc-label lc-home" href="/" aria-label="Adam Roch, back to the homepage">${arrow('left')}<span>Adam Roch</span></a>
    <div class="lc-tr">
      <div class="lc-index">
        <span class="lc-label lc-index-label">${indexLabel(opts.index, opts.total)}</span>
        <span class="lc-index-title">${esc(opts.title)}</span>
      </div>
      ${noteBtn}
    </div>
    <a class="lc-pill lc-label lc-next" href="${esc(opts.next.href)}"><span class="lc-next-text">Next<span class="lc-next-title"> · ${esc(opts.next.title)}</span></span>${arrow('right')}</a>
    <div class="lc-status lc-label"></div>`;

  const statusEl = root.querySelector<HTMLDivElement>('.lc-status')!;
  if (typeof opts.status === 'string') statusEl.textContent = opts.status;
  else if (opts.status) statusEl.append(opts.status);

  document.body.prepend(root);

  // entrance: rise on the next frame, or wait behind the preloader curtain if one is up
  requestAnimationFrame(() => {
    if (!html.classList.contains(LOADING_CLASS)) root.removeAttribute('data-enter');
  });

  /* ————— design note wiring ————— */

  const btn = root.querySelector<HTMLButtonElement>('.lc-note');
  const panel = opts.notePanelId ? document.getElementById(opts.notePanelId) : null;
  let open = false;
  let timer = 0;

  function finishClose(): void {
    clearTimeout(timer);
    if (!panel) return;
    panel.hidden = true;
    panel.dataset.state = 'closed';
  }

  function setOpen(next: boolean, returnFocus = false): void {
    if (!btn || !panel || next === open) return;
    open = next;
    clearTimeout(timer);
    btn.setAttribute('aria-expanded', String(next));
    if (next) {
      panel.hidden = false;
      panel.dataset.state = 'closed';
      void panel.offsetWidth; // commit the hidden state so the transition has a start
      panel.dataset.state = 'open';
      panel.focus({ preventScroll: true });
    } else {
      if (returnFocus) btn.focus({ preventScroll: true });
      if (reduced()) {
        finishClose();
      } else {
        panel.dataset.state = 'closing';
        timer = window.setTimeout(finishClose, NOTE_OUT_MS);
      }
    }
  }

  const onBtn = (): void => setOpen(!open);
  const onKey = (e: KeyboardEvent): void => {
    if (open && e.key === 'Escape') {
      e.preventDefault();
      setOpen(false, true);
    }
  };
  const onPointer = (e: PointerEvent): void => {
    if (!open || !panel || !btn) return;
    const t = e.target as Node;
    if (!panel.contains(t) && !btn.contains(t)) setOpen(false);
  };

  if (btn && panel) {
    panel.setAttribute('data-lc-panel', '');
    panel.dataset.state = 'closed';
    panel.hidden = true;
    if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
    let closeBtn = panel.querySelector<HTMLButtonElement>('.lc-close');
    if (!closeBtn) {
      closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'lc-close';
      closeBtn.setAttribute('aria-label', 'Close design note');
      closeBtn.innerHTML =
        '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
      panel.prepend(closeBtn);
    }
    closeBtn.addEventListener('click', () => setOpen(false, true));
    btn.addEventListener('click', onBtn);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
  }

  if (import.meta.env.DEV) smoke(root, btn, panel, finishClose);

  return {
    root,
    setStatus(text) {
      statusEl.textContent = text;
    },
    setNoteOpen(next) {
      setOpen(next);
    },
    destroy() {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      if (panel) {
        finishClose();
        panel.removeAttribute('data-lc-panel');
        delete panel.dataset.state;
      }
      root.remove();
    },
  };
}

/* ————— preloader curtain ————— */

export function mountPreloader(opts: PreloaderOptions): Preloader {
  const html = document.documentElement;
  html.classList.add(LOADING_CLASS);
  // any chrome already mounted waits behind the curtain and rises with it
  document.querySelectorAll('.lc').forEach((n) => n.setAttribute('data-enter', ''));

  const el = document.createElement('div');
  el.className = 'lc-preloader';
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <div class="lc-preloader-inner">
      <span class="lc-label lc-preloader-mark">Adam Roch</span>
      <span class="lc-label lc-preloader-index">${indexLabel(opts.index, opts.total)}</span>
      <span class="lc-preloader-title">${esc(opts.title)}</span>
      <span class="lc-preloader-rule" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="lc-preloader-fill"></span></span>
      <span class="lc-label lc-preloader-stage"></span>
    </div>`;
  document.body.append(el);

  const rule = el.querySelector<HTMLElement>('.lc-preloader-rule')!;
  const fill = el.querySelector<HTMLElement>('.lc-preloader-fill')!;
  const stage = el.querySelector<HTMLElement>('.lc-preloader-stage')!;
  const stages = opts.stages;
  let progress = 0;
  let lastSet = 0;
  let finished: Promise<void> | null = null;

  function set(p: number, label?: string): void {
    const next = Math.min(1, Math.max(0, p));
    if (next > progress) {
      progress = next;
      lastSet = performance.now();
      fill.style.transform = `scaleX(${progress})`;
      rule.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    }
    const text =
      label ?? (stages?.length ? stages[Math.min(stages.length - 1, Math.floor(progress * stages.length))] : undefined);
    if (text !== undefined && text !== stage.textContent) stage.textContent = text;
  }

  function done(): Promise<void> {
    if (finished) return finished;
    set(1);
    finished = (async () => {
      if (!reduced()) {
        // let the rule land on 100% before the curtain goes
        await wait(Math.max(0, RULE_MS - (performance.now() - lastSet)) + 40);
        el.classList.add('is-done');
        html.classList.remove(LOADING_CLASS);
        raiseAll();
        await wait(CURTAIN_MS + 40);
      } else {
        html.classList.remove(LOADING_CLASS);
        raiseAll();
      }
      el.remove();
    })();
    return finished;
  }

  set(0);
  return { el, set, done };
}

/* ————— dev smoke test: the four regions exist and the note button toggles ————— */

function smoke(
  root: HTMLElement,
  btn: HTMLButtonElement | null,
  panel: HTMLElement | null,
  settle: () => void
): void {
  const has = (sel: string): boolean => root.querySelector(sel) !== null;
  console.assert(
    has('.lc-home') && has('.lc-index') && has('.lc-next') && has('.lc-status'),
    '[lab-chrome] a chrome region is missing'
  );
  if (!btn || !panel) return;
  const focused = document.activeElement;
  panel.style.transition = 'none'; // toggle synchronously, nothing paints
  btn.click();
  console.assert(
    btn.getAttribute('aria-expanded') === 'true' && !panel.hidden && panel.dataset.state === 'open',
    '[lab-chrome] note button did not open the panel'
  );
  btn.click();
  console.assert(btn.getAttribute('aria-expanded') === 'false', '[lab-chrome] note button did not close the panel');
  settle();
  panel.style.transition = '';
  if (focused instanceof HTMLElement && focused !== document.body) focused.focus({ preventScroll: true });
  if (panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
}
