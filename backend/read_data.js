import Database from 'better-sqlite3';

const dbPath = './data/insights.db';
const db = new Database(dbPath);

try {
    const notebooks = db.prepare('SELECT id, title FROM notebooks').all();
    console.log('NOTEBOOKS_START');
    console.log(JSON.stringify(notebooks));
    console.log('NOTEBOOKS_END');

    const notes = db.prepare('SELECT notebook_id, content FROM notes').all();
    console.log('NOTES_START');
    console.log(JSON.stringify(notes));
    console.log('NOTES_END');

    const sources = db.prepare('SELECT notebook_id, title, content FROM sources').all();
    console.log('SOURCES_START');
    console.log(JSON.stringify(sources));
    console.log('SOURCES_END');
} catch (err) {
    console.error(err);
} finally {
    db.close();
}
