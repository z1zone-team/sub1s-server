import * as crypto from 'crypto';
import { travelLogAad } from '../../domain/travel/ports/IPayloadEncryptor';
import { CryptoService } from '../../infra/security/crypto.service';
import { reencryptTravelLogs, TravelLogRows } from './reencrypt-travel-logs';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

type Row = {
  id: string;
  userId: string;
  encryptedRoutePayload: string | null;
  iv: string | null;
  authTag: string | null;
  wrappedDek: string | null;
};

const fakePrisma = (rows: Row[]) => {
  const update = jest.fn().mockImplementation(async ({ where, data }) => {
    Object.assign(
      rows.find((row) => row.id === where.id)!,
      data,
    );
  });
  const prisma: TravelLogRows = {
    travelLog: {
      findMany: jest.fn().mockImplementation(async ({ where, take }) =>
        rows
          .filter((row) => !where.id || row.id > where.id.gt)
          .filter((row) => row.encryptedRoutePayload !== null)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take),
      ),
      update,
    },
  };
  return { prisma, update };
};

const toRow = (
  id: string,
  userId: string,
  bundle: { ciphertext: string; iv: string; tag: string; wrappedDek: string },
): Row => ({
  id,
  userId,
  encryptedRoutePayload: bundle.ciphertext,
  iv: bundle.iv,
  authTag: bundle.tag,
  wrappedDek: bundle.wrappedDek,
});

describe('reencryptTravelLogs', () => {
  const clear = () => {
    for (const name of [
      'MASTER_ENCRYPTION_KEY',
      'MASTER_ENCRYPTION_KEY_ID',
      'MASTER_ENCRYPTION_KEYS_OLD',
    ]) {
      delete process.env[name];
    }
  };
  afterEach(clear);

  const rotated = () => {
    clear();
    process.env.MASTER_ENCRYPTION_KEY = KEY_A;
    const before = new CryptoService();
    const rows = [
      toRow('a1', 'user-1', before.encrypt('route 1', travelLogAad('user-1'))),
      toRow('a2', 'user-2', before.encrypt('route 2', travelLogAad('user-2'))),
      toRow('a3', 'user-3', before.encrypt('route 3', travelLogAad('user-3'))),
    ];
    process.env.MASTER_ENCRYPTION_KEY = KEY_B;
    process.env.MASTER_ENCRYPTION_KEY_ID = '2';
    process.env.MASTER_ENCRYPTION_KEYS_OLD = `1:${KEY_A}`;
    return { rows, after: new CryptoService() };
  };

  it('only counts in a dry run and writes nothing', async () => {
    const { rows, after } = rotated();
    const { prisma, update } = fakePrisma(rows);

    const report = await reencryptTravelLogs(prisma, after, { apply: false });

    expect(report).toMatchObject({
      scanned: 3,
      migrated: 3,
      alreadyCurrent: 0,
      failed: [],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('moves every row to the current key, keeps the content, and then finds nothing left to move', async () => {
    const { rows, after } = rotated();
    const { prisma } = fakePrisma(rows);

    const report = await reencryptTravelLogs(prisma, after, {
      apply: true,
      batchSize: 2,
    });

    expect(report).toMatchObject({ scanned: 3, migrated: 3, failed: [] });
    expect(rows.every((row) => row.wrappedDek!.startsWith('v2.2.'))).toBe(true);
    expect(
      after.decrypt(
        {
          ciphertext: rows[1].encryptedRoutePayload!,
          iv: rows[1].iv!,
          tag: rows[1].authTag!,
          wrappedDek: rows[1].wrappedDek!,
        },
        travelLogAad('user-2'),
      ),
    ).toBe('route 2');

    const again = await reencryptTravelLogs(prisma, after, { apply: true });
    expect(again).toMatchObject({ scanned: 3, alreadyCurrent: 3, migrated: 0 });

    // 이전 키를 빼도 읽힌다
    delete process.env.MASTER_ENCRYPTION_KEYS_OLD;
    const withoutOld = new CryptoService();
    expect(
      withoutOld.decrypt(
        {
          ciphertext: rows[0].encryptedRoutePayload!,
          iv: rows[0].iv!,
          tag: rows[0].authTag!,
          wrappedDek: rows[0].wrappedDek!,
        },
        travelLogAad('user-1'),
      ),
    ).toBe('route 1');
  });

  it('migrates rows saved in the old format that has no key id', async () => {
    clear();
    process.env.MASTER_ENCRYPTION_KEY = KEY_A;
    const masterKey = Buffer.from(KEY_A, 'hex');
    const dek = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    const ciphertext =
      cipher.update('legacy route', 'utf-8', 'base64') + cipher.final('base64');
    const kekIv = crypto.randomBytes(16);
    const kek = crypto.createCipheriv('aes-256-cbc', masterKey, kekIv);
    const legacy = toRow('l1', 'user-1', {
      ciphertext,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      wrappedDek: Buffer.concat([kekIv, kek.update(dek), kek.final()]).toString(
        'base64',
      ),
    });
    const { prisma } = fakePrisma([legacy]);
    const service = new CryptoService();

    const report = await reencryptTravelLogs(prisma, service, { apply: true });

    expect(report.migrated).toBe(1);
    expect(legacy.wrappedDek).toMatch(/^v2\.1\./);
    expect(
      service.decrypt(
        {
          ciphertext: legacy.encryptedRoutePayload!,
          iv: legacy.iv!,
          tag: legacy.authTag!,
          wrappedDek: legacy.wrappedDek!,
        },
        travelLogAad('user-1'),
      ),
    ).toBe('legacy route');
  });

  it('leaves a row it cannot decrypt untouched and lists it without its content', async () => {
    const { rows, after } = rotated();
    rows[1].encryptedRoutePayload = Buffer.from('corrupted').toString('base64');
    const untouched = { ...rows[1] };
    const { prisma } = fakePrisma(rows);

    const report = await reencryptTravelLogs(prisma, after, { apply: true });

    expect(report.migrated).toBe(2);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].id).toBe('a2');
    expect(JSON.stringify(report)).not.toContain('route 2');
    expect(rows[1]).toEqual(untouched);
  });

  it('does not rewrite a row whose owner does not match, since it would fail to decrypt', async () => {
    clear();
    process.env.MASTER_ENCRYPTION_KEY = KEY_A;
    const service = new CryptoService();
    const copied = toRow(
      'c1',
      'user-2',
      service.encrypt('route of user-1', travelLogAad('user-1')),
    );
    const { prisma, update } = fakePrisma([copied]);

    const report = await reencryptTravelLogs(prisma, service, { apply: true });

    expect(report.failed).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });
});
