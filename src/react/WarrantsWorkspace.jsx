import React, { useLayoutEffect, useRef, useState } from 'react';
import Button from './ui/Button.jsx';
import { createPortal } from 'react-dom';
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

function collectWarrantButtons(scope, nextKey) {
  if (!scope) return [];
  const candidates = [];
  if (scope.matches?.('button:not([data-warrants-react-owned])')) candidates.push(scope);
  candidates.push(...scope.querySelectorAll?.('button:not([data-warrants-react-owned])') || []);
  const portals = [];
  for (const button of candidates) {
    const workspace = button.closest('.warrants-react-shell');
    const dialog = button.closest('#recordDialog');
    const warrantDialog = dialog?.querySelector('form[id^="warrant"], [class*="warrant"], [data-warrant-id]');
    if (!workspace && !warrantDialog) continue;
    const props = buttonPropsFromMarkup(button);
    const markup = button.innerHTML;
    const mount = document.createElement('span');
    mount.className = 'warrants-react-button-mount';
    button.replaceWith(mount);
    portals.push({ key: nextKey(), mount, props, markup });
  }
  return portals;
}

function WarrantsReactContent({ contentHtml }) {
  const hostRef = useRef(null);
  const keyRef = useRef(0);
  const [buttonPortals, setButtonPortals] = useState([]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const mountButtons = scope => {
      const additions = collectWarrantButtons(scope, () => 'warrant-react-button-' + (++keyRef.current));
      if (additions.length) setButtonPortals(current => [...current, ...additions]);
    };
    mountButtons(host);
    mountButtons(document.getElementById('recordDialog'));

    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) mountButtons(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [contentHtml]);

  return <>
    <div ref={hostRef} className="warrants-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
    {buttonPortals.map(({ key, mount, props, markup }) => createPortal(
      <Button {...props} dangerouslySetInnerHTML={{ __html: markup }} />,
      mount,
      key
    ))}
  </>;
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
        <Button className="warrants-react-switch" type="button" onClick={onSwitchClassic}>Voltar à interface clássica</Button>
      </div>
    </header>

    <section className="warrants-react-metrics" aria-label="Resumo dos mandados">
      <Metric label="Registros exibidos" value={stats?.total} detail="Conforme seu perfil de acesso" />
      <Metric label="Pendentes" value={stats?.active} detail="Situação registrada no sistema" />
      <Metric label="Baixa informada" value={stats?.reported} detail="Aguardando confirmação administrativa" />
      <Metric label="Baixados ou encerrados" value={stats?.closed} detail="Não contabilizados como ativos" />
    </section>

    <WarrantsReactContent key={contentHtml} contentHtml={contentHtml} />
    <footer className="warrants-react-footnote">Os indicadores refletem os registros disponíveis nesta sessão. Confirme a situação jurídica na fonte oficial antes de qualquer providência.</footer>
  </div>;
}
