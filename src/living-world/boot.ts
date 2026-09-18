/* ————— living world · lab 03: boot ————— */
// Entry module. Mounts the curtain and the shared chrome before three is
// fetched: static imports hoist, so the scene (main.ts) is loaded dynamically
// and reports its build progress through ./loading.

import { mountLabChrome, mountPreloader } from '../lab-chrome';
import { setPreloader } from './loading';
import './style.css';

const preloader = mountPreloader({
  title: 'Living World',
  index: 3,
  total: 5,
  stages: ['painting moss', 'growing arches', 'seeding grass', 'compiling light'],
});
setPreloader(preloader);

mountLabChrome({
  index: 3,
  total: 5,
  title: 'Living World',
  next: { href: '/lab/walkthrough/', title: 'Walkthrough' },
  notePanelId: 'lw-note-panel',
  skin: 'glass lw',
});

import('./main').catch((err: unknown) => {
  // a scene that cannot start still leaves a readable page behind the curtain
  console.error(err);
  document.documentElement.classList.add('lw-in', 'lw-live');
  void preloader.done();
});
