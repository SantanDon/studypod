import { getDatabase } from './src/db/database.js';
import { sources } from './src/db/schema.js';
import { eq } from 'drizzle-orm';
import EPub from 'epub';
import nlp from 'compromise';

async function main() {
  const db = await getDatabase();
  const filePath = '../uploads/pg1636.epub';
  const epub = new EPub(filePath);
  await epub.parse();

  const chapters = [];
  for (const item of epub.flow) {
    let title = item.title;
    if (!title) {
       // Try to extract from content
       try {
         const html = await epub.getChapter(item.id);
         const text = html.replace(/<[^>]*>?/gm, '').trim(); // Basic HTML strip
         title = text.split('\n')[0].substring(0, 50).trim();
         if (title.length > 47) title += '...';
       } catch (e) {
         title = 'Untitled Chapter';
       }
    }
    chapters.push({ id: item.id, title: title || 'Untitled Chapter' });
  }

  const metadata = { 
    chapters, 
    title: epub.metadata.title || 'Phaedrus', 
    author: epub.metadata.creator || 'Plato',
    fileName: 'pg1636.epub'
  };

  await db.update(sources)
    .set({ 
      metadata: JSON.stringify(metadata),
      processingStatus: 'completed'
    })
    .where(eq(sources.id, 'src-pg1636-correct-notebook'));

  console.log(`✅ SUCCESS: Refined metadata for ${metadata.title}`);
}

main().catch(console.error);
