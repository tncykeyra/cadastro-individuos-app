import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const appUrl = 'https://tncykeyra.github.io/cadastro-individuos-app/';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return respond({ error: 'Método não permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    return respond({ error: 'A função de usuários não está configurada no Supabase.' }, 503);
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
    return respond({ error: 'Apenas administradores podem cadastrar usuários.' }, 403);
  }

  let payload: { action?: string; email?: string; temporaryPassword?: string; userId?: string };
  try {
    payload = await request.json();
  } catch {
    return respond({ error: 'Informe um e-mail válido.' }, 400);
  }
  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!['delete', 'list_google_authorized'].includes(payload.action ?? '') && !emailPattern.test(email)) return respond({ error: 'Informe um e-mail válido.' }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (payload.action === 'list_google_authorized') {
    const { data: emails, error } = await admin
      .from('authorized_emails')
      .select('email, role, created_at')
      .order('created_at', { ascending: false })
      .limit(250);
    if (error) return respond({ error: 'Não foi possível carregar os e-mails autorizados.' }, 500);
    return respond({ ok: true, emails: emails ?? [] });
  }

  if (payload.action === 'revoke-google') {
    const { data: targetProfile, error: targetProfileError } = await admin
      .from('profiles')
      .select('id, role')
      .eq('email', email)
      .maybeSingle();
    if (targetProfileError) return respond({ error: 'Não foi possível consultar o perfil deste e-mail.' }, 500);
    if (targetProfile?.id === user.id) return respond({ error: 'Você não pode revogar o próprio acesso.' }, 400);
    if (targetProfile?.role === 'admin') {
      const { count, error: countError } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if (countError) return respond({ error: 'Não foi possível verificar os administradores ativos.' }, 500);
      if ((count ?? 0) <= 1) return respond({ error: 'Não é possível revogar o último administrador.' }, 409);
    }
    if (targetProfile && targetProfile.role !== 'disabled') {
      const { error } = await caller.rpc('admin_set_user_role', { target_user_id: targetProfile.id, target_role: 'disabled' });
      if (error) return respond({ error: 'Não foi possível bloquear o perfil deste usuário.' }, 500);
    }
    const { data: authorized, error: lookupError } = await admin.from('authorized_emails').select('email,role').eq('email', email).maybeSingle();
    if (lookupError) return respond({ error: 'Não foi possível consultar a autorização deste e-mail.' }, 500);
    const { error: revokeError } = await admin.from('authorized_emails').delete().eq('email', email);
    if (revokeError) {
      if (targetProfile && targetProfile.role !== 'disabled') await caller.rpc('admin_set_user_role', { target_user_id: targetProfile.id, target_role: targetProfile.role });
      return respond({ error: 'Não foi possível remover este e-mail da lista autorizada.' }, 500);
    }
    return respond({ ok: true, revoked: true, had_authorization: Boolean(authorized) });
  }

  if (payload.action === 'authorize-google') {
    const { data: existing, error: lookupError } = await admin
      .from('authorized_emails')
      .select('email, role')
      .eq('email', email)
      .maybeSingle();
    if (lookupError) return respond({ error: 'Não foi possível consultar a lista de e-mails autorizados.' }, 500);

    let role: string = existing?.role === 'admin' ? 'admin' : 'operator';
    let alreadyAuthorized = Boolean(existing);
    if (!existing) {
      const { error: insertError } = await admin
        .from('authorized_emails')
        .insert({ email, role: 'operator' });
      if (insertError?.code === '23505') {
        alreadyAuthorized = true;
      } else if (insertError) {
        return respond({ error: 'Não foi possível autorizar o e-mail na base de dados.' }, 500);
      }
    } else if (existing.role !== role) {
      const { error: updateError } = await admin
        .from('authorized_emails')
        .update({ role })
        .eq('email', email);
      if (updateError) return respond({ error: 'Não foi possível atualizar a autorização do e-mail.' }, 500);
    }

    const { data: authorized, error: authorizedError } = await admin
      .from('authorized_emails')
      .select('email, role')
      .eq('email', email)
      .single();
    if (authorizedError || !authorized) return respond({ error: 'Não foi possível confirmar a autorização do e-mail.' }, 500);
    role = authorized.role;

    if (role === 'operator' || role === 'admin') {
      const { data: pendingProfiles, error: pendingError } = await admin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .eq('role', 'pending')
        .limit(10);
      if (pendingError) return respond({ error: 'O e-mail foi autorizado, mas não foi possível atualizar um perfil pendente.' }, 500);
      for (const pending of pendingProfiles ?? []) {
        const { error: roleError } = await caller.rpc('admin_set_user_role', {
          target_user_id: pending.id,
          target_role: role,
        });
        if (roleError) return respond({ error: 'O e-mail foi autorizado, mas não foi possível atualizar um perfil pendente.' }, 500);
      }
    }

    return respond({ ok: true, role, already_authorized: alreadyAuthorized });
  }

  if (payload.action === 'delete') {
    const targetId = String(payload.userId ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
      return respond({ error: 'Selecione uma conta válida.' }, 400);
    }
    if (targetId === user.id) return respond({ error: 'Você não pode excluir sua própria conta.' }, 400);

    const { data: targetResult, error: targetError } = await admin.auth.admin.getUserById(targetId);
    if (targetError || !targetResult?.user) return respond({ error: 'A conta selecionada não foi encontrada.' }, 404);
    const { data: targetProfile } = await admin.from('profiles').select('role').eq('id', targetId).maybeSingle();
    if (targetProfile?.role === 'admin') {
      const { count, error: countError } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if (countError) return respond({ error: 'Não foi possível verificar os administradores ativos.' }, 500);
      if ((count ?? 0) <= 1) return respond({ error: 'Não é possível excluir o último administrador.' }, 409);
    }

    // Preserva os cadastros e substitui apenas a referência de autoria exigida
    // pelas chaves estrangeiras antes de remover a conta de autenticação.
    const references: Array<[string, string]> = [
      ['people', 'created_by'], ['people', 'updated_by'],
      ['vehicles', 'created_by'], ['vehicles', 'updated_by'],
      ['person_vehicle_links', 'created_by'], ['record_photos', 'created_by'],
    ];
    for (const [table, column] of references) {
      const { error } = await admin.from(table).update({ [column]: user.id }).eq(column, targetId);
      if (error && table === 'record_photos' && ['42P01', 'PGRST205', 'PGRST204'].includes(error.code ?? '')) continue;
      if (error) return respond({ error: 'Não foi possível preservar os cadastros vinculados à conta. Nenhuma conta foi excluída.' }, 500);
    }

    const targetEmail = String(targetResult.user.email ?? '').trim().toLowerCase();
    const { data: authorizationRow, error: authorizationLookupError } = await admin
      .from('authorized_emails')
      .select('email, role')
      .eq('email', targetEmail)
      .maybeSingle();
    if (authorizationLookupError) return respond({ error: 'Não foi possível verificar se o e-mail ainda está autorizado.' }, 500);
    if (authorizationRow) {
      const { error: revokeError } = await admin.from('authorized_emails').delete().eq('email', targetEmail);
      if (revokeError) return respond({ error: 'Não foi possível remover a autorização de acesso. Nenhuma conta foi excluída.' }, 500);
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
    if (deleteError) {
      if (authorizationRow) await admin.from('authorized_emails').insert(authorizationRow);
      return respond({ error: 'Não foi possível excluir a conta: ' + deleteError.message }, 500);
    }
    return respond({ ok: true, deleted: true, access_revoked: Boolean(authorizationRow) });
  }

  if (payload.action === 'create' || payload.action === 'invite') {
    return respond({
      error: 'Este projeto usa login pelo Google. Autorize o e-mail; a conta e o perfil serão criados no primeiro acesso.',
    }, 400);
  }
  return respond({ error: 'Ação inválida.' }, 400);
});


