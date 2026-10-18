import * as crypto from 'crypto';
import { CryptoService } from './crypto.service';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const AAD = 'travel_log:user-1';

/** 키 ID와 소유자 묶기가 생기기 전의 저장 형식을 그대로 만든다(예전에 저장된 행을 흉내 낸다) */
function legacyEncrypt(plaintext: string, masterKeyHex: string) {
  const masterKey = Buffer.from(masterKeyHex, 'hex');
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
  ciphertext += cipher.final('base64');
  const kekIv = crypto.randomBytes(16);
  const kek = crypto.createCipheriv('aes-256-cbc', masterKey, kekIv);
  return {
    ciphertext,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    wrappedDek: Buffer.concat([kekIv, kek.update(dek), kek.final()]).toString(
      'base64',
    ),
  };
}

const ENV_NAMES = [
  'MASTER_ENCRYPTION_KEY',
  'MASTER_3DES_KEY',
  'MASTER_ENCRYPTION_KEY_ID',
  'MASTER_ENCRYPTION_KEYS_OLD',
];

describe('CryptoService', () => {
  let service: CryptoService;
  const clearEnv = () => ENV_NAMES.forEach((name) => delete process.env[name]);

  beforeEach(() => {
    clearEnv();
    service = new CryptoService();
  });

  afterEach(clearEnv);

  it('encrypts plaintext into EncryptedDataBundle and decrypts back to original', () => {
    const sensitivePayload = JSON.stringify({
      route: ['02_222', '02_221'],
      timestamp: Date.now(),
      coords: [37.4979, 127.0276],
    });

    const encrypted = service.encrypt(sensitivePayload, AAD);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
    expect(encrypted.wrappedDek).toBeDefined();

    // Ciphertext must not contain plaintext
    expect(encrypted.ciphertext).not.toContain('02_222');

    const decrypted = service.decrypt(encrypted, AAD);
    expect(decrypted).toBe(sensitivePayload);
  });

  it('works with 32-character UTF-8 master keys (e.g. Bitwarden generated)', () => {
    process.env.MASTER_ENCRYPTION_KEY = 'aB3$eF5*hI7!kL9#mO1%qR3^tU5&wY7_';
    const bitwardenService = new CryptoService();
    const plaintext = 'confidential-subway-payload';
    const bundle = bitwardenService.encrypt(plaintext, AAD);
    expect(bitwardenService.decrypt(bundle, AAD)).toBe(plaintext);
  });

  it('works with 64-character hex master keys (e.g. openssl rand -hex 32)', () => {
    process.env.MASTER_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hexService = new CryptoService();
    const plaintext = 'sensitive-location-data';
    const bundle = hexService.encrypt(plaintext, AAD);
    expect(hexService.decrypt(bundle, AAD)).toBe(plaintext);
  });

  it('fails decryption if ciphertext or auth tag is tampered with', () => {
    const encrypted = service.encrypt('confidential-location-data', AAD);

    // Tamper with ciphertext
    const tamperedCiphertext = Buffer.from('corrupted-data').toString('base64');
    expect(() =>
      service.decrypt({ ...encrypted, ciphertext: tamperedCiphertext }, AAD),
    ).toThrow();

    // Tamper with auth tag
    const tamperedTag = Buffer.from('corrupted-tag---').toString('base64');
    expect(() =>
      service.decrypt({ ...encrypted, tag: tamperedTag }, AAD),
    ).toThrow();
  });

  it('throws on invalid key length', () => {
    process.env.MASTER_ENCRYPTION_KEY = 'too-short';
    expect(() => new CryptoService()).toThrow();
  });

  describe('owner binding', () => {
    it('does not decrypt a bundle copied to another owner', () => {
      const bundle = service.encrypt('route of user-1', 'travel_log:user-1');

      expect(service.decrypt(bundle, 'travel_log:user-1')).toBe(
        'route of user-1',
      );
      expect(() => service.decrypt(bundle, 'travel_log:user-2')).toThrow();
    });
  });

  describe('key versions', () => {
    it('stores the key id with the wrapped key', () => {
      process.env.MASTER_ENCRYPTION_KEY = KEY_A;
      process.env.MASTER_ENCRYPTION_KEY_ID = 'k2';

      const bundle = new CryptoService().encrypt('x', AAD);

      expect(bundle.wrappedDek).toMatch(/^v2\.k2\./);
      expect(bundle.wrappedDek.length).toBeLessThanOrEqual(128);
    });

    it('uses id 1 when no key id is configured', () => {
      process.env.MASTER_ENCRYPTION_KEY = KEY_A;

      const current = new CryptoService();

      expect(current.currentKeyId).toBe('1');
      expect(current.encrypt('x', AAD).wrappedDek).toMatch(/^v2\.1\./);
    });

    it('still reads data written with the previous key after the key is rotated', () => {
      process.env.MASTER_ENCRYPTION_KEY = KEY_A;
      const before = new CryptoService();
      const old = before.encrypt('written before rotation', AAD);

      process.env.MASTER_ENCRYPTION_KEY = KEY_B;
      process.env.MASTER_ENCRYPTION_KEY_ID = '2';
      process.env.MASTER_ENCRYPTION_KEYS_OLD = `1:${KEY_A}`;
      const after = new CryptoService();

      expect(after.decrypt(old, AAD)).toBe('written before rotation');
      const fresh = after.encrypt('written after rotation', AAD);
      expect(fresh.wrappedDek).toMatch(/^v2\.2\./);
      expect(after.decrypt(fresh, AAD)).toBe('written after rotation');
    });

    it('cannot read data of a key that was dropped from the configuration', () => {
      process.env.MASTER_ENCRYPTION_KEY = KEY_A;
      const old = new CryptoService().encrypt('secret', AAD);

      process.env.MASTER_ENCRYPTION_KEY = KEY_B;
      process.env.MASTER_ENCRYPTION_KEY_ID = '2';

      expect(() => new CryptoService().decrypt(old, AAD)).toThrow(
        '알 수 없는 암호화 키 ID',
      );
    });

    it('tells which stored values are not on the current key and format yet', () => {
      process.env.MASTER_ENCRYPTION_KEY = KEY_A;
      const before = new CryptoService();
      const old = before.encrypt('a', AAD);

      process.env.MASTER_ENCRYPTION_KEY = KEY_B;
      process.env.MASTER_ENCRYPTION_KEY_ID = '2';
      process.env.MASTER_ENCRYPTION_KEYS_OLD = `1:${KEY_A}`;
      const after = new CryptoService();

      expect(after.isCurrent(old)).toBe(false);
      expect(after.isCurrent(after.encrypt('b', AAD))).toBe(true);
      expect(after.isCurrent(legacyEncrypt('c', KEY_B))).toBe(false);
    });

    it('rejects a malformed or duplicated key configuration', () => {
      process.env.MASTER_ENCRYPTION_KEY = KEY_A;

      process.env.MASTER_ENCRYPTION_KEY_ID = 'bad id!';
      expect(() => new CryptoService()).toThrow('키 ID');

      process.env.MASTER_ENCRYPTION_KEY_ID = '2';
      process.env.MASTER_ENCRYPTION_KEYS_OLD = KEY_B;
      expect(() => new CryptoService()).toThrow('ID:키');

      process.env.MASTER_ENCRYPTION_KEYS_OLD = `2:${KEY_B}`;
      expect(() => new CryptoService()).toThrow('겹쳐요');
    });
  });

  describe('data stored before key versions and owner binding', () => {
    it('is still read, whatever owner is asked for, since it carries no owner binding', () => {
      process.env.MASTER_ENCRYPTION_KEY = KEY_A;
      const legacy = legacyEncrypt('old route', KEY_A);

      expect(new CryptoService().decrypt(legacy, AAD)).toBe('old route');
    });

    it('is read with a previous key when the current key changed', () => {
      const legacy = legacyEncrypt('old route', KEY_A);

      process.env.MASTER_ENCRYPTION_KEY = KEY_B;
      process.env.MASTER_ENCRYPTION_KEY_ID = '2';
      process.env.MASTER_ENCRYPTION_KEYS_OLD = `1:${KEY_A}`;

      expect(new CryptoService().decrypt(legacy, AAD)).toBe('old route');
    });

    it('fails when no configured key opens it', () => {
      const legacy = legacyEncrypt('old route', KEY_A);
      process.env.MASTER_ENCRYPTION_KEY = KEY_B;

      expect(() => new CryptoService().decrypt(legacy, AAD)).toThrow();
    });
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
