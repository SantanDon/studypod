import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
export function candidateInputPaths(paths) {
  return [...new Set(paths.filter(path => {
    if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) return false;
    // Never fingerprint credentials, environment files, databases, private
    // diagnostics, dependency/build output, caches, or prior receipts.
    if (/(?:^|\/)(?:\.ai-bridge|node_modules|dist|\.git|\.cache|coverage|\.env[^/]*|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)(?:\/|$)/i.test(path) || /\.private\./i.test(path)) return false;
    const scope = /^(?:src\/|public\/|e2e\/|scripts\/|backend\/(?:src|scripts)\/|(?:backend\/)?package(?:-lock)?\.json$|index\.html$|(?:vite|vitest|eslint|playwright)\.config\.[^/]+$|tsconfig[^/]*\.json$)/.test(path);
    return scope && /\.(?:[cm]?[jt]sx?|json|css|html|svg|png|jpe?g|webp|woff2?|sql|ps1)$/.test(path);
  }))].sort();
}

// Supplying an inventory permits bounded filesystem-contract tests without
// importing the runtime runner or launching servers/providers/browsers.
export async function sourceFingerprint(root, inventory) {
  const paths = inventory ?? execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, windowsHide: true }).toString().split('\0');
  const files = [];
  for (const path of candidateInputPaths(paths)) {
    try { files.push({ path, sha256: digest(await readFile(resolve(root, path))) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; files.push({ path, absent: true }); }
  }
  return { sha256: digest(JSON.stringify(files)), files };
}
