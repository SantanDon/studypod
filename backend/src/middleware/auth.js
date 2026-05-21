import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbHelpers, getDatabase, schema } from '../db/database.js';
import { eq, asc } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.warn('JWT_SECRET is not set. Token verification will fail.');
}

export function hashApiKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

export async function authenticateToken(req, res, next) {
   const authHeader = req.headers['authorization'];
   let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
   
   // If token is a cookie-sentinel, treat it as no token so the cookie fallback executes
   const SENTINELS = ['COOKIE_SESSION', 'SESSION_MANAGED_BY_COOKIE', 'managed_by_cookie'];
   if (SENTINELS.includes(token)) {
     token = null;
   }
   
   // Cookie fallback for Web App
   if (!token && req.cookies && req.cookies.accessToken) {
     token = req.cookies.accessToken;
   }
 
   // Authentication mandatory for all requests

   if (!token) {
     return res.status(401).json({ error: 'Access token required' });
   }

  // API key path — starts with spm_
  if (token.startsWith('spm_')) {
    try {
      const keyHash = hashApiKey(token);
      const keyRow = await dbHelpers.getApiKeyByHash(keyHash);
      if (!keyRow) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      if (keyRow.expiresAt && new Date(keyRow.expiresAt) < new Date()) {
        return res.status(401).json({ error: 'API key has expired' });
      }

      await dbHelpers.touchApiKey(keyRow.id);
      const user = await dbHelpers.getUserById(keyRow.userId);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      let scopes = [];
      try { scopes = JSON.parse(keyRow.scopes || '[]'); } catch {}

      let restrictedNotebooks = null;
      if (keyRow.notebookIds) {
        try { restrictedNotebooks = JSON.parse(keyRow.notebookIds); } catch {}
      }

      req.user = {
        userId: user.id,
        email: user.email,
        apiKeyId: keyRow.id,
        scopes,
        restrictedNotebooks,
        rateLimit: keyRow.rateLimit || 0,
        authMethod: 'api_key'
      };
      req.keyRow = keyRow;
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'API key validation failed' });
    }
  }

  // JWT path
  try {
    const user = jwt.verify(token, JWT_SECRET);
    
    // VERCEL WORKAROUND: If user exists in JWT but not in DB (DB reset)
    // We auto-provision a shell record so Foreign Keys don't break across isolated endpoints
    const userId = user.userId || user.id;
    if (userId) {
      const existing = await dbHelpers.getUserById(userId);
      if (!existing) {
        logger.warn(`Auto-provisioning missing user ${userId} after DB reset...`);
        try {
          const fallbackEmail = user.email || `recovered_${userId.substring(0, 8)}@studypod.local`;
          await dbHelpers.createUser(userId, fallbackEmail, 'AUTOPROVISIONED_SESSION_RECOVERY', user.displayName || 'Recovered User', user.accountType || 'human');
        } catch (provisionError) {
          logger.error('Failed to auto-provision user:', provisionError);
        }
      }
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.debug(`Token expired for token starting with: ${token ? token.substring(0, 10) : 'none'}`);
      return res.status(401).json({ error: 'Token expired' });
    }
    logger.warn(`Invalid token: ${error.name} - ${error.message}`);
    return res.status(403).json({ error: 'Invalid token' });
  }
}

export function generateToken(userId, email) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
}

export function generateRefreshToken(userId, email) {
  return jwt.sign({ userId, email, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');
    return decoded;
  } catch {
    throw new Error('Invalid refresh token');
  }
}

export function requireScope(requiredScope) {
  return (req, res, next) => {
    if (!req.user || !req.user.scopes) {
      return next();
    }
    if (req.user.authMethod !== 'api_key') {
      return next();
    }
    if (req.user.scopes.includes('admin:keys') || req.user.scopes.includes('admin:all')) {
      return next();
    }
    if (!req.user.scopes.includes(requiredScope)) {
      return res.status(403).json({
        error: `API key lacks required scope: ${requiredScope}`,
        keyScopes: req.user.scopes
      });
    }

    if (req.user.restrictedNotebooks && req.params.id) {
      if (!req.user.restrictedNotebooks.includes(req.params.id)) {
        return res.status(403).json({
          error: 'API key is not authorized for this notebook',
          allowedNotebooks: req.user.restrictedNotebooks
        });
      }
    }

    next();
  };
}
