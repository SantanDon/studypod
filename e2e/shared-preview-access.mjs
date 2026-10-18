// The access link and its cookies stay in process/BrowserContext memory only.
export function validateSharedPreviewLink(value, origin) {
  try {
    const target = new URL(origin);
    const link = new URL(value);
    if (target.protocol !== 'https:' || target.origin !== origin || link.origin !== origin || link.username || link.password || link.hash) throw 0;
    return link.href;
  } catch {
    throw new Error('Preview access link rejected');
  }
}

export async function bootstrapSharedPreview(context, origin, value = process.env.STUDYPOD_PREVIEW_ACCESS_LINK) {
  if (!value) return { enabled: false };
  let current = validateSharedPreviewLink(value, origin);
  try {
    // APIRequestContext bypasses browser routes: enforce GET and origin here.
    // At most five redirects; no automatic redirects or persisted storageState.
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await context.request.get(current, { maxRedirects: 0, timeout: 15000, failOnStatusCode: false });
      let status;
      let location;
      try {
        status = response.status();
        if ([301, 302, 303, 307, 308].includes(status)) location = response.headers().location;
      } finally {
        await response.dispose();
      }
      if (status >= 200 && status < 300) return { enabled: true };
      if (!location || redirects === 5) throw 0;
      current = validateSharedPreviewLink(new URL(location, current).href, origin);
    }
  } catch {
    throw new Error('Preview access bootstrap failed');
  }
  throw new Error('Preview access bootstrap failed');
}
