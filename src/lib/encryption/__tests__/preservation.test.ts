import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt, deriveMasterKey, generateSalt } from '../index';

describe('Preservation Property Tests', () => {
  let masterKey: CryptoKey;
  let testSalt: Uint8Array;

  beforeEach(async () => {
    testSalt = generateSalt();
    masterKey = await deriveMasterKey('testpassword123', testSalt);
  });

  it('should preserve strings exactly after encryption and decryption', async () => {
    const originalString = 'Hello, this is a highly confidential string!';
    const encrypted = await encrypt(originalString, masterKey);
    const decrypted = await decrypt(encrypted, masterKey);
    
    expect(decrypted).toBe(originalString);
  });

  it('should preserve flat JSON objects exactly after encryption and decryption', async () => {
    const originalObject = {
      title: 'Secret Notebook',
      description: 'Contains classified algorithms',
      tags: ['top-secret', 'science']
    };
    
    const originalString = JSON.stringify(originalObject);
    const encrypted = await encrypt(originalString, masterKey);
    const decryptedString = await decrypt(encrypted, masterKey);
    const decryptedObject = JSON.parse(decryptedString);
    
    expect(decryptedObject).toEqual(originalObject);
  });

  it('should preserve deeply nested objects after encryption and decryption', async () => {
    const deepObject = {
      level1: {
        level2: {
          level3: {
            value: 42,
            text: 'Deeply hidden secret',
            isValid: true,
            createdAt: new Date('2025-01-01T00:00:00Z').toISOString()
          }
        }
      }
    };
    
    const originalString = JSON.stringify(deepObject);
    const encrypted = await encrypt(originalString, masterKey);
    const decryptedString = await decrypt(encrypted, masterKey);
    const decryptedObject = JSON.parse(decryptedString);
    
    expect(decryptedObject).toEqual(deepObject);
  });

  it('should preserve arrays exactly after encryption and decryption', async () => {
    const originalArray = [1, 'two', { three: 3 }, [4, 5, 6]];
    
    const originalString = JSON.stringify(originalArray);
    const encrypted = await encrypt(originalString, masterKey);
    const decryptedString = await decrypt(encrypted, masterKey);
    const decryptedObject = JSON.parse(decryptedString);
    
    expect(decryptedObject).toEqual(originalArray);
  });
  
  it('should preserve empty strings exactly after encryption and decryption', async () => {
    const emptyString = '';
    const encrypted = await encrypt(emptyString, masterKey);
    const decrypted = await decrypt(encrypted, masterKey);
    
    expect(decrypted).toBe('');
  });
  
  it('should fail decryption gracefully or visibly if key is incorrect', async () => {
    const originalString = 'Sensitive data';
    const encrypted = await encrypt(originalString, masterKey);
    
    const wrongKey = await deriveMasterKey('wrongpassword!', testSalt);
    
    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
  });
});
