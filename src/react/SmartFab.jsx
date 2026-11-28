import React from 'react';

export default function SmartFab({ visible = true, kind = 'person' }) {
  if (!visible) return null;
  return (
    <button
      className="smart-fab"
      type="button"
      data-page="smart"
      data-smart-page-kind={kind === 'vehicle' ? 'vehicle' : 'person'}
      aria-label="Abrir cadastro inteligente"
    >
      <span aria-hidden="true">✨</span>
      <span>Cadastro inteligente</span>
    </button>
  );
}
