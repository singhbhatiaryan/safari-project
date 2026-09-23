import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Options } from './Options';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing in options.html');

createRoot(container).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
