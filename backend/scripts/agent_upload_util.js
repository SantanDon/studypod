import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.agent') });

const API_BASE = process.env.STUDYPOD_API || `http://localhost:${process.env.PORT || '4000'}/api`;
const AGENT_API_KEY = process.env.AGENT_API_KEY;

if (!AGENT_API_KEY) {
  console.error('❌ Error: AGENT_API_KEY is not set in .env.agent or env variables.');
  console.error('Please make sure .env.agent contains: AGENT_API_KEY=spm_...');
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.txt': return 'text/plain';
    case '.md': return 'text/markdown';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

async function performUpload(filePath, notebookId, headers) {
  const fileName = path.basename(filePath);
  const mimeType = getMimeType(filePath);
  const fileSize = fs.statSync(filePath).size;

  console.log(`\n🚀 Preparing upload of "${fileName}"...`);
  console.log(`   Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Mime: ${mimeType}`);

  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: mimeType });

  const formData = new FormData();
  formData.append('notebookId', notebookId);
  formData.append('file', blob, fileName);

  const uploadRes = await fetch(`${API_BASE}/agent/upload`, {
    method: 'POST',
    headers,
    body: formData
  });

  if (!uploadRes.ok) {
    const errorData = await uploadRes.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${uploadRes.status}: ${uploadRes.statusText}`);
  }

  const result = await uploadRes.json();
  console.log('\n======================================================');
  console.log('✅  UPLOAD SUCCESSFUL!');
  console.log('======================================================');
  console.log(`  Message: ${result.message}`);
  console.log(`  Upload ID: ${result.uploadId}`);
  console.log('======================================================\n');
}

async function main() {
  console.log('\n======================================================');
  console.log('🤖  StudyPodLM Agent Local File Uploader Utility  🤖');
  console.log('======================================================\n');
  console.log(`Using API base: ${API_BASE}`);
  console.log(`API Key hash prefix: ${AGENT_API_KEY.substring(0, 12)}...\n`);

  const headers = {
    'Authorization': `Bearer ${AGENT_API_KEY}`
  };

  // Check for command line arguments (allows programmatic agent use)
  const args = process.argv.slice(2);
  let cliFilePath = null;
  let cliNotebookId = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--file' || args[i] === '-f') && args[i + 1]) {
      cliFilePath = args[i + 1];
      i++;
    } else if ((args[i] === '--notebook' || args[i] === '-n') && args[i + 1]) {
      cliNotebookId = args[i + 1];
      i++;
    }
  }

  if (cliFilePath && cliNotebookId) {
    const resolvedPath = path.resolve(cliFilePath.trim().replace(/^['"]|['"]$/g, ''));
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      console.error(`❌ Error: File does not exist at "${resolvedPath}"`);
      rl.close();
      process.exit(1);
    }

    console.log(`Selected notebook ID: "${cliNotebookId}"`);
    console.log(`Selected file path: "${resolvedPath}"`);

    try {
      await performUpload(resolvedPath, cliNotebookId, headers);
      rl.close();
      process.exit(0);
    } catch (err) {
      console.error('❌ Programmatic Upload Failed:', err.message);
      rl.close();
      process.exit(1);
    }
  }

  // 1. Fetch and select notebook
  console.log('📚 Fetching notebooks...');
  let notebooks = [];
  try {
    const res = await fetch(`${API_BASE}/notebooks`, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    notebooks = await res.json();
  } catch (err) {
    console.error('❌ Failed to fetch notebooks:', err.message);
    rl.close();
    process.exit(1);
  }

  if (notebooks.length === 0) {
    console.log('❌ No notebooks found. Please create a notebook via the web UI first.');
    rl.close();
    process.exit(0);
  }

  console.log('\nAvailable Notebooks:');
  notebooks.forEach((nb, idx) => {
    console.log(`  [${idx + 1}] ${nb.title} (${nb.id})`);
  });

  let nbChoice = -1;
  while (nbChoice < 0 || nbChoice >= notebooks.length) {
    const answer = await askQuestion('\nSelect a notebook (number): ');
    const val = parseInt(answer.trim(), 10);
    if (!isNaN(val) && val >= 1 && val <= notebooks.length) {
      nbChoice = val - 1;
    } else {
      console.log('Invalid choice. Please select a valid notebook number.');
    }
  }

  const selectedNotebook = notebooks[nbChoice];
  console.log(`\nSelected notebook: "${selectedNotebook.title}"`);

  // 2. Select file or directory
  let filePath = '';
  let validFileSelected = false;

  while (!validFileSelected) {
    console.log('\nOptions:');
    console.log('  [1] Enter direct file path');
    console.log('  [2] Scan a directory for files');
    const option = await askQuestion('\nChoose option (1 or 2): ');

    if (option.trim() === '1') {
      const rawPath = await askQuestion('Enter absolute or relative path to the file: ');
      const resolved = path.resolve(rawPath.trim().replace(/^['"]|['"]$/g, ''));
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        filePath = resolved;
        validFileSelected = true;
      } else {
        console.log(`❌ Error: File does not exist at "${resolved}"`);
      }
    } else if (option.trim() === '2') {
      const defaultDir = path.resolve(process.cwd());
      const rawDir = await askQuestion(`Enter directory path to scan (default: ${defaultDir}): `);
      const targetDir = rawDir.trim() ? path.resolve(rawDir.trim().replace(/^['"]|['"]$/g, '')) : defaultDir;

      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        console.log(`❌ Error: Directory does not exist at "${targetDir}"`);
        continue;
      }

      console.log(`Scanning directory: "${targetDir}"...`);
      const allFiles = fs.readdirSync(targetDir);
      const filteredFiles = allFiles.filter(file => {
        const fullPath = path.join(targetDir, file);
        if (!fs.statSync(fullPath).isFile()) return false;
        if (file.startsWith('.')) return false; // skip hidden
        // Skip common heavy directories/files
        if (file === 'package-lock.json') return false;
        
        const ext = path.extname(file).toLowerCase();
        return ['.pdf', '.docx', '.txt', '.md', '.json', '.jpg', '.png'].includes(ext);
      });

      if (filteredFiles.length === 0) {
        console.log('⚠️ No supported files found in this directory.');
        continue;
      }

      console.log('\nFound files:');
      filteredFiles.forEach((file, idx) => {
        console.log(`  [${idx + 1}] ${file}`);
      });

      let fileChoice = -1;
      while (fileChoice < 0 || fileChoice >= filteredFiles.length) {
        const fileAns = await askQuestion('\nSelect a file (number, or 0 to cancel): ');
        const fileIdx = parseInt(fileAns.trim(), 10);
        if (!isNaN(fileIdx)) {
          if (fileIdx === 0) {
            break;
          }
          if (fileIdx >= 1 && fileIdx <= filteredFiles.length) {
            fileChoice = fileIdx - 1;
          }
        }
        if (fileChoice < 0) {
          console.log('Invalid choice. Please select a valid number.');
        }
      }

      if (fileChoice >= 0) {
        filePath = path.join(targetDir, filteredFiles[fileChoice]);
        validFileSelected = true;
      }
    }
  }

  // 3. Perform upload
  try {
    await performUpload(filePath, selectedNotebook.id, headers);
  } catch (err) {
    console.error('\n❌ Upload Failed:', err.message);
  }

  rl.close();
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  rl.close();
  process.exit(1);
});
