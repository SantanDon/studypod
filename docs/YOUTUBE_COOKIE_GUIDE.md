# YouTube Cookie Injection Guide

This guide explains how to extract, configure, and maintain the `YOUTUBE_COOKIE` environment variable for StudyPodLM. This serves as the permanent administrative fallback when YouTube's bot-detection challenges block serverless edge functions.

---

## Why is this needed?

YouTube employs aggressive bot-detection algorithms on datacenter IP addresses (like Vercel serverless / Cloudflare Edge runtimes). When a server makes direct requests to the YouTube player API:
1. YouTube may respond with a `503 Service Unavailable` or `401 Unauthorized` status.
2. The response payload may contain playability errors such as `LOGIN_REQUIRED` or `Sign in to confirm you're not a bot`.
3. Auto-generated captions or high-restriction videos may be completely hidden behind these challenges.

While StudyPodLM implements a multi-client fallback sequence (falling back from the `WEB` player with signature timestamps to the `ANDROID` player, and then to scraping/libraries), providing a valid browser session cookie via `YOUTUBE_COOKIE` is the most resilient way to bypass these blocks permanently.

---

## How to Extract Your YouTube Cookies

To authenticate requests to the InnerTube API, you need to copy the `Cookie` header from a valid browser session on YouTube.

### Step 1: Open Chrome DevTools
1. Open a new Incognito or standard browser window and navigate to [YouTube](https://www.youtube.com).
2. Log in with a standard YouTube account (preferably a burner or non-primary account to keep it isolated).
3. Right-click anywhere on the page and select **Inspect** (or press `F12` / `Ctrl+Shift+I` / `Cmd+Opt+I`) to open Developer Tools.

### Step 2: Capture a Player API Request
1. Click on the **Network** tab in DevTools.
2. In the filter box at the top left of the Network tab, type `youtubei/v1/player` or just `player`.
3. Open or refresh any video page on YouTube (e.g., `https://www.youtube.com/watch?v=TM9YBftRn1w`).
4. You should see a network request named `player?key=...`.

### Step 3: Copy the Cookie Header
1. Click on the `player` request in the list.
2. In the headers detail panel, scroll down to the **Request Headers** section.
3. Locate the `Cookie:` header.
4. Right-click on the value of the `Cookie` header and choose **Copy value** (or copy the entire string manually).

> [!WARNING]
> Do not copy the `Set-Cookie` header from the response headers. You need the **Request Headers** `Cookie` value, which starts with parameters like `VISITOR_INFO1_LIVE=...; YSC=...;`.

---

## Configuring the Environment Variable

Once you have the cookie string, you need to add it to your deployment environments.

### Vercel Deployment (Production)

1. Go to your [Vercel Dashboard](https://vercel.com).
2. Select your StudyPodLM project.
3. Navigate to **Settings** → **Environment Variables**.
4. Add a new variable:
   - **Key:** `YOUTUBE_COOKIE`
   - **Value:** *[Paste the copied cookie string]*
   - **Environment:** Select `Production`, `Preview`, and `Development` as needed.
5. Click **Save**.
6. **Important:** Redeploy your project or trigger a new build for the changes to take effect in the edge functions.

### Local Development

1. Open your `.env` file in the root of the project.
2. Add the following line:
   ```env
   YOUTUBE_COOKIE="your_copied_cookie_string_here"
   ```
3. Restart your local development server (`npm run dev`).

---

## Troubleshooting & Maintenance

- **Cookie Expiration:** YouTube session cookies eventually expire or get revoked if the corresponding browser session is logged out. If you notice transcript failures return with `LOGIN_REQUIRED` messages in the logs, repeat the extraction process and update the environment variable.
- **Burner Accounts:** We highly recommend using a secondary/burner Google account to extract cookies. If Google detects unusual request volume from datacenter IPs, it might trigger verification checks on that account.
- **Consent Prepend:** If you do not configure a custom cookie, the edge runtime defaults to `CONSENT=YES+cb.20231102-09-0;` which only bypasses cookie consent walls, not bot-detection checkpoints.
