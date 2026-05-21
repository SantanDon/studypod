import dotenv from 'dotenv';
dotenv.config();
import { getDatabase } from '../backend/src/db/database.js';
import { users, notebooks, sources } from '../backend/src/db/schema.js';
import { v4 as uuidv4 } from 'uuid';

async function populate() {
  try {
    console.log('🚀 Starting population script...');
    const db = await getDatabase();
    
    // 1. Get or create user
    let user = (await db.select().from(users).limit(1))[0];
    if (!user) {
      console.log('Creating default user...');
      const userId = uuidv4();
      await db.insert(users).values({
        id: userId,
        email: 'lo@santlabs.com',
        passwordHash: 'placeholder',
        displayName: 'LO',
        accountType: 'human'
      });
      user = { id: userId };
    }
    console.log(`Using user ID: ${user.id}`);

    // 2. Create YC Notebook
    const notebookId = uuidv4();
    await db.insert(notebooks).values({
      id: notebookId,
      userId: user.id,
      title: 'Y Combinator Video Prep',
      description: 'Research and references for the YC video application.',
      icon: 'video'
    });
    console.log(`Created notebook: ${notebookId}`);

    // 3. Add YouTube Sources
    const ycVideos = [
      {
        title: 'How to Pitch Your Startup - Y Combinator',
        url: 'https://www.youtube.com/watch?v=S6uUun_p_7s'
      },
      {
        title: 'The Best Pitch Deck for Startups - YC Startup School',
        url: 'https://www.youtube.com/watch?v=WPe_uI2t_P8'
      },
      {
        title: 'How to Apply and Succeed at Y Combinator',
        url: 'https://www.youtube.com/watch?v=0lG9V9S-Fio'
      },
      {
        title: 'YC Demo Day Winter 2024 Highlights',
        url: 'https://www.youtube.com/watch?v=U9vS6fF2cSc'
      }
    ];

    for (const video of ycVideos) {
      await db.insert(sources).values({
        id: uuidv4(),
        notebookId,
        userId: user.id,
        title: video.title,
        type: 'youtube',
        url: video.url,
        processingStatus: 'completed'
      });
      console.log(`Added source: ${video.title}`);
    }

    console.log('✅ Population complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Population failed:', error);
    process.exit(1);
  }
}

populate();
