import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const STOCK_WRITER = 'src/modules/inventory/stock.service.ts';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !relative(ROOT, file).startsWith('src/generated'));
}

const STOCK_WRITE_PATTERNS = [
  /\bstock_quantity\s*:\s*\{\s*(?:set|increment|decrement)\b/,
  /\bstock_quantity\s*:\s*-?\d+\b/,
  /\bSET\s+"?stock_quantity"?/i,
  /\bstock_quantity\s*[+-]?=/i,
  /\b(?:increment|decrement)\b[^\n]*\bstock_quantity\b/i,
];

describe('architecture boundaries', () => {
  it('only inventory/stock.service.ts writes Item.stock_quantity', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const repoPath = relative(ROOT, file);
      if (repoPath === STOCK_WRITER) continue;

      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (STOCK_WRITE_PATTERNS.some((pattern) => pattern.test(line))) {
          offenders.push(`${repoPath}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('catalog and inventory modules do not import each other', () => {
    const violations: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const repoPath = relative(ROOT, file);
      const module = repoPath.startsWith('src/modules/catalog/')
        ? 'catalog'
        : repoPath.startsWith('src/modules/inventory/')
          ? 'inventory'
          : null;
      if (!module) continue;

      const other = module === 'catalog' ? 'inventory' : 'catalog';
      const content = readFileSync(file, 'utf8');
      const specifiers = [
        ...content.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g),
      ].map((match) => match[1]);

      for (const specifier of specifiers) {
        if (
          specifier.includes(`/modules/${other}/`) ||
          specifier.startsWith(`../${other}/`)
        ) {
          violations.push(`${repoPath} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
