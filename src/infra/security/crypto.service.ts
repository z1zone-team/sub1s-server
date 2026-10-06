import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';

export interface EncryptedDataBundle {
  ciphertext: string; // Base64 AES-256-GCM ciphertext (encrypted_route_payload)
  iv: string; // Base64 Nonce/IV (12 bytes)
  tag: string; // Base64 GCM Auth Tag (16 bytes - auth_tag)
  wrappedDek: string; // Base64 3DES-CBC wrapped DEK (wrapped_dek)
}

@Injectable()
export class CryptoService {
  // Tier 1/2: 3DES Master Key (24 bytes / 192-bit)
  private readonly kek3Des: Buffer;

  constructor() {
    const keyStr =
      process.env.MASTER_3DES_KEY || 'sub1s-master-key-24bytes';
    if (Buffer.byteLength(keyStr, 'utf-8') !== 24) {
      throw new Error(
        'MASTER_3DES_KEY must be exactly 24 bytes (192-bit) in UTF-8 format.',
      );
    }
    this.kek3Des = Buffer.from(keyStr, 'utf-8');
  }

  /**
   * 3-Tier Hybrid Encryption:
   * 1. Generates ephemeral 256-bit DEK & 96-bit (12 bytes) GCM Nonce
   * 2. Encrypts payload with AES-256-GCM (confidentiality + 128-bit auth tag)
   * 3. Wraps DEK with 3DES-EDE3-CBC (key wrapping)
   */
  encrypt(plaintext: string): EncryptedDataBundle {
    const dek = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
    ciphertext += cipher.final('base64');
    const tag = cipher.getAuthTag();

    const desIv = crypto.randomBytes(8);
    const desCipher = crypto.createCipheriv(
      'des-ede3-cbc',
      this.kek3Des,
      desIv,
    );
    const wrappedDek = Buffer.concat([
      desIv,
      desCipher.update(dek),
      desCipher.final(),
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
   * 1. Unwraps DEK via 3DES-EDE3-CBC
   * 2. Decrypts AES-256-GCM and verifies 128-bit Auth Tag (throws on tamper)
   */
  decrypt(bundle: EncryptedDataBundle): string {
    const wrappedDekBuffer = Buffer.from(bundle.wrappedDek, 'base64');
    const desIv = wrappedDekBuffer.subarray(0, 8);
    const encryptedDek = wrappedDekBuffer.subarray(8);

    const desDecipher = crypto.createDecipheriv(
      'des-ede3-cbc',
      this.kek3Des,
      desIv,
    );
    const dek = Buffer.concat([
      desDecipher.update(encryptedDek),
      desDecipher.final(),
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
