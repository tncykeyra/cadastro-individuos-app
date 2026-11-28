import React, { useEffect, useState } from 'react';
import Button from './ui/Button.jsx';
import './RecordsList.jsx.css';

const formatCpf = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : value || '—';
};

function RecordCard({ entity, record, onOpen }) {
  const isPerson = entity === 'people';
  const title = isPerson ? record.full_name || 'Nome não informado' : record.plate || 'Placa não informada';
  const formattedCpf = formatCpf(record.cpf_digits);
  const cover = record.photos?.find(photo => photo.is_cover && photo.url) || record.photos?.find(photo => photo.url);
  const metadata = isPerson
    ? [record.alias ? 'Vulgo: ' + record.alias : null, record.rg ? 'RG: ' + record.rg : null].filter(Boolean)
    : [record.make, record.model, record.color].filter(Boolean);
  return (
    <button className={'react-record-card ' + (isPerson ? 'is-person person-card' : 'is-vehicle')} type="button" onClick={() => onOpen(record.id, entity)} aria-label={'Abrir ficha de ' + title}>
      <span className={'react-record-card-media ' + (isPerson ? 'avatar' : '')}>
        {cover?.url
          ? <img src={cover.url} alt={isPerson ? 'Foto de ' + title : 'Foto do veículo'} loading="lazy" />
          : <span aria-hidden="true">{isPerson ? '♙' : '⌑'}</span>}
      </span>
      <span className="react-record-card-copy">
        <strong>{title}</strong>
        {isPerson
          ? <><small>CPF: {formattedCpf}</small>{metadata.map((item,index)=><small key={index}>{item}</small>)}</>
          : <small>{metadata.join(' · ') || 'Dados complementares não informados'}</small>}
        {isPerson && Number(record.warrant_alert_count) > 0 && <small className="react-record-warning">⚠ Aviso de mandado. Confira na fonte oficial.</small>}
      </span>
      <span className="react-record-card-arrow" aria-hidden="true">›</span>
    </button>
  );
}

function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="react-record-pagination" aria-label="Paginação">
      <Button variant="secondary" size="small" disabled={page <= 0} onClick={() => onChange(page - 1)}>Anterior</Button>
      <span>Página {page + 1} de {pages} · {total.toLocaleString('pt-BR')} registros</span>
      <Button variant="secondary" size="small" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Próxima</Button>
    </nav>
  );
}

export default function RecordsList({
  entity, records = [], relatedRecords = [], total = 0, page = 0, pageSize = 30,
  query = '', letter = 'all', serverPaged = false, onSearch, onAdd, onExport,
  onOpen, onPageChange, onPageSizeChange, onLetterChange,
}) {
  const people = entity === 'people';
  const [searchValue, setSearchValue] = useState(query);
  useEffect(() => setSearchValue(query), [query]);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return (
    <section className="react-records-module">
      <header className="react-records-heading">
        <div>
          <span className="react-records-eyebrow">CONSULTA OPERACIONAL</span>
          <h1>{people ? 'Indivíduos' : 'Veículos'}</h1>
          <p>{people
            ? 'Localize registros por nome, CPF, RG ou endereço. Consulte a ficha completa e os vínculos.'
            : 'Localize registros por placa, modelo, pessoa ou endereço. Consulte a ficha e as pessoas associadas.'}</p>
        </div>
        <div className="react-records-actions">
          <Button variant="secondary" onClick={onExport}>Exportar planilha</Button>
          <Button onClick={onAdd}>＋ Adicionar</Button>
        </div>
      </header>

      <div className="react-records-search-wrap">
        <label className="react-records-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={searchValue}
            onChange={event => {
              const nextValue = event.target.value;
              setSearchValue(nextValue);
              if (!nextValue.trim() && query.trim()) onSearch('');
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSearch(searchValue);
              }
            }}
            placeholder={people ? 'Buscar indivíduo, endereço, CPF ou placa' : 'Buscar placa, modelo, pessoa, CPF ou endereço'}
            aria-label={people ? 'Pesquisar indivíduos' : 'Pesquisar veículos'} />
          <Button className="react-record-search-button" aria-label="Pesquisar" title="Pesquisar" onClick={() => onSearch(searchValue)}>
            <span aria-hidden="true">⌕</span><span>Pesquisar</span>
          </Button>
        </label>
        {searchValue.trim() && <p className="react-record-search-hint" role="status" aria-live="polite">
          {searchValue.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').length < 3
            ? 'Digite ao menos 3 caracteres úteis.'
            : searchValue.trim() === query.trim()
              ? 'Pesquisa concluída.'
              : 'Pressione Enter ou toque em Pesquisar para consultar.'}
        </p>}
      </div>

      <div className="react-records-toolbar">
        {people && <div className="react-record-letters" aria-label="Filtrar por inicial">
          <Button size="small" variant={letter === 'all' ? 'primary' : 'secondary'} onClick={() => onLetterChange('all')}>Todas</Button>
          {letters.map(item => <Button key={item} size="small" variant={letter === item ? 'primary' : 'secondary'} onClick={() => onLetterChange(item)}>{item}</Button>)}
        </div>}
        <label className="react-record-page-size">Exibir
          <select value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value))}>
            {[15, 30, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
          por página
        </label>
      </div>

      <div className="react-record-results" aria-live="polite">
        <div className="react-record-results-heading">
          <strong>{people ? 'Indivíduos encontrados' : 'Veículos encontrados'}</strong>
          <span>{total.toLocaleString('pt-BR')} registro(s)</span>
        </div>
        {records.length
          ? <div className="react-record-grid">{records.map(record => <RecordCard key={record.id} entity={entity} record={record} onOpen={onOpen} />)}</div>
          : <div className="react-record-empty"><strong>Nenhum registro encontrado</strong><span>Confira os termos da pesquisa ou tente novamente.</span></div>}
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onChange={onPageChange} />

      {relatedRecords.length > 0 && <section className="react-related-records">
        <h2>{people ? 'Veículos relacionados à pesquisa' : 'Indivíduos relacionados à pesquisa'}</h2>
        <div className="react-record-grid">{relatedRecords.map(record => <RecordCard key={record.id} entity={people ? 'vehicles' : 'people'} record={record} onOpen={onOpen} />)}</div>
      </section>}
    </section>
  );
}
