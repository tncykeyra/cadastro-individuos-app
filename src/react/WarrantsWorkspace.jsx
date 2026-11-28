import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './warrants-workspace.css';

const format = value => Number(value || 0).toLocaleString('pt-BR');

function Metric({ label, value, detail }) {
  return <article className="warrants-react-metric">
    <span>{label}</span>
    <strong>{format(value)}</strong>
    <small>{detail}</small>
  </article>;
}


function buttonPropsFromMarkup(button) {
  const props = {};
  const propertyNames = {
    class: 'className',
    tabindex: 'tabIndex',
    autofocus: 'autoFocus',
    formnovalidate: 'formNoValidate',
    formaction: 'formAction',
    formenctype: 'formEncType',
    formmethod: 'formMethod',
    formtarget: 'formTarget'
  };
  for (const attribute of [...button.attributes]) {
    const name = attribute.name;
    const value = attribute.value;
    const property = propertyNames[name] || name;
    if (['disabled', 'hidden', 'formNoValidate'].includes(property)) props[property] = true;
    else if (name === 'style') {
      props.style = Object.fromEntries(value.split(';').map(rule => rule.trim()).filter(Boolean).map(rule => {
        const separator = rule.indexOf(':');
        const key = rule.slice(0, separator).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return [key, rule.slice(separator + 1).trim()];
      }));
    } else props[property] = value;
  }
  props['data-warrants-react-owned'] = 'true';
  return props;
}

function mountWarrantButtons(scope, roots) {
  if (!scope) return;
  const candidates = [];
  if (scope.matches?.('button:not([data-warrants-react-owned])')) candidates.push(scope);
  candidates.push(...scope.querySelectorAll?.('button:not([data-warrants-react-owned])') || []);
  for (const button of candidates) {
    const workspace = button.closest('.warrants-react-shell');
    const dialog = button.closest('#recordDialog');
    const warrantDialog = dialog?.querySelector('.warrant-form, .warrant-summary, [data-warrant-id]');
    if (!workspace && !warrantDialog) continue;
    const props = buttonPropsFromMarkup(button);
    const markup = button.innerHTML;
    const mount = document.createElement('span');
    mount.className = 'warrants-react-button-mount';
    button.replaceWith(mount);
    const root = createRoot(mount);
    flushSync(() => root.render(
      <button {...props} dangerouslySetInnerHTML={{ __html: markup }} />
    ));
    roots.add(root);
  }
}

function WarrantsReactContent({ contentHtml }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const roots = new Set();
    const host = hostRef.current;
    const dialog = document.getElementById('recordDialog');
    mountWarrantButtons(host, roots);
    mountWarrantButtons(dialog, roots);

    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) mountWarrantButtons(node, roots);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const root of roots) root.unmount();
      roots.clear();
    };
  }, [contentHtml]);
  return <div ref={hostRef} className="warrants-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />;
}

export default function WarrantsWorkspace({ contentHtml, stats, admin, onSwitchClassic }) {
  return <div className="warrants-react-shell">
    <header className="warrants-react-hero">
      <div>
        <span className="warrants-react-eyebrow">GESTÃO DE ORDENS JUDICIAIS</span>
        <h1>Mandados de prisão</h1>
        <p>Consulta, inclusão e revisão administrativa em uma área única. Confira a situação de cada registro na fonte oficial.</p>
      </div>
      <div className="warrants-react-hero-side">
        <span className="warrants-react-role">{admin ? 'Área administrativa' : 'Consulta operacional'}</span>
        <button className="warrants-react-switch" type="button" onClick={onSwitchClassic}>Voltar à interface clássica</button>
      </div>
    </header>

    <section className="warrants-react-metrics" aria-label="Resumo dos mandados">
      <Metric label="Registros exibidos" value={stats?.total} detail="Conforme seu perfil de acesso" />
      <Metric label="Pendentes" value={stats?.active} detail="Situação registrada no sistema" />
      <Metric label="Baixa informada" value={stats?.reported} detail="Aguardando confirmação administrativa" />
      <Metric label="Baixados ou encerrados" value={stats?.closed} detail="Não contabilizados como ativos" />
    </section>

    <WarrantsReactContent contentHtml={contentHtml} />
    <footer className="warrants-react-footnote">Os indicadores refletem os registros disponíveis nesta sessão. Confirme a situação jurídica na fonte oficial antes de qualquer providência.</footer>
  </div>;
}
