import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

// Cross-Origin Isolation headers for SharedArrayBuffer (required for Kokoro TTS / ONNX)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize routes after app is set up using dynamic imports to handle CommonJS modules
const initializeRoutes = async () => {
  try {
    // Import the routes as ES modules
    const { default: authRoutes } = await import('./routes/auth.js');
    const { default: userRoutes } = await import('./routes/user.js');
    const { default: pdfRoutes } = await import('./routes/pdf.js');
    const { default: youtubeRoutes } = await import('./routes/youtube.js');

    // API Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/user', userRoutes);
    app.use('/api/pdf', pdfRoutes);
    app.use('/api', youtubeRoutes);
    // Register generic proxy route (must come after specific routes if needed, or be distinct)
    const { default: proxyRoutes } = await import('./routes/proxy.js');
    app.use('/api', proxyRoutes);

    console.log('✅ Routes initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing routes:', error);
    throw error;
  }
};

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Serve static files from frontend build
app.use(express.static(path.join(__dirname, '../../dist')));

// Handle React routing, return all requests to React app
// API routes are already handled above, so this only catches non-API requests
app.get('*', (req, res, next) => {
  // If it's an API request that wasn't handled, let it fall through to 404
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server and initialize routes
const startServer = async () => {
  try {
    await initializeRoutes();
    
    app.listen(PORT, () => {
      console.log('🚀 InsightsLM Backend Server');
      console.log(`📡 Server running on http://localhost:${PORT}`);
      console.log(`🔗 CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
      console.log('📊 Available routes:');
      console.log('   - GET  /health');
      console.log('   - POST /api/auth/signup');
      console.log('   - POST /api/auth/signin');
      console.log('   - POST /api/auth/signout');
      console.log('   - POST /api/auth/refresh');
      console.log('   - GET  /api/user/profile');
      console.log('   - PUT  /api/user/profile');
      console.log('   - GET  /api/user/preferences');
      console.log('   - PUT  /api/user/preferences');
      console.log('   - GET  /api/user/stats');
      console.log('   - PUT  /api/user/password');
      console.log('   - GET  /api/user/export');
      console.log('   - DELETE /api/user/account');
      console.log('   - POST /api/pdf/process-pdf');
      console.log('   - GET  /api/proxy');
      console.log('   - GET  /api/youtube-transcript');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});