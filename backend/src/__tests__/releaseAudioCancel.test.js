import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Honest mock labelling: auth is mocked (header-switchable user + scopes, no
// live account/JWT); the cancel path touches no database and never invokes
// TTS/providers/ffmpeg. Storage is a fresh per-file temp root stubbed into
// the route BEFORE its dynamic import, restored afterwards. Worker posted
// messages are covered separately in audiobookWorkerContract.test.js with a
// mocked runFullAudiobookJob.
vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req, _res, next) => {
    const headerUser = String(req.headers?.["x-test-user"] || "").trim();
    req.user = {
      userId: headerUser || "owner-a",
      id: headerUser || "owner-a",
      authMethod: "mock",
    };
    next();
  },
  // Simulated scope gating: granted scopes come from x-test-scopes
  // (default read+write). This verifies the cancel route is wired behind
  // sources:write; full JWT scope semantics live in the real middleware.
  requireScope: (scope) => (req, res, next) => {
    const granted = String(
      req.headers?.["x-test-scopes"] ?? "sources:read sources:write",
    ).split(/\s+/);
    if (!granted.includes(scope)) {
      return res
        .status(403)
        .json({ error: "Forbidden", code: "SCOPE_FORBIDDEN" });
    }
    next();
  },
}));

let tmpRoot;
let JOB_DIR;
let MANIFEST_DIR;
let saveBookManifest;
let loadBookManifest;
let routeModule;
let audiobookRouter;
let server;
let baseUrl;
let seq = 0;

const freshIds = (tag) => {
  seq += 1;
  const stamp = `${Date.now()}_${process.pid}_${seq}`;
  return {
    bookFile: `release-${tag}-${stamp}.epub`,
    renderId: `render_${tag}_${stamp}`.slice(0, 40),
    jobId: `cancel-${tag}-${stamp}`,
  };
};

const seedManifest = ({ fileName, renderId, renderStatus, finalStatus }) => {
  saveBookManifest(MANIFEST_DIR, {
    schemaVersion: 2,
    ownerId: "owner-a",
    fileName,
    title: "Release cancel fixture",
    author: "Fixture",
    format: "epub",
    chapters: [
      {
        id: "ch-1",
        title: "Chapter 1",
        text: "Usable completed chapter audio text fixture one.",
        narrationText: "Usable completed chapter audio text fixture one.",
        order: 1,
        narratable: true,
        contentHash: "ch1",
      },
      {
        id: "ch-2",
        title: "Chapter 2",
        text: "In-flight chapter text fixture two.",
        narrationText: "In-flight chapter text fixture two.",
        order: 2,
        narratable: true,
        contentHash: "ch2",
      },
    ],
    renders: {
      [renderId]: {
        id: renderId,
        status: renderStatus,
        pipelineVersion: "v2",
        provider: "mock",
        requestedVoice: "mock_narrator",
        voice: "mock_narrator",
        requestedStyle: "faithful",
        style: "faithful",
        narrationSignature: "sig",
        contentSignature: "content",
        outputFormat: "mp3",
        chapterIds: ["ch-1", "ch-2"],
        chapters: {
          "ch-1": {
            chapterId: "ch-1",
            title: "Chapter 1",
            order: 1,
            status: "completed",
            voice: "mock_narrator",
            audioFileName: "ch1.wav",
            audioFormat: "wav",
            fileSizeBytes: 100,
            durationSeconds: 5,
            completedAt: new Date(0).toISOString(),
          },
          "ch-2": {
            chapterId: "ch-2",
            title: "Chapter 2",
            order: 2,
            status: renderStatus === "completed" ? "completed" : "processing",
            voice: "mock_narrator",
            startedAt: new Date(0).toISOString(),
          },
        },
        activeJobId: null,
        activeChapterId: null,
        createdAt: new Date(0).toISOString(),
        startedAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        final: {
          status: finalStatus,
          fileName: `release-${renderId}.mp3`,
          format: "mp3",
          fileSizeBytes: finalStatus === "completed" ? 100 : 0,
          durationSeconds: finalStatus === "completed" ? 5 : 0,
        },
      },
    },
    activeRenderId: renderId,
    listenerState: {
      renderId: null,
      currentChapterId: null,
      currentTimeSeconds: 0,
      chapterDurationSeconds: 0,
      playbackRate: 1,
      completedChapterIds: [],
      progressPercent: 0,
      updatedAt: new Date(0).toISOString(),
    },
    bookmarks: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });
};

const setRenderActiveJob = (fileName, renderId, jobId) => {
  const manifest = loadBookManifest(MANIFEST_DIR, fileName);
  manifest.renders[renderId].activeJobId = jobId;
  saveBookManifest(MANIFEST_DIR, manifest);
};

const seedJob = (jobId, job) => {
  fs.writeFileSync(
    path.join(JOB_DIR, `${jobId}.json`),
    JSON.stringify({ jobId, ownerId: "owner-a", ...job }, null, 2),
    "utf8",
  );
};

const seedProcessingFixture = (tag) => {
  const ids = freshIds(tag);
  seedManifest({
    fileName: ids.bookFile,
    renderId: ids.renderId,
    renderStatus: "processing",
    finalStatus: "processing",
  });
  setRenderActiveJob(ids.bookFile, ids.renderId, ids.jobId);
  seedJob(ids.jobId, {
    bookFileName: ids.bookFile,
    renderId: ids.renderId,
    status: "processing",
    phase: "narrating",
    progress: 47,
  });
  return ids;
};

const readJobFile = (jobId) =>
  JSON.parse(fs.readFileSync(path.join(JOB_DIR, `${jobId}.json`), "utf8"));

const markerPathFor = (jobId) =>
  path.join(JOB_DIR, `${jobId}.cancelled.json`);

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-audio-cancel-"));
  vi.stubEnv("AUDIOBOOK_STORAGE_DIR", tmpRoot);
  vi.resetModules();
  const bookService = await import("../services/audiobookBookService.js");
  saveBookManifest = bookService.saveBookManifest;
  loadBookManifest = bookService.loadBookManifest;
  routeModule = await import("../routes/audiobook.js");
  audiobookRouter = routeModule.default;
  JOB_DIR = path.join(tmpRoot, "audiobook_jobs");
  MANIFEST_DIR = path.join(tmpRoot, "audiobook_manifests");

  const app = express();
  app.use(express.json());
  app.use("/api/audiobook", audiobookRouter);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  vi.unstubAllEnvs();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("release audiobook cancellation lifecycle", () => {
  it("returns 404 for a missing job without revealing state", async () => {
    const response = await fetch(
      `${baseUrl}/api/audiobook/job-status/no-such-job-xyz/cancel`,
      { method: "POST" },
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 for another owner's job and leaves it untouched", async () => {
    const ids = seedProcessingFixture("foreign");
    const before = readJobFile(ids.jobId);
    const response = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
      { method: "POST", headers: { "x-test-user": "owner-b" } },
    );
    expect(response.status).toBe(404);
    expect(readJobFile(ids.jobId)).toEqual(before);
    expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(false);
  });

  it("enforces sources:write gating on the cancel route", async () => {
    const ids = seedProcessingFixture("scope");
    const response = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
      { method: "POST", headers: { "x-test-scopes": "sources:read" } },
    );
    expect(response.status).toBe(403);
    expect(readJobFile(ids.jobId).status).toBe("processing");
    expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(false);
  });

  it("refuses a completed job, keeps it completed, writes no marker", async () => {
    const ids = freshIds("done");
    seedManifest({
      fileName: ids.bookFile,
      renderId: ids.renderId,
      renderStatus: "completed",
      finalStatus: "completed",
    });
    setRenderActiveJob(ids.bookFile, ids.renderId, ids.jobId);
    seedJob(ids.jobId, {
      bookFileName: ids.bookFile,
      renderId: ids.renderId,
      status: "completed",
      phase: "completed",
      progress: 100,
      fileName: `release-${ids.renderId}.mp3`,
    });
    const response = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
      { method: "POST" },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUDIOBOOK_JOB_ALREADY_COMPLETED",
    });
    expect(readJobFile(ids.jobId).status).toBe("completed");
    expect(
      loadBookManifest(MANIFEST_DIR, ids.bookFile).renders[ids.renderId].status,
    ).toBe("completed");
    expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(false);
  });

  it("cancels durably: tombstone first, fenced render, no leaks", async () => {
    const ids = seedProcessingFixture("cancel");
    const response = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("cancelled");
    expect(payload.cancelled).toBe(true);
    expect(payload.cancelling).toBe(false);
    expect(payload).not.toHaveProperty("ownerId");
    expect(payload).not.toHaveProperty("url");

    const marker = JSON.parse(
      fs.readFileSync(markerPathFor(ids.jobId), "utf8"),
    );
    expect(marker).toMatchObject({
      jobId: ids.jobId,
      ownerId: "owner-a",
    });

    const persisted = readJobFile(ids.jobId);
    expect(persisted.status).toBe("cancelled");
    expect(typeof persisted.cancelledAt).toBe("string");

    const render = loadBookManifest(MANIFEST_DIR, ids.bookFile).renders[
      ids.renderId
    ];
    expect(render.status).toBe("cancelled");
    expect(render.activeChapterId).toBeNull();
    expect(render.chapters["ch-1"].status).toBe("completed");
    expect(render.chapters["ch-1"].audioFileName).toBe("ch1.wav");
    expect(render.chapters["ch-2"].status).toBe("cancelled");
    expect(render.final.status).not.toBe("completed");
  });

  it("cancel twice is idempotent within one explicit sequence", async () => {
    const ids = seedProcessingFixture("twice");
    const first = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
      { method: "POST" },
    );
    expect(first.status).toBe(200);
    const second = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
      { method: "POST" },
    );
    expect(second.status).toBe(200);
    const payload = await second.json();
    expect(payload.status).toBe("cancelled");
    expect(payload.alreadyCancelled).toBe(true);

    const status = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}`,
    );
    expect(status.status).toBe(200);
    const job = await status.json();
    expect(job.status).toBe("cancelled");
    expect(job).not.toHaveProperty("url");
  });

  it("returns 503 with no success when the marker cannot persist", async () => {
    const ids = seedProcessingFixture("markerfail");
    // Fault injection on the fs layer: only the cancel-marker write fails.
    // (A directory at the marker path is NOT used: the fail-closed read
    // overlay would treat it as a present marker before the writer runs.)
    const origWrite = fs.writeFileSync;
    const spy = vi
      .spyOn(fs, "writeFileSync")
      .mockImplementation((target, ...rest) => {
        if (String(target).includes(".cancelled.json")) {
          throw new Error("injected marker IO failure");
        }
        return origWrite(target, ...rest);
      });
    try {
      const response = await fetch(
        `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
        { method: "POST" },
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "AUDIOBOOK_CANCEL_NOT_DURABLE",
      });
      expect(readJobFile(ids.jobId).status).toBe("processing");
      expect(
        loadBookManifest(MANIFEST_DIR, ids.bookFile).renders[ids.renderId]
          .status,
      ).toBe("processing");
      expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a job without context rather than claiming an unserialized cancellation", async () => {
    const ids = freshIds('orphan');
    seedJob(ids.jobId, { status: 'processing', phase: 'preparing' });
    const response = await fetch(`${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('AUDIOBOOK_JOB_CONTEXT_MISSING');
    expect(readJobFile(ids.jobId).status).toBe('processing');
    expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(false);
  });

  it("stale completed writes cannot resurrect a cancelled job or its downloads", async () => {
    const ids = seedProcessingFixture("stale");
    const cancel = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
      { method: "POST" },
    );
    expect(cancel.status).toBe(200);

    // Simulate a late worker overwriting the job JSON with completion + URL.
    seedJob(ids.jobId, {
      bookFileName: ids.bookFile,
      renderId: ids.renderId,
      status: "completed",
      phase: "completed",
      progress: 100,
      url: `/api/audiobook/render-download?file=${ids.bookFile}&renderId=${ids.renderId}`,
      legacyDownloadUrl: `/api/audiobook/download/${ids.jobId}/evil.mp3`,
      fileName: "evil.mp3",
    });

    const status = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}`,
    );
    expect(status.status).toBe(200);
    const job = await status.json();
    expect(job.status).toBe("cancelled");
    expect(job).not.toHaveProperty("url");
    expect(job).not.toHaveProperty("legacyDownloadUrl");

    const download = await fetch(
      `${baseUrl}/api/audiobook/download/${ids.jobId}/evil.mp3`,
    );
    expect(download.status).toBe(404);

    const renderDownload = await fetch(
      `${baseUrl}/api/audiobook/render-download?file=${encodeURIComponent(ids.bookFile)}&renderId=${encodeURIComponent(ids.renderId)}`,
    );
    expect(renderDownload.status).toBe(404);
  });

  it("restarts from the durable marker rather than memory", async () => {
    const ids = seedProcessingFixture("restart");
    const cancel = await fetch(
      `${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`,
      { method: "POST" },
    );
    expect(cancel.status).toBe(200);
    fs.unlinkSync(path.join(JOB_DIR, `${ids.jobId}.json`));

    vi.resetModules();
    const freshRoute = await import("../routes/audiobook.js");
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use("/api/audiobook", freshRoute.default);
    const freshServer = await new Promise((resolve) => {
      const s = freshApp.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const address = freshServer.address();
      const freshBase = `http://127.0.0.1:${address.port}`;
      const response = await fetch(
        `${freshBase}/api/audiobook/job-status/${ids.jobId}`,
      );
      expect(response.status).toBe(200);
      const job = await response.json();
      expect(job.status).toBe("cancelled");
      expect(job).not.toHaveProperty("ownerId");

      const foreign = await fetch(
        `${freshBase}/api/audiobook/job-status/${ids.jobId}`,
        { headers: { "x-test-user": "owner-b" } },
      );
      expect(foreign.status).toBe(404);
    } finally {
      await new Promise((resolve, reject) => {
        freshServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("aborts a completion-style manifest write filed after the tombstone", async () => {
    const ids = seedProcessingFixture("inlock");
    const written = routeModule.writeAudiobookCancelMarker(
      ids.jobId,
      "owner-a",
      { renderId: ids.renderId, bookFileName: ids.bookFile },
    );
    expect(written.ok).toBe(true);

    await expect(
      routeModule.mutateOwnedManifestForJob({
        fileName: ids.bookFile,
        ownerId: "owner-a",
        jobId: ids.jobId,
        renderId: ids.renderId,
        checkOwnership: true,
        mutate: (current) => ({ ...current, updatedAt: "evil" }),
      }),
    ).rejects.toMatchObject({ code: "AUDIOBOOK_JOB_CANCELLED" });
    const render = loadBookManifest(MANIFEST_DIR, ids.bookFile).renders[
      ids.renderId
    ];
    expect(render.status).toBe("processing");
    expect(render.activeJobId).toBe(ids.jobId);
  });

  it("rejects an older execution publishing into a retried render", async () => {
    const ids = seedProcessingFixture("supersede");
    await expect(
      routeModule.mutateOwnedManifestForJob({
        fileName: ids.bookFile,
        ownerId: "owner-a",
        jobId: "full_older-execution",
        renderId: ids.renderId,
        checkOwnership: true,
        mutate: (current) => ({ ...current }),
      }),
    ).rejects.toMatchObject({ code: "AUDIOBOOK_RENDER_SUPERSEDED" });
  });

  it("blocks a retry while the previous execution is still alive", () => {
    expect(
      routeModule.selectAudiobookRetryBlock({
        renderActiveJobId: "full_old",
        isWorkerActive: true,
      }),
    ).toBe("AUDIOBOOK_PREVIOUS_EXECUTION_ACTIVE");
    expect(
      routeModule.selectAudiobookRetryBlock({
        renderActiveJobId: "full_old",
        isWorkerActive: false,
      }),
    ).toBeNull();
    expect(
      routeModule.selectAudiobookRetryBlock({
        renderActiveJobId: null,
        isWorkerActive: false,
      }),
    ).toBeNull();
  });

  it("round-trips the cancel marker with job/owner association", () => {
    const ids = freshIds("marker");
    expect(routeModule.readAudiobookCancelMarker(ids.jobId)).toEqual({
      present: false,
    });
    const written = routeModule.writeAudiobookCancelMarker(
      ids.jobId,
      "owner-a",
      { renderId: "render_x", bookFileName: "book.epub" },
    );
    expect(written.ok).toBe(true);
    const read = routeModule.readAudiobookCancelMarker(ids.jobId);
    expect(read.present).toBe(true);
    expect(read.marker).toMatchObject({
      jobId: ids.jobId,
      ownerId: "owner-a",
      renderId: "render_x",
      bookFileName: "book.epub",
    });
    expect(routeModule.isCancelledAudiobookJob({ status: "cancelled" })).toBe(
      true,
    );
    expect(routeModule.isCancelledAudiobookJob({ status: "processing" })).toBe(
      false,
    );
  });
  it('does not resurrect an old cancelled job when a later execution completes the same render', async () => {
    const ids = seedProcessingFixture('retry-complete');
    expect((await fetch(`${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`, { method: 'POST' })).status).toBe(200);
    const next = loadBookManifest(MANIFEST_DIR, ids.bookFile);
    next.renders[ids.renderId].status = 'completed';
    next.renders[ids.renderId].activeJobId = 'new-execution';
    next.renders[ids.renderId].final.status = 'completed';
    saveBookManifest(MANIFEST_DIR, next);
    seedJob(ids.jobId, { bookFileName: ids.bookFile, renderId: ids.renderId, status: 'completed', fileName: 'old.mp3', url: '/old.mp3' });
    const response = await fetch(`${baseUrl}/api/audiobook/job-status/${ids.jobId}`);
    const payload = await response.json();
    expect(payload.status).toBe('cancelled');
    expect(payload.url).toBeUndefined();
    expect((await fetch(`${baseUrl}/api/audiobook/download/${ids.jobId}/old.mp3`)).status).toBe(404);
    expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(true);
  });

  it('serializes a cancellation behind an in-flight completion without creating a losing marker', async () => {
    const ids = seedProcessingFixture('completion-wins');
    let entered;
    const hasLock = new Promise(resolve => { entered = resolve; });
    let release;
    const readyToFinish = new Promise(resolve => { release = resolve; });
    const completion = routeModule.mutateOwnedManifestForJob({
      fileName: ids.bookFile, ownerId: 'owner-a', jobId: ids.jobId, renderId: ids.renderId,
      mutate: async current => {
        entered();
        await readyToFinish;
        current.renders[ids.renderId].status = 'completed';
        current.renders[ids.renderId].final.status = 'completed';
        return current;
      },
    });
    await hasLock;
    const cancelling = fetch(`${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`, { method: 'POST' });
    try {
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(false);
    } finally { release(); }
    await completion;
    const response = await cancelling;
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('AUDIOBOOK_JOB_ALREADY_COMPLETED');
    expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(false);
    expect(loadBookManifest(MANIFEST_DIR, ids.bookFile).renders[ids.renderId].status).toBe('completed');
  });

  it('cleans a partially written cancellation marker and reports storage failure', async () => {
    const ids = seedProcessingFixture('partial-marker');
    const originalWrite = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((target, ...rest) => {
      if (String(target).includes('.cancelled.json')) {
        originalWrite(target, '{partial', 'utf8');
        throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
      }
      return originalWrite(target, ...rest);
    });
    try {
      const response = await fetch(`${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`, { method: 'POST' });
      expect(response.status).toBe(503);
      expect(readJobFile(ids.jobId).status).toBe('processing');
      expect(fs.existsSync(markerPathFor(ids.jobId))).toBe(false);
      expect(fs.readdirSync(JOB_DIR).filter(name => name.startsWith(ids.jobId) && name.endsWith('.tmp'))).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('checks execution identity for ordinary progress, not only final publication', async () => {
    const ids = seedProcessingFixture('progress-identity');
    await expect(routeModule.mutateOwnedManifestForJob({
      fileName: ids.bookFile, ownerId: 'owner-a', jobId: 'stale-execution', renderId: ids.renderId,
      mutate: current => { current.renders[ids.renderId].status = 'processing'; return current; },
    })).rejects.toMatchObject({ code: 'AUDIOBOOK_RENDER_SUPERSEDED' });
    expect(loadBookManifest(MANIFEST_DIR, ids.bookFile).renders[ids.renderId].activeJobId).toBe(ids.jobId);
  });

  it('keeps a newer active render selected while cancelling an older render', async () => {
    const ids = seedProcessingFixture('active-selection');
    const current = loadBookManifest(MANIFEST_DIR, ids.bookFile);
    const otherRenderId = 'newer-render';
    current.renders[otherRenderId] = { ...current.renders[ids.renderId], id: otherRenderId, activeJobId: 'newer-job' };
    current.activeRenderId = otherRenderId;
    saveBookManifest(MANIFEST_DIR, current);
    expect((await fetch(`${baseUrl}/api/audiobook/job-status/${ids.jobId}/cancel`, { method: 'POST' })).status).toBe(200);
    expect(loadBookManifest(MANIFEST_DIR, ids.bookFile).activeRenderId).toBe(otherRenderId);
  });

});
