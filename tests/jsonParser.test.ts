import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeBraces, cleanJsonResponse, parseJsonResponse } from '@/utils/jsonParser';

// Helper: Generate strings that don't contain braces (to avoid false positives in tests)
const safeStringArb = fc.string().filter(s => !s.includes('{') && !s.includes('}'));

describe('JSON Parser - Brace Normalization', () => {
  /**
   * **Feature: quiz-podcast-autosave-fix, Property 1: Brace Normalization Preserves JSON Structure**
   * **Validates: Requirements 1.1, 1.2, 3.2, 3.3**
   * 
   * For any valid JSON object (with string values that don't contain braces),
   * if we double all JSON braces and then normalize, we get back the original object.
   */
  describe('Property 1: Brace Normalization Preserves JSON Structure', () => {
    it('should normalize double braces to single braces for simple objects', () => {
      fc.assert(
        fc.property(
          fc.record({
            key: safeStringArb,
            value: safeStringArb,
            num: fc.integer()
          }),
          (obj) => {
            const originalJson = JSON.stringify(obj);
            
            // Double all braces (simulating LLM output)
            const doubledJson = originalJson
              .replace(/\{/g, '{{')
              .replace(/\}/g, '}}');
            
            // Normalize and parse
            const normalized = normalizeBraces(doubledJson);
            const parsed = JSON.parse(normalized);
            
            // Should produce equivalent object
            expect(parsed).toEqual(obj);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle nested objects with double braces', () => {
      // Test with specific nested structures to verify normalization works
      const testCases = [
        { outer: { inner: { value: "test" } } },
        { a: { b: { c: { d: "deep" } } } },
        { level1: { level2: "value" } },
      ];
      
      for (const nestedObj of testCases) {
        const originalJson = JSON.stringify(nestedObj);
        const doubledJson = originalJson
          .replace(/\{/g, '{{')
          .replace(/\}/g, '}}');
        
        const normalized = normalizeBraces(doubledJson);
        const parsed = JSON.parse(normalized);
        
        expect(parsed).toEqual(nestedObj);
      }
    });

    it('should handle arrays with objects containing double braces', () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({ key: safeStringArb, num: fc.integer() })),
          (arr) => {
            const originalJson = JSON.stringify(arr);
            const doubledJson = originalJson
              .replace(/\{/g, '{{')
              .replace(/\}/g, '}}');
            
            const normalized = normalizeBraces(doubledJson);
            const parsed = JSON.parse(normalized);
            
            expect(parsed).toEqual(arr);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not modify strings without double braces', () => {
      fc.assert(
        fc.property(
          fc.record({ key: safeStringArb, value: fc.integer() }),
          (obj) => {
            const json = JSON.stringify(obj);
            // Single braces should remain unchanged
            const normalized = normalizeBraces(json);
            expect(normalized).toBe(json);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: quiz-podcast-autosave-fix, Property 2: Quiz JSON Round-Trip**
   * **Validates: Requirements 1.3**
   * 
   * For any valid quiz response object (with safe strings), if we serialize it to JSON,
   * double all braces, then pass it through the parser, we SHALL get back an equivalent quiz object.
   */
  describe('Property 2: Quiz JSON Round-Trip', () => {
    // Generator for quiz question objects with safe strings (no braces in content)
    const quizQuestionArb = fc.record({
      question: safeStringArb.filter(s => s.length > 0),
      options: fc.array(safeStringArb.filter(s => s.length > 0), { minLength: 2, maxLength: 4 }),
      correctAnswer: fc.integer({ min: 0, max: 3 }),
      explanation: safeStringArb
    });

    const quizResponseArb = fc.record({
      questions: fc.array(quizQuestionArb, { minLength: 1, maxLength: 5 })
    });

    it('should parse quiz responses with doubled braces', () => {
      fc.assert(
        fc.property(
          quizResponseArb,
          (quizResponse) => {
            const originalJson = JSON.stringify(quizResponse);
            
            // Simulate LLM doubling braces
            const doubledJson = originalJson
              .replace(/\{/g, '{{')
              .replace(/\}/g, '}}');
            
            // Parse through our robust parser
            const parsed = parseJsonResponse<typeof quizResponse>(
              doubledJson,
              (obj): obj is typeof quizResponse => {
                return obj !== null && 
                       typeof obj === 'object' && 
                       'questions' in obj &&
                       Array.isArray((obj as any).questions);
              }
            );
            
            expect(parsed).toEqual(quizResponse);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle quiz responses with markdown code blocks and doubled braces', () => {
      fc.assert(
        fc.property(
          quizResponseArb,
          (quizResponse) => {
            const originalJson = JSON.stringify(quizResponse);
            
            // Simulate LLM output with markdown and doubled braces
            const llmOutput = `Here are the quiz questions:\n\`\`\`json\n${originalJson
              .replace(/\{/g, '{{')
              .replace(/\}/g, '}}')}\n\`\`\``;
            
            const parsed = parseJsonResponse<typeof quizResponse>(
              llmOutput,
              (obj): obj is typeof quizResponse => {
                return obj !== null && 
                       typeof obj === 'object' && 
                       'questions' in obj &&
                       Array.isArray((obj as any).questions);
              }
            );
            
            expect(parsed).toEqual(quizResponse);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle quiz responses with leading prose and doubled braces', () => {
      fc.assert(
        fc.property(
          quizResponseArb,
          safeStringArb.filter(s => s.length >= 10),
          (quizResponse, prose) => {
            const originalJson = JSON.stringify(quizResponse);
            
            // Simulate LLM output with leading prose and doubled braces
            const llmOutput = `${prose}\n${originalJson
              .replace(/\{/g, '{{')
              .replace(/\}/g, '}}')}`;
            
            const parsed = parseJsonResponse<typeof quizResponse>(
              llmOutput,
              (obj): obj is typeof quizResponse => {
                return obj !== null && 
                       typeof obj === 'object' && 
                       'questions' in obj &&
                       Array.isArray((obj as any).questions);
              }
            );
            
            expect(parsed).toEqual(quizResponse);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Unit Tests - normalizeBraces', () => {
    it('should convert {{ to {', () => {
      expect(normalizeBraces('{{')).toBe('{');
    });

    it('should convert }} to }', () => {
      expect(normalizeBraces('}}')).toBe('}');
    });

    it('should handle the exact error case from the bug report', () => {
      const buggyResponse = `I'll create five medium-difficulty multiple-choice questions based on the provided content. Here they are:{{"questions": [{{"question": "What is the primary function?","options": ["A", "B", "C", "D"],"correctAnswer": 1,"explanation": "Test"}}]}}`;
      
      const normalized = normalizeBraces(buggyResponse);
      
      // Should be parseable now
      const jsonStart = normalized.indexOf('{');
      const jsonPart = normalized.substring(jsonStart);
      const parsed = JSON.parse(jsonPart);
      
      expect(parsed.questions).toBeDefined();
      expect(parsed.questions[0].question).toBe('What is the primary function?');
    });

    it('should handle empty string', () => {
      expect(normalizeBraces('')).toBe('');
    });

    it('should handle null/undefined gracefully', () => {
      expect(normalizeBraces(null as any)).toBe(null);
      expect(normalizeBraces(undefined as any)).toBe(undefined);
    });

    it('should handle mixed single and double braces', () => {
      const mixed = '{ "a": {{ "b": 1 }} }';
      const normalized = normalizeBraces(mixed);
      expect(normalized).toBe('{ "a": { "b": 1 } }');
    });
  });

  describe('Unit Tests - cleanJsonResponse', () => {
    it('should clean and normalize doubled braces in one pass', () => {
      const input = '```json\n{{"key": "value"}}\n```';
      const cleaned = cleanJsonResponse(input);
      expect(JSON.parse(cleaned)).toEqual({ key: 'value' });
    });

    it('should handle real-world LLM quiz response with doubled braces', () => {
      const llmResponse = `I'll create five medium-difficulty multiple-choice questions based on the provided content. Here they are:{{"questions": [{{"question": "What is the primary function of the sequestration process in Insolvency Act?","options": ["To protect creditors' interests", "To facilitate business rescue", "To provide a framework for compulsory and voluntary insolvency applications", "To ensure the orderly wind-up of businesses"],"correctAnswer": 1,"explanation": "According to the content, sequestration is a process that protects creditors' interests by seizing an insolvent company's assets and preventing further financial losses."}}]}}`;
      
      const cleaned = cleanJsonResponse(llmResponse);
      const parsed = JSON.parse(cleaned);
      
      expect(parsed.questions).toHaveLength(1);
      expect(parsed.questions[0].correctAnswer).toBe(1);
    });
  });
});
