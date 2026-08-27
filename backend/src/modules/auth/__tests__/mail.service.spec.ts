import { MailService } from '../mail/mail.service';

describe('MailService', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('stocke l\'email dans la devOutbox en développement', async () => {
    process.env.NODE_ENV = 'development';
    const mailService = new MailService();

    await mailService.sendPasswordResetEmail('user@test.local', 'raw-token-abc', 'http://localhost:3000/reset-password?token=raw-token-abc');

    const outbox = mailService.getDevOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe('user@test.local');
    expect(outbox[0].resetToken).toBe('raw-token-abc');
  });

  it('lève une exception en production (aucun fournisseur réel configuré)', async () => {
    process.env.NODE_ENV = 'production';
    const mailService = new MailService();

    await expect(
      mailService.sendPasswordResetEmail('user@test.local', 'raw-token-abc', 'https://app.example.com/reset-password?token=raw-token-abc'),
    ).rejects.toThrow(/aucun fournisseur email réel/i);
  });

  it('ne simule jamais un envoi silencieux en production', async () => {
    process.env.NODE_ENV = 'production';
    const mailService = new MailService();

    await expect(
      mailService.sendPasswordResetEmail('user@test.local', 'raw-token-abc', 'https://app.example.com/reset'),
    ).rejects.toThrow();

    // La devOutbox ne doit pas non plus être silencieusement remplie.
    expect(mailService.getDevOutbox()).toHaveLength(0);
  });
});
