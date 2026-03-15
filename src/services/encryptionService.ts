/**
 * Encryption Service
 * Provides client-side encryption using AES-GCM with PBKDF2 key derivation
 * All encryption happens in the browser - keys are never sent to servers
 */

export interface EncryptedData {
  iv: number[];
  salt: number[];
  data: number[];
  version: number;
}

export interface EncryptionKey {
  key: CryptoKey;
  salt: Uint8Array;
}

class EncryptionService {
  private readonly VERSION = 1;
  private readonly KEY_ALGORITHM = 'AES-GCM';
  private readonly KEY_LENGTH = 256;
  private readonly ITERATIONS = 100000;
  private readonly SALT_LENGTH = 16;
  private readonly IV_LENGTH = 12;

  /**
   * Derive an encryption key from a password using PBKDF2
   */
  async deriveKey(password: string, salt?: Uint8Array): Promise<EncryptionKey> {
    const saltToUse = salt || this.generateSalt();
    
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    // Derive the actual encryption key using PBKDF2
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltToUse,
        iterations: this.ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      {
        name: this.KEY_ALGORITHM,
        length: this.KEY_LENGTH,
      },
      false,
      ['encrypt', 'decrypt']
    );
    
    return { key, salt: saltToUse };
  }

  /**
   * Generate a random salt
   */
  generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
  }

  /**
   * Generate a random initialization vector
   */
  generateIV(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
  }

  /**
   * Encrypt data using AES-GCM
   */
  async encrypt(data: string, password: string): Promise<EncryptedData> {
    const { key, salt } = await this.deriveKey(password);
    const iv = this.generateIV();
    
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: this.KEY_ALGORITHM,
        iv,
      },
      key,
      dataBuffer
    );
    
    return {
      iv: Array.from(iv),
      salt: Array.from(salt),
      data: Array.from(new Uint8Array(encryptedBuffer)),
      version: this.VERSION,
    };
  }

  /**
   * Decrypt data using AES-GCM
   */
  async decrypt(encryptedData: EncryptedData, password: string): Promise<string> {
    try {
      const salt = new Uint8Array(encryptedData.salt);
      const iv = new Uint8Array(encryptedData.iv);
      const data = new Uint8Array(encryptedData.data);
      
      const { key } = await this.deriveKey(password, salt);
      
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: this.KEY_ALGORITHM,
          iv,
        },
        key,
        data
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data. Wrong password or corrupted data.');
    }
  }

  /**
   * Securely hash a password using PBKDF2
   * Returns a string in format: iterations:salt:hash
   */
  async hashPassword(password: string): Promise<string> {
    const salt = this.generateSalt();
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );
    
    const hash = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: this.ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    
    const hashArray = Array.from(new Uint8Array(hash));
    const saltArray = Array.from(salt);
    
    return `${this.ITERATIONS}:${saltArray.join(',')}:${hashArray.join(',')}`;
  }

  /**
   * Verify a password against a stored hash
   */
  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    try {
      const parts = storedHash.split(':');
      if (parts.length !== 3) return false;
      
      const iterations = parseInt(parts[0], 10);
      const salt = new Uint8Array(parts[1].split(',').map(Number));
      
      const encoder = new TextEncoder();
      const passwordBuffer = encoder.encode(password);
      
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveBits']
      );
      
      const hash = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt,
          iterations,
          hash: 'SHA-256',
        },
        keyMaterial,
        256
      );
      
      const hashArray = Array.from(new Uint8Array(hash));
      const storedHashArray = parts[2].split(',').map(Number);
      
      // Constant-time comparison
      if (hashArray.length !== storedHashArray.length) return false;
      
      let result = 0;
      for (let i = 0; i < hashArray.length; i++) {
        result |= hashArray[i] ^ storedHashArray[i];
      }
      
      return result === 0;
    } catch (error) {
      console.error('Password verification failed:', error);
      return false;
    }
  }

  /**
   * Check if the browser supports the required crypto APIs
   */
  isSupported(): boolean {
    return !!(
      window.crypto &&
      window.crypto.subtle &&
      window.crypto.getRandomValues
    );
  }
}

export const encryptionService = new EncryptionService();
