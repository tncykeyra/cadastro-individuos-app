import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './toast.css';

let root = null;
let nextToastId = 0;

function ToastItem({ item, onDismiss }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.id), 2800);
    return () => window.clearTimeout(timer);
  }, [item.id, onDismiss]);

  return <div className="react-toast-item" role="status">{item.message}</div>;
}

function ToastViewport() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const handleToast = (event) => {
      const message = String(event.detail?.message ?? '').trim();
      if (!message) return;
      const item = { id: ++nextToastId, message };
      setItems(current => [...current.slice(-2), item]);
    };
    window.addEventListener('app:toast', handleToast);
    return () => window.removeEventListener('app:toast', handleToast);
  }, []);

  const dismiss = (id) => setItems(current => current.filter(item => item.id !== id));

  return <div className="react-toast-stack" aria-live="polite" aria-relevant="additions text">
    {items.map(item => <ToastItem key={item.id} item={item} onDismiss={dismiss} />)}
  </div>;
}

export function mountToastViewport(host) {
  if (!host) return;
  host.classList.remove('toast', 'show');
  host.classList.add('react-toast-host');
  if (!root) root = createRoot(host);
  root.render(<ToastViewport />);
}
