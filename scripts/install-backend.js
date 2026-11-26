import { execSync } from 'child_process';

if (process.env.VERCEL || process.env.CI) {
  console.log('Skipping backend installation on Vercel/CI environment');
  process.exit(0);
}

try {
  console.log('Installing backend dependencies...');
  execSync('npm ci', { cwd: new URL('../backend/', import.meta.url), stdio: 'inherit' });
} catch (error) {
  console.error('Failed to install backend dependencies:', error.message);
  process.exit(1);
}
