import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/app.css';
import { UnlockFrame } from './UnlockFrame';

document.documentElement.classList.add('embed');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UnlockFrame />
  </StrictMode>,
);
