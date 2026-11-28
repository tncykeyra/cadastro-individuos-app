import React from 'react';

// Converts the existing form template into React elements. The resulting controls
// are real React-rendered DOM nodes, so the established form listeners and data-*
// integrations can continue to run while each field is migrated to stateful JSX.
const BOOLEAN_ATTRIBUTES = new Set([
  'disabled','hidden','multiple','required','checked','readonly','autofocus',
  'controls','autoplay','muted','loop','open','novalidate','formnovalidate',
  'allowfullscreen','playsinline','selected'
]);
const ATTRIBUTE_NAMES = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', maxlength: 'maxLength',
  minlength: 'minLength', readonly: 'readOnly', autofocus: 'autoFocus',
  autocomplete: 'autoComplete', formnovalidate: 'formNoValidate',
  contenteditable: 'contentEditable', crossorigin: 'crossOrigin',
  colspan: 'colSpan', rowspan: 'rowSpan', cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing', usemap: 'useMap', datetime: 'dateTime',
  srcset: 'srcSet', referrerpolicy: 'referrerPolicy', playsinline: 'playsInline',
  'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin', 'fill-rule': 'fillRule',
  'clip-rule': 'clipRule', 'clip-path': 'clipPath', 'viewbox': 'viewBox',
  'preserveaspectratio': 'preserveAspectRatio', 'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity'
};
const VOID_ELEMENTS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

function styleObject(value) {
  return Object.fromEntries(String(value).split(';').map(rule => rule.trim()).filter(Boolean).map(rule => {
    const index = rule.indexOf(':');
    if (index < 0) return null;
    const key = rule.slice(0, index).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return [key, rule.slice(index + 1).trim()];
  }).filter(Boolean));
}

function nodeToElement(node, key) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const tag = node.localName;
  const props = { key };
  for (const attribute of [...node.attributes]) {
    const name = attribute.name.toLowerCase();
    if (name === 'value' && tag === 'input') {
      props.defaultValue = attribute.value;
      continue;
    }
    if (name === 'checked' && tag === 'input') {
      props.defaultChecked = true;
      continue;
    }
    if (name === 'selected' && tag === 'option') continue;
    if (name === 'style') {
      props.style = styleObject(attribute.value);
      continue;
    }
    const property = ATTRIBUTE_NAMES[name] || attribute.name;
    if (BOOLEAN_ATTRIBUTES.has(name)) props[property === 'checked' ? 'defaultChecked' : property] = true;
    else props[property] = attribute.value;
  }

  let children = [...node.childNodes].map((child, index) => nodeToElement(child, index)).filter(child => child !== null);
  if (tag === 'textarea') {
    props.defaultValue = node.textContent || '';
    children = [];
  }
  if (tag === 'select') {
    const selected = [...node.options].filter(option => option.hasAttribute('selected')).map(option => option.value);
    if (selected.length) props.defaultValue = node.multiple ? selected : selected[0];
  }
  if (VOID_ELEMENTS.has(tag)) return React.createElement(tag, props);
  return React.createElement(tag, props, ...children);
}

export function markupToReactNodes(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup || '');
  return [...template.content.childNodes].map((node, index) => nodeToElement(node, index)).filter(node => node !== null);
}
