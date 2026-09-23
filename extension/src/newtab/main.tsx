/**
 * New-tab page.
 *
 * It renders the *same* StartPage component as the website, so the two can never
 * drift. The only difference is the transport: here the bridge talks to the service
 * worker directly over chrome.runtime (no content script involved), and the store
 * keeps its own cache in this origin's localStorage.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@web/styles.css';
import { StartPage } from '@web/components/StartPage';
import { store } from '@web/state/store';

document.documentElement.setAttribute('data-safari-startpage', '');

store.connect();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing in newtab.html');

createRoot(container).render(
  <StrictMode>
    <StartPage />
  </StrictMode>,
);

window.addEventListener('beforeunload', () => store.flush());

// The service worker pushes updates even when this page is in the background.
chrome.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: string })?.type === 'SAFARI_OPEN_START_PAGE') store.flush();
});
