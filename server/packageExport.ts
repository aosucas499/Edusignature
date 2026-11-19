import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import type { PackageFileEntry } from '../src/types.ts';

const PI_PACKAGE_DIR = path.resolve(process.cwd(), 'pi_package');

function walkFiles(dir: string, base: string, out: PackageFileEntry[]): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (rel === 'web' || rel === '__pycache__') continue;
      walkFiles(full, base, out);
    } else {
      const stat = fs.statSync(full);
      out.push({
        path: rel,
        sizeBytes: stat.size,
        content: fs.readFileSync(full, 'utf-8'),
      });
    }
  }
}

export function listPiPackageFiles(): PackageFileEntry[] {
  const result: PackageFileEntry[] = [];
  walkFiles(PI_PACKAGE_DIR, PI_PACKAGE_DIR, result);
  return result;
}

export function createPiPackageTarStream() {
  if (!fs.existsSync(PI_PACKAGE_DIR)) {
    throw new Error('Directorio pi_package no encontrado.');
  }
  return tar.create(
    {
      gzip: true,
      cwd: PI_PACKAGE_DIR,
    },
    ['.']
  );
}
