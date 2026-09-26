import { loadEnv } from '../env';

export interface MailResult {
  entregue: boolean;
  /** Quando SMTP não está configurado, o conteúdo que deveria ir por e-mail. */
  alternativo?: string;
}

/**
 * Envio via SMTP (Nodemailer) usando EMAIL_HOST/PORT/USER/PASS/FROM.
 * Sem SMTP configurado, devolve { entregue: false, alternativo } para o
 * chamador logar (modo desenvolvimento) sem quebrar o fluxo.
 */
export async function enviarEmail(opts: {
  para: string;
  assunto: string;
  texto: string;
}): Promise<MailResult> {
  const env = loadEnv();
  if (!env.EMAIL_HOST) {
    return { entregue: false, alternativo: `${opts.assunto}\n\n${opts.texto}` };
  }
  const { createTransport } = await import('nodemailer');
  const transporter = createTransport({
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT ?? 587,
    secure: env.EMAIL_SECURE ?? false,
    auth: env.EMAIL_USER ? { user: env.EMAIL_USER, pass: env.EMAIL_PASS ?? '' } : undefined,
  });
  await transporter.sendMail({
    from: env.EMAIL_FROM ?? env.EMAIL_USER ?? 'no-reply@logenxoval.local',
    to: opts.para,
    subject: opts.assunto,
    text: opts.texto,
  });
  return { entregue: true };
}