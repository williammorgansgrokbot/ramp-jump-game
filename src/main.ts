import './style.css';
import { Game } from './game/Game';

const block = (event: Event) => event.preventDefault();
document.addEventListener('gesturestart', block);
document.addEventListener('selectstart', block);
document.addEventListener(
  'touchmove',
  (event) => {
    if (event.touches.length > 1) event.preventDefault();
  },
  { passive: false },
);

const game = new Game();
void game.start().then(() => {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  }
}).catch((err) => {
  console.error(err);
});
