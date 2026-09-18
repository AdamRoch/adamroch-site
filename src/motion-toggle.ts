// MOTION · FULL / MOTION · REDUCED in the footer rail. Writes the choice and reloads;
// the inline head script reads localStorage['adam-motion'] before first paint, so the
// page boots straight into the chosen state and the browser restores scroll position.

const KEY = 'adam-motion';
const RETURN = 'adam-motion-return';

export function initMotionToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-motion]');
  if (!btn) return;
  const reduced = document.documentElement.classList.contains('reduced');
  btn.textContent = reduced ? 'MOTION · REDUCED' : 'MOTION · FULL';
  btn.setAttribute('aria-label', reduced ? 'Motion is reduced. Switch to full motion' : 'Motion is full. Switch to reduced motion');
  btn.hidden = false;
  // the reload lands on <body>; put focus back on the control that caused it
  try {
    if (sessionStorage.getItem(RETURN)) {
      sessionStorage.removeItem(RETURN);
      btn.focus();
    }
  } catch {
    /* private mode: focus starts at the top, as it would without the toggle */
  }
  btn.addEventListener('click', () => {
    try {
      localStorage.setItem(KEY, reduced ? 'full' : 'reduced');
      sessionStorage.setItem(RETURN, '1');
    } catch {
      /* private mode: the reload still honours the OS setting */
    }
    location.reload();
  });
}
