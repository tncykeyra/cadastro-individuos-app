import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './react.css';

const rootElement = document.getElementById('react-root');
if (!rootElement) {
  throw new Error('Elemento #react-root não encontrado.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
