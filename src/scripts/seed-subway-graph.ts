import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { OUT_DIR, readJson } from './lib/subway-common';

const MOCK_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  clerkId: 'user_mock_test_1',
  nickname: '로컬테스트러너',
  isRankingPublic: true,
};

interface LineJson {
  id: string;
  lineName: string;
  colorHex: string;
}

interface StationJson {
  id: string;
  lineId: string;
  stationCode: string;
  stationName: string;
  lat: number;
  lng: number;
  lineSeq?: number;
}

interface EdgeJson {
  fromStationId: string;
  toStationId: string;
  lineId: string;
  direction: string;
  isExpress: boolean;
  distanceKm: number;
  durationSec: number;
  isEstimated: boolean;
}

interface TransferJson {
  fromStationId: string;
  toStationId: string;
  walkingDurationSec: number;
}

function loadOptional<T>(file: string): T[] {
  const path = join(OUT_DIR, file);
  return existsSync(path) ? readJson<T[]>(path) : [];
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const prisma = new PrismaClient();
  try {
    const lines = readJson<LineJson[]>(join(OUT_DIR, 'lines.json'));
    const stations = readJson<StationJson[]>(join(OUT_DIR, 'stations.json'));
    const edges = loadOptional<EdgeJson>('edges.json');
    const transfers = loadOptional<TransferJson>('transfers.json');

    await prisma.user.upsert({
      where: { clerkId: MOCK_USER.clerkId },
      update: {},
      create: MOCK_USER,
    });

    await prisma.$transaction([
      ...lines.map((line) =>
        prisma.subwayLine.upsert({
          where: { id: line.id },
          update: { lineName: line.lineName, colorHex: line.colorHex },
          create: line,
        }),
      ),
      ...stations.map((station) =>
        prisma.station.upsert({
          where: { id: station.id },
          update: { ...station },
          create: station,
        }),
      ),
      // edges and transfers have generated ids, so they are replaced instead of merged
      prisma.routeEdge.deleteMany(),
      prisma.transferEdge.deleteMany(),
      prisma.routeEdge.createMany({ data: edges }),
      prisma.transferEdge.createMany({ data: transfers }),
    ]);

    console.log(
      `[Seed Complete] MockUser seeded, Lines: ${lines.length}, Stations: ${stations.length}, Edges: ${edges.length}, Transfers: ${transfers.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
