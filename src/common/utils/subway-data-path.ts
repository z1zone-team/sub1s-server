import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function getSubwayDataPath(filename: string): string {
  // 1. Relative to src/common/utils or dist/common/utils
  const relativeFromUtils = resolve(__dirname, '../../data/subway', filename);
  if (existsSync(relativeFromUtils)) return relativeFromUtils;

  // 2. Relative to process.cwd() / src
  const srcPath = resolve(process.cwd(), 'src/data/subway', filename);
  if (existsSync(srcPath)) return srcPath;

  // 3. Relative to process.cwd() / dist
  const distPath = resolve(process.cwd(), 'dist/data/subway', filename);
  if (existsSync(distPath)) return distPath;

  return relativeFromUtils;
}
