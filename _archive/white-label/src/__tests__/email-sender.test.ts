import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail, EmailPayload, EmailSenderConfig, EmailSenderDeps } from '../lib/email-sender';

const payload: EmailPayload = {
  to: 'fan@example.com',
  subject: 'Your ticket',
  html: '<p>Hello</p>',
  text: 'Hello',
};

function makeDeps(ok = true, status = 200): EmailSenderDeps & { sendHttp: ReturnType<typeof vi.fn> } {
  const sendHttp = vi.fn().mockResolvedValue({ ok, status });
  return { sendHttp };
}

describe('email-sender', () => {
  beforeEach(() => {
    delete process.env['SENDGRID_API_KEY'];
  });

  it('1. sendgrid: volá správný endpoint s Bearer tokenem', async () => {
    const deps = makeDeps();
    const config: EmailSenderConfig = {
      provider: 'sendgrid',
      fromEmail: 'no-reply@tixly.cz',
      fromName: 'Tixly',
      apiKey: 'SG.test-key',
    };
    await sendEmail(payload, config, deps);
    expect(deps.sendHttp).toHaveBeenCalledTimes(1);
    const [url, options] = deps.sendHttp.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer SG.test-key');
  });

  it('2. sendgrid: hodí chybu při non-2xx response', async () => {
    const deps = makeDeps(false, 401);
    const config: EmailSenderConfig = {
      provider: 'sendgrid',
      fromEmail: 'no-reply@tixly.cz',
      fromName: 'Tixly',
      apiKey: 'bad-key',
    };
    await expect(sendEmail(payload, config, deps)).rejects.toThrow('SendGrid error: 401');
  });

  it('3. mailgun: volá správný endpoint s Basic auth', async () => {
    const deps = makeDeps();
    const config: EmailSenderConfig = {
      provider: 'mailgun',
      fromEmail: 'no-reply@mg.slaviapraha.cz',
      fromName: 'Slavia Praha',
      apiKey: 'mg-key',
    };
    await sendEmail(payload, config, deps);
    const [url, options] = deps.sendHttp.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.mailgun.net/v3/mg.slaviapraha.cz/messages');
    const expectedAuth = `Basic ${Buffer.from('api:mg-key').toString('base64')}`;
    expect((options.headers as Record<string, string>)['Authorization']).toBe(expectedAuth);
  });

  it('4. mailgun: správně extrahuje doménu z from_email', async () => {
    const deps = makeDeps();
    const config: EmailSenderConfig = {
      provider: 'mailgun',
      fromEmail: 'hello@custom-domain.cz',
      fromName: 'Test',
      apiKey: 'key',
    };
    await sendEmail(payload, config, deps);
    const [url] = deps.sendHttp.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('custom-domain.cz');
  });

  it('5. shared: použije SENDGRID_API_KEY z env', async () => {
    process.env['SENDGRID_API_KEY'] = 'SG.env-key';
    const deps = makeDeps();
    const config: EmailSenderConfig = {
      provider: 'shared',
      fromEmail: 'no-reply@tixly.cz',
      fromName: 'Tixly',
    };
    await sendEmail(payload, config, deps);
    const [url, options] = deps.sendHttp.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer SG.env-key');
  });

  it('6. Neznámý provider → použije shared SendGrid', async () => {
    process.env['SENDGRID_API_KEY'] = 'SG.fallback';
    const deps = makeDeps();
    // Cast přes unknown pro testování fallback větve
    const config = {
      provider: 'unknown-provider',
      fromEmail: 'no-reply@tixly.cz',
      fromName: 'Tixly',
    } as unknown as EmailSenderConfig;
    await sendEmail(payload, config, deps);
    const [url] = deps.sendHttp.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
  });

  it('7. sendgrid: payload obsahuje správné from/to/subject', async () => {
    const deps = makeDeps();
    const config: EmailSenderConfig = {
      provider: 'sendgrid',
      fromEmail: 'test@tixly.cz',
      fromName: 'Test Sender',
      apiKey: 'SG.key',
    };
    await sendEmail(payload, config, deps);
    const [, options] = deps.sendHttp.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.from).toEqual({ email: 'test@tixly.cz', name: 'Test Sender' });
    expect(body.personalizations[0].to[0].email).toBe('fan@example.com');
    expect(body.subject).toBe('Your ticket');
  });

  it('8. mailgun: payload je form-urlencoded', async () => {
    const deps = makeDeps();
    const config: EmailSenderConfig = {
      provider: 'mailgun',
      fromEmail: 'no-reply@mg.test.cz',
      fromName: 'Test',
      apiKey: 'key',
    };
    await sendEmail(payload, config, deps);
    const [, options] = deps.sendHttp.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = options.body as string;
    expect(body).toContain('subject=Your+ticket');
    expect(body).toContain('to=fan%40example.com');
  });
});
