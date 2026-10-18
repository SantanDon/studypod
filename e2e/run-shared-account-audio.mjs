import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSharedAccountEnvironment } from './shared-account-policy.mjs';
const args = process.argv.slice(2);
if (!['--check', '--run'].includes(args[0]) || (args.length !== 1 && !(args.length === 3 && args[1] === '--grep'))) throw new Error('Use --check or --run, optionally --grep exact scenario pattern');
validateSharedAccountEnvironment(process.env, args[0] === '--run');
const child = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'e2e/shared-account-audio.config.ts', ...(args[0] === '--check' ? ['--list'] : []), ...(args[1] ? args.slice(1) : [])], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, DEBUG: '', PWDEBUG: '', PLAYWRIGHT_NO_COPY_PROMPT: '1', STUDYPOD_SHARED_INVENTORY_ONLY: args[0] === '--check' ? '1' : '0', STUDYPOD_AUTH_SIGNUP: '0', STUDYPOD_AUTH_TERMS_ACCEPTED: '0' }, stdio: 'inherit' });
process.exit(child.status ?? 1);
