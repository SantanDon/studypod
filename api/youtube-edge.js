/**
 * Authenticated YouTube recovery on Vercel's Edge Runtime.
 * YouTube may still restrict datacenter requests or have no captions available.
 */

export const config = { runtime: 'edge' };

const YOUTUBE_INNERTUBE_API_KEY = process.env.YOUTUBE_INNERTUBE_API_KEY || '';

const ALLOWED_ORIGINS = [
  'https://studypod-lm.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/').replace(/\n/g, ' ').trim();
}

function parseJson3Captions(jsonText) {
  const result = [];
  let data;
  try { data = JSON.parse(jsonText); } catch { return result; }
  const events = Array.isArray(data?.events) ? data.events : [];
  for (const event of events) {
    if (!Array.isArray(event?.segs) || event.segs.length === 0) continue;
    const text = decodeHtmlEntities(
      event.segs.map(s => typeof s?.utf8 === 'string' ? s.utf8 : '').join('').replace(/\n/g, ' ')
    ).trim();
    if (text.length > 0) {
      result.push({ text, offset: event.tStartMs || 0, duration: event.dDurationMs || 3000 });
    }
  }
  return result;
}

function parseXmlCaptions(xmlText) {
  const result = [];
  if (!xmlText) return result;
  
  // Try <text> tags first (srv1/srv2/srv3 formats)
  let textRegex = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = textRegex.exec(xmlText)) !== null) {
    const attrs = match[1];
    const content = match[2];
    const text = decodeHtmlEntities(
      content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    ).trim();
    const startMatch = attrs.match(/start="([\d.]+)"/);
    const durMatch = attrs.match(/dur="([\d.]+)"/);
    if (text.length > 0 && startMatch) {
      result.push({
        text,
        offset: parseFloat(startMatch[1]) * 1000,
        duration: durMatch ? parseFloat(durMatch[1]) * 1000 : 3000,
      });
    }
  }
  
  if (result.length > 0) return result;

  // Try <p> tags next (timed text/srv3 formats used by Android client)
  const pRegex = /<p\s+([^>]*?)>([\s\S]*?)<\/p>/gi;
  while ((match = pRegex.exec(xmlText)) !== null) {
    const attrs = match[1];
    const content = match[2];
    const text = decodeHtmlEntities(
      content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    ).trim();
    const tMatch = attrs.match(/\bt="([\d.]+)"/);
    const dMatch = attrs.match(/\bd="([\d.]+)"/);
    if (text.length > 0 && tMatch) {
      result.push({
        text,
        offset: parseFloat(tMatch[1]),
        duration: dMatch ? parseFloat(dMatch[1]) : 3000,
      });
    }
  }

  return result;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

function captionTracks(data) {
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks.filter(track => track && typeof track.baseUrl === 'string') : [];
}

async function recoverCaptions(data, language, userAgent, watchUrl) {
  const rank = track => {
    const code = typeof track.languageCode === 'string' ? track.languageCode.toLowerCase() : '';
    return code === language ? 0 : code.split('-')[0] === language.split('-')[0] ? 1 : 2;
  };
  const tracks = [...captionTracks(data)].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  const deadline = Date.now() + 6000;
  for (const track of tracks) {
    let base;
    try {
      base = new URL(track.baseUrl, 'https://www.youtube.com');
      if (base.protocol !== 'https:' || !/(^|\.)youtube\.com$/i.test(base.hostname)) continue;
    } catch { continue; }
    const variants = ['json3', 'srv3', null].map(format => {
      const target = new URL(base);
      if (format) target.searchParams.set('fmt', format);
      else target.searchParams.delete('fmt');
      return target.href;
    });
    for (const target of new Set(variants)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { transcript: [], language: null };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(1800, remaining));
      try {
        const response = await fetch(target, {
          headers: { 'User-Agent': userAgent, 'Referer': watchUrl }, signal: controller.signal,
        });
        if (!response.ok) continue;
        const body = await response.text();
        // The service can return XML even when JSON was requested (and vice versa).
        const transcript = parseJson3Captions(body);
        const parsed = transcript.length ? transcript : parseXmlCaptions(body);
        if (parsed.length) return { transcript: parsed, language: track.languageCode || null };
      } catch {
        // A blocked format or malformed response must not stop the next attempt.
      } finally { clearTimeout(timer); }
    }
  }
  return { transcript: [], language: null };
}

// ── JWT verification helpers for Edge runtime (no npm deps) ───────────────────
function base64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const textEncoder = new TextEncoder();
function stringToBytes(str) {
  return textEncoder.encode(str);
}

async function verifyJwt(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    
    const [headerB64, payloadB64, signatureB64] = parts;
    const msgBytes = stringToBytes(headerB64 + '.' + payloadB64);
    const signatureBytes = base64urlToBytes(signatureB64);
    
    const secretBytes = stringToBytes(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      msgBytes
    );
    
    if (!isValid) return false;
    
    const payloadBytes = base64urlToBytes(payloadB64);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (payload.exp && Date.now() / 1000 >= payload.exp) {
      return false;
    }
    
    return payload;
  } catch (err) {
    return false;
  }
}

export default async function handler(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // ── Authentication check for Edge Route ──────────────────────────────────
  const authHeader = request.headers.get('authorization');
  let token = authHeader && authHeader.split(' ')[1];
  const sentinels = new Set(['COOKIE_SESSION', 'SESSION_MANAGED_BY_COOKIE', 'managed_by_cookie']);
  if (sentinels.has(token)) {
    token = null;
  }
  
  if (!token && request.headers.get('cookie')) {
    const cookies = request.headers.get('cookie').split(';').reduce((acc, c) => {
      const parts = c.split('=');
      if (parts[0]) acc[parts[0].trim()] = (parts[1] || '').trim();
      return acc;
    }, {});
    token = cookies.accessToken;
  }

  const secret = process.env.JWT_SECRET;
  let userPayload = null;
  if (token && secret) {
    userPayload = await verifyJwt(token, secret);
  }

  if (!userPayload) {
    return new Response(JSON.stringify({ error: 'Access token required or invalid for Edge extraction' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const videoId = url.searchParams.get('videoId');
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return new Response(JSON.stringify({ error: 'Invalid videoId' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const requestedLanguage = url.searchParams.get('language') || 'en';
  const language = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(requestedLanguage)
    ? requestedLanguage.toLowerCase() : 'en';

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const apiKey = YOUTUBE_INNERTUBE_API_KEY;

  try {
    // ── Step 1: Session Warmup ─────────────────────────────────────────────────
    // Fetch YouTube homepage first to get fresh VISITOR_INFO1_LIVE + YSC cookies
    // and visitorData. This mimics a real browser navigating to YouTube before
    // requesting a video. Warmup is best-effort and does not guarantee access.
    let warmCookies = process.env.YOUTUBE_COOKIE || 'CONSENT=YES+cb.20231102-09-0;';
    let visitorData = '';

    try {
      const homeRes = await fetchWithTimeout('https://www.youtube.com/', {
        headers: {
          'User-Agent': desktopUA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1',
        }
      }, 6000);

      if (homeRes.ok) {
        // Extract cookies from the homepage response
        const setCookies = homeRes.headers.getSetCookie ? homeRes.headers.getSetCookie() : [];
        const cookiePairs = (Array.isArray(setCookies) ? setCookies : [setCookies])
          .filter(Boolean).map(c => c.split(';')[0]);
        if (cookiePairs.length > 0) {
          const base = process.env.YOUTUBE_COOKIE || 'CONSENT=YES+cb.20231102-09-0';
          warmCookies = base + '; ' + cookiePairs.join('; ');
        }
        // Extract visitorData from the page HTML
        const homeHtml = await homeRes.text();
        const vdMatch = homeHtml.match(/"visitorData":"([^"]+)"/);
        if (vdMatch) visitorData = vdMatch[1];
      }
    } catch (_) {
      // Warmup failed — continue without it (cold request)
    }

    // ── Step 2: InnerTube Player Request (with warm session) ───────────────────
    const browserHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': desktopUA,
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': '2.20240415.01.00',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://www.youtube.com',
      'Referer': watchUrl,
      'Cookie': warmCookies,
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'same-origin',
      'Sec-Fetch-Site': 'same-origin',
    };

    const clientCtx = {
      clientName: 'WEB',
      clientVersion: '2.20240415.01.00',
      hl: language,
      gl: 'US',
      timeZone: 'America/New_York',
      utcOffsetMinutes: -240,
      browserName: 'Chrome',
      browserVersion: '124.0.0.0',
      osName: 'Windows',
      osVersion: '10.0',
      ...(visitorData ? { visitorData } : {}),
    };

    const playerBody = JSON.stringify({
      context: { client: clientCtx },
      videoId,
    });

    let playerData = {};
    try {
      const playerRes = await fetchWithTimeout(
        `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
        { method: 'POST', headers: browserHeaders, body: playerBody }
      );
      if (playerRes.ok) playerData = await playerRes.json();
    } catch {
      // A failed WEB request must still allow the independent Android attempt.
    }
    let videoDetails = playerData?.videoDetails || {};
    let playabilityStatus = playerData?.playabilityStatus || {};
    let extractedBy = 'edge_web_client';
    let activeUA = desktopUA;

    const isWebUnplayable = playabilityStatus.status === 'UNPLAYABLE';
    const isWebRestricted = playabilityStatus.status === 'LOGIN_REQUIRED';
    let recovered = !isWebUnplayable && !isWebRestricted
      ? await recoverCaptions(playerData, language, activeUA, watchUrl)
      : { transcript: [], language: null };

    // ── Fallback: Android client if WEB is hollow, blocked, unplayable, or has no captions ───────────────────
    if (!videoDetails?.title || isWebRestricted || isWebUnplayable || recovered.transcript.length === 0) {
      try {
        const androidUA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)';
        const androidBody = JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
              hl: language,
              gl: 'US'
            }
          },
          videoId
        });

        const androidRes = await fetchWithTimeout(
          `https://www.youtube.com/youtubei/v1/player?prettyPrint=false`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': androidUA
            },
            body: androidBody
          },
          6000
        );

        if (androidRes.ok) {
          const androidData = await androidRes.json();
          const androidDetails = androidData?.videoDetails || {};
          const androidPlayabilityStatus = androidData?.playabilityStatus || {};

          const androidUsable = !['UNPLAYABLE', 'LOGIN_REQUIRED', 'ERROR'].includes(androidPlayabilityStatus.status);
          if (androidUsable) {
            const androidRecovered = await recoverCaptions(androidData, language, androidUA, watchUrl);
            // Retain useful WEB metadata when an alternate client returns less detail.
            videoDetails = {
              ...androidDetails, ...videoDetails,
              title: videoDetails.title || androidDetails.title,
              author: videoDetails.author || androidDetails.author,
              shortDescription: videoDetails.shortDescription || androidDetails.shortDescription,
            };
            if (androidRecovered.transcript.length || !recovered.transcript.length && androidDetails?.title) {
              playabilityStatus = androidPlayabilityStatus;
              if (androidRecovered.transcript.length) {
                recovered = androidRecovered;
                extractedBy = 'edge_android_client';
              }
            }
          }
        }
      } catch (androidErr) {
        // Fallback failed, continue to standard check/error response
      }
    }

    // ── Step 3: Check playability and return appropriate error if still failing
    if (!videoDetails?.title) {
      return new Response(JSON.stringify({
        error: 'YouTube requires authentication for this video. Set YOUTUBE_COOKIE in Vercel env vars.',
        playabilityStatus: playabilityStatus.status,
        reason: playabilityStatus.reason,
      }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (playabilityStatus.status === 'LOGIN_REQUIRED') {
      return new Response(JSON.stringify({
        error: `Video requires sign-in: ${playabilityStatus.reason}`,
        hint: 'Set YOUTUBE_COOKIE in Vercel env vars with your YouTube session cookies to enable extraction.',
      }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (playabilityStatus.status === 'UNPLAYABLE') {
      return new Response(JSON.stringify({
        error: `Video is unplayable: ${playabilityStatus.reason}`,
      }), { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const transcript = recovered.transcript;

    const responseBody = JSON.stringify({
      videoId,
      title: videoDetails.title,
      author: videoDetails.author || 'Unknown Channel',
      description: videoDetails.shortDescription || '',
      keywords: videoDetails.keywords || [],
      transcript,
      captionCount: transcript.length,
      language: recovered.language || language,
      transcriptStatus: transcript.length ? 'complete' : 'metadata_only',
      extractedBy,
    });

    return new Response(responseBody, {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
