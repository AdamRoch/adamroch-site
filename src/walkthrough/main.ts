/* ————— Walkthrough — bootstrap —————
   No three.js here on purpose: static imports hoist, and the curtain has to paint
   before the renderer and the colossus start downloading. The scene arrives by
   dynamic import and reports its progress into the preloader. */

import { mountLabChrome, mountPreloader } from '../lab-chrome';
import './style.css';

const chrome = mountLabChrome({
  index: 4,
  total: 5,
  title: 'Walkthrough',
  next: { href: '/lab/broadsheet/', title: 'The Broadsheet' },
  notePanelId: 'wt-note-panel',
  skin: 'wt brackets',
});

const pre = mountPreloader({ title: 'Walkthrough', index: 4, total: 5 });
pre.set(0.02, 'waking the renderer');

import('./scene')
  .then((scene) => scene.boot(pre, chrome))
  .catch((err: unknown) => {
    console.error('[walkthrough] the scene failed to boot', err);
    pre.set(1, 'the scene failed to load');
    void pre.done(); // never leave the curtain hanging over a broken page
  });
