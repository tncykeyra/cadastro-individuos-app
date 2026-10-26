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

    // Reassign linked records to the administrator first, preserving the records themselves.
    // The caller client preserves auth.uid() for update triggers and audit checks.
    const references: Array<[string, string, boolean]> = [
      ['people', 'created_by', false], ['people', 'updated_by', false],
      ['vehicles', 'created_by', false], ['vehicles', 'updated_by', false],
      ['person_vehicle_links', 'created_by', false],
      ['record_photos', 'created_by', true],
      ['person_photos', 'created_by', true], ['person_photos', 'updated_by', true],
      ['vehicle_photos', 'created_by', true], ['vehicle_photos', 'updated_by', true],
    ];
    for (const [table, column, optionalPhotoField] of references) {
      const { error } = await caller.from(table).update({ [column]: user.id }).eq(column, targetId);
      if (optionalPhotoField && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error?.code ?? '')) continue;
      if (error) return respond({ error: 'Não foi possível preservar a autoria dos registros vinculados à conta: ' + error.message + '. Nenhuma conta foi excluída.' }, 500);
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

  if (payload.action === 'create-email-user') {
    const { data: existingProfile, error: existingProfileError } = await admin
      .from('profiles')
      .select('id, role')
      .eq('email', email)
      .maybeSingle();
    if (existingProfileError) return respond({ error: 'Não foi possível consultar o acesso deste e-mail.' }, 500);

    if (existingProfile) {
      if (existingProfile.role === 'disabled') {
        return respond({ error: 'Este e-mail já tem uma conta desativada. Reative-a na lista de Usuários antes de liberar o acesso.' }, 409);
      }
      const { data: authRecord, error: authLookupError } = await admin.auth.admin.getUserById(existingProfile.id);
      if (authLookupError || !authRecord?.user) {
        return respond({ error: 'A conta existe, mas não foi possível conferir o método de acesso. Nenhuma alteração foi feita.' }, 500);
      }
      const authUser = authRecord.user;
      const providers = Array.isArray(authUser.app_metadata?.providers) ? authUser.app_metadata.providers : [];
      const hasGoogle = providers.includes('google') || (authUser.identities ?? []).some((identity) => identity.provider === 'google');
      const role = existingProfile.role === 'pending' ? 'operator' : existingProfile.role;

      if (!hasGoogle) {
        const { error: metadataError } = await admin.auth.admin.updateUserById(existingProfile.id, {
          user_metadata: { ...authUser.user_metadata, must_change_password: true },
        });
        if (metadataError) return respond({ error: 'Não foi possível preparar a criação de senha. Nenhuma alteração no perfil foi feita.' }, 500);
      }

      if (existingProfile.role === 'pending') {
        const { error: roleError } = await caller.rpc('admin_set_user_role', {
          target_user_id: existingProfile.id,
          target_role: 'operator',
        });
        if (roleError) {
          if (!hasGoogle) await admin.auth.admin.updateUserById(existingProfile.id, { user_metadata: authUser.user_metadata ?? {} });
          return respond({ error: 'Não foi possível liberar o perfil como Operador.' }, 500);
        }
      }

      return respond({
        ok: true,
        created: false,
        existing: true,
        existingGoogle: hasGoogle,
        email,
        role,
      });
    }

    const displayName = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    });
    if (createError || !created.user) {
      const detail = createError?.message ?? 'Não foi possível criar a conta.';
      if (/already (been )?registered|already exists|duplicate/i.test(detail)) {
        return respond({ error: 'Já existe uma conta de autenticação com este e-mail. Confira a lista de Usuários antes de tentar novamente.' }, 409);
      }
      return respond({ error: 'Não foi possível criar a conta: ' + detail }, 400);
    }

    const { error: profileError } = await admin.from('profiles').upsert({
      id: created.user.id,
      email,
      display_name: displayName,
      role: 'operator',
    }, { onConflict: 'id' });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return respond({ error: 'A conta não foi finalizada porque não foi possível criar o perfil de Operador.' }, 500);
    }
    return respond({ ok: true, created: true, email, role: 'operator', userId: created.user.id });
  }

  if (payload.action === 'create-password-user') {
    const temporaryPassword = String(payload.temporaryPassword ?? '');
    if (temporaryPassword.length < 12) return respond({ error: 'A senha temporária precisa ter pelo menos 12 caracteres.' }, 400);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    });
    if (createError || !created.user) {
      const detail = createError?.message ?? 'Não foi possível criar a conta.';
      if (/already (been )?registered|already exists|duplicate/i.test(detail)) {
        return respond({ error: 'Já existe uma conta com este e-mail. Exclua ou reative a conta existente antes de criar outra.' }, 409);
      }
      return respond({ error: 'Não foi possível criar a conta: ' + detail }, 400);
    }
    const displayName = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    const { error: profileError } = await admin.from('profiles').upsert({
      id: created.user.id,
      email,
      display_name: displayName,
      role: 'operator',
    }, { onConflict: 'id' });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return respond({ error: 'A conta não foi finalizada porque não foi possível criar o perfil de Operador: ' + profileError.message }, 500);
    }
    return respond({ ok: true, created: true, email, role: 'operator', userId: created.user.id });
  }

  if (payload.action === 'create' || payload.action === 'invite') {
    return respond({
      error: 'Use “Criar conta por e-mail” para gerar uma senha temporária ou autorize uma Conta Google.',
    }, 400);
  }

  return respond({ error: 'Ação inválida.' }, 400);
});


