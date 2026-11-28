import React from 'react';

const STORAGE_KEY = 'cadastro-criminal-card-density-v1';

export function getCardDensity() {
  try { return localStorage.getItem(STORAGE_KEY) === 'compact' ? 'compact' : 'large'; }
  catch { return 'large'; }
}

export default function CardDensityControl() {
  const selected = getCardDensity();
  return (
    <div className="card-density-control" role="group" aria-label="Modo de visualização dos cartões">
      <span className="card-density-label">Visualização</span>
      <button className="card-density-option" type="button" data-card-density="large" aria-label="Cards grandes" aria-pressed={String(selected === 'large')} title="Cards grandes">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg><span>Grandes</span>
      </button>
      <button className="card-density-option" type="button" data-card-density="compact" aria-label="Miniaturas" aria-pressed={String(selected === 'compact')} title="Miniaturas">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1.5"/><path d="M13 5h8M13 8h8M3 15h7v5H3zM13 15h8M13 18h8"/></svg><span>Miniaturas</span>
      </button>
    </div>
  );
}
