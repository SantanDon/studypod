import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { EPub } from 'epub';
import { logger } from '../utils/logger.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;
const UPLOADS_DIR = isVercel ? '/tmp/uploads' : path.join(__dirname, '../../../uploads');
const AUDIO_CACHE_DIR = path.join(UPLOADS_DIR, 'audio_cache');

try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(AUDIO_CACHE_DIR)) {
    fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
  }
} catch (err) {
  logger.warn(`Could not create uploads directory (expected in read-only environments): ${err.message}`);
}

const upload = multer({ dest: path.join(UPLOADS_DIR, 'temp/') });

let KokoroTTS = null;
let tts = null;
const generationJobs = new Map();

const getTTS = async () => {
  if (process.env.VERCEL) {
    throw new Error('Kokoro TTS is not supported in the Vercel serverless environment due to bundle size constraints.');
  }
  if (!KokoroTTS) {
    const pkg = 'kokoro-js';
    const mod = await import(pkg);
    KokoroTTS = mod.KokoroTTS;
  }
  if (!tts) {
    logger.info('🔊 Initializing Kokoro TTS engine (first load)...');
    tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", {
      dtype: "q8",
      device: "cpu"
    });
    logger.info('✅ Kokoro TTS engine ready');
  }
  return tts;
};

/**
 * Parse an EPUB file. epub v2.x uses async parse() — no event emitters.
 */
const parseEpub = async (filePath) => {
  const epub = new EPub(filePath);
  await epub.parse();
  return epub;
};

/**
 * Build a chapter list that merges flow items with TOC titles.
 * Flow items come from the spine (reading order) but often lack human titles.
 * TOC entries have the actual chapter names. We match them by id/href.
 */
const getChaptersWithTitles = (epub) => {
  // Build a title lookup from TOC
  const tocTitles = {};
  if (epub.toc && epub.toc.length > 0) {
    for (const entry of epub.toc) {
      if (entry.id) tocTitles[entry.id] = entry.title;
      if (entry.href) {
        // Also match by href basename in case IDs differ
        const hrefBase = entry.href.split('#')[0];
        tocTitles[hrefBase] = entry.title;
      }
    }
  }

  return epub.flow.map((chapter, index) => {
    const tocTitle = tocTitles[chapter.id] || tocTitles[chapter.href];
    return {
      id: chapter.id,
      title: tocTitle || chapter.title || `Chapter ${index + 1}`,
      href: chapter.href
    };
  });
};

/**
 * Split long text into TTS-safe chunks (~400 chars).
 * Kokoro crashes on very long strings, so we split on sentence boundaries.
 */
const chunkTextForTTS = (text, maxLen = 400) => {
  if (!text || text.length <= maxLen) return [text];
  
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Force-split any single chunk that's still too long
  const final = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLen) {
      final.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += maxLen) {
        final.push(chunk.slice(i, i + maxLen));
      }
    }
  }
  return final;
};

/**
 * Generate audio for a text block, chunking if necessary.
 */
const generateChunkedAudio = async (engine, text, voice, cachePath) => {
  const chunks = chunkTextForTTS(text);

  if (chunks.length === 1) {
    const audio = await engine.generate(chunks[0], { voice });
    await audio.save(cachePath);
    return cachePath;
  }

  logger.info(`  📎 Splitting into ${chunks.length} TTS chunks...`);
  const chunkPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = cachePath.replace('.wav', `_chunk${i}.wav`);
    const audio = await engine.generate(chunks[i], { voice });
    await audio.save(chunkPath);
    chunkPaths.push(chunkPath);
  }

  try {
    await concatWavFiles(chunkPaths, cachePath);
  } finally {
    for (const cp of chunkPaths) {
      try { fs.unlinkSync(cp); } catch (_) {}
    }
  }
  return cachePath;
};

/**
 * Concatenate multiple WAV files (same sample rate/channels from Kokoro).
 */
const concatWavFiles = async (inputPaths, outputPath) => {
  if (inputPaths.length === 0) throw new Error('No WAV files to concatenate');
  if (inputPaths.length === 1) {
    fs.copyFileSync(inputPaths[0], outputPath);
    return;
  }

  const buffers = inputPaths.map(p => fs.readFileSync(p));
  const headerSize = 44;
  const firstHeader = Buffer.from(buffers[0].buffer, buffers[0].byteOffset, headerSize);
  
  const pcmChunks = buffers.map((buf) => {
    return Buffer.from(buf.buffer, buf.byteOffset + headerSize, buf.length - headerSize);
  });
  
  const totalPcmSize = pcmChunks.reduce((sum, b) => sum + b.length, 0);
  const header = Buffer.from(firstHeader);
  header.writeUInt32LE(36 + totalPcmSize, 4);
  header.writeUInt32LE(totalPcmSize, 40);
  
  const output = Buffer.concat([header, ...pcmChunks]);
  fs.writeFileSync(outputPath, output);
};

// ─── EXTRACT ENDPOINT (frontend EPUB ingestion) ──────────────────────────────

router.post('/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const tempPath = req.file.path;
    const safeFileName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const permanentPath = path.join(UPLOADS_DIR, safeFileName);
    
    fs.copyFileSync(tempPath, permanentPath);
    try { fs.unlinkSync(tempPath); } catch (_) {}

    logger.info(`📚 Extracting EPUB: ${safeFileName}`);
    const epub = await parseEpub(permanentPath);
    const metadata = epub.metadata;

    const chapters = getChaptersWithTitles(epub);

    let fullContent = '';
    for (const chapter of epub.flow) {
      try {
        const html = await epub.getChapter(chapter.id);
        const plainText = (html || '').replace(/<[^>]*>?/gm, '').trim();
        if (plainText) {
          fullContent += `\n\n--- ${chapter.title || 'Chapter'} ---\n\n${plainText}`;
        }
      } catch (chapterErr) {
        logger.warn(`  ⚠️ Could not extract chapter ${chapter.id}:`, chapterErr.message);
      }
    }

    fullContent = fullContent.trim();
    const bookTitle = metadata.title || safeFileName.replace(/\.epub$/i, '');
    logger.info(`  ✅ Extracted ${fullContent.length} chars, ${chapters.length} chapters from "${bookTitle}"`);

    res.json({
      title: bookTitle,
      author: metadata.creator || 'Unknown Author',
      description: metadata.description || '',
      chapters,
      content: fullContent,
      fileName: safeFileName
    });
  } catch (err) {
    logger.error('EPUB extraction failed:', err);
    res.status(500).json({ error: `EPUB extraction failed: ${err.message}` });
  }
});

// ─── METADATA ─────────────────────────────────────────────────────────────────

router.get('/meta', async (req, res) => {
  try {
    const fileName = req.query.file || 'phaedrus.epub';
    const filePath = path.join(UPLOADS_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const epub = await parseEpub(filePath);
    const metadata = epub.metadata;
    const chapters = getChaptersWithTitles(epub);

    res.json({
      title: metadata.title,
      author: metadata.creator,
      description: metadata.description,
      chapters
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── VOICES ───────────────────────────────────────────────────────────────────

router.get('/voices', async (req, res) => {
  try {
    const engine = await getTTS();
    res.json({ voices: Object.keys(engine.voices) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GENERATE CHAPTER AUDIO ──────────────────────────────────────────────────

router.get('/generate/:id', async (req, res) => {
  try {
    const fileName = req.query.file || 'phaedrus.epub';
    const filePath = path.join(UPLOADS_DIR, fileName);
    const chapterId = req.params.id;
    const voice = req.query.voice || 'af_bella';

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `EPUB not found: ${fileName}` });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cacheKey = `${safeName}_${chapterId}_${voice}.wav`;
    const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);

    if (fs.existsSync(cachePath)) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
      return res.sendFile(cachePath);
    }

    logger.info(`🔊 Generating audio for chapter "${chapterId}" of "${fileName}" with voice "${voice}"`);

    const epub = await parseEpub(filePath);
    const html = await epub.getChapter(chapterId);
    const plainText = (html || '').replace(/<[^>]*>?/gm, '').trim();

    if (!plainText || plainText.length < 2) {
      return res.status(400).json({ error: 'Chapter has no extractable text' });
    }

    const engine = await getTTS();
    await generateChunkedAudio(engine, plainText, voice, cachePath);

    logger.info(`  ✅ Chapter audio saved: ${cacheKey}`);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.sendFile(cachePath);
  } catch (err) {
    logger.error('Chapter generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GENERATE FULL AUDIOBOOK ─────────────────────────────────────────────────

router.post('/generate-full', async (req, res) => {
  try {
    const { fileName, voice, chapterIds } = req.body;
    
    if (!fileName || !chapterIds || chapterIds.length === 0) {
      return res.status(400).json({ error: 'fileName and chapterIds are required' });
    }

    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `EPUB not found: ${fileName}` });
    }

    const jobId = `full_${Date.now()}`;
    generationJobs.set(jobId, { status: 'processing', progress: 0 });

    (async () => {
      try {
        const epub = await parseEpub(filePath);
        const engine = await getTTS();
        const chapterPaths = [];
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const selectedVoice = voice || 'af_bella';

        for (let i = 0; i < chapterIds.length; i++) {
          const cid = chapterIds[i];
          const cacheKey = `${safeName}_${cid}_${selectedVoice}.wav`;
          const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);

          if (!fs.existsSync(cachePath)) {
            logger.info(`  🔊 Full book: generating chapter ${i + 1}/${chapterIds.length} (${cid})`);
            const html = await epub.getChapter(cid);
            const text = (html || '').replace(/<[^>]*>?/gm, '').trim();
            
            if (text && text.length >= 2) {
              await generateChunkedAudio(engine, text, selectedVoice, cachePath);
            } else {
              logger.warn(`  ⚠️ Skipping empty chapter: ${cid}`);
              continue;
            }
          }
          chapterPaths.push(cachePath);
          generationJobs.set(jobId, { 
            status: 'processing', 
            progress: Math.round(((i + 1) / chapterIds.length) * 100) 
          });
        }

        if (chapterPaths.length === 0) {
          generationJobs.set(jobId, { status: 'failed', error: 'No chapters had extractable text' });
          return;
        }

        const finalFileName = `${safeName}_full_${selectedVoice}.wav`;
        const finalPath = path.join(AUDIO_CACHE_DIR, finalFileName);
        
        logger.info(`  📎 Concatenating ${chapterPaths.length} chapter files...`);
        await concatWavFiles(chapterPaths, finalPath);

        logger.info(`  ✅ Full audiobook saved: ${finalFileName}`);
        generationJobs.set(jobId, { 
          status: 'completed', 
          url: `/api/audiobook/download/${finalFileName}` 
        });
      } catch (err) {
        logger.error('Full generation failed:', err);
        generationJobs.set(jobId, { status: 'failed', error: err.message });
      }
    })();

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── JOB STATUS & DOWNLOAD ──────────────────────────────────────────────────

router.get('/job-status/:id', (req, res) => {
  const job = generationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.get('/download/:filename', (req, res) => {
  const filePath = path.join(AUDIO_CACHE_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

// ─── GUTENBERG IMPORT ────────────────────────────────────────────────────────

/**
 * POST /api/audiobook/import-gutenberg
 * Download an EPUB from Project Gutenberg by book ID, extract metadata + chapters.
 * Body: { bookId: number }
 * Example: { bookId: 1342 } → Pride and Prejudice
 */
router.post('/import-gutenberg', async (req, res) => {
  try {
    const { bookId } = req.body;
    if (!bookId) {
      return res.status(400).json({ error: 'bookId is required (e.g. 1342 for Pride and Prejudice)' });
    }

    const safeFileName = `pg${bookId}.epub`;
    const permanentPath = path.join(UPLOADS_DIR, safeFileName);

    // Check if already downloaded
    if (!fs.existsSync(permanentPath)) {
      // Try EPUB (no images) first — smaller, faster
      const urls = [
        `https://www.gutenberg.org/ebooks/${bookId}.epub.noimages`,
        `https://www.gutenberg.org/ebooks/${bookId}.epub.images`,
        `https://www.gutenberg.org/cache/epub/${bookId}/pg${bookId}.epub`,
      ];

      let downloaded = false;
      for (const url of urls) {
        try {
          logger.info(`📥 Trying: ${url}`);
          const response = await fetch(url, { 
            redirect: 'follow',
            headers: { 'User-Agent': 'StudyPodLM/1.0 (Audiobook Studio)' }
          });
          
          if (response.ok) {
            const arrayBuf = await response.arrayBuffer();
            const buf = Buffer.from(arrayBuf);
            
            // Quick sanity check — EPUBs are zips, should start with PK
            if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B) {
              fs.writeFileSync(permanentPath, buf);
              logger.info(`  ✅ Downloaded ${buf.length} bytes → ${safeFileName}`);
              downloaded = true;
              break;
            } else {
              logger.warn(`  ⚠️ Response from ${url} is not a valid ZIP/EPUB`);
            }
          } else {
            logger.warn(`  ⚠️ ${url} returned ${response.status}`);
          }
        } catch (fetchErr) {
          logger.warn(`  ⚠️ Fetch failed for ${url}:`, fetchErr.message);
        }
      }

      if (!downloaded) {
        return res.status(404).json({ 
          error: `Could not download EPUB for Gutenberg book #${bookId}. Check the ID at https://www.gutenberg.org/ebooks/${bookId}` 
        });
      }
    } else {
      logger.info(`📚 Using cached EPUB: ${safeFileName}`);
    }

    // Parse the EPUB
    const epub = await parseEpub(permanentPath);
    const metadata = epub.metadata;
    const chapters = getChaptersWithTitles(epub);

    // Extract full text content
    let fullContent = '';
    for (const chapter of epub.flow) {
      try {
        const html = await epub.getChapter(chapter.id);
        const plainText = (html || '').replace(/<[^>]*>?/gm, '').trim();
        if (plainText) {
          const chTitle = chapters.find(c => c.id === chapter.id)?.title || 'Chapter';
          fullContent += `\n\n--- ${chTitle} ---\n\n${plainText}`;
        }
      } catch (_) {}
    }
    fullContent = fullContent.trim();

    const bookTitle = metadata.title || `Gutenberg Book #${bookId}`;
    logger.info(`  ✅ Parsed "${bookTitle}" by ${metadata.creator || 'Unknown'}: ${chapters.length} chapters, ${fullContent.length} chars`);

    res.json({
      title: bookTitle,
      author: metadata.creator || 'Unknown Author',
      description: metadata.description || '',
      chapters,
      content: fullContent,
      fileName: safeFileName,
      gutenbergId: bookId,
      gutenbergUrl: `https://www.gutenberg.org/ebooks/${bookId}`
    });
  } catch (err) {
    logger.error('Gutenberg import failed:', err);
    res.status(500).json({ error: `Gutenberg import failed: ${err.message}` });
  }
});

export default router;
