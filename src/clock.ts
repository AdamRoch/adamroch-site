// One true fact in the chrome: the time in Austin. Intl with America/Chicago so the
// offset follows DST; every [data-clock] gets " · 14:32 GMT-5" with the separator in the text so it
// copies and reads aloud. Text swaps on the minute boundary; digits never roll.

function makeFormatter(): Intl.DateTimeFormat {
  const base: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  try {
    return new Intl.DateTimeFormat('en-US', { ...base, timeZoneName: 'shortOffset' });
  } catch {
    // Safari < 15.4: 'shortOffset' throws; 'short' gives CDT / CST
    return new Intl.DateTimeFormat('en-US', { ...base, timeZoneName: 'short' });
  }
}

export function initClock(): void {
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-clock]'));
  if (targets.length === 0) return;
  const fmt = makeFormatter();

  const render = (): void => {
    const parts = fmt.formatToParts(new Date());
    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const text = ` · ${part('hour')}:${part('minute')} ${part('timeZoneName')}`.trimEnd();
    for (const el of targets) if (el.textContent !== text) el.textContent = text;
  };

  let timer = 0;
  let interval = 0;
  const schedule = (): void => {
    clearTimeout(timer);
    clearInterval(interval);
    const untilNextMinute = 60_000 - (Date.now() % 60_000) + 50;
    timer = window.setTimeout(() => {
      render();
      interval = window.setInterval(render, 60_000);
    }, untilNextMinute);
  };

  render();
  schedule();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    render();
    schedule();
  });
}
