import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing in popup.html');

createRoot(container).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
