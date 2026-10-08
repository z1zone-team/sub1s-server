import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { OUT_DIR, readJson } from './lib/subway-common';

function countInFile(file: string): number {
  const path = join(OUT_DIR, file);
  return existsSync(path) ? readJson<unknown[]>(path).length : 0;
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const prisma = new PrismaClient();
  try {
    const checks = [
      {
        name: 'lines',
        file: 'lines.json',
        db: await prisma.subwayLine.count(),
      },
      {
        name: 'stations',
        file: 'stations.json',
        db: await prisma.station.count(),
      },
      { name: 'edges', file: 'edges.json', db: await prisma.routeEdge.count() },
      {
        name: 'transfers',
        file: 'transfers.json',
        db: await prisma.transferEdge.count(),
      },
    ];
    let failed = false;
    for (const check of checks) {
      const expected = countInFile(check.file);
      const ok = expected === check.db;
      failed = failed || !ok;
      console.log(
        `${ok ? 'OK  ' : 'FAIL'} ${check.name}: db=${check.db} file=${expected}`,
      );
    }
    if (failed) process.exitCode = 1;

    const withDoorsInDb = await prisma.transferEdge.count({
      where: { recommendedDoors: { isEmpty: false } },
    });
    console.log(`INFO transfers with recommendedDoors: db=${withDoorsInDb}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
