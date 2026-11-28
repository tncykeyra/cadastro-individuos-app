import React, { useLayoutEffect, useRef, useState } from 'react';
import Button from './ui/Button.jsx';
import { createPortal } from 'react-dom';
import './people-workspace.css';

function buttonPropsFromMarkup(button) {
  const props = {};
  const names = { class: 'className', tabindex: 'tabIndex', autofocus: 'autoFocus', formnovalidate: 'formNoValidate', formaction: 'formAction', formenctype: 'formEncType', formmethod: 'formMethod', formtarget: 'formTarget' };
  for (const attribute of [...button.attributes]) {
    const name = attribute.name;
    const key = names[name] || name;
    const value = attribute.value;
    if (['disabled', 'hidden', 'formNoValidate'].includes(key)) props[key] = true;
    else if (name === 'style') props.style = Object.fromEntries(value.split(';').map(rule => rule.trim()).filter(Boolean).map(rule => {
      const separator = rule.indexOf(':');
      return [rule.slice(0, separator).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), rule.slice(separator + 1).trim()];
    }));
    else props[key] = value;
  }
  props['data-people-react-owned'] = 'true';
  return props;
}

function collectButtons(scope, nextKey, workspace) {
  if (!scope) return [];
  const candidates = [];
  if (scope.matches?.('button:not([data-people-react-owned])')) candidates.push(scope);
  candidates.push(...(scope.querySelectorAll?.('button:not([data-people-react-owned])') || []));
  const portals = [];
  for (const button of candidates) {
    const inWorkspace = button.closest('.people-react-shell');
    const dialog = button.closest('#recordDialog');
    if (!inWorkspace && !(dialog && workspace?.isConnected)) continue;
    const mount = document.createElement('span');
    mount.className = 'people-react-button-mount';
    button.replaceWith(mount);
    portals.push({ key: nextKey(), mount, props: buttonPropsFromMarkup(button), markup: button.innerHTML });
  }
  return portals;
}

function PeopleReactContent({ contentHtml }) {
  const hostRef = useRef(null);
  const keyRef = useRef(0);
  const [portals, setPortals] = useState([]);
  const mountsRef = useRef(new Set());
  useLayoutEffect(() => {
    const host = hostRef.current;
    const mountButtons = scope => {
      const additions = collectButtons(scope, () => 'people-react-button-' + (++keyRef.current), host);
      if (additions.length) {
        additions.forEach(({ mount }) => mountsRef.current.add(mount));
        setPortals(current => [...current, ...additions]);
      }
    };
    mountButtons(host);
    mountButtons(document.getElementById('recordDialog'));
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) mountButtons(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mountsRef.current.forEach(mount => mount.remove());
      mountsRef.current.clear();
    };
  }, [contentHtml]);
  return <>
    <div ref={hostRef} className="people-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
    {portals.map(({ key, mount, props, markup }) => createPortal(
      <Button {...props} dangerouslySetInnerHTML={{ __html: markup }} />, mount, key
    ))}
  </>;
}

export default function PeopleWorkspace({ contentHtml, view = 'list' }) {
  const detail = view === 'detail';
  return <div className={'people-react-shell ' + (detail ? 'is-detail' : 'is-list')}>
    <header className="people-react-hero">
      <div className="people-react-heading">
        {detail && <span className="people-react-eyebrow">CONSULTA INDIVIDUAL</span>}
        <h1>{detail ? 'Ficha do indivíduo' : 'Indivíduos'}</h1>
        <p>{detail
          ? 'Identificação, informações complementares, vínculos e veículos associados em uma única consulta.'
          : 'Consulte e gerencie os registros individuais, com acesso organizado aos dados de identificação e aos vínculos associados.'}</p>
      </div>
      <div className="people-react-tools">
        {detail && <span className="people-react-context"><span className="people-react-context-dot" />Registro selecionado</span>}
      </div>
    </header>
    <PeopleReactContent key={contentHtml} contentHtml={contentHtml} />
  </div>;
}
