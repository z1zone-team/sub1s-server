import { Module } from '@nestjs/common';
import { PAYLOAD_ENCRYPTOR } from '../../domain/travel/ports/IPayloadEncryptor';
import { CryptoService } from './crypto.service';

@Module({
  providers: [
    CryptoService,
    { provide: PAYLOAD_ENCRYPTOR, useExisting: CryptoService },
  ],
  exports: [CryptoService, PAYLOAD_ENCRYPTOR],
})
export class SecurityModule {}
