import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/globals.css';
import { InstallerApp } from './InstallerApp';

// The installer is dark-only by design. Set the class before paint so Tailwind
// tokens resolve to the same palette used by the app in dark mode.
document.documentElement.classList.add('dark');
document.documentElement.classList.remove('light');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <InstallerApp />
  </React.StrictMode>,
);
