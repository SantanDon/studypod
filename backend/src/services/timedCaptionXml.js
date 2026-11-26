import { DOMParser } from '@xmldom/xmldom';

function readTime(element, attribute) {
  const value = element.getAttribute(attribute);
  if (!value || !value.trim()) return null;
  const time = Number(value);
  return Number.isFinite(time) && time >= 0 ? time : null;
}

// The result is transcript text. Keep literal punctuation and decode XML entities once.
export function parseTimedCaptionXml(xml, { requireTiming = false, includeTimingSource = false } = {}) {
  if (typeof xml !== 'string' || !xml.trimStart().startsWith('<') ||
      xml.length > 8 * 1024 * 1024 || /<!DOCTYPE\b/i.test(xml)) return [];

  let document;
  try {
    const rejectMalformed = () => { throw new Error('Invalid caption XML'); };
    document = new DOMParser({
      errorHandler: { warning: rejectMalformed, error: rejectMalformed, fatalError: rejectMalformed },
    }).parseFromString(xml, 'application/xml');
  } catch {
    return [];
  }

  for (const tag of ['text', 'p']) {
    const segments = [];
    const elements = document.getElementsByTagName(tag);
    const seconds = tag === 'text';
    const scale = seconds ? 1000 : 1;
    for (let i = 0; i < elements.length; i++) {
      const element = elements.item(i);
      const text = element.textContent.replace(/\n/g, ' ').trim();
      const start = readTime(element, seconds ? 'start' : 't');
      if (!text || (requireTiming && start === null)) continue;
      const duration = readTime(element, seconds ? 'dur' : 'd');
      segments.push({
        text,
        offset: start === null ? segments.length * 3000 : start * scale,
        duration: duration === null ? 3000 : duration * scale,
        ...(includeTimingSource ? { timingSource: start === null ? 'inferred' : 'provider' } : {}),
      });
    }
    if (segments.length) return segments;
  }
  return [];
}
