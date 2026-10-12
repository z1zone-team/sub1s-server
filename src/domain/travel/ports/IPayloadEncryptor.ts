export const PAYLOAD_ENCRYPTOR = Symbol('PAYLOAD_ENCRYPTOR');

export interface EncryptedDataBundle {
  ciphertext: string; // Base64 AES-256-GCM ciphertext (encrypted_route_payload)
  iv: string; // Base64 Nonce/IV (12 bytes)
  tag: string; // Base64 GCM Auth Tag (16 bytes - auth_tag)
  wrappedDek: string; // Base64 AES-256-CBC wrapped DEK (wrapped_dek)
}

/** 이동 기록의 경로 같은 민감한 값을 저장하기 전에 암호화하고 읽을 때 복호화한다 */
export interface IPayloadEncryptor {
  encrypt(plaintext: string): EncryptedDataBundle;
  decrypt(bundle: EncryptedDataBundle): string;
}
