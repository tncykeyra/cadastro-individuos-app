import React, { useState } from 'react';
import Button from './ui/Button.jsx';
import './detail-actions.css';

const cpf = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : value || '—';
};

function VehiclePhotoGallery({ photos = [] }) {
  const [active, setActive] = useState(0);
  const available = photos.filter(photo => photo?.url);
  if (!available.length) return <div className="vehicle-native-photo-empty" aria-label="Veículo sem fotografia">⌑<span>Sem fotografia</span></div>;
  const current = available[Math.min(active, available.length - 1)];
  return <div className="vehicle-native-gallery">
    <div className="vehicle-native-photo-stage">
      <img src={current.url} alt={'Fotografia do veículo, imagem ' + (active + 1)} />
      {available.length > 1 && <div className="vehicle-native-photo-controls">
        <Button size="small" variant="secondary" onClick={() => setActive(index => (index - 1 + available.length) % available.length)} aria-label="Foto anterior">‹</Button>
        <span>{active + 1} / {available.length}</span>
        <Button size="small" variant="secondary" onClick={() => setActive(index => (index + 1) % available.length)} aria-label="Próxima foto">›</Button>
      </div>}
    </div>
    {available.length > 1 && <div className="vehicle-native-thumbnails">
      {available.map((photo, index) => <button key={photo.id || photo.photo_path || index} type="button" className={index === active ? 'active' : ''} onClick={() => setActive(index)} aria-label={'Abrir foto ' + (index + 1)}>
        <img src={photo.url} alt="" loading="lazy" />
      </button>)}
    </div>}
  </div>;
}

function Info({ label, value, wide = false }) {
  return <div className={'vehicle-native-info' + (wide ? ' is-wide' : '')}><span>{label}</span><strong>{value || '—'}</strong></div>;
}

export default function VehicleDetail({ vehicle, photos, links, plateSuggestion, recordId, canDelete }) {
  return <div className="vehicles-react-shell is-detail">
    <header className="vehicles-react-hero">
      <div className="vehicles-react-heading">
        <span className="vehicles-react-eyebrow">CONSULTA INDIVIDUAL</span>
        <h1>Ficha do veículo</h1>
        <p>Identificação, características, registros complementares e pessoas vinculadas em uma única consulta.</p>
      </div>
      <div className="vehicles-react-tools"><span className="vehicles-react-context"><span className="vehicles-react-context-dot"/>Registro selecionado</span></div>
    </header>
    <div className="vehicles-react-content">
    <section className="vehicle-native-detail">
    <Button variant="secondary" size="small" className="vehicle-native-back" type="button" data-back>← Voltar para veículos</Button>
    <div className="vehicle-native-identity">
      <VehiclePhotoGallery photos={photos} />
      <div className="vehicle-native-title">
        <span className="vehicle-native-eyebrow">FICHA DO VEÍCULO</span>
        <h2>{vehicle.plate || 'Placa não informada'}</h2>
        <p>{[vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(' · ') || 'Dados complementares não informados'}</p>
        <div className="vehicle-native-actions">
          <Button type="button" className="vehicle-detail-action vehicle-share-action" data-record-pdf={'vehicles:' + recordId} title="Compartilhar ficha do veículo" aria-label="Compartilhar ficha do veículo"><svg className="detail-share-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4"/></svg><span className="vehicle-action-label">Compartilhar</span></Button>
          <Button type="button" className="vehicle-detail-action vehicle-edit-action" data-edit-vehicle={recordId}>✎ Editar</Button>
          {canDelete && <Button type="button" variant="danger" className="vehicle-detail-action vehicle-delete-action" data-delete-record={'vehicles:' + recordId}>Excluir</Button>}
        </div>
      </div>
    </div>
    {plateSuggestion && <div className="vehicle-native-alert" role="status"><strong>{plateSuggestion.isAdmin ? 'Alteração de placa aguardando sua revisão' : 'Sugestão de placa enviada ao administrador'}</strong><span>Atual: {plateSuggestion.current} · Sugerida: {plateSuggestion.proposed}{plateSuggestion.isAdmin ? ' · Revise em Usuários → Sugestões de edição.' : ' · Aguardando aprovação.'}</span></div>}
    <section className="vehicle-native-section">
      <h3>Dados de identificação</h3>
      <div className="vehicle-native-info-grid">
        <Info label="Placa" value={vehicle.plate} />
        <Info label="Marca" value={vehicle.make} />
        <Info label="Modelo" value={vehicle.model} />
        <Info label="Cor" value={vehicle.color} />
        <Info label="Anotações" value={vehicle.notes} wide />
      </div>
    </section>
    <section className="vehicle-native-section">
      <div className="vehicle-native-section-heading"><div><h3>Pessoas associadas</h3><p>Vínculos registrados para este veículo.</p></div><Button type="button" className="vehicle-detail-action vehicle-associate-action" data-link-vehicle={recordId}>＋ Associar pessoa</Button></div>
      {links?.length ? <div className="vehicle-native-links">{links.map(link => <article className={'vehicle-native-link' + (!link.active ? ' is-inactive' : '')} key={link.id}>
        <button className="vehicle-native-person" type="button" data-open-person={link.people?.id}>
          <span className="vehicle-native-person-photo">{link.people?.photo_url ? <img src={link.people.photo_url} alt="" loading="lazy" /> : '♙'}</span>
          <span><strong>{link.people?.full_name || 'Pessoa não disponível'}</strong><small>CPF: {cpf(link.people?.cpf_digits)} · {({driver:'Condutor',owner:'Proprietário',associated:'Associado'})[link.relation] || 'Vínculo registrado'}{!link.active ? ' · vínculo inativo' : ''}</small></span>
        </button>
        {link.active && <Button type="button" variant="secondary" size="small" className="vehicle-native-unlink" data-unlink={link.id} title="Desativar vínculo" aria-label="Desativar vínculo">×</Button>}
      </article>)}</div> : <div className="vehicle-native-empty">Nenhuma pessoa associada.</div>}
    </section>
    </section>
    </div>
  </div>;
}
