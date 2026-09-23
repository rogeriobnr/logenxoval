const ASSINATURA_SALT = 'logenxoval:assinatura';

/** Assinatura determinística da matrícula (SHA-256 hex) enviada com a operação. */
export async function assinarMatricula(matricula: string): Promise<string> {
  const data = new TextEncoder().encode(`${ASSINATURA_SALT}:${matricula}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}