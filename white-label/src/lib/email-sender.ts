export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSenderConfig {
  provider: 'sendgrid' | 'mailgun' | 'ses' | 'smtp' | 'shared';
  fromEmail: string;
  fromName: string;
  apiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
}

export interface EmailSenderDeps {
  sendHttp: (url: string, options: RequestInit) => Promise<{ ok: boolean; status: number }>;
}

export async function sendEmail(
  payload: EmailPayload,
  config: EmailSenderConfig,
  deps: EmailSenderDeps,
): Promise<void> {
  switch (config.provider) {
    case 'sendgrid':
      return sendViaSendGrid(payload, config, deps);
    case 'mailgun':
      return sendViaMailgun(payload, config, deps);
    case 'shared':
    default:
      return sendViaSharedSendGrid(payload, config, deps);
  }
}

async function sendViaSendGrid(
  payload: EmailPayload,
  config: EmailSenderConfig,
  deps: EmailSenderDeps,
): Promise<void> {
  const res = await deps.sendHttp('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: payload.to }] }],
      from: { email: config.fromEmail, name: config.fromName },
      subject: payload.subject,
      content: [
        { type: 'text/plain', value: payload.text },
        { type: 'text/html', value: payload.html },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`SendGrid error: ${res.status}`);
  }
}

async function sendViaMailgun(
  payload: EmailPayload,
  config: EmailSenderConfig,
  deps: EmailSenderDeps,
): Promise<void> {
  const domain = config.fromEmail.split('@')[1];
  const formData = new URLSearchParams({
    from: `${config.fromName} <${config.fromEmail}>`,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  const res = await deps.sendHttp(
    `https://api.mailgun.net/v3/${domain}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    },
  );
  if (!res.ok) {
    throw new Error(`Mailgun error: ${res.status}`);
  }
}

async function sendViaSharedSendGrid(
  payload: EmailPayload,
  config: EmailSenderConfig,
  deps: EmailSenderDeps,
): Promise<void> {
  // Použije platform SendGrid klíč z env
  const apiKey = process.env['SENDGRID_API_KEY'] ?? '';
  return sendViaSendGrid(payload, { ...config, apiKey, provider: 'sendgrid' }, deps);
}
