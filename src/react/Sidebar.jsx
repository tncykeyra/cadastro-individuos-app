import React from 'react';
import Button from './ui/Button.jsx';
import { createRoot } from 'react-dom/client';
import './sidebar.css';

function IconMarkup({ html }) {
  return <span className="react-sidebar-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html || '•' }} />;
}

function Sidebar({ items = [], cities = [], activeCityId, activeCityName, showTour, onCityChange }) {
  return <>
    {cities.length > 1 && <div className="react-sidebar-city-switcher">
      <label htmlFor="reactCitySwitcher">Cidade de trabalho</label>
      <select id="reactCitySwitcher" value={activeCityId || ''} onChange={event => onCityChange?.(event.target.value)}>
        {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
      </select>
    </div>}
    {activeCityName && <div className="react-sidebar-city-label"><small>Cidade de acesso</small><strong>{activeCityName}</strong></div>}
    <div className="react-sidebar-section-label">MENU PRINCIPAL</div>
    <div className="react-sidebar-items">
      {items.map((item, index) => <Button key={item.id} className={'nav-item react-sidebar-item' + (item.active ? ' active' : '')} type="button" data-page={item.id} style={{'--sidebar-index': index}}>
        <IconMarkup html={item.iconHtml}/>
        <span className="react-sidebar-item-label">{item.name}</span>
        {item.showAlert && <span className="nav-alert-badge" aria-label={item.alertLabel + ': ' + item.alertCount} title={item.alertLabel}>{item.alertCount > 99 ? '99+' : item.alertCount}</span>}
        <span className="react-sidebar-item-arrow" aria-hidden="true">›</span>
      </Button>)}
    </div>
    {showTour && <div className="react-sidebar-footer"><Button className="nav-item tour-nav-item react-sidebar-item" type="button" data-open-operator-tour aria-label="Como usar o aplicativo"><span className="react-sidebar-help" aria-hidden="true">?</span><span className="react-sidebar-item-label">Como usar</span><span className="react-sidebar-item-arrow" aria-hidden="true">›</span></Button></div>}
  </>;
}

let sidebarRoot;
export function renderSidebar(element, props) {
  if (!element) return;
  if (!sidebarRoot) sidebarRoot = createRoot(element);
  sidebarRoot.render(<Sidebar {...props} items={props.items.map(item => ({...item, active: item.active ?? (props.page === item.id)}))}/>);
}
