export type AudioShareOutcome = "shared" | "unsupported" | "cancelled";

type ShareNavigator = Pick<Navigator, "share" | "canShare">;

interface ShareAudioFileOptions {
  url: string;
  fileName: string;
  title: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  navigatorImpl?: ShareNavigator;
}

const audioMimeType = (fileName: string) => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4b" || extension === "m4a") return "audio/mp4";
  if (extension === "wav") return "audio/wav";
  return "application/octet-stream";
};

export async function shareAudioFile({
  url,
  fileName,
  title,
  headers,
  fetchImpl = fetch,
  navigatorImpl = typeof navigator !== "undefined" ? navigator : undefined,
}: ShareAudioFileOptions): Promise<AudioShareOutcome> {
  if (!navigatorImpl?.share) return "unsupported";

  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`Could not prepare audiobook for sharing (HTTP ${response.status})`);
  }

  const blob = await response.blob();
  const file = new File([blob], fileName, {
    type: blob.type || audioMimeType(fileName),
  });
  const shareData: ShareData = {
    title,
    text: `Listen to ${title}`,
    files: [file],
  };

  if (navigatorImpl.canShare && !navigatorImpl.canShare(shareData)) {
    return "unsupported";
  }

  try {
    await navigatorImpl.share(shareData);
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "cancelled";
    }
    if (error instanceof TypeError) return "unsupported";
    throw error;
  }
}
