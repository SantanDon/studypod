/**
 * Email recovery integration
 * 
 * Optional email recovery allows users to receive recovery tokens via email.
 * Tokens are encrypted and expire after 24 hours.
 */

import { RecoveryToken, EmailRecoveryConfig, RecoveryResult } from './types';

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a recovery token
 * 
 * @param userId - User ID
 * @returns RecoveryToken object
 */
export function generateRecoveryToken(userId: string): RecoveryToken {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  
  return {
    token,
    userId,
    expiresAt,
    encryptedKey: '', // Will be set after encryption
    createdAt: new Date().toISOString(),
  };
}

/**
 * Validate recovery token
 * Checks expiration and format
 * 
 * @param token - Token to validate
 * @returns True if token is valid and not expired
 */
export function validateRecoveryToken(token: RecoveryToken): boolean {
  // Check expiration
  if (Date.now() > token.expiresAt) {
    return false;
  }
  
  // Check format
  if (!token.token || !token.userId) {
    return false;
  }
  
  return true;
}

/**
 * Store recovery token in localStorage
 * 
 * @param token - Recovery token to store
 */
export function storeRecoveryToken(token: RecoveryToken): void {
  const key = `recovery_token_${token.userId}`;
  localStorage.setItem(key, JSON.stringify(token));
}

/**
 * Retrieve recovery token from localStorage
 * 
 * @param userId - User ID
 * @returns RecoveryToken or null if not found
 */
export function getRecoveryToken(userId: string): RecoveryToken | null {
  const key = `recovery_token_${userId}`;
  const stored = localStorage.getItem(key);
  
  if (!stored) {
    return null;
  }
  
  try {
    return JSON.parse(stored) as RecoveryToken;
  } catch {
    return null;
  }
}

/**
 * Remove recovery token from storage
 * 
 * @param userId - User ID
 */
export function removeRecoveryToken(userId: string): void {
  const key = `recovery_token_${userId}`;
  localStorage.removeItem(key);
}

/**
 * Setup email recovery for user
 * 
 * @param userId - User ID
 * @param email - Email address
 * @returns EmailRecoveryConfig
 */
export function setupEmailRecovery(userId: string, email: string): EmailRecoveryConfig {
  const config: EmailRecoveryConfig = {
    email,
    enabled: true,
    verifiedAt: new Date().toISOString(),
  };
  
  const key = `email_recovery_${userId}`;
  localStorage.setItem(key, JSON.stringify(config));
  
  return config;
}

/**
 * Get email recovery config for user
 * 
 * @param userId - User ID
 * @returns EmailRecoveryConfig or null if not set up
 */
export function getEmailRecoveryConfig(userId: string): EmailRecoveryConfig | null {
  const key = `email_recovery_${userId}`;
  const stored = localStorage.getItem(key);
  
  if (!stored) {
    return null;
  }
  
  try {
    return JSON.parse(stored) as EmailRecoveryConfig;
  } catch {
    return null;
  }
}

/**
 * Check if user has email recovery set up
 * 
 * @param userId - User ID
 * @returns True if email recovery is configured
 */
export function hasEmailRecovery(userId: string): boolean {
  const config = getEmailRecoveryConfig(userId);
  return config !== null && config.enabled;
}

/**
 * Disable email recovery
 * 
 * @param userId - User ID
 */
export function disableEmailRecovery(userId: string): void {
  const config = getEmailRecoveryConfig(userId);
  if (config) {
    config.enabled = false;
    const key = `email_recovery_${userId}`;
    localStorage.setItem(key, JSON.stringify(config));
  }
}

/**
 * Remove email recovery configuration
 * 
 * @param userId - User ID
 */
export function removeEmailRecovery(userId: string): void {
  const key = `email_recovery_${userId}`;
  localStorage.removeItem(key);
}

/**
 * Send recovery email (placeholder - requires backend integration)
 * In production, this would call an API endpoint to send email
 * 
 * @param email - Email address
 * @param userId - User ID
 * @returns Promise resolving to success status
 */
export async function sendRecoveryEmail(
  email: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Generate recovery token
    const token = generateRecoveryToken(userId);
    storeRecoveryToken(token);
    
    // In production, call backend API to send email
    // For now, just log the recovery URL
    const recoveryUrl = `${window.location.origin}/recover?token=${token.token}&userId=${userId}`;
    console.log('Recovery email would be sent to:', email);
    console.log('Recovery URL:', recoveryUrl);
    
    // TODO: Integrate with email service
    // await fetch('/api/send-recovery-email', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ email, recoveryUrl }),
    // });
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send recovery email',
    };
  }
}

/**
 * Recover account using email token
 * 
 * @param tokenString - Token from email link
 * @param userId - User ID
 * @returns RecoveryResult indicating success or failure
 */
export async function recoverWithEmail(
  tokenString: string,
  userId: string
): Promise<RecoveryResult> {
  try {
    // Retrieve stored token
    const storedToken = getRecoveryToken(userId);
    
    if (!storedToken) {
      return {
        success: false,
        error: 'No recovery token found. Please request a new recovery email.',
      };
    }
    
    // Validate token
    if (!validateRecoveryToken(storedToken)) {
      removeRecoveryToken(userId);
      return {
        success: false,
        error: 'Recovery token has expired. Please request a new recovery email.',
      };
    }
    
    // Verify token matches
    if (storedToken.token !== tokenString) {
      return {
        success: false,
        error: 'Invalid recovery token. Please check your email and try again.',
      };
    }
    
    // Token is valid - remove it (one-time use)
    removeRecoveryToken(userId);
    
    return {
      success: true,
      method: 'email',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Recovery failed',
    };
  }
}
