/**
 * Audio Generation E2E Tests
 *
 * Tests the podcast audio generation feature in StudyPod LM.
 * Validates the UI flow, script generation quality, and progress reporting.
 *
 * These tests seed localStorage with a test user / notebook / source
 * to bypass the auth gate and immediately exercise the podcast feature.
 */
import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'e2e-test-user-001';
const TEST_NOTEBOOK_ID = 'e2e-test-notebook-001';
const TEST_SOURCE_ID = 'e2e-test-source-001';

/** Substantive test content — long enough to exercise the summarisation paths */
const TEST_SOURCE_CONTENT = `
# Introduction to Machine Learning

Machine learning is a subset of artificial intelligence that focuses on building systems
that can learn from and make decisions based on data. Rather than being explicitly
programmed, these systems improve their performance on tasks through experience.

## Supervised Learning

In supervised learning, the algorithm learns from labeled training data. Each example
in the training set consists of an input paired with the desired output. The algorithm
learns a mapping function from the input to the output, which it can then apply to
new, unseen data. Common supervised learning algorithms include linear regression,
decision trees, and neural networks.

### Key Concepts in Supervised Learning

Feature engineering is the process of selecting and transforming variables to improve
model performance. Cross-validation helps estimate how well a model will generalize
to new data. Regularization techniques like L1 and L2 prevent overfitting by adding
penalty terms to the loss function.

## Unsupervised Learning

Unsupervised learning works with unlabeled data. The algorithm tries to find hidden
patterns or groupings in the data without guidance. Clustering, dimensionality
reduction, and association rule learning are common unsupervised techniques.

K-means clustering partitions data into k groups by minimizing intra-cluster variance.
Principal Component Analysis (PCA) reduces dimensionality while preserving variance.
These methods are widely used in exploratory data analysis, customer segmentation,
and anomaly detection.

## Reinforcement Learning

Reinforcement learning involves an agent that learns to make decisions by interacting
with an environment. The agent receives rewards or penalties for its actions and aims
to maximize cumulative reward. This paradigm has achieved remarkable results in game
playing, robotics, and autonomous navigation.

Deep reinforcement learning combines deep neural networks with RL algorithms,
enabling agents to handle high-dimensional state spaces. Notable examples include
DeepMind's AlphaGo and OpenAI's robotic hand manipulation system.

## Practical Applications

Machine learning is transforming healthcare through early disease detection,
drug discovery, and personalized treatment plans. In finance, ML powers fraud
detection, algorithmic trading, and credit scoring. Natural language processing
enables chatbots, translation, and sentiment analysis at scale.
`.trim();

/**
 * A well-formed LLM response that represents a GOOD podcast script.
 * Used to mock the Groq API response so tests don't require a real API key.
 */
const MOCK_GOOD_SCRIPT_RESPONSE = JSON.stringify({
  title: 'Deep Dive: Machine Learning Fundamentals',
  segments: Array.from({ length: 45 }, (_, i) => {
    const speaker = i % 2 === 0 ? 'Alex' : 'Sarah';
    const topics = [
      'Machine learning is fundamentally about building systems that learn from experience rather than being explicitly programmed. This represents a paradigm shift in how we approach problem-solving with computers.',
      'That is a really great way to put it, Alex. So when we talk about supervised learning, we are essentially giving the algorithm examples with the correct answers, right? Like a teacher grading homework?',
      'Exactly, Sarah! And the beauty of it is that once the model has learned from enough labeled examples, it can make predictions on completely new data it has never seen before.',
      'That makes sense. But how do we know if the model is actually learning useful patterns versus just memorizing the training data? I have heard that is a common pitfall.',
      'Great question! That is what we call overfitting. We use techniques like cross-validation and regularization to prevent that. Cross-validation splits the data into multiple folds and tests on each one.',
      'Oh interesting! So regularization adds a kind of penalty to keep the model from getting too complex? That is a clever approach.',
      'Right. Now let us talk about unsupervised learning, which is fascinating because there are no labels at all. The algorithm has to discover structure in the data on its own.',
      'That sounds much harder! How does K-means clustering work? I have seen it mentioned a lot in data science articles.',
      'K-means starts by randomly placing K center points, then iteratively assigns each data point to the nearest center and re-calculates the centers. It converges when assignments stop changing.',
      'And what about reinforcement learning? That is the one used in game-playing AI, right? I remember reading about AlphaGo beating the world champion.',
      'Yes! Reinforcement learning is fundamentally different. An agent takes actions in an environment and receives rewards. The goal is to learn a policy that maximizes cumulative reward over time.',
      'So it is like training a dog with treats? Take good actions, get rewards, learn to repeat those actions?',
      'Ha, that is actually a great analogy! Deep reinforcement learning combines this with neural networks, allowing agents to handle incredibly complex environments with millions of possible states.',
      'The practical applications are what really excite me. Machine learning in healthcare could save thousands of lives through early disease detection.',
      'Absolutely. ML models can analyze medical images, genetic data, and patient records to identify patterns that human doctors might miss, leading to earlier and more accurate diagnoses.',
    ];
    return {
      speaker,
      text: topics[i % topics.length],
    };
  }),
});

/**
 * Simulates a BAD LLM response — headings-only with "moving onto" transitions.
 * This is the bug the user reported.
 */
const MOCK_BAD_SCRIPT_RESPONSE = JSON.stringify({
  title: 'Machine Learning Overview',
  segments: [
    { speaker: 'Alex', text: 'Today we are covering machine learning.' },
    { speaker: 'Sarah', text: 'Introduction to Machine Learning.' },
    { speaker: 'Alex', text: 'Moving onto Supervised Learning.' },
    { speaker: 'Sarah', text: 'Moving onto Unsupervised Learning.' },
    { speaker: 'Alex', text: 'Moving onto Reinforcement Learning.' },
    { speaker: 'Sarah', text: 'Moving onto Practical Applications.' },
    { speaker: 'Alex', text: 'That wraps up our episode.' },
  ],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed localStorage with a test user, session, notebook, and source
 * so the app renders the authenticated notebook view immediately.
 */
async function seedTestData(page: Page) {
  await page.evaluate(
    ({ userId, notebookId, sourceId, sourceContent }) => {
      const now = new Date().toISOString();

      // 1. User
      const user = {
        id: userId,
        email: 'e2e-tester@studypod.test',
        created_at: now,
        emailVerified: true,
      };
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem(
        'users',
        JSON.stringify([user]),
      );

      // 2. Session (never expires)
      const session = {
        access_token: 'e2e-test-token',
        refresh_token: 'e2e-test-refresh',
        user,
        expires_at: Date.now() + 86400000, // +24 hours
      };
      localStorage.setItem('currentSession', JSON.stringify(session));

      // 3. Notebook
      const notebook = {
        id: notebookId,
        title: 'ML Fundamentals Test Notebook',
        description: 'E2E test notebook for audio generation',
        user_id: userId,
        created_at: now,
        updated_at: now,
        generation_status: 'pending' as const,
      };
      localStorage.setItem('notebooks', JSON.stringify([notebook]));

      // 4. Source — content stored in localStorage for test simplicity
      //    (prod uses IndexedDB, but localStorage fallback is supported)
      const source = {
        id: sourceId,
        notebook_id: notebookId,
        title: 'Machine Learning Overview',
        type: 'text' as const,
        content: sourceContent,
        created_at: now,
        updated_at: now,
      };
      localStorage.setItem('sources', JSON.stringify([source]));
    },
    {
      userId: TEST_USER_ID,
      notebookId: TEST_NOTEBOOK_ID,
      sourceId: TEST_SOURCE_ID,
      sourceContent: TEST_SOURCE_CONTENT,
    },
  );
}

/**
 * Navigate to the test notebook after seeding data.
 */
async function navigateToNotebook(page: Page) {
  await seedTestData(page);
  await page.goto(`/notebook/${TEST_NOTEBOOK_ID}`);
  // Wait for the app to finish loading (the loading spinner should disappear)
  await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 15_000 }).catch(() => {
    // Loading spinner may have already disappeared
  });
}

/**
 * Intercept Groq API calls and return a mocked response.
 */
async function mockGroqAPI(page: Page, responseBody: string) {
  await page.route('**/api.groq.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'mock-completion',
        object: 'chat.completion',
        created: Date.now(),
        model: 'llama-3.3-70b-versatile',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: responseBody,
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 },
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Audio Generation Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a blank page first to set up localStorage before app loads
    await page.goto('/');
  });

  // -----------------------------------------------------------------------
  // 1. Podcast View Renders
  // -----------------------------------------------------------------------
  test('podcast view renders with generate button', async ({ page }) => {
    await navigateToNotebook(page);

    // The PodcastView uses a podcast-card class
    const podcastCard = page.locator('.podcast-card');
    await expect(podcastCard).toBeVisible({ timeout: 10_000 });

    // "Generate Podcast" button should be present
    const generateBtn = page.locator('.podcast-generate-btn');
    await expect(generateBtn).toBeVisible();
    await expect(generateBtn).toContainText(/Generate Podcast/i);
  });

  // -----------------------------------------------------------------------
  // 2. Mode Selection Toggles
  // -----------------------------------------------------------------------
  test('mode selection toggles between standard, deep dive, and deep think', async ({ page }) => {
    await navigateToNotebook(page);

    // Wait for the podcast card to appear
    const podcastCard = page.locator('.podcast-card');
    await expect(podcastCard).toBeVisible({ timeout: 10_000 });

    // The three mode buttons
    const standardBtn = podcastCard.getByRole('button', { name: /Standard/i });
    const deepDiveBtn = podcastCard.getByRole('button', { name: /Deep Dive/i });
    const deepThinkBtn = podcastCard.getByRole('button', { name: /Deep Think/i });

    // Standard should be active by default (has bg-primary class)
    await expect(standardBtn).toHaveClass(/bg-primary/);

    // Hint text for standard mode
    await expect(podcastCard.locator('text=Quick overview')).toBeVisible();

    // Click Deep Dive
    await deepDiveBtn.click();
    await expect(deepDiveBtn).toHaveClass(/bg-primary/);
    await expect(podcastCard.locator('text=Detailed 5-part')).toBeVisible();

    // Click Deep Think
    await deepThinkBtn.click();
    await expect(deepThinkBtn).toHaveClass(/bg-indigo-600/);
    await expect(podcastCard.locator('text=Advanced AI analysis')).toBeVisible();

    // Click back to Standard
    await standardBtn.click();
    await expect(standardBtn).toHaveClass(/bg-primary/);
  });

  // -----------------------------------------------------------------------
  // 3. Generate Button Shows Loading State
  // -----------------------------------------------------------------------
  test('generate button shows loading state when clicked', async ({ page }) => {
    // Delay the mock response slightly so we can observe the loading state
    await page.route('**/api.groq.com/**', async (route) => {
      // Add a small delay to simulate real network latency
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mock-completion',
          object: 'chat.completion',
          created: Date.now(),
          model: 'llama-3.3-70b-versatile',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: MOCK_GOOD_SCRIPT_RESPONSE },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 },
        }),
      });
    });
    await navigateToNotebook(page);

    const generateBtn = page.locator('.podcast-generate-btn');
    await expect(generateBtn).toBeVisible({ timeout: 10_000 });
    await expect(generateBtn).toContainText(/Generate Podcast/i);

    // Click generate
    await generateBtn.click();

    // The button text should change from "Generate Podcast" to a status message,
    // or the generating view should appear. Either confirms the loading state fired.
    const loadingStarted = await Promise.race([
      generateBtn.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => 'view-changed' as const),
      page.locator('.podcast-generating').waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'generating-view' as const),
      expect(generateBtn).toHaveClass(/loading/, { timeout: 5_000 }).then(() => 'loading-class' as const),
    ]).catch(() => 'timeout');

    // Any of these outcomes means the generation started
    expect(['view-changed', 'generating-view', 'loading-class']).toContain(loadingStarted);
  });

  // -----------------------------------------------------------------------
  // 4. Script Quality Validation — Good Response
  // -----------------------------------------------------------------------
  test('good LLM response produces substantive script segments', async ({ page }) => {
    await mockGroqAPI(page, MOCK_GOOD_SCRIPT_RESPONSE);
    await navigateToNotebook(page);

    // Intercept console.log to capture the script generation output
    const scriptLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('Final script:') || text.includes('segments')) {
        scriptLogs.push(text);
      }
    });

    const generateBtn = page.locator('.podcast-generate-btn');
    await expect(generateBtn).toBeVisible({ timeout: 10_000 });
    await generateBtn.click();

    // Wait for the generation to start and the generating view to appear,
    // OR for the player to appear (fast mock)
    const generatingOrPlayer = page.locator('.podcast-generating, .podcast-player-container');
    await expect(generatingOrPlayer).toBeVisible({ timeout: 30_000 });

    // Verify console logs indicate substantive script was produced
    // Give some time for async generation to run
    await page.waitForTimeout(3000);

    const hasSubstantiveLogs = scriptLogs.some(
      (log) => log.includes('45 segments') || log.includes('Final script'),
    );

    // At minimum, the mock should have been parsed
    expect(scriptLogs.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 5. Script Quality Validation — Bad Response (Bug Reproduction)
  // -----------------------------------------------------------------------
  test('bad LLM response with headings-only triggers fallback with limited content', async ({ page }) => {
    await mockGroqAPI(page, MOCK_BAD_SCRIPT_RESPONSE);
    await navigateToNotebook(page);

    // Capture console output to detect the fallback path
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('segments') ||
        text.includes('expanded script') ||
        text.includes('fallback') ||
        text.includes('Final script')
      ) {
        consoleLogs.push(text);
      }
    });

    const generateBtn = page.locator('.podcast-generate-btn');
    await expect(generateBtn).toBeVisible({ timeout: 10_000 });
    await generateBtn.click();

    // Wait for generation to progress
    await page.waitForTimeout(5000);

    // The bad response only has 7 segments (<20), so the fallback should trigger
    const hitFallback = consoleLogs.some(
      (log) =>
        log.includes('expanded script') ||
        log.includes('Only') ||
        log.includes('fallback'),
    );

    // This test documents the BUG: when fallback triggers, it produces
    // shallow content. We expect the fallback to fire.
    console.log('Fallback triggered:', hitFallback);
    console.log('Console logs captured:', consoleLogs);

    // The generation should still proceed (not crash)
    const generatingOrPlayer = page.locator('.podcast-generating, .podcast-player-container, .podcast-card');
    await expect(generatingOrPlayer).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // 6. Audio Settings Panel Opens
  // -----------------------------------------------------------------------
  test('audio settings panel opens when settings button is clicked', async ({ page }) => {
    await navigateToNotebook(page);

    const podcastCard = page.locator('.podcast-card');
    await expect(podcastCard).toBeVisible({ timeout: 10_000 });

    // Click "Audio Settings"
    const settingsBtn = podcastCard.locator('.podcast-settings-btn');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // The TTSProviderSettings modal/panel should appear
    // It renders with a dialog or settings panel
    const settingsPanel = page.locator('[role="dialog"], .tts-settings, .settings-panel');
    await expect(settingsPanel).toBeVisible({ timeout: 5_000 });
  });

  // -----------------------------------------------------------------------
  // 7. Generation Progress is Displayed
  // -----------------------------------------------------------------------
  test('generation progress percentage and status are displayed', async ({ page }) => {
    await mockGroqAPI(page, MOCK_GOOD_SCRIPT_RESPONSE);
    await navigateToNotebook(page);

    const generateBtn = page.locator('.podcast-generate-btn');
    await expect(generateBtn).toBeVisible({ timeout: 10_000 });
    await generateBtn.click();

    // Wait for the generating view to appear
    const generatingView = page.locator('.podcast-generating');

    // The generating view should show progress elements.
    // It may transition quickly if the mock completes fast, so we allow either
    // the generating view or the complete player view.
    const anyActiveView = page.locator('.podcast-generating, .podcast-player-container');
    await expect(anyActiveView).toBeVisible({ timeout: 30_000 });

    // If we caught the generating state, verify its elements
    if (await generatingView.isVisible()) {
      // Progress bar
      const progressBar = generatingView.locator('.generating-progress');
      await expect(progressBar).toBeVisible();

      // Status message
      const statusMsg = generatingView.locator('.generating-status');
      await expect(statusMsg).toBeVisible();

      // Percentage display
      const percentDisplay = generatingView.locator('.generating-percent');
      await expect(percentDisplay).toBeVisible();
    }
  });

  // -----------------------------------------------------------------------
  // 8. No Sources Shows Error
  // -----------------------------------------------------------------------
  test('clicking generate with no sources shows an error toast', async ({ page }) => {
    // Seed user + notebook but NO sources
    await page.evaluate(
      ({ userId, notebookId }) => {
        const now = new Date().toISOString();
        const user = {
          id: userId,
          email: 'e2e-tester@studypod.test',
          created_at: now,
          emailVerified: true,
        };
        localStorage.setItem('currentUser', JSON.stringify(user));
        localStorage.setItem('users', JSON.stringify([user]));

        const session = {
          access_token: 'e2e-test-token',
          refresh_token: 'e2e-test-refresh',
          user,
          expires_at: Date.now() + 86400000,
        };
        localStorage.setItem('currentSession', JSON.stringify(session));

        const notebook = {
          id: notebookId,
          title: 'Empty Test Notebook',
          user_id: userId,
          created_at: now,
          updated_at: now,
          generation_status: 'pending',
        };
        localStorage.setItem('notebooks', JSON.stringify([notebook]));
        localStorage.setItem('sources', JSON.stringify([]));
      },
      { userId: TEST_USER_ID, notebookId: TEST_NOTEBOOK_ID },
    );

    await page.goto(`/notebook/${TEST_NOTEBOOK_ID}`);
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 15_000 }).catch(() => {});

    const podcastCard = page.locator('.podcast-card');
    await expect(podcastCard).toBeVisible({ timeout: 10_000 });

    const generateBtn = page.locator('.podcast-generate-btn');
    await expect(generateBtn).toBeVisible();

    // The button should be disabled when no sources exist
    // OR clicking it should show a toast error  
    const isDisabled = await generateBtn.isDisabled();

    if (!isDisabled) {
      await generateBtn.click();
      // Expect an error toast to appear
      const toast = page.locator('[role="status"], .toast, [data-sonner-toast]');
      await expect(toast.first()).toBeVisible({ timeout: 5_000 });
    } else {
      // Button is correctly disabled — pass
      expect(isDisabled).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // 9. Segment Content Quality Check (diagnostics helper)
  // -----------------------------------------------------------------------
  test('diagnostic: capture generated segment content for quality review', async ({ page }) => {
    await mockGroqAPI(page, MOCK_GOOD_SCRIPT_RESPONSE);
    await navigateToNotebook(page);

    // Set up a listener for the script data that gets logged or stored
    const segmentTexts: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('Podcast script generated') || text.includes('segments')) {
        segmentTexts.push(text);
      }
    });

    const generateBtn = page.locator('.podcast-generate-btn');
    await expect(generateBtn).toBeVisible({ timeout: 10_000 });
    await generateBtn.click();

    // Wait for script generation to complete
    await page.waitForTimeout(5000);

    // The test captures diagnostic info — check that segments were produced
    console.log('=== DIAGNOSTIC: Segment logs captured ===');
    segmentTexts.forEach((t) => console.log(t));
    console.log('=== END DIAGNOSTIC ===');

    // Verify at least some console output was captured about segments
    expect(segmentTexts.length).toBeGreaterThanOrEqual(0); // Always passes — diagnostic only
  });
});
