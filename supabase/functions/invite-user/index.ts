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

const recordCityAuthorizations = async (
  admin: ReturnType<typeof createClient>,
  entries: Array<{ email: string; city_id: string; role: string }>,
  actor: { id: string; email: string; name: string },
) => {
  for (const entry of entries) {
    const email = entry.email.trim().toLowerCase();
    const cityId = entry.city_id.trim();
    if (!email || !cityId || !['operator', 'admin'].includes(entry.role)) continue;
    const { data: existing, error: lookupError } = await admin.from('authorized_email_city_audit')
      .select('email').eq('email', email).eq('city_id', cityId).maybeSingle();
    if (lookupError) return lookupError;
    if (existing) {
      const { error } = await admin.from('authorized_email_city_audit').update({
        role: entry.role, updated_by: actor.id, updated_by_email: actor.email,
        updated_by_name: actor.name, updated_at: new Date().toISOString(),
      }).eq('email', email).eq('city_id', cityId);
      if (error) return error;
    } else {
      const { error } = await admin.from('authorized_email_city_audit').insert({
        email, city_id: cityId, role: entry.role, created_by: actor.id,
        created_by_email: actor.email, created_by_name: actor.name,
        updated_by: actor.id, updated_by_email: actor.email,
        updated_by_name: actor.name,
      });
      if (error?.code === '23505') {
        const { error: retryError } = await admin.from('authorized_email_city_audit').update({
          role: entry.role, updated_by: actor.id, updated_by_email: actor.email,
          updated_by_name: actor.name, updated_at: new Date().toISOString(),
        }).eq('email', email).eq('city_id', cityId);
        if (retryError) return retryError;
      } else if (error) return error;
    }
  }
  return null;
};

const getCityAuthorizationAudit = async (
  admin: ReturnType<typeof createClient>,
  emails: string[],
  cityIds?: string[],
) => {
  const normalizedEmails = [...new Set(emails.map(value => value.trim().toLowerCase()).filter(Boolean))];
  if (!normalizedEmails.length) return [];
  let query = admin.from('authorized_email_city_audit')
    .select('email, city_id, role, created_by_email, created_by_name, created_at, updated_by_email, updated_by_name, updated_at')
    .in('email', normalizedEmails).limit(5000);
  if (cityIds?.length) query = query.in('city_id', cityIds);
  const { data, error } = await query;
  if (error) throw error;
  const cities = [...new Set((data ?? []).map((row: any) => row.city_id).filter(Boolean))];
  const { data: cityRows, error: citiesError } = cities.length
    ? await admin.from('cities').select('id,name').in('id', cities).limit(500)
    : { data: [], error: null };
  if (citiesError) throw citiesError;
  const cityById = new Map((cityRows ?? []).map((city: any) => [city.id, city.name]));
  return (data ?? []).map((row: any) => ({
    ...row,
    city_name: cityById.get(row.city_id) ?? 'Cidade',
  }));
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

  const [{ data: profile, error: profileError }, { data: masterValue, error: masterError }, { data: adminValue, error: adminError }, { data: activeCityId, error: cityError }] = await Promise.all([
    caller.from('profiles').select('role,email,display_name').eq('id', user.id).single(),
    caller.rpc('is_master_admin'),
    caller.rpc('is_admin'),
    caller.rpc('current_city_id'),
  ]);
  const isMaster = !masterError && masterValue === true;
  const isCityAdmin = !profileError && profile?.role === 'admin' && !isMaster && !adminError && adminValue === true && !cityError && Boolean(activeCityId);
  if (!isMaster && !isCityAdmin) return respond({ error: 'Apenas administradores autorizados podem gerenciar acessos.' }, 403);

  let payload: { action?: string; email?: string; temporaryPassword?: string; userId?: string; role?: string; city_id?: string; city_ids?: string[]; city_roles?: Array<{ city_id?: string; role?: string }> };
  try {
    payload = await request.json();
  } catch {
    return respond({ error: 'Informe um e-mail válido.' }, 400);
  }
  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!['delete', 'list_google_authorized', 'list_local_admins'].includes(payload.action ?? '') && !emailPattern.test(email)) return respond({ error: 'Informe um e-mail válido.' }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (isCityAdmin) {
    if (payload.action === 'authorize-city-operator') {
      const { error } = await caller.rpc('admin_authorize_city_operator', { p_email: email });
      if (error) return respond({ error: error.message || 'Não foi possível autorizar o operador nesta cidade.' }, error.code === '42501' ? 403 : 400);
      const auditError = await recordCityAuthorizations(admin, [{ email, city_id: String(activeCityId), role: 'operator' }], { id: user.id, email: String(user.email ?? profile?.email ?? '').trim().toLowerCase(), name: String(profile?.display_name ?? '').trim() });
      return respond({ ok: true, authorized: true, email, role: 'operator', city_id: activeCityId, authorshipRecorded: !auditError, warning: auditError ? 'A autorização foi aplicada, mas a autoria não pôde ser registrada. Avise o administrador master.' : undefined });
    }
    if (payload.action === 'list_google_authorized') {
      const { data: rows, error } = await admin.from('authorized_emails')
        .select('email, role, city_id, city_ids, city_roles, created_at')
        .order('created_at', { ascending: false }).limit(500);
      if (error) return respond({ error: 'Não foi possível carregar os operadores autorizados.' }, 500);
      const scoped = (rows ?? []).filter(row => {
        if (Array.isArray(row.city_roles)) return row.city_roles.some((entry: any) => entry?.city_id === activeCityId && entry?.role === 'operator');
        const hasCity = row.city_id === activeCityId || (Array.isArray(row.city_ids) && row.city_ids.includes(activeCityId));
        return hasCity && row.role === 'operator';
      }).map(row => ({ email: row.email, role: 'operator', created_at: row.created_at }));
      try {
        const audit = await getCityAuthorizationAudit(admin, scoped.map(row => row.email), [String(activeCityId)]);
        for (const entry of scoped) entry.city_authorizations = audit.filter((item: any) => item.email === String(entry.email).toLowerCase());
      } catch { /* Existing access remains visible if historical audit data is unavailable. */ }
      return respond({ ok: true, emails: scoped });
    }
    return respond({ error: 'Administradores locais só podem autorizar operadores na própria cidade.' }, 403);
  }

  if (payload.action === 'list_google_authorized') {
    const { data: emails, error } = await admin
      .from('authorized_emails')
      .select('email, role, city_id, city_ids, city_roles, created_at')
      .order('created_at', { ascending: false })
      .limit(250);
    if (error) return respond({ error: 'Não foi possível carregar os e-mails autorizados.' }, 500);
    const rows = emails ?? [];
    try {
      const audit = await getCityAuthorizationAudit(admin, rows.map(row => row.email));
      for (const entry of rows) entry.city_authorizations = audit.filter((item: any) => item.email === String(entry.email).toLowerCase());
    } catch {
      return respond({ error: 'Os acessos foram carregados, mas não foi possível consultar a autoria. Atualize a página e tente novamente.' }, 500);
    }
    return respond({ ok: true, emails: rows });
  }

  if (payload.action === 'list_local_admins') {
    if (!isMaster) return respond({ error: 'Somente o administrador master pode consultar administradores de outras cidades.' }, 403);
    const { data: memberships, error: membershipsError } = await admin.from('city_memberships')
      .select('user_id, city_id, created_by, created_at')
      .eq('role', 'admin')
      .eq('is_master', false)
      .limit(2000);
    if (membershipsError) return respond({ error: 'Não foi possível carregar os administradores locais.' }, 500);
    const userIds = [...new Set((memberships ?? []).map(row => row.user_id).filter(Boolean))];
    const cityIds = [...new Set((memberships ?? []).map(row => row.city_id).filter(Boolean))];
    if (!userIds.length) return respond({ ok: true, admins: [] });
    const creatorIds = [...new Set((memberships ?? []).map(row => row.created_by).filter(Boolean))];
    const [{ data: profiles, error: profilesError }, { data: cities, error: citiesError }, { data: creators, error: creatorsError }] = await Promise.all([
      admin.from('profiles').select('id, email, display_name, role, created_at').in('id', userIds).limit(1000),
      cityIds.length ? admin.from('cities').select('id, name').in('id', cityIds).limit(500) : Promise.resolve({ data: [], error: null }),
      creatorIds.length ? admin.from('profiles').select('id, email, display_name').in('id', creatorIds).limit(1000) : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesError || citiesError || creatorsError) return respond({ error: 'Não foi possível carregar os dados dos administradores locais.' }, 500);
    const cityById = new Map((cities ?? []).map(city => [city.id, city]));
    const creatorById = new Map((creators ?? []).map(profile => [profile.id, profile]));
    const membershipsByUser = new Map<string, Array<{ id: string; name: string; created_at: string; created_by_email: string | null; created_by_name: string | null }>>();
    for (const membership of memberships ?? []) {
      const city = cityById.get(membership.city_id);
      const creator = creatorById.get(membership.created_by);
      const current = membershipsByUser.get(membership.user_id) ?? [];
      if (city && !current.some(item => item.id === city.id)) current.push({
        id: city.id, name: city.name, created_at: membership.created_at,
        created_by_email: creator?.email ?? null, created_by_name: creator?.display_name ?? null,
      });
      membershipsByUser.set(membership.user_id, current);
    }
    const admins = (profiles ?? []).map(profile => ({
      email: profile.email,
      display_name: profile.display_name,
      role: profile.role,
      created_at: profile.created_at,
      cities: membershipsByUser.get(profile.id) ?? [],
    })).filter(profile => profile.email);
    try {
      const audit = await getCityAuthorizationAudit(admin, admins.map(profile => profile.email), cityIds);
      for (const entry of admins) entry.city_authorizations = audit.filter((item: any) => item.email === String(entry.email).toLowerCase());
    } catch { /* Membership creator snapshots remain available as a fallback. */ }
    return respond({ ok: true, admins });
  }

  if (payload.action === 'set-google-role') {
    const role = String(payload.role ?? '');
    if (!['operator', 'admin'].includes(role)) return respond({ error: 'Escolha Operador ou Administrador.' }, 400);
    const { data: master, error: masterError } = await caller.rpc('is_master_admin');
    if (masterError || master !== true) return respond({ error: 'Somente o administrador master pode alterar o perfil base.' }, 403);

    const { data: authorizationRow, error: authorizationLookupError } = await admin
      .from('authorized_emails').select('email, role').eq('email', email).maybeSingle();
    if (authorizationLookupError) return respond({ error: 'Não foi possível consultar esta autorização.' }, 500);
    if (!authorizationRow) return respond({ error: 'Este e-mail não está na lista de autorizados.' }, 404);

    const { data: targetProfile, error: targetProfileError } = await admin
      .from('profiles').select('id, role').eq('email', email).maybeSingle();
    if (targetProfileError) return respond({ error: 'Não foi possível consultar o perfil deste e-mail.' }, 500);
    if (targetProfile?.id === user.id || email === String(user.email ?? '').trim().toLowerCase()) {
      return respond({ error: 'Você não pode alterar o próprio perfil.' }, 400);
    }
    if (targetProfile?.role === 'disabled') return respond({ error: 'Este usuário está desativado. Reative a conta em Usuários cadastrados antes de alterar o perfil.' }, 409);
    if (targetProfile?.role === 'admin' && role === 'operator') {
      const { count, error: countError } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if (countError) return respond({ error: 'Não foi possível verificar os administradores ativos.' }, 500);
      if ((count ?? 0) <= 1) return respond({ error: 'Não é possível rebaixar o último administrador.' }, 409);
    }

    if (targetProfile?.id) {
      const { error: roleError } = await caller.rpc('master_set_user_account_role', {
        p_user_id: targetProfile.id, p_role: role,
      });
      if (roleError) return respond({ error: roleError.message || 'Não foi possível atualizar o perfil da conta.' }, 400);
    } else {
      const { error: updateError } = await admin.from('authorized_emails').update({ role }).eq('email', email);
      if (updateError) return respond({ error: 'Não foi possível atualizar o perfil do e-mail autorizado.' }, 500);
    }

    const { data: verified, error: verifyError } = await admin
      .from('authorized_emails').select('role, city_roles, city_ids').eq('email', email).maybeSingle();
    if (verifyError || verified?.role !== role) return respond({ error: 'A alteração não pôde ser confirmada. Atualize a lista e tente novamente.' }, 500);
    return respond({ ok: true, email, role, city_roles: verified.city_roles, city_ids: verified.city_ids });
  }

  if (payload.action === 'update-google-cities') {
    const { data: master, error: masterError } = await caller.rpc('is_master_admin');
    if (masterError || master !== true) return respond({ error: 'Somente o administrador master pode alterar os perfis por cidade.' }, 403);
    const requestedCityRoles = Array.isArray(payload.city_roles) ? payload.city_roles.map(item => ({
      city_id: String(item?.city_id ?? '').trim(),
      role: String(item?.role ?? '').trim(),
    })) : [];
    if (!requestedCityRoles.length || requestedCityRoles.some(item => !item.city_id || !['operator', 'admin'].includes(item.role)) ||
        new Set(requestedCityRoles.map(item => item.city_id)).size !== requestedCityRoles.length) {
      return respond({ error: 'Selecione ao menos uma cidade e escolha um perfil válido em cada uma.' }, 400);
    }
    const cityIds = requestedCityRoles.map(item => item.city_id);
    const { data: cities, error: cityError } = await caller.rpc('list_my_cities');
    if (cityError || !Array.isArray(cities)) return respond({ error: 'Não foi possível consultar suas cidades autorizadas agora. Atualize a página e tente novamente.' }, 503);
    const availableById = new Map(cities.map((city: any) => [String(city.id), city]));
    const missing = cityIds.filter(id => !availableById.has(id));
    const inactive = cityIds.map(id => availableById.get(id)).filter(city => city && city.active !== true).map(city => city.name);
    if (missing.length || inactive.length) {
      const details = [...inactive, ...(missing.length ? ['cidade não encontrada'] : [])].join(', ');
      return respond({ error: 'Não foi possível salvar os acessos: ' + details + '. Atualize a lista de cidades e tente novamente.' }, 400);
    }
    const { data: authorizationRow, error: authorizationLookupError } = await admin
      .from('authorized_emails').select('email, role, city_id, city_ids, city_roles').eq('email', email).maybeSingle();
    if (authorizationLookupError) return respond({ error: 'Não foi possível consultar esta autorização.' }, 500);
    if (!authorizationRow) return respond({ error: 'Este e-mail não está na lista de autorizados.' }, 404);
    const { data: targetProfile, error: targetProfileError } = await admin
      .from('profiles').select('id, role').eq('email', email).maybeSingle();
    if (targetProfileError) return respond({ error: 'Não foi possível consultar o perfil deste e-mail.' }, 500);
    if (targetProfile?.id === user.id || email === String(user.email ?? '').trim().toLowerCase()) {
      return respond({ error: 'Você não pode alterar os próprios acessos.' }, 400);
    }
    if (targetProfile?.role === 'disabled') return respond({ error: 'Este usuário está desativado. Reative a conta antes de alterar as cidades.' }, 409);

    const { error: updateError } = await admin.from('authorized_emails').update({
      city_id: cityIds[0], city_ids: cityIds, city_roles: requestedCityRoles,
    }).eq('email', email);
    if (updateError) return respond({ error: 'Não foi possível salvar os perfis por cidade.' }, 500);

    if (targetProfile && ['operator', 'admin'].includes(targetProfile.role)) {
      const { error: membershipError } = await caller.rpc('master_replace_user_city_roles', {
        p_user_id: targetProfile.id, p_city_roles: requestedCityRoles,
      });
      if (membershipError) {
        const { error: rollbackError } = await admin.from('authorized_emails').update({
          role: authorizationRow.role, city_id: authorizationRow.city_id,
          city_ids: authorizationRow.city_ids, city_roles: authorizationRow.city_roles,
        }).eq('email', email);
        return respond({ error: rollbackError
          ? 'Não foi possível atualizar os perfis por cidade nem restaurar a autorização anterior. Peça ao administrador master para conferir o acesso.'
          : 'Não foi possível atualizar os vínculos por cidade. A autorização anterior foi mantida.' }, 400);
      }
    }
    const auditError = await recordCityAuthorizations(admin, requestedCityRoles.map(item => ({ email, city_id: item.city_id, role: item.role })), { id: user.id, email: String(user.email ?? profile?.email ?? '').trim().toLowerCase(), name: String(profile?.display_name ?? '').trim() });
    return respond({ ok: true, email, city_ids: cityIds, city_roles: requestedCityRoles, authorshipRecorded: !auditError, warning: auditError ? 'Os acessos foram salvos, mas a autoria não pôde ser registrada. Avise o administrador master.' : undefined });
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
      const { error } = await admin.from('profiles').update({ role: 'disabled' }).eq('id', targetProfile.id);
      if (error) return respond({ error: 'Não foi possível bloquear o perfil deste usuário.' }, 500);
    }
    const { data: authorized, error: lookupError } = await admin.from('authorized_emails').select('email,role').eq('email', email).maybeSingle();
    if (lookupError) return respond({ error: 'Não foi possível consultar a autorização deste e-mail.' }, 500);
    const { error: codeCleanupError } = await admin.from('email_first_access_codes').delete().eq('email', email);
    if (codeCleanupError) return respond({ error: 'Não foi possível invalidar os códigos pendentes deste e-mail.' }, 500);
    const { error: revokeError } = await admin.from('authorized_emails').delete().eq('email', email);
    if (revokeError) {
      if (targetProfile && targetProfile.role !== 'disabled') await admin.from('profiles').update({ role: targetProfile.role }).eq('id', targetProfile.id);
      return respond({ error: 'Não foi possível remover este e-mail da lista autorizada.' }, 500);
    }
    return respond({ ok: true, revoked: true, had_authorization: Boolean(authorized) });
  }

  if (payload.action === 'authorize-google') {
    try {
    const requestedCityRoles = Array.isArray(payload.city_roles) ? payload.city_roles.map(item => ({
      city_id: String(item?.city_id ?? '').trim(),
      role: String(item?.role ?? '').trim(),
    })) : [];
    if (requestedCityRoles.some(item => !item.city_id || !['operator', 'admin'].includes(item.role)) ||
        new Set(requestedCityRoles.map(item => item.city_id)).size !== requestedCityRoles.length) {
      return respond({ error: 'Escolha um perfil válido para cada cidade.' }, 400);
    }
    const legacyCityIds = Array.isArray(payload.city_ids) ? payload.city_ids : (payload.city_id ? [payload.city_id] : []);
    const cityIds = [...new Set((requestedCityRoles.length ? requestedCityRoles.map(item => item.city_id) : legacyCityIds).map(value => String(value).trim()).filter(Boolean))];
    if (cityIds.length) {
      const { data: master, error: masterError } = await caller.rpc('is_master_admin');
      if (masterError || master !== true) return respond({ error: 'Somente o administrador master pode atribuir cidades nesta autorização.' }, 403);
      const { data: cities, error: cityError } = await caller.rpc('list_my_cities');
      if (cityError || !Array.isArray(cities)) return respond({ error: 'Não foi possível consultar suas cidades autorizadas agora. Atualize a página e tente novamente.' }, 503);
      const availableById = new Map(cities.map((city: any) => [String(city.id), city]));
      const missing = cityIds.filter(id => !availableById.has(id));
      const inactive = cityIds.map(id => availableById.get(id)).filter(city => city && city.active !== true).map(city => city.name);
      if (missing.length || inactive.length) {
        const details = [...inactive, ...(missing.length ? ['cidade não encontrada'] : [])].join(', ');
        return respond({ error: 'Não foi possível autorizar: ' + details + '. Atualize a lista de cidades e tente novamente.' }, 400);
      }
    }
    const { data: existing, error: lookupError } = await admin
      .from('authorized_emails').select('email, role, city_id, city_ids, city_roles').eq('email', email).maybeSingle();
    if (lookupError) return respond({ error: 'Não foi possível consultar a lista de e-mails autorizados.' }, 500);

    const { data: disabledProfile, error: disabledProfileError } = await admin
      .from('profiles').select('id').eq('email', email).eq('role', 'disabled').limit(1).maybeSingle();
    if (disabledProfileError) return respond({ error: 'Não foi possível verificar o perfil deste e-mail.' }, 500);
    if (disabledProfile) return respond({ error: 'O perfil está desativado. Reative-o na lista de Usuários antes de gerar um código.' }, 409);

    let role: string = requestedCityRoles[0]?.role || (existing?.role === 'admin' ? 'admin' : 'operator');
    const alreadyAuthorized = Boolean(existing);
    const cityRolesToSave = requestedCityRoles.length
      ? requestedCityRoles
      : cityIds.map(city_id => ({ city_id, role }));
    if (!cityIds.length || !cityRolesToSave.length) {
      return respond({ error: 'Selecione ao menos uma cidade e uma função antes de autorizar o e-mail.' }, 400);
    }
    // Upsert makes a repeated/concurrent authorization apply the latest city and role choices
    // instead of treating a unique-key race as a successful no-op.
    const { error: authorizationWriteError } = await admin.from('authorized_emails').upsert({
      email, role, city_id: cityIds[0], city_ids: cityIds, city_roles: cityRolesToSave,
    }, { onConflict: 'email' });
    if (authorizationWriteError) {
      return respond({ error: 'Não foi possível salvar a autorização. Nenhuma confirmação de acesso foi emitida.' }, 500);
    }

    const { data: authorized, error: authorizedError } = await admin
      .from('authorized_emails').select('email, role, city_id, city_ids, city_roles').eq('email', email).single();
    if (authorizedError || !authorized) return respond({ error: 'Não foi possível confirmar a autorização do e-mail.' }, 500);
    role = authorized.role;
    const savedCityRoles = Array.isArray(authorized.city_roles) ? authorized.city_roles : [];
    const expectedCityRoles = new Map(cityRolesToSave.map(item => [item.city_id, item.role]));
    const savedCityRoleMap = new Map(savedCityRoles.map((item: any) => [String(item?.city_id ?? ''), String(item?.role ?? '')]));
    if (savedCityRoleMap.size !== expectedCityRoles.size ||
        [...expectedCityRoles].some(([cityId, cityRole]) => savedCityRoleMap.get(cityId) !== cityRole)) {
      return respond({ error: 'A autorização foi gravada, mas a cidade e o perfil não foram confirmados. Revise os acessos antes do primeiro login.' }, 500);
    }

    if (!['operator', 'admin'].includes(role)) {
      return respond({ error: 'Este papel não pode receber um código de primeiro acesso.' }, 409);
    }
    const { data: pendingProfiles, error: pendingError } = await admin
      .from('profiles').select('id').eq('email', email).eq('role', 'pending').limit(10);
    if (pendingError) return respond({ error: 'O e-mail foi autorizado, mas não foi possível atualizar um perfil pendente.' }, 500);
    for (const pending of pendingProfiles ?? []) {
      const { error: roleError } = await caller.rpc('admin_set_user_role', {
        target_user_id: pending.id, target_role: role,
      });
      if (roleError) return respond({ error: 'O e-mail foi autorizado, mas não foi possível atualizar um perfil pendente.' }, 500);
    }

    if (cityIds.length) {
      const { data: profilesToAssign, error: assignmentLookupError } = await admin
        .from('profiles').select('id').eq('email', email).in('role', ['operator', 'admin']);
      if (assignmentLookupError) return respond({ error: 'O e-mail foi autorizado, mas não foi possível localizar o perfil para atribuir cidades.' }, 500);
      for (const existingProfile of profilesToAssign ?? []) {
        const { error: assignmentError } = await caller.rpc('master_replace_user_city_roles', {
          p_user_id: existingProfile.id, p_city_roles: cityRolesToSave,
        });
        if (assignmentError) return respond({ error: 'O e-mail foi autorizado, mas as cidades não puderam ser atribuídas ao perfil existente.' }, 500);
        const { data: confirmedMemberships, error: membershipCheckError } = await admin
          .from('city_memberships').select('city_id, role').eq('user_id', existingProfile.id).eq('is_master', false);
        if (membershipCheckError) return respond({ error: 'Não foi possível confirmar os acessos por cidade do perfil existente.' }, 500);
        const memberships = new Map((confirmedMemberships ?? []).map((item: any) => [String(item.city_id), String(item.role)]));
        if (memberships.size !== expectedCityRoles.size ||
            [...expectedCityRoles].some(([cityId, cityRole]) => memberships.get(cityId) !== cityRole)) {
          return respond({ error: 'Os acessos por cidade não coincidem com a seleção. O primeiro acesso foi bloqueado para evitar perfil incorreto.' }, 500);
        }
      }
    }
    const auditError = cityRolesToSave.length ? await recordCityAuthorizations(admin, cityRolesToSave.map(item => ({ email, city_id: item.city_id, role: item.role })), { id: user.id, email: String(user.email ?? profile?.email ?? '').trim().toLowerCase(), name: String(profile?.display_name ?? '').trim() }) : null;
    const { code, error: codeError } = await issueActivationCode(admin, email, user.id);
    if (codeError || !code) {
      // The Google allowlist write is authoritative. The optional WhatsApp/password code
      // must never turn a successful Google authorization into an apparent failure.
      console.error('[authorize-google] optional first-access code generation failed', codeError?.code ?? 'unknown');
      return respond({ ok: true, authorized: true, role, already_authorized: alreadyAuthorized, firstAccessCode: null, codeUnavailable: true, authorshipRecorded: !auditError, warning: auditError ? 'A autorização foi aplicada, mas a autoria não pôde ser registrada.' : undefined });
    }
    return respond({ ok: true, authorized: true, role, already_authorized: alreadyAuthorized, city_id: authorized.city_id, city_ids: authorized.city_ids, city_roles: authorized.city_roles, firstAccessCode: code, codeUnavailable: false, authorshipRecorded: !auditError, warning: auditError ? 'A autorização foi aplicada, mas a autoria não pôde ser registrada.' : undefined });
    } catch (error) {
      // Return the persisted allowlist state if a later optional step unexpectedly fails.
      const { data: persisted } = await admin.from('authorized_emails').select('role, city_id, city_ids, city_roles').eq('email', email).maybeSingle();
      if (persisted && ['operator', 'admin'].includes(persisted.role)) {
        console.error('[authorize-google] authorized; optional step failed', error instanceof Error ? error.name : 'UnknownError');
        return respond({ ok: true, authorized: true, role: persisted.role, already_authorized: true, city_id: persisted.city_id, city_ids: persisted.city_ids, city_roles: persisted.city_roles, firstAccessCode: null, codeUnavailable: true });
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
    // A rotina transacional do banco preserva todas as referências e auditorias,
    // valida o último administrador e mantém os registros em suas cidades.
    const { error: prepareError } = await caller.rpc('master_prepare_user_deletion', {
      p_target_user_id: targetId,
    });
    if (prepareError) {
      return respond({ error: prepareError.message || 'Não foi possível preparar a exclusão com segurança. Nenhuma conta foi excluída.' }, prepareError.code === '42501' ? 403 : 400);
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


