import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  EncryptedDataBundle,
  IPayloadEncryptor,
} from '../../domain/travel/ports/IPayloadEncryptor';

// 예전에는 이 파일이 정의했다. 포트로 옮겼지만 import 경로가 바뀌지 않도록 다시 내보낸다
export type { EncryptedDataBundle };

@Injectable()
export class CryptoService implements IPayloadEncryptor {
  // Master Key (32 bytes / 256-bit AES)
  private readonly masterKey: Buffer;

  constructor() {
    const configured =
      process.env.MASTER_ENCRYPTION_KEY || process.env.MASTER_3DES_KEY;
    // 운영에서 키가 없으면 소스에 적힌 고정 키로 저장하지 않도록 기동을 막는다
    if (!configured && process.env.NODE_ENV === 'production') {
      throw new Error(
        'MASTER_ENCRYPTION_KEY(또는 MASTER_3DES_KEY)가 없어 암호화 서비스를 시작할 수 없어요',
      );
    }
    const keyStr =
      configured ||
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    this.masterKey = this.parseMasterKey(keyStr);
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
   * 2. Encrypts payload with AES-256-GCM (confidentiality + 128-bit auth tag)
   * 3. Wraps DEK with AES-256-CBC using 256-bit Master Key
   */
  encrypt(plaintext: string): EncryptedDataBundle {
    const dek = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
    ciphertext += cipher.final('base64');
    const tag = cipher.getAuthTag();

    const kekIv = crypto.randomBytes(16);
    const kekCipher = crypto.createCipheriv(
      'aes-256-cbc',
      this.masterKey,
      kekIv,
    );
    const wrappedDek = Buffer.concat([
      kekIv,
      kekCipher.update(dek),
      kekCipher.final(),
    ]).toString('base64');

    return {
      ciphertext,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      wrappedDek,
    };
  }

  /**
   * Decryption & Integrity Verification:
   * 1. Unwraps DEK via AES-256-CBC
   * 2. Decrypts AES-256-GCM and verifies 128-bit Auth Tag (throws on tamper)
   */
  decrypt(bundle: EncryptedDataBundle): string {
    const wrappedDekBuffer = Buffer.from(bundle.wrappedDek, 'base64');
    const kekIv = wrappedDekBuffer.subarray(0, 16);
    const encryptedDek = wrappedDekBuffer.subarray(16);

    const kekDecipher = crypto.createDecipheriv(
      'aes-256-cbc',
      this.masterKey,
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
    decipher.setAuthTag(Buffer.from(bundle.tag, 'base64'));

    let decrypted = decipher.update(bundle.ciphertext, 'base64', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }
}
