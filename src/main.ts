import './style.css';
import { initParticles } from './particles';
import { initAnimations } from './animations';
import { initModals } from './modal';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.querySelector<HTMLCanvasElement>('#gl-bg');
const particles = canvas ? initParticles(canvas, reduced) : null;

initAnimations({
  reduced,
  onScroll: (progress) => particles?.setScroll(progress),
  onTheme: (theme) => particles?.setTheme(theme),
});
initModals();
