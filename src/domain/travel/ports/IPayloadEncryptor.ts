export const PAYLOAD_ENCRYPTOR = Symbol('PAYLOAD_ENCRYPTOR');

/**
 * 이동 기록 암호문에 묶는 소유자 정보(GCM 추가 인증 데이터).
 * 암호문을 다른 사용자의 행으로 복사하면 이 값이 달라 풀리지 않는다
 */
export const travelLogAad = (userId: string): string => `travel_log:${userId}`;

export interface EncryptedDataBundle {
  ciphertext: string; // Base64 AES-256-GCM ciphertext (encrypted_route_payload)
  iv: string; // Base64 Nonce/IV (12 bytes)
  tag: string; // Base64 GCM Auth Tag (16 bytes - auth_tag)
  wrappedDek: string; // Base64 AES-256-CBC wrapped DEK (wrapped_dek)
}

/** 이동 기록의 경로 같은 민감한 값을 저장하기 전에 암호화하고 읽을 때 복호화한다 */
export interface IPayloadEncryptor {
  /** `aad`는 암호문에 묶는 소유자 정보다. 읽을 때 같은 값을 주어야 풀린다 */
  encrypt(plaintext: string, aad: string): EncryptedDataBundle;
  decrypt(bundle: EncryptedDataBundle, aad: string): string;
}
