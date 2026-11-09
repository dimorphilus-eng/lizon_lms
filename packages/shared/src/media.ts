export type VideoEmbed =
  | { kind: "file"; src: string }
  | { kind: "youtube"; src: string }
  | { kind: "vimeo"; src: string };

const YOUTUBE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/;

/** Безопасное встраивание: только YouTube, Vimeo или прямой файл. Чужие iframe-URL отвергаются. */
export function videoEmbed(url: string | null | undefined): VideoEmbed | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const youtube = trimmed.match(YOUTUBE);
  if (youtube) return { kind: "youtube", src: `https://www.youtube-nocookie.com/embed/${youtube[1]}` };
  const vimeo = trimmed.match(VIMEO);
  if (vimeo) return { kind: "vimeo", src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/^https?:\/\//i.test(trimmed) && /\.(mp4|webm|ogg)(\?.*)?$/i.test(trimmed)) {
    return { kind: "file", src: trimmed };
  }
  if (trimmed.startsWith("/backend/api/files/") || trimmed.startsWith("/api/files/")) {
    return { kind: "file", src: trimmed };
  }
  return null;
}
