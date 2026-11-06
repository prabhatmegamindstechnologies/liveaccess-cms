// Library images in the admin. Content stores site addresses (images/cms/…), which only exist on the site after Publish,
// so anything shown here goes through the API's file route instead.
import { MEDIA_DIR, type MediaSrc } from "@liveaccess/shared";
import { API_BASE } from "./api.ts";

export type MediaUse = { kind: "page" | "guide" | "area"; title: string; link: string; live: boolean };
export type MediaItem = {
  id: number; key: string; src: string; fileName: string; altText: string; width: number | null; height: number | null; bytes: number;
  createdAt: string; updatedAt: string; usedIn: MediaUse[];
};
export type MediaPage = { items: MediaItem[]; total: number; page: number; pageSize: number };

const FILES = `${API_BASE}/media/files/`;

/** The picture itself, for thumbnails. The version changes on every replace, so a thumbnail is never stale. */
export const fileUrl = (m: Pick<MediaItem, "key" | "updatedAt">) => `${FILES}${m.key}?v=${Date.parse(m.updatedAt)}`;

export const toAdmin = (html: string) => html.replaceAll(MEDIA_DIR, FILES);
export const fromAdmin = (html: string) => html.replaceAll(FILES, MEDIA_DIR);

// Image blocks hold a number; the preview needs the file. Filled from the editor's data and from each pick.
const known = new Map<number, string>();
export const rememberMedia = (files: Record<string, string>) => Object.entries(files).forEach(([id, key]) => known.set(Number(id), key));
export const mediaSrc: MediaSrc = (id) => (known.has(id) ? `${MEDIA_DIR}${known.get(id)}` : null);

export const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
