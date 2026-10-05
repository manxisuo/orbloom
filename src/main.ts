import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './app/App.vue';
import { audioBus } from './game/audio';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');

const unlockAudio = () => {
  audioBus.unlock();
};
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio, { passive: true });
