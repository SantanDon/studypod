import { getDatabase } from './src/db/database.js';
import { sources } from './src/db/schema.js';
import EPub from 'epub';

async function main() {
  const db = await getDatabase();
  const filePath = '../uploads/pg1636.epub';
  const epub = new EPub(filePath);
  await epub.parse();

  const chapters = epub.flow.map(c => ({ id: c.id, title: c.title }));
  const metadata = { 
    chapters, 
    title: epub.metadata.title || 'Phaedrus', 
    author: epub.metadata.creator || 'Plato',
    fileName: 'pg1636.epub'
  };

  await db.insert(sources).values({
    id: 'src-pg1636-correct-notebook',
    notebookId: '165c06dd-56d0-43e2-8ba8-756afbaba576',
    userId: 'don-santos-id-001',
    title: metadata.title,
    type: 'ebook',
    content: '',
    metadata: JSON.stringify(metadata),
    filePath: 'pg1636.epub',
    fileSize: 139369,
    processingStatus: 'completed'
  });

  console.log(`✅ SUCCESS: Injected ${metadata.title} into notebook 165c06dd-56d0-43e2-8ba8-756afbaba576 for Don Santos`);
}

main().catch(console.error);
