import { execSync } from 'child_process';

if (process.env.VERCEL) {
  console.log('Skipping backend installation on Vercel');
  process.exit(0);
}

try {
  console.log('Installing backend dependencies...');
  execSync('npm install --prefix backend', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to install backend dependencies:', error.message);
  process.exit(1);
}
