import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initI18n } from './lib/i18n';
import './lib/polyfills';
import './styles/globals.css';

void initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
