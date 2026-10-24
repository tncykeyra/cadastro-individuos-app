import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return Response.json({ error: 'Método não permitido.' }, { status: 405, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization = request.headers.get('Authorization');
  if (!authorization) return Response.json({ error: 'Sessão necessária.' }, { status: 401, headers: cors });

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return Response.json({ error: 'Sessão inválida.' }, { status: 401, headers: cors });

  const { data: profile, error: profileError } = await caller.from('profiles').select('role').eq('id', user.id).single();
  if (profileError || profile?.role !== 'admin') return Response.json({ error: 'Apenas administradores podem convidar usuários.' }, { status: 403, headers: cors });

  let email = '';
  try { email = String((await request.json()).email ?? '').trim().toLowerCase(); }
  catch { return Response.json({ error: 'Informe um e-mail válido.' }, { status: 400, headers: cors }); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: 'Informe um e-mail válido.' }, { status: 400, headers: cors });

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.auth.admin.inviteUserByEmail(email);
  if (error) return Response.json({ error: error.message }, { status: 400, headers: cors });
  return Response.json({ ok: true }, { status: 200, headers: cors });
});

