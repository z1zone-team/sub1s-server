import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(() => {
    service = new CryptoService();
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
});
