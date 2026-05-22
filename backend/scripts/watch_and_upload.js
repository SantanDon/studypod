#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

// Load env files
const envLocal = loadEnv(path.join(__dirname, '../../.env'));
const envAgent = loadEnv(path.join(__dirname, '../../.env.agent'));

const PORT = envLocal.PORT || process.env.PORT || '4000';
const API_BASE = `http://localhost:${PORT}/api`;
const AGENT_API_KEY = envAgent.AGENT_API_KEY || process.env.AGENT_API_KEY;

if (!AGENT_API_KEY) {
  console.error('❌ Error: AGENT_API_KEY is not configured in .env.agent.');
  console.error('   Please run pairing script first: node backend/scripts/kilo_pair.js <PIN>');
  process.exit(1);
}

const headers = { 'Authorization': `Bearer ${AGENT_API_KEY}` };

async function fetchNotebooks() {
  const res = await fetch(`${API_BASE}/notebooks`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to list notebooks: ${res.statusText}`);
  }
  return res.json();
}

async function uploadFile(notebookId, filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n📤 [Upload] Starting upload of ${fileName} to notebook ${notebookId}...`);
  
  const start = Date.now();
  const fileBuffer = fs.readFileSync(filePath);
  const sizeBytes = fileBuffer.length;
  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(2);
  
  // Detect mime type simply
  let mimeType = 'text/plain';
  if (fileName.endsWith('.pdf')) mimeType = 'application/pdf';
  else if (fileName.endsWith('.json')) mimeType = 'application/json';
  else if (fileName.endsWith('.md')) mimeType = 'text/markdown';
  else if (fileName.endsWith('.html')) mimeType = 'text/html';

  const blob = new Blob([fileBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('notebookId', notebookId);
  formData.append('file', blob, fileName);

  try {
    const res = await fetch(`${API_BASE}/agent/upload`, {
      method: 'POST',
      headers,
      body: formData
    });
    
    const duration = Date.now() - start;
    if (!res.ok) {
      console.error(`❌ [Upload Failed] status ${res.status}: ${await res.text()}`);
      return false;
    }
    
    const json = await res.json();
    console.log(`✅ [Upload Success] Upload ID: ${json.uploadId}`);
    console.log(`⏱️  Duration: ${duration}ms | Size: ${sizeMb} MB | Speed: ${(sizeMb / (duration / 1000)).toFixed(2)} MB/s`);
    return true;
  } catch (err) {
    console.error(`❌ [Upload Error] Connection failed:`, err.message);
    return false;
  }
}

async function main() {
  const notebookIdArg = process.argv[2];
  const watchDirArg = process.argv[3];

  console.log('──────────────────────────────────────────────────────');
  console.log('👀 STUDYPOD AUTOMATIC DIRECTORY MONITORING UTILITY');
  console.log('──────────────────────────────────────────────────────');

  let notebooks;
  try {
    notebooks = await fetchNotebooks();
  } catch (err) {
    console.error(`❌ Could not connect to StudyPod API server on port ${PORT}:`, err.message);
    console.error(`   Please ensure backend server is running.`);
    process.exit(1);
  }

  if (!notebookIdArg || !watchDirArg) {
    console.log('\nUsage:');
    console.log('  node backend/scripts/watch_and_upload.js <notebook-id> <local-directory-path>');
    console.log('\nAvailable Notebooks:');
    notebooks.forEach((n, idx) => {
      console.log(`  [${idx + 1}] Title: "${n.title}"`);
      console.log(`      ID:    ${n.id}`);
    });
    console.log('──────────────────────────────────────────────────────\n');
    process.exit(0);
  }

  const selectedNotebook = notebooks.find(n => n.id === notebookIdArg);
  if (!selectedNotebook) {
    console.error(`❌ Error: Notebook with ID "${notebookIdArg}" not found or unauthorized.`);
    process.exit(1);
  }

  const watchDir = path.resolve(watchDirArg);
  if (!fs.existsSync(watchDir)) {
    console.log(`📁 Directory "${watchDir}" does not exist. Creating it...`);
    fs.mkdirSync(watchDir, { recursive: true });
  }

  console.log(`\n🔔 Target Notebook: "${selectedNotebook.title}" (${selectedNotebook.id})`);
  console.log(`📁 Watching Local Folder: ${watchDir}`);
  console.log(`✨ Drop any document (.txt, .md, .pdf) in this folder to upload automatically.\n`);

  // Track uploaded files to prevent redundant uploads on restart
  const uploadedFiles = new Set();

  // Scan existing files
  const existingFiles = fs.readdirSync(watchDir);
  for (const file of existingFiles) {
    const filePath = path.join(watchDir, file);
    if (fs.statSync(filePath).isFile()) {
      uploadedFiles.add(file);
      console.log(`ℹ️  Ignoring existing file: ${file}`);
    }
  }

  console.log(`\n🚀 Monitoring started. Press Ctrl+C to terminate...`);

  // Watch directory
  fs.watch(watchDir, async (eventType, filename) => {
    if (!filename) return;
    
    const filePath = path.join(watchDir, filename);
    
    // Check if file is still written/exists
    if (!fs.existsSync(filePath)) {
      if (uploadedFiles.has(filename)) {
        uploadedFiles.delete(filename);
        console.log(`🗑️  Detected removal of file: ${filename}`);
      }
      return;
    }

    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) return;

      // Ignore temporary files
      if (filename.startsWith('.') || filename.endsWith('~') || filename.endsWith('.tmp')) return;

      // If it's a new file
      if (!uploadedFiles.has(filename)) {
        uploadedFiles.add(filename);
        
        // Wait a short delay to ensure writing is complete (debounce/stabilize)
        setTimeout(async () => {
          await uploadFile(notebookIdArg, filePath);
        }, 1000);
      }
    } catch (e) {
      // Ignored if file locks during writing
    }
  });
}

main().catch(err => {
  console.error('❌ Utility crashed:', err.message);
  process.exit(1);
});
