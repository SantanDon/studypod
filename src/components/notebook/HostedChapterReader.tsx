import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { podcastApi, type PodcastRecord } from "@/services/podcastApiService";
import type { Source } from "@/hooks/useSources";
import type { TTSWorkerManager } from "@/lib/tts/ttsWorker";
import StudyGlyph from "./StudyGlyph";

// Keep each inference short enough to run in a typical browser. Never omit a word.
function narrationParts(content: string): string[] {
  const words = content.match(/\S+/gu) || [];
  const parts: string[] = [];
  let part = "";
  for (const word of words) {
    if (part && part.length + word.length + 1 > 650) {
      parts.push(part);
      part = "";
    }
    part += (part ? " " : "") + word;
  }
  if (part) parts.push(part);
  return parts;
}

function storedPosition(key: string) {
  try {
    const seconds = Number(localStorage.getItem(key));
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  } catch { return 0; }
}
function rememberPosition(key: string, seconds: number) {
  try { localStorage.setItem(key, String(seconds)); } catch { /* Playback also works without device storage. */ }
}

interface Props { notebookId: string; sources: Source[]; token?: string }
export default function HostedChapterReader({ notebookId, sources, token }: Props) {
  const api = useMemo(() => podcastApi(notebookId, token), [notebookId, token]);
  const readable = useMemo(() => sources.filter(s => s.content?.trim() && s.notebook_id === notebookId), [notebookId, sources]);
  const [sourceId, setSourceId] = useState("");
  const source = readable.find(s => s.id === sourceId) || readable[0];
  const [index, setIndex] = useState(0);
  const parts = useMemo(() => narrationParts(source?.content || ""), [source?.content]);
  const partNumber = Math.min(index, Math.max(0, parts.length - 1));
  const passage = parts[partNumber];
  const selectionKey = "studypod:chapter-part:" + notebookId + ":" + (source?.id || "");
  useEffect(() => { setIndex(Math.floor(storedPosition(selectionKey))); }, [selectionKey]);
  function choosePart(next: number) {
    setIndex(next);
    rememberPosition(selectionKey, next);
    setPlayer(undefined);
    setStatus("");
  }
  const [records, setRecords] = useState<PodcastRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [downloadAmount, setDownloadAmount] = useState("");
  const [player, setPlayer] = useState<{ id: string; url: string }>();
  const alive = useRef(false);
  const locked = useRef(false);
  const worker = useRef<TTSWorkerManager | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  function releaseVoice() {
    clearTimeout(idleTimer.current);
    worker.current?.terminate();
    worker.current = null;
  }
  const stableIds = useRef(new Map<string, string>());
  const title = source ? source.title.slice(0, 240) + (parts.length > 1 ? " · Part " + (partNumber + 1) : "") : "";
  const saved = records.find(row => row.source_ids.includes(source?.id || "") && row.title === title && row.script.segments[0]?.text === passage);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; releaseVoice(); };
  }, []);
  useEffect(() => {
    let current = true;
    setLoaded(false);
    api.list("audiobook-chapter").then(rows => {
      if (current) { setRecords(rows); setLoaded(true); setStatus(""); }
    }).catch(() => { if (current) setStatus("Your saved chapters could not be loaded."); });
    return () => { current = false; };
  }, [api, attempt]);
  useEffect(() => () => { if (player) URL.revokeObjectURL(player.url); }, [player]);

  async function listen() {
    if (!source || !passage || !loaded || locked.current) return;
    clearTimeout(idleTimer.current);
    locked.current = true;
    setBusy(true);
    setPlayer(undefined);
    try {
      let record = saved;
      if (!record) {
        setStatus("Preparing the narration voice. The first download can take a few minutes.");
        const { TTSWorkerManager } = await import("@/lib/tts/ttsWorker");
        if (!alive.current) return;
        const voice = worker.current ?? new TTSWorkerManager();
        worker.current = voice;
        await voice.initialize(message => {
          const amount = message.match(/\b([\d.]+) MB received\b/);
          if (alive.current && amount && Number(amount[1]) > 0) setDownloadAmount(amount[0]);
        });
        if (!alive.current) return;
        setDownloadAmount("");
        setStatus("Reading this passage aloud…");
        const speech = await voice.synthesize(passage, "af_heart", 1);
        URL.revokeObjectURL(speech.audioUrl);
        if (!alive.current) return;
        setStatus("Saving this chapter to your notebook…");
        const key = JSON.stringify([source.id, title, passage]);
        const id = stableIds.current.get(key) || crypto.randomUUID();
        stableIds.current.set(key, id);
        record = await api.save({
          id, title, blob: speech.audioBlob, sourceIds: [source.id],
          script: { title, recordingKind: "audiobook-chapter", segments: [{ speaker: "Narrator", text: passage }] },
        });
        if (!alive.current) return;
        setRecords(rows => [record!, ...rows.filter(row => row.id !== record!.id)]);
      }
      setStatus("Opening the saved recording…");
      const blob = await api.audio(record.id);
      if (alive.current) {
        setPlayer({ id: record.id, url: URL.createObjectURL(blob) });
        setStatus("Ready to play. Your recording is saved in this notebook.");
      }
    } catch (error) {
      releaseVoice();
      if (alive.current) setStatus(error instanceof Error ? error.message : "The recording could not be opened. Try again.");
    } finally {
      if (alive.current && worker.current) idleTimer.current = setTimeout(releaseVoice, 120_000);
      locked.current = false;
      if (alive.current) { setDownloadAmount(""); setBusy(false); }
    }
  }

  return <Card className="space-y-4 p-5 sm:p-6" data-testid="hosted-chapter-reader">
    <div className="flex items-start gap-3"><StudyGlyph kind="audiobook" className="h-12 w-12 shrink-0" />
      <div className="min-w-0"><h3 className="studio-audio-title">Narrate a notebook source</h3>
        <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">Turn the original words into a saved audiobook, one short part at a time. Keep this tab open while each part records.</p></div>
    </div>
    {source ? <>
      <label className="block text-sm font-medium">Source
        <select className="mt-1 block min-h-11 w-full rounded-md border bg-background px-3" disabled={busy} value={source.id} onChange={e => {setSourceId(e.target.value); setIndex(0); setPlayer(undefined); setStatus("");}}>
          {readable.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </label>
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={busy || partNumber === 0} onClick={() => choosePart(partNumber - 1)}>Previous</Button>
        <span className="text-sm">Part {partNumber + 1} of {parts.length}</span>
        <Button variant="outline" disabled={busy || partNumber + 1 >= parts.length} onClick={() => choosePart(partNumber + 1)}>Next</Button>
      </div>
      <blockquote className="rounded-lg border-l-4 border-primary bg-muted/40 p-3 text-sm leading-6 break-words">{passage}</blockquote>
      {(!player || player.id !== saved?.id) && <Button disabled={busy || !loaded} onClick={listen}>{busy ? "Working…" : saved ? "Open saved recording" : "Generate chapter audio"}</Button>}
      {player && player.id === saved?.id && <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3"><audio className="min-w-0 basis-48 flex-1" aria-label={title} controls src={player.url}
        onLoadedMetadata={e => { const time = storedPosition("studypod:chapter-time:" + player.id); if (time < e.currentTarget.duration) e.currentTarget.currentTime = time; }}
        onPause={e => rememberPosition("studypod:chapter-time:" + player.id, e.currentTarget.currentTime)}
        onSeeked={e => rememberPosition("studypod:chapter-time:" + player.id, e.currentTarget.currentTime)}
        onEnded={() => rememberPosition("studypod:chapter-time:" + player.id, 0)}
      /><a className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold underline underline-offset-4 hover:bg-muted" href={player.url} download={title + ".wav"}>Download chapter audio</a></div>}
    </> : <p className="text-sm">Add a text source to this notebook to start a recording.</p>}
    <div className="space-y-1 text-sm text-muted-foreground">
      <p role="status">{status}</p>
      {downloadAmount && <p className="font-medium tabular-nums text-foreground">{downloadAmount}</p>}
    </div>
    {!loaded && status && <Button variant="outline" onClick={() => setAttempt(n => n + 1)}>Retry saved chapters</Button>}
  </Card>;
}
