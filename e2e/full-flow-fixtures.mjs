import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { spawnSync } from 'node:child_process';
export const content = 'Synthetic StudyPod acceptance material. The Cedar experiment uses exactly 17 blue trays. Each tray contains three bean seedlings. The seedlings receive light for six hours daily. Water is measured every morning. Chlorophyll absorbs light during photosynthesis. Plants use carbon dioxide and water to produce sugars and release oxygen. The experimental control receives the same water but no light. Researchers compare growth after fourteen days. No private or copyrighted course material is included.';
export async function makeFixtures(directory) {
  await mkdir(directory, { recursive: true });
  for (const ext of ['txt', 'md', 'markdown']) await writeFile(resolve(directory, `cedar.${ext}`), content);
  await writeFile(resolve(directory, 'corrupt.pdf'), '%PDF-1.7\nThis intentionally corrupt synthetic fixture has no PDF object structure.');
  const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(content.match(/.{1,75}(?:\s|$)/g).join('\n'), { x: 30, y: 780, font, size: 12, lineHeight: 18 });
  await writeFile(resolve(directory, 'cedar.pdf'), await pdf.save());
  await writeFile(resolve(directory, 'cedar.docx'), await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(content)] }] })));
  const zip = new JSZip(); zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Cedar experiment</dc:title><dc:identifier id="book">cedar-qa</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cedar experiment</title></head><body><h1>Cedar experiment</h1><p>${content}</p></body></html>`);
  await writeFile(resolve(directory, 'cedar.epub'), await zip.generateAsync({ type: 'nodebuffer' }));
  if (process.env.STUDYPOD_AUDIO_FIXTURE_DIR) {
    for (const ext of ['wav', 'mp3', 'm4a']) await copyFile(resolve(process.env.STUDYPOD_AUDIO_FIXTURE_DIR, `cedar.${ext}`), resolve(directory, `cedar.${ext}`));
    return;
  }
  const speech = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.Speech; $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speaker.SetOutputToWaveFile($env:STUDYPOD_FIXTURE_WAV); $speaker.Speak($env:STUDYPOD_FIXTURE_SPEECH); $speaker.Dispose()"], { windowsHide: true, timeout: 30000, env: { ...process.env, STUDYPOD_FIXTURE_WAV: resolve(directory, 'cedar.wav'), STUDYPOD_FIXTURE_SPEECH: content } });
  if (speech.status !== 0) throw new Error('Synthetic speech WAV fixture unavailable');
  for (const ext of ['mp3', 'm4a']) {
    const converted = spawnSync('ffmpeg', ['-nostdin', '-y', '-i', resolve(directory, 'cedar.wav'), resolve(directory, `cedar.${ext}`)], { windowsHide: true, timeout: 30000, stdio: 'ignore' });
    if (converted.status !== 0) throw new Error(`Synthetic ${ext} fixture conversion unavailable`);
  }
}
