import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  EncryptedDataBundle,
  IPayloadEncryptor,
} from '../../domain/travel/ports/IPayloadEncryptor';

// 예전에는 이 파일이 정의했다. 포트로 옮겼지만 import 경로가 바뀌지 않도록 다시 내보낸다
export type { EncryptedDataBundle };

interface MasterKey {
  id: string;
  key: Buffer;
}

const DEV_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DEFAULT_KEY_ID = '1';
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,8}$/;
/** 키 버전과 소유자 묶기를 쓰는 형식의 접두사. 접두사가 없으면 예전 형식이다 */
const FORMAT_PREFIX = 'v2';

/**
 * 이동 기록 같은 민감한 값의 암호화.
 *
 * 저장 형식(`wrapped_dek`):
 * - 예전: base64(IV 16바이트 + 래핑된 DEK). 키 ID와 소유자 묶기가 없다
 * - 지금: `v2.<키 ID>.<base64>`. 본문의 GCM 추가 인증 데이터에 소유자 정보를 묶어 두어
 *   다른 사용자의 행으로 복사하면 풀리지 않는다
 *
 * 키: 현재 키는 `MASTER_ENCRYPTION_KEY`(ID는 `MASTER_ENCRYPTION_KEY_ID`, 기본 `1`)이고
 * 이전 키는 `MASTER_ENCRYPTION_KEYS_OLD`에 `ID:키,ID:키`로 둔다. 새로 쓰는 값은 현재 키로 암호화하고
 * 읽을 때는 저장된 키 ID의 키로 푼다. 예전 형식은 현재 키부터 이전 키들까지 차례로 시도한다
 */
@Injectable()
export class CryptoService implements IPayloadEncryptor {
  private readonly current: MasterKey;
  private readonly previous: MasterKey[];

  constructor() {
    const configured =
      process.env.MASTER_ENCRYPTION_KEY || process.env.MASTER_3DES_KEY;
    // 운영에서 키가 없으면 소스에 적힌 고정 키로 저장하지 않도록 기동을 막는다
    if (!configured && process.env.NODE_ENV === 'production') {
      throw new Error(
        'MASTER_ENCRYPTION_KEY(또는 MASTER_3DES_KEY)가 없어 암호화 서비스를 시작할 수 없어요',
      );
    }

    this.current = {
      id: this.parseKeyId(
        process.env.MASTER_ENCRYPTION_KEY_ID || DEFAULT_KEY_ID,
      ),
      key: this.parseMasterKey(configured || DEV_KEY),
    };
    this.previous = this.parsePreviousKeys(
      process.env.MASTER_ENCRYPTION_KEYS_OLD,
    );
  }

  /** 지금 새로 암호화할 때 쓰는 키의 ID */
  get currentKeyId(): string {
    return this.current.id;
  }

  /** 이 묶음이 현재 키와 현재 형식으로 저장돼 있는지. 아니면 다시 암호화할 대상이다 */
  isCurrent(bundle: EncryptedDataBundle): boolean {
    const parsed = this.parseWrapped(bundle.wrappedDek);
    return parsed.versioned && parsed.keyId === this.current.id;
  }

  private parseKeyId(id: string): string {
    if (!KEY_ID_PATTERN.test(id)) {
      throw new Error(
        `암호화 키 ID는 영문, 숫자, _, -로 8자 이하여야 해요: ${id}`,
      );
    }
    return id;
  }

  private parsePreviousKeys(value: string | undefined): MasterKey[] {
    if (!value?.trim()) return [];
    const keys: MasterKey[] = [];
    for (const entry of value.split(',')) {
      const separator = entry.indexOf(':');
      if (separator === -1) {
        throw new Error(
          'MASTER_ENCRYPTION_KEYS_OLD는 ID:키,ID:키 형식이어야 해요',
        );
      }
      const id = this.parseKeyId(entry.slice(0, separator).trim());
      const key = this.parseMasterKey(entry.slice(separator + 1).trim());
      if (id === this.current.id || keys.some((item) => item.id === id)) {
        throw new Error(`암호화 키 ID가 겹쳐요: ${id}`);
      }
      keys.push({ id, key });
    }
    return keys;
  }

  private parseMasterKey(keyStr: string): Buffer {
    // 1. 64-char Hex string (32 bytes, e.g., openssl rand -hex 32)
    if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
      return Buffer.from(keyStr, 'hex');
    }

    // 2. 32-character UTF-8 string (32 bytes, e.g., Bitwarden 32 chars)
    if (Buffer.byteLength(keyStr, 'utf-8') === 32) {
      return Buffer.from(keyStr, 'utf-8');
    }

    // 3. Fallback for legacy 24-byte string during migration (SHA-256 stretched to 32 bytes)
    if (Buffer.byteLength(keyStr, 'utf-8') === 24) {
      return crypto.createHash('sha256').update(keyStr, 'utf-8').digest();
    }

    throw new Error(
      'MASTER_ENCRYPTION_KEY must be a 64-character HEX string (256-bit) or a 32-character UTF-8 string.',
    );
  }

  /**
   * 3-Tier Hybrid Encryption:
   * 1. Generates ephemeral 256-bit DEK & 96-bit (12 bytes) GCM Nonce
   * 2. Encrypts payload with AES-256-GCM (confidentiality + 128-bit auth tag),
   *    binding `aad` (the owner) as additional authenticated data
   * 3. Wraps DEK with AES-256-CBC using the current 256-bit Master Key
   */
  encrypt(plaintext: string, aad: string): EncryptedDataBundle {
    const dek = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(Buffer.from(aad, 'utf-8'));
    let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
    ciphertext += cipher.final('base64');
    const tag = cipher.getAuthTag();

    const kekIv = crypto.randomBytes(16);
    const kekCipher = crypto.createCipheriv(
      'aes-256-cbc',
      this.current.key,
      kekIv,
    );
    const wrapped = Buffer.concat([
      kekIv,
      kekCipher.update(dek),
      kekCipher.final(),
    ]).toString('base64');

    return {
      ciphertext,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      wrappedDek: `${FORMAT_PREFIX}.${this.current.id}.${wrapped}`,
    };
  }

  /**
   * Decryption & Integrity Verification:
   * 1. Unwraps DEK via AES-256-CBC with the key named in the stored value
   * 2. Decrypts AES-256-GCM and verifies 128-bit Auth Tag (throws on tamper or when `aad` is not the owner's)
   */
  decrypt(bundle: EncryptedDataBundle, aad: string): string {
    const parsed = this.parseWrapped(bundle.wrappedDek);

    if (parsed.versioned) {
      const master = [this.current, ...this.previous].find(
        (item) => item.id === parsed.keyId,
      );
      if (!master) {
        throw new Error(`알 수 없는 암호화 키 ID: ${parsed.keyId}`);
      }
      return this.open(bundle, parsed.wrapped, master.key, aad);
    }

    // 예전 형식은 키 ID가 없어서 현재 키부터 이전 키들까지 차례로 푼다
    let lastError: unknown;
    for (const master of [this.current, ...this.previous]) {
      try {
        return this.open(bundle, parsed.wrapped, master.key, undefined);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('복호화에 실패했어요');
  }

  private parseWrapped(wrappedDek: string):
    | { versioned: true; keyId: string; wrapped: string }
    | {
        versioned: false;
        wrapped: string;
      } {
    if (!wrappedDek.startsWith(`${FORMAT_PREFIX}.`)) {
      return { versioned: false, wrapped: wrappedDek };
    }
    const [, keyId, wrapped] = wrappedDek.split('.');
    if (!keyId || !wrapped)
      throw new Error('저장된 암호문 형식이 올바르지 않아요');
    return { versioned: true, keyId, wrapped };
  }

  private open(
    bundle: EncryptedDataBundle,
    wrappedBase64: string,
    masterKey: Buffer,
    aad: string | undefined,
  ): string {
    const wrappedDekBuffer = Buffer.from(wrappedBase64, 'base64');
    const kekIv = wrappedDekBuffer.subarray(0, 16);
    const encryptedDek = wrappedDekBuffer.subarray(16);

    const kekDecipher = crypto.createDecipheriv(
      'aes-256-cbc',
      masterKey,
      kekIv,
    );
    const dek = Buffer.concat([
      kekDecipher.update(encryptedDek),
      kekDecipher.final(),
    ]);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      dek,
      Buffer.from(bundle.iv, 'base64'),
    );
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf-8'));
    decipher.setAuthTag(Buffer.from(bundle.tag, 'base64'));

    let decrypted = decipher.update(bundle.ciphertext, 'base64', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }
}
