/* ————— Lab 05 · Tender: where the page is, as numbers the coins and the chrome can share ————— */
// Layout is read in measure() only (load, resize, fonts); read() is arithmetic on the cache,
// so the frame loop never touches layout.
//
// Per section k:
//   enter[k]  0 when its top is at the viewport bottom, 1 when its top reaches the viewport top
//   pin[k]    0..1 through the pinned span (a .tn-pin section's sticky inner is stuck), else 0
//   after[k]  px scrolled since the pinned span ended (how far a released formation has moved)

export interface SectionInfo {
  el: HTMLElement;
  top: number; // document px
  height: number;
  pinned: boolean;
  tone: 'dark' | 'light';
  chapter: string;
}

export interface ScrollState {
  y: number;
  vw: number;
  vh: number;
  enter: number[];
  pin: number[];
  after: number[];
}

export interface ScrollModel {
  readonly sections: SectionInfo[];
  measure(): void;
  read(y: number, out: ScrollState): void;
  state(): ScrollState; // a fresh state object sized for the sections
  sectionAt(y: number, viewportY: number): SectionInfo | null; // the section under a viewport row
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function createScroll(root: ParentNode = document): ScrollModel {
  const sections: SectionInfo[] = Array.from(root.querySelectorAll<HTMLElement>('.tn-sec')).map((el) => ({
    el,
    top: 0,
    height: 0,
    pinned: el.classList.contains('tn-pin'),
    tone: el.dataset.tone === 'light' ? 'light' : 'dark',
    chapter: el.dataset.chapter ?? '',
  }));
  let vw = 1;
  let vh = 1;

  function measure(): void {
    vw = document.documentElement.clientWidth || window.innerWidth;
    vh = window.innerHeight;
    const sy = window.scrollY;
    for (const s of sections) {
      const r = s.el.getBoundingClientRect();
      s.top = r.top + sy;
      s.height = r.height;
    }
  }

  function read(y: number, out: ScrollState): void {
    out.y = y;
    out.vw = vw;
    out.vh = vh;
    for (let k = 0; k < sections.length; k++) {
      const s = sections[k];
      out.enter[k] = clamp01((y - (s.top - vh)) / vh);
      const span = s.pinned ? Math.max(1, s.height - vh) : 0;
      out.pin[k] = span ? clamp01((y - s.top) / span) : 0;
      out.after[k] = Math.max(0, y - (s.top + span));
    }
  }

  function state(): ScrollState {
    const n = sections.length;
    return { y: 0, vw, vh, enter: new Array(n).fill(0), pin: new Array(n).fill(0), after: new Array(n).fill(0) };
  }

  function sectionAt(y: number, viewportY: number): SectionInfo | null {
    const docY = y + viewportY;
    for (const s of sections) if (docY >= s.top && docY < s.top + s.height) return s;
    return null;
  }

  measure();
  return { sections, measure, read, state, sectionAt };
}
