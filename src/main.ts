import './style.css';
import { initWebGL } from './webgl';
import { initAnimations } from './animations';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.querySelector<HTMLCanvasElement>('#gl');
const gl = canvas ? initWebGL(canvas, reduced) : null;

initAnimations({
  reduced,
  onScroll: (progress) => gl?.setScroll(progress),
});
