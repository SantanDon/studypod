import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Design System Compliance
 * Verifies that the UI follows anti-vibe-coding principles:
 * - No purple gradients
 * - No sparkle icons
 * - No decorative blur effects
 * - Academic copy (not marketing-speak)
 * - Semantic color tokens
 */

test.describe('Design System Compliance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // Wait for app to load
    await page.waitForLoadState('networkidle');
  });

  test('should not have purple gradient on hero heading', async ({ page }) => {
    // Check that hero heading does NOT have purple gradient
    const heading = page.locator('h1').first();
    const styles = await heading.evaluate((el) => {
      return window.getComputedStyle(el).background;
    });
    
    // Should NOT contain purple gradient
    expect(styles).not.toContain('linear-gradient');
    expect(styles).not.toContain('667eea');
    expect(styles).not.toContain('764ba2');
  });

  test('should use academic tutor names, not marketing-speak', async ({ page }) => {
    // Navigate to chat to see tutor selector
    await page.click('text=Chat');
    await page.waitForLoadState('networkidle');
    
    // Check that tutor names are academic, not marketing
    const tutorButtons = page.locator('[role="button"]').filter({ hasText: /Standard|Questioning|Simplified|Narrative|Concise|Evidence-Based/ });
    
    // Should have at least one academic tutor name
    const count = await tutorButtons.count();
    expect(count).toBeGreaterThan(0);
    
    // Should NOT have marketing-speak tutor names
    const marketingNames = page.locator('text=/Academic Guide|Socratic Guide|Conceptual Simplifier|Narrative Specialist|The Conciser|Deep Researcher/');
    const marketingCount = await marketingNames.count();
    expect(marketingCount).toBe(0);
  });

  test('should not have sparkle icons', async ({ page }) => {
    // Check that sparkle icons are not present
    const sparkleIcons = page.locator('[class*="sparkles"]');
    const count = await sparkleIcons.count();
    expect(count).toBe(0);
  });

  test('should not have decorative blur effects', async ({ page }) => {
    // Check that backdrop-blur is not used
    const blurElements = page.locator('[class*="backdrop-blur"]');
    const count = await blurElements.count();
    expect(count).toBe(0);
  });

  test('should use semantic color tokens, not hardcoded colors', async ({ page }) => {
    // Check that primary button uses semantic color
    const primaryButton = page.locator('button').first();
    const classes = await primaryButton.getAttribute('class');
    
    // Should use semantic tokens like bg-primary, not hardcoded colors
    if (classes?.includes('bg-')) {
      expect(classes).toMatch(/bg-(primary|secondary|muted|background|foreground|destructive)/);
    }
  });

  test('should not have purple icon colors', async ({ page }) => {
    // Navigate to a page with icons
    await page.click('text=Chat');
    await page.waitForLoadState('networkidle');
    
    // Check that icons don't have purple colors
    const purpleIcons = page.locator('[class*="text-purple"], [class*="text-pink"]');
    const count = await purpleIcons.count();
    
    // Should have minimal or no purple/pink icons
    expect(count).toBeLessThan(3);
  });

  test('should have professional, academic copy', async ({ page }) => {
    // Check that copy is academic, not marketing-speak
    const body = await page.textContent('body');
    
    // Should NOT contain marketing phrases
    expect(body).not.toContain('Unlock the power');
    expect(body).not.toContain('Transform your');
    expect(body).not.toContain('Revolutionize');
    expect(body).not.toContain('Empower yourself');
  });

  test('should have proper text contrast (no white text on white)', async ({ page }) => {
    // Check that form inputs have readable text
    const inputs = page.locator('input, select, textarea');
    
    for (let i = 0; i < await inputs.count(); i++) {
      const input = inputs.nth(i);
      const color = await input.evaluate((el) => {
        return window.getComputedStyle(el).color;
      });
      
      // Text color should not be white (rgb(255, 255, 255))
      expect(color).not.toBe('rgb(255, 255, 255)');
    }
  });

  test('should not have glow effects on icons', async ({ page }) => {
    // Check that icons don't have glow/shadow effects
    const icons = page.locator('i[class*="fi"]');
    
    for (let i = 0; i < Math.min(5, await icons.count()); i++) {
      const icon = icons.nth(i);
      const filter = await icon.evaluate((el) => {
        return window.getComputedStyle(el).filter;
      });
      
      // Should not have glow filter
      expect(filter).not.toContain('drop-shadow');
      expect(filter).not.toContain('blur');
    }
  });

  test('should render without errors', async ({ page }) => {
    // Check for console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');
    
    // Should have no critical errors
    const criticalErrors = errors.filter(e => 
      !e.includes('ResizeObserver') && 
      !e.includes('Non-Error promise rejection')
    );
    expect(criticalErrors.length).toBe(0);
  });
});
