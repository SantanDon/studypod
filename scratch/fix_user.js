import dotenv from 'dotenv';
dotenv.config();
import { getDatabase } from '../backend/src/db/database.js';
import { users, notebooks, sources } from '../backend/src/db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

async function checkAndFix() {
  try {
    const db = await getDatabase();
    const userId = 'don-santos-id-001';
    
    // 1. Check if user exists
    let user = (await db.select().from(users).where(eq(users.id, userId)))[0];
    if (!user) {
      console.log(`Creating user ${userId}...`);
      await db.insert(users).values({
        id: userId,
        email: 'don@santlabs.com',
        passwordHash: 'placeholder',
        displayName: 'Don Santos',
        accountType: 'human'
      });
      user = { id: userId };
    }
    
    // 2. See if this user has any notebooks
    const userNotebooks = await db.select().from(notebooks).where(eq(notebooks.userId, userId));
    console.log(`User ${userId} has ${userNotebooks.length} notebooks.`);
    
    if (userNotebooks.length === 0) {
      console.log('Populating notebooks for this user...');
      const notebookId = uuidv4();
      await db.insert(notebooks).values({
        id: notebookId,
        userId: userId,
        title: 'Y Combinator Video Prep',
        description: 'Research and references for the YC video application.',
        icon: 'video'
      });
      
      const ycVideos = [
        { title: 'How to Pitch Your Startup - Y Combinator', url: 'https://www.youtube.com/watch?v=S6uUun_p_7s' },
        { title: 'The Best Pitch Deck for Startups - YC Startup School', url: 'https://www.youtube.com/watch?v=WPe_uI2t_P8' }
      ];

      for (const video of ycVideos) {
        await db.insert(sources).values({
          id: uuidv4(),
          notebookId,
          userId: userId,
          title: video.title,
          type: 'youtube',
          url: video.url,
          processingStatus: 'completed'
        });
      }
      console.log('Done populating.');
    }
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkAndFix();
