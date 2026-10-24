import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { installGlassLight } from './components/glassLight';
import './styles.css';
import './liquid-glass.css';
import './midnight.css';

installGlassLight();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// The first screen fades in once it has rendered, instead of popping in piece by piece.
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('ready')));
