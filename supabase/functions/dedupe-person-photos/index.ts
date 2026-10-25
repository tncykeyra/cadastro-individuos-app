import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

async function fetchAll(queryFactory: (start: number, end: number) => any) {
  const rows: any[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await queryFactory(start, start + 999);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}
const pathValues = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.length > 0) : [];

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return respond({ error: 'Método não permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    return respond({ error: 'A função de limpeza não está configurada no Supabase.' }, 503);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return respond({ error: 'Sessão necessária.' }, 401);

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return respond({ error: 'Sessão inválida. Entre novamente.' }, 401);

  const { data: profile, error: profileError } = await caller
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profileError || profile?.role !== 'admin') {
    return respond({ error: 'Apenas administradores podem limpar fotos duplicadas.' }, 403);
  }

  let dryRun = true;
  try {
    const payload = await request.json();
    dryRun = payload?.dryRun !== false;
  } catch {
    return respond({ error: 'Solicitação inválida.' }, 400);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  try {
    const [people, storageObjects] = await Promise.all([
      fetchAll((start, end) => admin.from('people').select('id,photo_path,photo_paths').order('id').range(start, end)),
      fetchAll((start, end) => admin.schema('storage').from('objects').select('name,metadata').eq('bucket_id', 'people-photos').range(start, end)),
    ]);

    const metadataByPath = new Map<string, any>(storageObjects.map((object: any) => [object.name, object.metadata ?? {}]));
    const plans: { id: string; paths: string[]; removedPaths: string[] }[] = [];
    let duplicateReferences = 0;

    for (const person of people) {
      const original = pathValues(person.photo_paths);
      const seenContents = new Set<string>();
      const keptPaths = new Set<string>();
      const removedPaths = new Set<string>();
      const preferredOrder = original
        .map((photoPath, index) => ({ photoPath, index }))
        .sort((a, b) => Number(b.photoPath === person.photo_path) - Number(a.photoPath === person.photo_path) || a.index - b.index);

      for (const { photoPath } of preferredOrder) {
        const metadata = metadataByPath.get(photoPath);
        const etag = metadata?.eTag;
        const size = metadata?.size ?? metadata?.contentLength ?? '';
        const contentKey = etag ? 'etag:' + String(etag) + ':' + String(size) : 'path:' + photoPath;

        if (seenContents.has(contentKey)) {
          duplicateReferences += 1;
          if (metadata && !keptPaths.has(photoPath)) removedPaths.add(photoPath);
          continue;
        }
        seenContents.add(contentKey);
        keptPaths.add(photoPath);
      }

      const next = [...new Set(original)].filter((photoPath) => keptPaths.has(photoPath));
      if (next.length !== original.length) {
        plans.push({ id: person.id, paths: next, removedPaths: [...removedPaths] });
      }
    }

    if (dryRun) {
      return respond({
        ok: true,
        dryRun: true,
        affectedPeople: plans.length,
        duplicateReferences,
        duplicateFilesPotentiallyRemovable: new Set(plans.flatMap((plan) => plan.removedPaths)).size,
      });
    }

    let updatedPeople = 0;
    const updateErrors: string[] = [];
    for (let index = 0; index < plans.length; index += 8) {
      const batch = plans.slice(index, index + 8);
      const results = await Promise.all(batch.map(async (plan) => {
        const { data, error } = await caller.from('people')
          .update({ photo_paths: plan.paths })
          .eq('id', plan.id)
          .select('id')
          .maybeSingle();
        if (error || !data) return { id: plan.id, error: error?.message ?? 'Registro não atualizado.' };
        return { id: plan.id };
      }));
      for (const result of results) {
        if (result.error) updateErrors.push(result.id + ': ' + result.error);
        else updatedPeople += 1;
      }
    }

    if (updateErrors.length) {
      return respond({
        ok: false,
        partial: updatedPeople > 0,
        error: 'Algumas listas de fotos não foram atualizadas. Execute a verificação novamente para concluir.',
        updatedPeople,
        failedPeople: updateErrors.length,
      }, 500);
    }

    const [currentPeople, vehicles, recordPhotos, personPhotos, vehiclePhotos] = await Promise.all([
      fetchAll((start, end) => admin.from('people').select('photo_path,photo_paths').range(start, end)),
      fetchAll((start, end) => admin.from('vehicles').select('photo_path,photo_paths').range(start, end)),
      fetchAll((start, end) => admin.from('record_photos').select('photo_path').range(start, end)),
      fetchAll((start, end) => admin.from('person_photos').select('photo_path').range(start, end)),
      fetchAll((start, end) => admin.from('vehicle_photos').select('photo_path').range(start, end)),
    ]);

    const stillReferenced = new Set<string>();
    const addPeoplePaths = (rows: any[]) => {
      for (const row of rows) {
        if (typeof row.photo_path === 'string' && row.photo_path) stillReferenced.add(row.photo_path);
        for (const photoPath of pathValues(row.photo_paths)) stillReferenced.add(photoPath);
      }
    };
    addPeoplePaths(currentPeople);
    addPeoplePaths(vehicles);
    for (const row of [...recordPhotos, ...personPhotos, ...vehiclePhotos]) {
      if (typeof row.photo_path === 'string' && row.photo_path) stillReferenced.add(row.photo_path);
    }

    const removedPaths = new Set(plans.flatMap((plan) => plan.removedPaths));
    const safeToDelete = [...removedPaths].filter((photoPath) =>
      metadataByPath.has(photoPath) && !stillReferenced.has(photoPath)
    );

    let deletedFiles = 0;
    const deleteErrors: string[] = [];
    for (let index = 0; index < safeToDelete.length; index += 100) {
      const batch = safeToDelete.slice(index, index + 100);
      const { data, error } = await admin.storage.from('people-photos').remove(batch);
      if (error) {
        deleteErrors.push(error.message);
        continue;
      }
      deletedFiles += data?.length ?? batch.length;
    }

    return respond({
      ok: deleteErrors.length === 0,
      dryRun: false,
      updatedPeople,
      duplicateReferencesRemoved: duplicateReferences,
      duplicateFilesDeleted: deletedFiles,
      filesStillReferenced: removedPaths.size - safeToDelete.length,
      storageErrors: deleteErrors,
    }, deleteErrors.length ? 207 : 200);
  } catch (error) {
    console.error('Photo cleanup failed:', error);
    return respond({ error: 'Não foi possível concluir a limpeza. Verifique a conexão e tente novamente.' }, 500);
  }
});
