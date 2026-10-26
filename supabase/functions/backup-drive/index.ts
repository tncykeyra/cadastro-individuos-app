import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { contentHmacTag, encryptAesGcm } from './crypto.ts';

const APP_URL = 'https://tncykeyra.github.io/cadastro-individuos-app/';
const DRIVE_REDIRECT = 'https://etvxrzjtnhuefxeirkxf.supabase.co/functions/v1/backup-drive/oauth/callback';
const BUCKET = 'people-photos';
const ENTITIES = ['people','vehicles','person_vehicle_links','record_photos','person_photos','vehicle_photos','record_revisions','audit_events','authorized_emails','profiles'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-backup-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const utf8 = (value: string) => new TextEncoder().encode(value);
const fromB64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const toB64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const safeCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 48) || 'BACKUP_FAILED';
const getEnv = (name: string) => Deno.env.get(name) || '';

function serviceClient() {
  const url = getEnv('SUPABASE_URL'), key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('BACKUP_NOT_CONFIGURED');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function requireAdmin(request: Request) {
  const url = getEnv('SUPABASE_URL'), anon = getEnv('SUPABASE_ANON_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anon || !authorization) throw new Error('SESSION_REQUIRED');
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) throw new Error('SESSION_INVALID');
  const admin = serviceClient();
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');
  return { admin, user };
}
async function secret(admin: ReturnType<typeof serviceClient>, name: string) {
  const { data, error } = await admin.rpc('backup_secret_get', { p_name: name });
  if (error) throw new Error('BACKUP_SCHEMA_NOT_READY');
  return typeof data === 'string' ? data : '';
}
async function saveSecret(admin: ReturnType<typeof serviceClient>, name: string, value: string) {
  const { error } = await admin.rpc('backup_secret_set', { p_name: name, p_secret: value });
  if (error) throw new Error('BACKUP_SECRET_SAVE_FAILED');
}
async function googleClient(admin: ReturnType<typeof serviceClient>) {
  const clientId = await secret(admin, 'google_client_id');
  const clientSecret = await secret(admin, 'google_client_secret');
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_NOT_CONFIGURED');
  return { clientId, clientSecret };
}
async function getAccessToken(admin: ReturnType<typeof serviceClient>) {
  const { clientId, clientSecret } = await googleClient(admin);
  const refreshToken = await secret(admin, 'google_refresh_token');
  if (!refreshToken) throw new Error('GOOGLE_DRIVE_NOT_CONNECTED');
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!response.ok) throw new Error('GOOGLE_TOKEN_REFRESH_FAILED');
  const result = await response.json();
  if (result.refresh_token) await saveSecret(admin, 'google_refresh_token', result.refresh_token);
  if (!result.access_token) throw new Error('GOOGLE_TOKEN_REFRESH_FAILED');
  return String(result.access_token);
}
async function driveRequest(accessToken: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: 'Bearer ' + accessToken },
  });
  if (!response.ok) throw new Error('GOOGLE_DRIVE_REQUEST_FAILED');
  return response;
}
async function ensureDriveFolder(admin: ReturnType<typeof serviceClient>, accessToken: string) {
  let folderId = await secret(admin, 'google_drive_folder_id');
  if (folderId) return folderId;
  const response = await driveRequest(accessToken,
    'https://www.googleapis.com/drive/v3/files?fields=id,name',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cadastro Criminal - Backups Criptografados', mimeType: 'application/vnd.google-apps.folder' }),
    });
  const folder = await response.json();
  if (!folder.id) throw new Error('GOOGLE_DRIVE_FOLDER_CREATE_FAILED');
  folderId = String(folder.id);
  await saveSecret(admin, 'google_drive_folder_id', folderId);
  return folderId;
}
async function driveUpload(accessToken: string, folderId: string, filename: string, bytes: Uint8Array) {
  const boundary = 'ccbackup' + crypto.randomUUID().replaceAll('-', '');
  const metadata = JSON.stringify({
    name: filename, mimeType: 'application/octet-stream', parents: [folderId],
    appProperties: { app: 'cadastro-criminal', encrypted: 'true' },
  });
  const pre = utf8('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata +
    '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n');
  const post = utf8('\r\n--' + boundary + '--');
  const body = new Uint8Array(pre.length + bytes.length + post.length);
  body.set(pre, 0); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
  const response = await driveRequest(accessToken,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    { method: 'POST', headers: { 'content-type': 'multipart/related; boundary=' + boundary }, body });
  const result = await response.json();
  if (!result.id) throw new Error('GOOGLE_DRIVE_UPLOAD_FAILED');
  return String(result.id);
}
async function ensureEncryptionKey(admin: ReturnType<typeof serviceClient>) {
  let keyText = await secret(admin, 'backup_crypto_key');
  if (!keyText) {
    keyText = toB64(crypto.getRandomValues(new Uint8Array(32)));
    await saveSecret(admin, 'backup_crypto_key', keyText);
  }
  const raw = fromB64(keyText);
  if (raw.length !== 32) throw new Error('BACKUP_KEY_INVALID');
  return raw;
}
async function encrypted(admin: ReturnType<typeof serviceClient>, bytes: Uint8Array) {
  const raw = await ensureEncryptionKey(admin);
  return await encryptAesGcm(bytes, raw, 'cadastro-criminal-backup-v1', 'CCBK1');
}
async function createRecoveryEnvelope(admin: ReturnType<typeof serviceClient>, accessToken: string, folderId: string, recoveryKey: string) {
  const master = await ensureEncryptionKey(admin);
  const recovery = fromB64(recoveryKey);
  if (recovery.length !== 32) throw new Error('RECOVERY_KEY_INVALID');
  const payload = await encryptAesGcm(master, recovery, 'cadastro-criminal-key-envelope-v1', 'CCKR1');
  return await driveUpload(accessToken, folderId, 'recovery-key-envelope.ccr.enc', payload);
}
async function contentTag(admin: ReturnType<typeof serviceClient>, bytes: Uint8Array) {
  const raw = await ensureEncryptionKey(admin);
  return await contentHmacTag(raw, bytes);
}
async function createRun(admin: ReturnType<typeof serviceClient>, createdBy: string | null, triggerType: 'manual' | 'scheduled') {
  await ensureEncryptionKey(admin);
  const { data: active, error: activeError } = await admin.from('backup_runs').select('id,status')
    .in('status', ['queued','running']).order('created_at').limit(1).maybeSingle();
  if (activeError) throw new Error('BACKUP_SCHEMA_NOT_READY');
  if (active) return { id: active.id, alreadyRunning: true, scheduleActive: true };
  const { data: run, error } = await admin.from('backup_runs')
    .insert({ trigger_type: triggerType, created_by: createdBy, status: 'queued' })
    .select('id').single();
  if (error || !run) throw new Error('BACKUP_RUN_CREATE_FAILED');
  const { data: counts, error: snapshotError } = await admin.rpc('backup_capture_snapshot', { p_run_id: run.id });
  if (snapshotError) {
    await admin.from('backup_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_code: 'SNAPSHOT_FAILED' }).eq('id', run.id);
    throw new Error('BACKUP_SNAPSHOT_FAILED');
  }
  await admin.from('backup_runs').update({
    status: 'running', started_at: new Date().toISOString(), current_entity: ENTITIES[0],
    progress: { entity_index: 0, entity_counts: counts || {}, storage_count: null, storage_completed: 0 },
  }).eq('id', run.id);
  const { error: scheduleError } = await admin.rpc('backup_configure_schedule');
  return { id: run.id, alreadyRunning: false, scheduleActive: !scheduleError };
}
async function startFromCron(admin: ReturnType<typeof serviceClient>, request: Request) {
  const expected = await secret(admin, 'backup_cron_secret');
  if (!expected || request.headers.get('x-backup-cron-secret') !== expected) throw new Error('CRON_AUTH_REQUIRED');
  const refresh = await secret(admin, 'google_refresh_token');
  if (!refresh) return { skipped: true, reason: 'DRIVE_NOT_CONNECTED' };
  if (await secret(admin,'backup_recovery_key_delivered') !== 'true') return { skipped:true, reason:'RECOVERY_KEY_NOT_SAVED' };
  const run = await createRun(admin, null, 'scheduled');
  return { started: !run.alreadyRunning, runId: run.id };
}
async function saveArtifact(admin: ReturnType<typeof serviceClient>, runId: string, key: string, kind: 'database' | 'media' | 'manifest', driveFileId: string, byteSize: number) {
  const { error } = await admin.from('backup_artifacts').insert({
    run_id: runId, artifact_key: key, kind, drive_file_id: driveFileId, byte_size: byteSize,
  });
  if (error) throw new Error('BACKUP_METADATA_SAVE_FAILED');
}
async function worker(admin: ReturnType<typeof serviceClient>) {
  const { data: claimed, error: claimError } = await admin.rpc('backup_claim_run');
  if (claimError) throw new Error('BACKUP_SCHEMA_NOT_READY');
  const run = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!run) return { worked: false };
  try {
    const accessToken = await getAccessToken(admin);
    const folderId = await ensureDriveFolder(admin, accessToken);
    const progress = run.progress || {};
    const entityIndex = Number(progress.entity_index || 0);
    if (entityIndex < ENTITIES.length) {
      const entity = ENTITIES[entityIndex];
      const after = Number(run.entity_cursor || 0);
      const { data: rows, error } = await admin.rpc('backup_read_snapshot', {
        p_run_id: run.id, p_entity: entity, p_after: after, p_limit: 500,
      });
      if (error) throw new Error('SNAPSHOT_READ_FAILED');
      if (rows?.length) {
        const payload = utf8(JSON.stringify({
          format: 'cadastro-criminal-backup-v1', entity, rows: rows.map((row: { row_data: unknown }) => row.row_data),
        }));
        const blob = await encrypted(admin, payload);
        const from = Number(rows[0].sequence), to = Number(rows[rows.length - 1].sequence);
        const filename = 'database-' + entity + '-' + from + '-' + to + '.ccb.enc';
        const driveId = await driveUpload(accessToken, folderId, filename, blob);
        await saveArtifact(admin, run.id, entity + '-' + from + '-' + to, 'database', driveId, blob.length);
        const { error: updateError } = await admin.from('backup_runs').update({
          current_entity: entity, entity_cursor: to, lease_until: null,
          progress: { ...progress, entity_index: entityIndex, database_entity: entity },
        }).eq('id', run.id);
        if (updateError) throw new Error('BACKUP_PROGRESS_SAVE_FAILED');
        return { worked: true, stage: 'database', entity };
      }
      const next = entityIndex + 1;
      const { error: updateError } = await admin.from('backup_runs').update({
        current_entity: next < ENTITIES.length ? ENTITIES[next] : 'storage',
        entity_cursor: 0, lease_until: null,
        progress: { ...progress, entity_index: next },
      }).eq('id', run.id);
      if (updateError) throw new Error('BACKUP_PROGRESS_SAVE_FAILED');
      return { worked: true, stage: 'database-table-complete' };
    }

    const { data: objects, error: objectsError } = await admin.rpc('backup_list_storage_objects', {
      p_after: run.storage_cursor || '', p_limit: 25,
    });
    if (objectsError) throw new Error('STORAGE_LIST_FAILED');
    if (!objects?.length) {
      const { data: artifacts, error: artifactError } = await admin.from('backup_artifacts')
        .select('artifact_key,kind,drive_file_id,byte_size').eq('run_id', run.id);
      const { data: photos, error: photoError } = await admin.from('backup_run_storage_items')
        .select('object_name,content_tag,drive_file_id,source_size,mimetype').eq('run_id', run.id);
      if (artifactError || photoError) throw new Error('BACKUP_METADATA_READ_FAILED');
      const manifest = utf8(JSON.stringify({
        format: 'cadastro-criminal-backup-v1',
        run: { id: run.id, created_at: run.created_at, trigger_type: run.trigger_type },
        entities: progress.entity_counts || {}, artifacts: artifacts || [], media: photos || [],
        encryption: 'AES-256-GCM; key retained only in Supabase Vault',
      }));
      const blob = await encrypted(admin, manifest);
      const driveId = await driveUpload(accessToken, folderId, 'manifest-' + run.id + '.ccb.enc', blob);
      await saveArtifact(admin, run.id, 'manifest', 'manifest', driveId, blob.length);
      await admin.from('backup_snapshot_rows').delete().eq('run_id', run.id);
      await admin.from('backup_runs').update({
        status: 'completed', finished_at: new Date().toISOString(), current_entity: null,
        lease_until: null, error_code: null, progress: { ...progress, photo_count: photos?.length || 0 },
      }).eq('id', run.id);
      return { worked: true, stage: 'completed', runId: run.id };
    }

    let completed = 0;
    const started = Date.now();
    for (const object of objects) {
      if (completed >= 20 || Date.now() - started > 70000) break;
      const path = String(object.object_name);
      const size = Number(object.object_size || 0);
      const lastModified = object.object_last_modified ? new Date(object.object_last_modified).toISOString() : null;
      const { data: previous } = await admin.from('backup_file_index')
        .select('source_size,source_etag,source_last_modified,content_tag,drive_file_id')
        .eq('object_name', path).maybeSingle();
      let tag = previous?.content_tag || '';
      let driveId = '';
      const sameModified = (!lastModified && !previous?.source_last_modified) ||
        Boolean(lastModified && previous?.source_last_modified &&
          Date.parse(String(previous.source_last_modified)) === Date.parse(lastModified));
      const unchanged = Boolean(previous && Number(previous.source_size) === size &&
        String(previous.source_etag || '') === String(object.object_etag || '') && sameModified);
      if (unchanged && previous) {
        tag = String(previous.content_tag); driveId = String(previous.drive_file_id);
      } else {
        const { data: file, error: downloadError } = await admin.storage.from(BUCKET).download(path);
        if (downloadError || !file) throw new Error('STORAGE_DOWNLOAD_FAILED');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (size && bytes.length !== size) throw new Error('STORAGE_SIZE_MISMATCH');
        tag = await contentTag(admin, bytes);
        const { data: duplicate } = await admin.from('backup_file_index')
          .select('drive_file_id').eq('content_tag', tag).limit(1).maybeSingle();
        if (duplicate?.drive_file_id) driveId = String(duplicate.drive_file_id);
        else {
          const blob = await encrypted(admin, bytes);
          driveId = await driveUpload(accessToken, folderId, 'media-' + tag.slice(0, 40) + '.ccb.enc', blob);
        }
        const { error: indexError } = await admin.from('backup_file_index').upsert({
          object_name: path, bucket_id: BUCKET, source_size: size,
          source_etag: object.object_etag, source_last_modified: lastModified,
          content_tag: tag, drive_file_id: driveId, updated_at: new Date().toISOString(),
        }, { onConflict: 'object_name' });
        if (indexError) throw new Error('BACKUP_INDEX_SAVE_FAILED');
      }
      const { error: itemError } = await admin.from('backup_run_storage_items').upsert({
        run_id: run.id, object_name: path, content_tag: tag, drive_file_id: driveId,
        source_size: size, mimetype: object.object_mimetype,
      }, { onConflict: 'run_id,object_name' });
      if (itemError) throw new Error('BACKUP_METADATA_SAVE_FAILED');
      const { error: cursorError } = await admin.from('backup_runs').update({
        storage_cursor: path,
        progress: { ...progress, entity_index: ENTITIES.length, photo_count: Number(progress.photo_count || 0) + 1 },
      }).eq('id', run.id);
      if (cursorError) throw new Error('BACKUP_PROGRESS_SAVE_FAILED');
      completed++;
    }
    await admin.from('backup_runs').update({ lease_until: null }).eq('id', run.id);
    return { worked: true, stage: 'storage', completed };
  } catch (error) {
    const code = safeCode(error instanceof Error ? error.message : '');
    await admin.from('backup_runs').update({
      status: 'failed', finished_at: new Date().toISOString(), lease_until: null, error_code: code,
    }).eq('id', run.id);
    throw error;
  }
}

function callbackPage(message: string, ok: boolean) {
  const color = ok ? '#147d4a' : '#a52626';
  const html = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cadastro Criminal</title><body style="font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#202628"><h1>Cadastro Criminal</h1><p style="color:' + color + '">' + message + '</p><a href="' + APP_URL + '#">Voltar ao aplicativo</a></body></html>';
  return new Response(html, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
async function oauthCallback(request: Request) {
  const url = new URL(request.url), state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  if (url.searchParams.get('error')) return callbackPage('A autorização foi cancelada. Volte ao aplicativo e tente novamente.', false);
  if (!code || !state) return callbackPage('Não foi possível validar a autorização. Volte ao aplicativo.', false);
  const admin = serviceClient();
  const { data: stateRow, error: stateError } = await admin.from('backup_oauth_states')
    .update({ used_at: new Date().toISOString() }).eq('state', state).is('used_at', null)
    .gt('expires_at', new Date().toISOString()).select('state').maybeSingle();
  if (stateError || !stateRow) return callbackPage('A autorização expirou ou já foi utilizada. Volte ao aplicativo para iniciar novamente.', false);
  try {
    const { clientId, clientSecret } = await googleClient(admin);
    const body = new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: DRIVE_REDIRECT, grant_type: 'authorization_code',
    });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!response.ok) throw new Error('O Google não concluiu a autorização.');
    const token = await response.json();
    if (!token.refresh_token) throw new Error('O Google não forneceu autorização persistente. Confira o modo de teste e tente novamente.');
    await saveSecret(admin, 'google_refresh_token', String(token.refresh_token));
    const accessToken = String(token.access_token || '');
    if (accessToken) await ensureDriveFolder(admin, accessToken);
    return callbackPage('Google Drive foi conectado. Você pode voltar ao aplicativo e criar o primeiro backup.', true);
  } catch {
    return callbackPage('Não foi possível concluir a conexão com o Google Drive. Volte ao app e verifique a configuração.', false);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname.endsWith('/oauth/callback')) return await oauthCallback(request);
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'worker' || body.action === 'scheduled_start') {
      const admin = serviceClient();
      if (body.action === 'worker') {
        const expected = await secret(admin, 'backup_cron_secret');
        if (!expected || request.headers.get('x-backup-cron-secret') !== expected) return json({ error: 'Não autorizado.' }, 401);
        return json(await worker(admin));
      }
      return json(await startFromCron(admin, request));
    }
    const { admin, user } = await requireAdmin(request);
    if (body.action === 'status') {
      const [clientId, refresh, key, folder, recoveryKey, recoveryDelivered] = await Promise.all([
        secret(admin,'google_client_id'), secret(admin,'google_refresh_token'),
        secret(admin,'backup_crypto_key'), secret(admin,'google_drive_folder_id'),
        secret(admin,'backup_recovery_key'), secret(admin,'backup_recovery_key_delivered'),
      ]);
      const { data: runs, error } = await admin.from('backup_runs')
        .select('id,status,trigger_type,created_at,started_at,finished_at,progress,error_code')
        .order('created_at',{ascending:false}).limit(15);
      if (error) throw new Error('BACKUP_SCHEMA_NOT_READY');
      return json({ configured: Boolean(clientId && refresh && key && folder), clientConfigured: Boolean(clientId),
        driveConnected: Boolean(refresh), encryptionConfigured: Boolean(key), folderConfigured: Boolean(folder),
        recoveryKeyCreated: Boolean(recoveryKey), recoveryKeyAcknowledged: recoveryDelivered === 'true', runs: runs || [] });
    }
    if (body.action === 'save_client') {
      const clientId = String(body.clientId || '').trim();
      const clientSecret = String(body.clientSecret || '');
      if (!clientId.endsWith('.apps.googleusercontent.com') || clientSecret.length < 10 || clientSecret.length > 8192) return json({ error: 'Informe um cliente OAuth Web e o segredo recém-gerado.' },400);
      await saveSecret(admin,'google_client_id',clientId);
      await saveSecret(admin,'google_client_secret',clientSecret);
      return json({ ok: true, clientConfigured: true });
    }
    if (body.action === 'create_recovery_key') {
      const refresh = await secret(admin,'google_refresh_token');
      if (!refresh) return json({ error:'Conecte o Google Drive antes de criar a chave de recuperação.' },400);
      let recoveryKey = await secret(admin,'backup_recovery_key');
      const delivered = await secret(admin,'backup_recovery_key_delivered');
      if (recoveryKey && delivered === 'true') return json({ error:'A chave já foi confirmada como guardada e não será exibida novamente.' },409);
      if (!recoveryKey) {
        recoveryKey = toB64(crypto.getRandomValues(new Uint8Array(32)));
        const accessToken = await getAccessToken(admin);
        const folderId = await ensureDriveFolder(admin,accessToken);
        const envelopeId = await createRecoveryEnvelope(admin,accessToken,folderId,recoveryKey);
        await saveSecret(admin,'backup_recovery_key',recoveryKey);
        await saveSecret(admin,'backup_key_envelope_drive_id',envelopeId);
        await saveSecret(admin,'backup_recovery_key_delivered','false');
      } else if (!await secret(admin,'backup_key_envelope_drive_id')) {
        const accessToken = await getAccessToken(admin);
        const folderId = await ensureDriveFolder(admin,accessToken);
        const envelopeId = await createRecoveryEnvelope(admin,accessToken,folderId,recoveryKey);
        await saveSecret(admin,'backup_key_envelope_drive_id',envelopeId);
      }
      return json({ recoveryKey, oneTime:true });
    }
    if (body.action === 'ack_recovery_key') {
      const recoveryKey = await secret(admin,'backup_recovery_key');
      if (!recoveryKey) return json({ error:'Gere a chave de recuperação primeiro.' },400);
      await saveSecret(admin,'backup_recovery_key_delivered','true');
      return json({ ok:true });
    }
    if (body.action === 'connect') {
      const { clientId } = await googleClient(admin);
      const state = crypto.randomUUID() + crypto.randomUUID();
      const { error } = await admin.from('backup_oauth_states').insert({
        state, created_by:user.id, expires_at:new Date(Date.now()+10*60*1000).toISOString(),
      });
      if (error) throw new Error('BACKUP_SCHEMA_NOT_READY');
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id:clientId, redirect_uri:DRIVE_REDIRECT, response_type:'code',
        scope:'https://www.googleapis.com/auth/drive.file', access_type:'offline',
        prompt:'consent', include_granted_scopes:'true', state,
      }).toString();
      return json({ authorizationUrl: auth.toString() });
    }
    if (body.action === 'run_step') return json(await worker(admin));
    if (body.action === 'backup_now') {
      await googleClient(admin);
      const refresh = await secret(admin,'google_refresh_token');
      if (!refresh) return json({ error: 'Conecte o Google Drive antes de iniciar o backup.' },400);
      if (await secret(admin,'backup_recovery_key_delivered') !== 'true') return json({ error:'Guarde e confirme a chave de recuperação antes do primeiro backup.' },400);
      const result = await createRun(admin,user.id,'manual');
      return json({ ok:true, runId:result.id, alreadyRunning:result.alreadyRunning, scheduleActive:result.scheduleActive });
    }
    if (body.action === 'history') {
      const { data, error } = await admin.from('backup_runs')
        .select('id,status,trigger_type,created_at,started_at,finished_at,progress,error_code')
        .order('created_at',{ascending:false}).limit(100);
      if (error) throw new Error('BACKUP_SCHEMA_NOT_READY');
      return json({ runs:data || [] });
    }
    return json({ error:'Operação de backup desconhecida.' },400);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'BACKUP_FAILED';
    const known: Record<string,string> = {
      SESSION_REQUIRED:'Entre novamente como administrador.',
      SESSION_INVALID:'Sua sessão expirou. Entre novamente.',
      ADMIN_REQUIRED:'Apenas administradores podem gerenciar backups.',
      BACKUP_SCHEMA_NOT_READY:'A estrutura de backup ainda não foi configurada no Supabase.',
      GOOGLE_CLIENT_NOT_CONFIGURED:'Configure a nova credencial OAuth do Google para continuar.',
      GOOGLE_DRIVE_NOT_CONNECTED:'Conecte o Google Drive antes de iniciar.',
      BACKUP_KEY_INVALID:'A chave de criptografia está inválida; backup interrompido.',
      GOOGLE_TOKEN_REFRESH_FAILED:'A autorização do Google expirou. Reconecte o Drive.',
      CRON_AUTH_REQUIRED:'Não autorizado.',
    };
    return json({ error:known[code] || 'Não foi possível concluir a operação de backup.' },code==='ADMIN_REQUIRED'?403:code==='SESSION_REQUIRED'||code==='SESSION_INVALID'?401:500);
  }
});
