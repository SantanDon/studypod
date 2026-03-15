# Maxun Integration Guide for StudyPodLM

## What is Maxun?

Maxun is an open-source no-code platform for web scraping, data extraction, and creating structured APIs from websites.

## Why Use Maxun with StudyPodLM?

Maxun excels at:
- Research website extraction (articles, papers, docs)
- Documentation processing
- News aggregation
- Academic sources

## NOT for YouTube

YouTube blocks scrapers aggressively. Use the enhanced `youtube-transcript.js` API instead.

## Quick Setup

```bash
npm install @maxun/sdk
```

## Environment Variables

```bash
VITE_MAXUN_API_KEY=your_key
VITE_MAXUN_BASE_URL=https://app.maxun.dev
```

## Basic Usage

```typescript
import { MaxunClient } from '@maxun/sdk';

const client = new MaxunClient({
  apiKey: process.env.VITE_MAXUN_API_KEY,
  baseURL: process.env.VITE_MAXUN_BASE_URL,
});

// Extract article
const result = await client.robots.scrape({
  url: 'https://example.com/article',
  format: 'markdown',
});
```

See full documentation at https://docs.maxun.dev
