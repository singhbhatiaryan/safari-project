import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { StartPage } from './components/StartPage';
import { store } from './state/store';

// Hook the extension bridge up before the first paint so a new tab shows the
// authoritative state instead of flashing a stale one.
store.connect();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');

createRoot(container).render(
  <StrictMode>
    <StartPage />
  </StrictMode>,
);

window.addEventListener('beforeunload', () => store.flush());
