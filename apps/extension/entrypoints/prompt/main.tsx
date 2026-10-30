import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/app.css';
import { PromptApp } from './PromptApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PromptApp />
  </StrictMode>,
);
