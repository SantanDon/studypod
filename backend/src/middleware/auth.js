import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { dbHelpers } from '../db/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

export function hashApiKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // API key path — starts with spm_
  if (token.startsWith('spm_')) {
    try {
      const keyHash = hashApiKey(token);
      const keyRow = dbHelpers.getApiKeyByHash(keyHash);
      if (!keyRow) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      dbHelpers.touchApiKey(keyRow.id);
      const user = dbHelpers.getUserById(keyRow.user_id);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      req.user = { userId: user.id, email: user.email };
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'API key validation failed' });
    }
  }

  // JWT path
  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
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
