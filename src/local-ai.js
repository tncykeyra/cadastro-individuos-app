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

export async function extractSmartTextLocally(rawText, onProgress = () => {}) {
  if (!globalThis.navigator?.gpu) throw new Error('Este aparelho ou navegador não oferece WebGPU.');
  const text = String(rawText ?? '').trim().slice(0, 5000);
  if (!text) throw new Error('Digite as informações antes de analisar.');
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  if (!enginePromise) {
    enginePromise = CreateMLCEngine(MODEL_ID, {
      initProgressCallback: progress => onProgress(progress?.text || 'Baixando o modelo local pela primeira vez…')
    }).catch(error => { enginePromise = null; throw error; });
  }
  onProgress('Carregando a IA generativa no aparelho…');
  const engine = await enginePromise;
  onProgress('Interpretando o texto localmente…');
  const response = await engine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: 'Interprete texto em português brasileiro para preparar cadastros. Responda somente um objeto JSON com as chaves person e vehicle. person aceita full_name, rg, birthday, address_primary, notes. vehicle aceita make, model, color, notes. Todos os valores são strings. Não invente dados; use string vazia quando ausente. Mantenha relatos sem campo específico em notes, sem mudar o sentido. Não use CPF nem placa reconhecidos por inferência: deixe esses campos fora do resultado. Não classifique suspeitas como fatos.'
      },
      { role: 'user', content: JSON.stringify(text) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 700
  });
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('A IA local não retornou dados estruturados.');
  const parsed = JSON.parse(content);
  onProgress('Conferindo os campos reconhecidos…');
  return {
    person: cleanObject(parsed.person, fields.person),
    vehicle: cleanObject(parsed.vehicle, fields.vehicle)
  };
}
