import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(() => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.MASTER_3DES_KEY;
    service = new CryptoService();
  });

  afterEach(() => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.MASTER_3DES_KEY;
  });

  it('encrypts plaintext into EncryptedDataBundle and decrypts back to original', () => {
    const sensitivePayload = JSON.stringify({
      route: ['02_222', '02_221'],
      timestamp: Date.now(),
      coords: [37.4979, 127.0276],
    });

    const encrypted = service.encrypt(sensitivePayload);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
    expect(encrypted.wrappedDek).toBeDefined();

    // Ciphertext must not contain plaintext
    expect(encrypted.ciphertext).not.toContain('02_222');

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(sensitivePayload);
  });

  it('works with 32-character UTF-8 master keys (e.g. Bitwarden generated)', () => {
    process.env.MASTER_ENCRYPTION_KEY = 'aB3$eF5*hI7!kL9#mO1%qR3^tU5&wY7_';
    const bitwardenService = new CryptoService();
    const plaintext = 'confidential-subway-payload';
    const bundle = bitwardenService.encrypt(plaintext);
    expect(bitwardenService.decrypt(bundle)).toBe(plaintext);
  });

  it('works with 64-character hex master keys (e.g. openssl rand -hex 32)', () => {
    process.env.MASTER_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hexService = new CryptoService();
    const plaintext = 'sensitive-location-data';
    const bundle = hexService.encrypt(plaintext);
    expect(hexService.decrypt(bundle)).toBe(plaintext);
  });

  it('fails decryption if ciphertext or auth tag is tampered with', () => {
    const encrypted = service.encrypt('confidential-location-data');

    // Tamper with ciphertext
    const tamperedCiphertext = Buffer.from('corrupted-data').toString('base64');
    expect(() =>
      service.decrypt({ ...encrypted, ciphertext: tamperedCiphertext }),
    ).toThrow();

    // Tamper with auth tag
    const tamperedTag = Buffer.from('corrupted-tag---').toString('base64');
    expect(() => service.decrypt({ ...encrypted, tag: tamperedTag })).toThrow();
  });

  it('throws on invalid key length', () => {
    process.env.MASTER_ENCRYPTION_KEY = 'too-short';
    expect(() => new CryptoService()).toThrow();
  });

  describe('without a configured key', () => {
    const nodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = nodeEnv;
    });

    it('refuses to start in production instead of using the key written in the source', () => {
      process.env.NODE_ENV = 'production';

      expect(() => new CryptoService()).toThrow('MASTER_ENCRYPTION_KEY');
    });

    it('starts in production once a key is configured', () => {
      process.env.NODE_ENV = 'production';
      process.env.MASTER_ENCRYPTION_KEY = 'a'.repeat(64);

      expect(() => new CryptoService()).not.toThrow();
    });
  });
});
