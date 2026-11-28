import React, { useState } from 'react';
import Button from './ui/Button.jsx';
import './detail-actions.css';

const cpf = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : value || '—';
};
const date = value => value ? new Date(value + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

function Gallery({ photos = [] }) {
  const available = photos.filter(photo => photo?.url);
  const cover = Math.max(0, available.findIndex(photo => photo.is_cover));
  const [active, setActive] = useState(cover);
  if (!available.length) return <div className="photo-empty">Nenhuma foto cadastrada.</div>;
  const current = available[Math.min(active, available.length - 1)];
  return <section className="record-gallery record-gallery-detail portrait-gallery">
    <div className="carousel-stage">
      <button type="button" className="carousel-main" data-photo-zoom={current.url} aria-label="Ampliar foto do indivíduo">
        <img src={current.url} alt={'Foto do indivíduo ' + (active + 1)} style={{objectFit:'cover',objectPosition:current.crop_position || '50% 20%'}} />
        <span className="carousel-count">{active + 1} / {available.length}</span>
      </button>
      {available.length > 1 && <>
        <button type="button" className="carousel-arrow carousel-previous" onClick={() => setActive(i => (i - 1 + available.length) % available.length)} aria-label="Foto anterior">‹</button>
        <button type="button" className="carousel-arrow carousel-next" onClick={() => setActive(i => (i + 1) % available.length)} aria-label="Próxima foto">›</button>
      </>}
    </div>
    {available.length > 1 && <div className="carousel-thumbnails" aria-label="Galeria de fotos">
      {available.map((photo,index)=><button type="button" key={photo.id || photo.photo_path || index} className={'carousel-thumb '+(index===active?'active':'')} onClick={()=>setActive(index)} aria-label={'Mostrar foto '+(index+1)}>
        <img src={photo.url} alt={'Miniatura '+(index+1)} loading="lazy"/><span>{photo.is_cover?'Capa':index+1}</span>
      </button>)}
    </div>}
  </section>;
}

function Info({label,value,wide=false,copy}) {
  if (value === null || value === undefined || value === '') return null;
  return <section className={'info-box'+(wide?' wide':'')}>
    <div className={'info-label'+(copy?' info-label-copy':'')}><span>{label}</span>{copy && <button type="button" className="copy-info-button" data-copy-info={copy} data-copy-label={label} title={'Copiar '+label} aria-label={'Copiar '+label}>⧉</button>}</div>
    <div className="info-value">{value}</div>
  </section>;
}

export default function PersonDetail({person,photos=[],vehicles=[],canDelete=false,identityHtml='',warrantHtml='',crossCityHtml='',relationshipsHtml='',onShare}) {
  const [sharing,setSharing] = useState(false);
  const sharePerson = async () => {
    if (sharing || typeof onShare !== 'function') return;
    setSharing(true);
    try { await onShare(person.id); }
    finally { setSharing(false); }
  };
  const name = person?.full_name || 'Nome não informado';
  const addresses = [person?.address_primary,person?.address_secondary,...(Array.isArray(person?.additional_addresses)?person.additional_addresses:[])].map(value=>String(value||'').trim()).filter(Boolean);
  return <div className="people-react-shell is-detail">
    <header className="people-react-hero">
      <div className="people-react-heading">
        <span className="people-react-eyebrow">CONSULTA INDIVIDUAL</span>
        <h1>Ficha do indivíduo</h1>
        <p>Identificação, informações complementares, vínculos e veículos associados em uma única consulta.</p>
      </div>
      <div className="people-react-tools"><span className="people-react-context"><span className="people-react-context-dot"/>Registro selecionado</span></div>
    </header>
    <div className="people-react-content">
      <section className="person-native-detail">
        <Button variant="secondary" size="small" type="button" data-back>← Voltar para indivíduos</Button>
        <div className="detail-hero">
          <div><Gallery photos={photos}/></div>
          <div>
            <div className="detail-title">
              <div className="detail-name-copy">
                <h1>{name}</h1>
                <button className="copy-info-button" type="button" data-copy-info={name} data-copy-label="Nome" title="Copiar nome" aria-label="Copiar nome">⧉</button>
              </div>
              <div className="detail-actions">
                <Button size="small" className="people-share-button" type="button" onClick={sharePerson} disabled={sharing} aria-busy={sharing} title="Compartilhar ficha do indivíduo" aria-label="Compartilhar ficha do indivíduo"><svg className="detail-share-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4"/></svg><span className="people-share-button-label">Compartilhar</span></Button>
                <Button type="button" data-edit-person={person.id}>✎ Editar</Button>
                {canDelete && <Button variant="danger" type="button" data-delete-record={'people:'+person.id}>Excluir</Button>}
              </div>
            </div>
            <p className="muted">Registro criado em {person.created_at ? new Date(person.created_at).toLocaleDateString('pt-BR') : '—'}</p>
            {identityHtml && <div dangerouslySetInnerHTML={{__html:identityHtml}}/>}
          </div>
        </div>
        {warrantHtml && <div dangerouslySetInnerHTML={{__html:warrantHtml}}/>}
        {crossCityHtml && <div dangerouslySetInnerHTML={{__html:crossCityHtml}}/>}
        <div className="detail-sections">
          <Info label="CPF" value={person.cpf_digits?cpf(person.cpf_digits):'—'} copy={person.cpf_digits}/>
          <Info label="RG" value={person.rg} copy={person.rg}/>
          <Info label="Matrícula" value={person.registration}/>
          <Info label="Apelido/Vulgo" value={person.alias}/>
          <Info label="Aniversário" value={date(person.birthday)}/>
          {addresses.map((address,index)=><Info key={index} label={'Endereço '+(index+1)} value={<a href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address)} target="_blank" rel="noopener noreferrer">{address} ↗</a>} wide/>)}
          <Info label="Anotações" value={person.notes} wide/>
          <Info label="Crimes" value={person.occurrence_notes} wide/>
          <Info label="Referência da ocorrência" value={person.occurrence_reference} wide/>
        </div>
        {relationshipsHtml && <div dangerouslySetInnerHTML={{__html:relationshipsHtml}}/>}
        <section className="person-relationships vehicle-relationships">
          <div className="section-heading association-section-heading">
            <h2>Veículos associados</h2>
            <Button size="small" type="button" data-link-person={person.id}>＋ Associar veículo</Button>
          </div>
          <div className="list">
            {vehicles.length ? vehicles.map(link=><div className={'list-row'+(!link.active?' inactive':'')} key={link.id} data-open-vehicle={link.vehicles?.id}>
              <div className="vehicle-thumb">{link.vehicles?.photo_url?<img className="linked-vehicle-photo" src={link.vehicles.photo_url} loading="lazy" decoding="async" alt={'Foto do veículo '+(link.vehicles.plate||'')}/>:<span aria-hidden="true">▰</span>}</div>
              <div><div className="row-title">{link.vehicles?.plate||'Veículo removido'}</div><div className="row-subtitle">{[link.vehicles?.make,link.vehicles?.model,link.vehicles?.color].filter(Boolean).join(' · ')}{link.active?'':' · inativo'}</div></div>
              {link.active && <Button variant="secondary" size="small" type="button" className="more-button" data-unlink={link.id} title="Desativar vínculo" aria-label="Desativar vínculo">×</Button>}
            </div>) : <div className="empty">Nenhum veículo associado.</div>}
          </div>
        </section>
      </section>
    </div>
  </div>;
}
