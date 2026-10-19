import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Brand fonts are bundled with the app (not loaded from Google), so they work offline.
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import './index.css';
import { App } from './App';
import { applyTheme } from './theme';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
