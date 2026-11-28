import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from './ui/Button.jsx';
import './legacy-page-workspace.css';

function readButtonProps(button) {
  const props = {};
  const names = {
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
    const key = names[name] || name;
    if (['disabled', 'hidden', 'formNoValidate'].includes(key)) props[key] = true;
    else if (name === 'style') {
      props.style = Object.fromEntries(attribute.value.split(';').map(rule => rule.trim()).filter(Boolean).map(rule => {
        const separator = rule.indexOf(':');
        const cssName = rule.slice(0, separator).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return [cssName, rule.slice(separator + 1).trim()];
      }));
    } else props[key] = attribute.value;
  }
  props['data-react-bridge-owned'] = 'true';
  return props;
}

export default function LegacyPageWorkspace({ contentHtml, pageTitle }) {
  const hostRef = useRef(null);
  const keyRef = useRef(0);
  const [portals, setPortals] = useState([]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const mounts = new WeakSet();
    const mountButtons = scope => {
      if (!scope) return;
      const buttons = [];
      if (scope.matches?.('button:not([data-react-bridge-owned])')) buttons.push(scope);
      buttons.push(...(scope.querySelectorAll?.('button:not([data-react-bridge-owned])') || []));
      const additions = [];
      for (const button of buttons) {
        if (mounts.has(button)) continue;
        mounts.add(button);
        const props = readButtonProps(button);
        const markup = button.innerHTML;
        const mount = document.createElement('span');
        mount.className = 'legacy-react-button-mount';
        button.replaceWith(mount);
        additions.push({ key: 'legacy-react-button-' + (++keyRef.current), mount, props, markup });
      }
      if (additions.length) setPortals(current => [...current, ...additions]);
    };

    mountButtons(host);
    const dialog = document.getElementById('recordDialog');
    mountButtons(dialog);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (host.contains(node) || node === host || dialog?.contains(node) || node === dialog) mountButtons(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [contentHtml]);

  const isAuthentication = /auth-wrap|auth-card|firstAccessForm|googleLogin/.test(contentHtml);
  return <div className="legacy-react-workspace" data-react-workspace="true" data-page-title={pageTitle || ''}>
    {!isAuthentication && <div className="legacy-react-workspace-indicator" aria-hidden="true"><span/>Interface integrada ao React</div>}
    <div ref={hostRef} className="legacy-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
    {portals.map(({ key, mount, props, markup }) => <React.Fragment key={key}>
      {createPortal(<Button {...props} dangerouslySetInnerHTML={{ __html: markup }} />, mount, key)}
    </React.Fragment>)}
  </div>;
}
