const extensionForAudioType = (contentType: string): string => {
  const mimeType = contentType.split(";")[0].trim().toLowerCase();
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(mimeType)) return "wav";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/webm") return "webm";
  if (mimeType === "audio/mp4" || mimeType === "audio/aac") return "m4a";
  return "mp3";
};

export function downloadAudioBlob(blob: Blob, title: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const extension = extensionForAudioType(blob.type);
  const baseTitle = title.replace(/\.(mp3|wav|ogg|webm|m4a)$/i, "");
  link.href = blobUrl;
  link.download = `${baseTitle}.${extension}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Browsers may still be reading the object URL after click() returns.
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
