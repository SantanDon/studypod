export function parseTimedCaptionXml(xml: string, options?: {
  requireTiming?: boolean;
  includeTimingSource?: boolean;
}): Array<{ text: string; offset: number; duration: number; timingSource?: 'provider' | 'inferred' }>;
