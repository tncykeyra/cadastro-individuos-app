import React, { useEffect, useRef } from 'react';

export default function IdentitySuggestionAlert({ count = 0, onClose, onNavigate }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (count > 0 && dialog && !dialog.open) dialog.showModal();
  }, [count]);
  if (!count) return null;
  const close = () => dialogRef.current?.close();
  const quantity = Number(count).toLocaleString('pt-BR');
  return (
    <dialog ref={dialogRef} className="identity-suggestion-alert-dialog" aria-labelledby="identitySuggestionAlertTitle" onClose={onClose} onClick={event => { if (event.target === dialogRef.current) close(); }}>
      <section className="identity-suggestion-alert-card">
        <button className="identity-suggestion-alert-close" type="button" onClick={close} aria-label="Fechar aviso">×</button>
        <span className="identity-suggestion-alert-icon" aria-hidden="true">!</span>
        <p className="identity-suggestion-alert-eyebrow">REVISÃO ADMINISTRATIVA</p>
        <h2 id="identitySuggestionAlertTitle">{count === 1 ? 'Sugestão de alteração aguardando' : 'Sugestões de alteração aguardando'}</h2>
        <p className="identity-suggestion-alert-copy">Há {quantity} {count === 1 ? 'sugestão' : 'sugestões'} de nome ou CPF aguardando revisão. Confira os dados apresentados e aprove ou rejeite cada alteração. Nenhuma informação será modificada antes da sua decisão.</p>
        <div className="identity-suggestion-alert-actions">
          <button className="button secondary" type="button" onClick={close}>Agora não</button>
          <button className="button" type="button" onClick={() => { onNavigate?.(); close(); }}>Ver sugestões</button>
        </div>
      </section>
    </dialog>
  );
}
