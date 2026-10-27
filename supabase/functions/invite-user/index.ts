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
const activationAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalizeActivationCode = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashActivationCode = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeActivationCode(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const generateActivationCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const raw = Array.from(bytes, (byte) => activationAlphabet[byte & 31]).join('');
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
};
const issueActivationCode = async (admin: ReturnType<typeof createClient>, email: string, adminId: string) => {
  const code = generateActivationCode();
  const codeHash = await hashActivationCode(code);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin.from('email_first_access_codes').upsert({
    email, code_hash: codeHash, expires_at: expiresAt, used_at: null, created_by: adminId,
  }, { onConflict: 'email' });
  return { code: error ? null : code, error };
};
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

  const earlyPayload = await request.clone().json().catch(() => null) as { action?: string; email?: string; code?: string; password?: string } | null;
  if (earlyPayload?.action === 'complete-email-first-access') {
    const email = String(earlyPayload.email ?? '').trim().toLowerCase();
    const code = normalizeActivationCode(earlyPayload.code);
    const password = String(earlyPayload.password ?? '');
    if (!emailPattern.test(email) || code.length !== 16 || password.length < 12 || password.length > 128) {
      return respond({ error: 'Confira o e-mail, o código e use uma senha com pelo menos 12 caracteres.' }, 400);
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const [{ data: authorizationRow, error: authorizationError }, { data: profile, error: profileError }] = await Promise.all([
      admin.from('authorized_emails').select('email, role').eq('email', email).maybeSingle(),
      admin.from('profiles').select('id, email, display_name, role').eq('email', email).maybeSingle(),
    ]);
    if (authorizationError || profileError) {
      return respond({ error: 'Não foi possível validar o primeiro acesso agora. Tente novamente.' }, 503);
    }
    if (!authorizationRow || !['operator', 'admin'].includes(authorizationRow.role) || profile?.role === 'disabled') {
      return respond({ error: 'E-mail ou código de primeiro acesso inválido ou expirado. Solicite um novo código ao administrador.' }, 400);
    }

    const codeHash = await hashActivationCode(code);
    const now = new Date().toISOString();
    const { data: availableCode, error: codeLookupError } = await admin
      .from('email_first_access_codes')
      .select('email')
      .eq('email', email)
      .eq('code_hash', codeHash)
      .is('used_at', null)
      .gt('expires_at', now)
      .maybeSingle();
    if (codeLookupError) return respond({ error: 'Não foi possível validar o código agora. Tente novamente.' }, 503);
    if (!availableCode) return respond({ error: 'E-mail ou código de primeiro acesso inválido ou expirado. Solicite um novo código ao administrador.' }, 400);

    const { data: claimedCode, error: claimError } = await admin
      .from('email_first_access_codes')
      .update({ used_at: now })
      .eq('email', email)
      .eq('code_hash', codeHash)
      .is('used_at', null)
      .gt('expires_at', now)
      .select('email')
      .maybeSingle();
    if (claimError) return respond({ error: 'Não foi possível validar o código agora. Tente novamente.' }, 503);
    if (!claimedCode) return respond({ error: 'Este código já foi usado ou expirou. Solicite um novo código ao administrador.' }, 400);

    let authUser: any = null;
    if (profile?.id) {
      const { data, error } = await admin.auth.admin.getUserById(profile.id);
      if (!error) authUser = data.user;
    }
    if (!authUser) {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) return respond({ error: 'Não foi possível preparar a conta. Solicite um novo código ao administrador.' }, 503);
      authUser = (data.users ?? []).find((entry) => String(entry.email ?? '').toLowerCase() === email) ?? null;
    }

    let userId: string;
    if (authUser) {
      const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true,
        user_metadata: { ...authUser.user_metadata, must_change_password: false },
      });
      if (error || !data.user) return respond({ error: 'Não foi possível definir a senha. Solicite um novo código ao administrador.' }, 500);
      userId = data.user.id;
    } else {
      const displayName = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, must_change_password: false },
      });
      if (error || !data.user) return respond({ error: 'Não foi possível criar a conta. Solicite um novo código ao administrador.' }, 500);
      userId = data.user.id;
      const { error: profileCreateError } = await admin.from('profiles').upsert({
        id: userId, email, display_name: displayName, role: authorizationRow.role,
      }, { onConflict: 'id' });
      if (profileCreateError) {
        await admin.auth.admin.deleteUser(userId);
        return respond({ error: 'Não foi possível concluir o perfil. Solicite um novo código ao administrador.' }, 500);
      }
    }

    if (profile?.role === 'pending') {
      const { error } = await admin.from('profiles').update({ role: authorizationRow.role }).eq('id', profile.id);
      if (error) return respond({ error: 'Senha definida, mas não foi possível liberar o perfil. Peça ao administrador para conferir o acesso.' }, 500);
    }
    return respond({ ok: true, email });
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
    try {
    const { data: existing, error: lookupError } = await admin
      .from('authorized_emails').select('email, role').eq('email', email).maybeSingle();
    if (lookupError) return respond({ error: 'Não foi possível consultar a lista de e-mails autorizados.' }, 500);

    const { data: disabledProfile, error: disabledProfileError } = await caller
      .from('profiles').select('id').eq('email', email).eq('role', 'disabled').limit(1).maybeSingle();
    if (disabledProfileError) return respond({ error: 'Não foi possível verificar o perfil deste e-mail.' }, 500);
    if (disabledProfile) return respond({ error: 'O perfil está desativado. Reative-o na lista de Usuários antes de gerar um código.' }, 409);

    let role: string = existing?.role === 'admin' ? 'admin' : 'operator';
    const alreadyAuthorized = Boolean(existing);
    if (!existing) {
      const { error } = await admin.from('authorized_emails').insert({ email, role: 'operator' });
      if (error?.code !== '23505' && error) return respond({ error: 'Não foi possível autorizar o e-mail na base de dados.' }, 500);
    } else if (existing.role !== role) {
      const { error } = await admin.from('authorized_emails').update({ role }).eq('email', email);
      if (error) return respond({ error: 'Não foi possível atualizar a autorização do e-mail.' }, 500);
    }

    const { data: authorized, error: authorizedError } = await admin
      .from('authorized_emails').select('email, role').eq('email', email).single();
    if (authorizedError || !authorized) return respond({ error: 'Não foi possível confirmar a autorização do e-mail.' }, 500);
    role = authorized.role;

    if (!['operator', 'admin'].includes(role)) {
      return respond({ error: 'Este papel não pode receber um código de primeiro acesso.' }, 409);
    }
    const { data: pendingProfiles, error: pendingError } = await caller
      .from('profiles').select('id').eq('email', email).eq('role', 'pending').limit(10);
    if (pendingError) return respond({ error: 'O e-mail foi autorizado, mas não foi possível atualizar um perfil pendente.' }, 500);
    for (const pending of pendingProfiles ?? []) {
      const { error: roleError } = await caller.rpc('admin_set_user_role', {
        target_user_id: pending.id, target_role: role,
      });
      if (roleError) return respond({ error: 'O e-mail foi autorizado, mas não foi possível atualizar um perfil pendente.' }, 500);
    }

    const { code, error: codeError } = await issueActivationCode(admin, email, user.id);
    if (codeError || !code) {
      // The Google allowlist write is authoritative. The optional WhatsApp/password code
      // must never turn a successful Google authorization into an apparent failure.
      console.error('[authorize-google] optional first-access code generation failed', codeError?.code ?? 'unknown');
      return respond({ ok: true, authorized: true, role, already_authorized: alreadyAuthorized, firstAccessCode: null, codeUnavailable: true });
    }
    return respond({ ok: true, authorized: true, role, already_authorized: alreadyAuthorized, firstAccessCode: code, codeUnavailable: false });
    } catch (error) {
      // Return the persisted allowlist state if a later optional step unexpectedly fails.
      const { data: persisted } = await admin.from('authorized_emails').select('role').eq('email', email).maybeSingle();
      if (persisted && ['operator', 'admin'].includes(persisted.role)) {
        console.error('[authorize-google] authorized; optional step failed', error instanceof Error ? error.name : 'UnknownError');
        return respond({ ok: true, authorized: true, role: persisted.role, already_authorized: true, firstAccessCode: null, codeUnavailable: true });
      }
      console.error('[authorize-google] request failed', error instanceof Error ? error.name : 'UnknownError');
      return respond({ error: 'Não foi possível autorizar este e-mail Google. Atualize a tela e tente novamente.' }, 500);
    }
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
      .from('profiles').select('id, role').eq('email', email).maybeSingle();
    if (existingProfileError) return respond({ error: 'Não foi possível consultar o acesso deste e-mail.' }, 500);
    if (existingProfile?.role === 'disabled') {
      return respond({ error: 'Este e-mail já tem uma conta desativada. Reative-a na lista de Usuários antes de liberar o acesso.' }, 409);
    }

    const { data: existingAuthorization, error: authorizationLookupError } = await admin
      .from('authorized_emails').select('email, role').eq('email', email).maybeSingle();
    if (authorizationLookupError) return respond({ error: 'Não foi possível consultar os e-mails autorizados.' }, 500);

    const role = existingAuthorization?.role === 'admin' || existingProfile?.role === 'admin' ? 'admin' : 'operator';
    const { error: authorizationWriteError } = await admin
      .from('authorized_emails').upsert({ email, role }, { onConflict: 'email' });
    if (authorizationWriteError) return respond({ error: 'Não foi possível autorizar este e-mail.' }, 500);

    if (existingProfile?.role === 'pending') {
      const { error: roleError } = await caller.rpc('admin_set_user_role', {
        target_user_id: existingProfile.id, target_role: role,
      });
      if (roleError) return respond({ error: 'O e-mail foi autorizado, mas não foi possível liberar o perfil.' }, 500);
    }

    const { code, error: codeError } = await issueActivationCode(admin, email, user.id);
    if (codeError || !code) return respond({ error: 'O e-mail foi autorizado, mas não foi possível gerar o código. Tente novamente.' }, 500);
    return respond({
      ok: true, created: !existingProfile, existing: Boolean(existingProfile), email, role, firstAccessCode: code,
    });
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


