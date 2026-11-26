const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function isAllowedBrowserOrigin(origin, allowedOrigins, development) {
  if (allowedOrigins.includes(origin)) return true;
  if (!development) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function protectBrowserWrites(allowedOrigins, development) {
  return (req, res, next) => {
    if (readMethods.has(req.method)) return next();
    const usesSession = req.cookies?.accessToken || req.cookies?.refreshToken;
    const changesSession = /^\/api\/auth\/(?:signup|signin|signout|refresh|mfa\/verify|reset-passphrase)\/?$/i.test(req.path);
    if (!usesSession && !changesSession) return next();

    const reject = () => res.status(403).json({ error: "Request origin could not be verified." });
    const origin = req.get("origin");
    const referer = req.get("referer");
    const site = req.get("sec-fetch-site");
    if (origin || referer) {
      try {
        const url = new URL(origin || referer);
        if (origin && url.origin !== origin) return reject();
        const sameOrigin = url.origin === `${req.protocol}://${req.get("host")}`;
        return sameOrigin || isAllowedBrowserOrigin(url.origin, allowedOrigins, development)
          ? next() : reject();
      } catch {
        return reject();
      }
    }
    if (site) return site === "same-origin" ? next() : reject();
    // Non-browser session clients can use JSON or explicitly identify an XHR.
    // Browsers must preflight either before sending it across origins.
    return req.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json" || req.get("x-requested-with") === "XMLHttpRequest"
      ? next() : reject();
  };
}
