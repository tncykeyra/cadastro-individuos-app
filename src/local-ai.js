const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
let enginePromise = null;

const fields = {
  person: ['full_name', 'rg', 'birthday', 'address_primary', 'notes'],
  vehicle: ['make', 'model', 'color', 'notes']
};

function cleanObject(value, allowed) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(allowed.map(key => [key, String(source[key] ?? '').trim().slice(0, 2000)]));
}

async function getEngine(onProgress) {
  if (!globalThis.navigator?.gpu) throw new Error('Este aparelho ou navegador não oferece WebGPU.');
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  if (!enginePromise) {
    enginePromise = CreateMLCEngine(MODEL_ID, {
      initProgressCallback: progress => onProgress(progress?.text || 'Baixando o modelo local pela primeira vez…')
    }).catch(error => { enginePromise = null; throw error; });
  }
  onProgress('Carregando a IA generativa no aparelho…');
  return enginePromise;
}

async function requestStructured(messages, onProgress) {
  const engine = await getEngine(onProgress);
  onProgress('Interpretando localmente…');
  const response = await engine.chat.completions.create({
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 900
  });
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('A IA local não retornou dados estruturados.');
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  onProgress('Conferindo os campos reconhecidos…');
  return parsed;
}

const extractionRules = 'Interprete texto em português brasileiro para preparar cadastros. Responda somente JSON com person e vehicle. person aceita full_name, rg, birthday, address_primary, notes; vehicle aceita make, model, color, notes. Todos strings. Não inclua CPF ou placa: esses identificadores são extraídos por validação determinística. Não invente dados; use string vazia quando ausente. Mantenha informações sem campo próprio em notes, sem mudar significado, sem transformar suspeitas em fatos.';

export async function extractSmartTextLocally(rawText, onProgress = () => {}) {
  const text = String(rawText ?? '').trim().slice(0, 5000);
  if (!text) throw new Error('Digite as informações antes de analisar.');
  const parsed = await requestStructured([
    { role: 'system', content: extractionRules },
    { role: 'user', content: JSON.stringify(text) }
  ], onProgress);
  return {
    person: cleanObject(parsed.person, fields.person),
    vehicle: cleanObject(parsed.vehicle, fields.vehicle)
  };
}

export async function replyToSmartConversation({ messages = [], kind = 'person', draft = {} } = {}, onProgress = () => {}) {
  const recent = messages.slice(-12).map(message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content ?? '').slice(0, 1200)
  }));
  if (!recent.some(message => message.role === 'user')) throw new Error('Envie uma mensagem antes de analisar.');
  const parsed = await requestStructured([
    {
      role: 'system',
      content: extractionRules + ' Esta é uma conversa de cadastro. Considere as mensagens em ordem: informações posteriores podem corrigir ou complementar as anteriores. Preserve os dados já confirmados no rascunho quando não houver correção explícita. Gere também reply, uma resposta curta e natural em português que diga o que entendeu ou pergunte apenas um esclarecimento necessário. Não afirme que salvou nada. Não execute ações.'
    },
    {
      role: 'user',
      content: JSON.stringify({
        tipo_em_foco: kind === 'vehicle' ? 'veículo' : 'indivíduo',
        rascunho_atual: draft,
        mensagens_da_conversa: recent
      })
    }
  ], onProgress);
  return {
    person: cleanObject(parsed.person, fields.person),
    vehicle: cleanObject(parsed.vehicle, fields.vehicle),
    reply: String(parsed.reply || 'Atualizei a ficha provisória. Confira os dados antes de continuar.').trim().slice(0, 500)
  };
}
