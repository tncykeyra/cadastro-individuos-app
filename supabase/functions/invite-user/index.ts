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

  let payload: { action?: string; email?: string; temporaryPassword?: string };
  try {
    payload = await request.json();
  } catch {
    return respond({ error: 'Informe um e-mail válido.' }, 400);
  }
  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!emailPattern.test(email)) return respond({ error: 'Informe um e-mail válido.' }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (payload.action === 'create') {
    const temporaryPassword = String(payload.temporaryPassword ?? '');
    if (temporaryPassword.length < 12) {
      return respond({ error: 'A senha provisória deve ter pelo menos 12 caracteres.' }, 400);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) {
        return respond({ error: 'Esse e-mail já possui uma conta. Confira a aba de usuários cadastrados.' }, 409);
      }
      return respond({ error: 'Não foi possível criar a conta: ' + error.message }, 400);
    }
    return respond({ ok: true, user_id: data.user.id }, 201);
  }

  if (payload.action !== 'invite') return respond({ error: 'Ação inválida.' }, 400);
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { must_change_password: true },
    redirectTo: appUrl,
  });
  if (!inviteError) return respond({ ok: true, email_sent: true });

  // If SMTP is unavailable or an invite already created an unconfirmed user,
  // provide a one-time link that the administrator can deliver through another channel.
  const { data: generated, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { data: { must_change_password: true }, redirectTo: appUrl },
  });
  const inviteLink = generated?.properties?.action_link;
  if (!linkError && inviteLink) {
    return respond({
      ok: true,
      email_sent: false,
      invite_link: inviteLink,
      message: 'O e-mail automático falhou; use o link de convite abaixo.',
    });
  }
  if (/smtp|email|mail|send/i.test(inviteError.message)) {
    return respond({
      error: 'O Supabase não conseguiu enviar o e-mail nem gerar um link. Use “Cadastrar sem convite” ou configure o envio de e-mails.',
    }, 502);
  }
  if (/already|registered|exists/i.test(inviteError.message)) {
    return respond({
      error: 'Esse e-mail já tem uma conta. Confira a aba “Usuários cadastrados”.',
    }, 409);
  }
  return respond({ error: 'Não foi possível enviar o convite: ' + inviteError.message }, 400);
});
