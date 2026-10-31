import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/app.css';
import { PromptApp } from './PromptApp';

// Shown inside a page as a modal: no scrollbars of its own (content still scrolls).
if (new URLSearchParams(location.search).get('embed') === '1')
  document.documentElement.classList.add('embed');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PromptApp />
  </StrictMode>,
);
