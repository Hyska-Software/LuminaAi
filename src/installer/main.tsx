import React from 'react';
import ReactDOM from 'react-dom/client';
import '../lib/polyfills';
import '../styles/globals.css';
import { initI18n } from '@/lib/i18n';
import { InstallerApp } from './InstallerApp';

// The installer is dark-only by design. Set the class before paint so Tailwind
// tokens resolve to the same palette used by the app in dark mode.
document.documentElement.classList.add('dark');
document.documentElement.classList.remove('light');

// The setup window always starts in English and ignores the app's cached
// locale; the user can switch languages from the installer header.
void initI18n({ initial: 'en', useCache: false }).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <InstallerApp />
    </React.StrictMode>,
  );
});
