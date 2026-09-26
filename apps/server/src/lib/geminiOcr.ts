export class GeminiOcrError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'GeminiOcrError';
    this.status = status;
  }
}

export const MODELO_GEMINI = 'gemini-2.0-flash';

export const PROMPT_FOLHA_ENXOVAL =
  'Transcreva o conteúdo desta folha de enxoval (impressa, fotografada ou PDF) ' +
  'somente como texto, sem comentários, em português. Cada item deve ocupar uma única linha, ' +
  'mantendo: o código numérico SAP (6 a 8 dígitos, quando existir), a descrição, a quantidade ' +
  '(número) e a unidade de medida quando houver. Preserve exatamente números, palavras e ordem ' +
  'como aparecem. Ignore cabeçalhos, logotipos e rodapés.';

export interface AnalisarImagemGeminiParams {
  apiKey: string;
  base64: string;
  mime: string;
  prompt?: string;
  fetchImpl?: typeof fetch;
}

export interface GeminiOcrResult {
  texto: string;
}

function pickFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? globalThis.fetch;
}

/**
 * Envia a imagem/PDF (base64) para o Google Gemini e devolve o texto transcrito.
 * Usa `fetchImpl` injetável (padrão: global fetch) para permitir testes.
 */
export async function analisarImagemGemini(params: AnalisarImagemGeminiParams): Promise<GeminiOcrResult> {
  const { apiKey, base64, mime, prompt = PROMPT_FOLHA_ENXOVAL } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${apiKey}`;

  let res: Response;
  try {
    res = await pickFetch(params.fetchImpl)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: mime, data: base64 } }, { text: prompt }] }],
        generationConfig: { responseMimeType: 'text/plain', temperature: 0.2 },
      }),
    });
  } catch (err) {
    throw new GeminiOcrError(err instanceof Error ? `Falha ao acessar o serviço de IA: ${err.message}` : 'Falha ao acessar o serviço de IA');
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new GeminiOcrError('O serviço de IA devolveu uma resposta inválida.');
  }

  if (!res.ok) {
    const body = data as { error?: { message?: string } };
    throw new GeminiOcrError(body?.error?.message ?? `Serviço de IA respondeu ${res.status}.`, res.status);
  }

  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  const texto = (candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();

  if (!texto) throw new GeminiOcrError('O serviço de IA não retornou texto reconhecido.');
  return { texto };
}