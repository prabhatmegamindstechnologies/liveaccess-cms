// Library images, as content refers to them: a site-relative address, like the site's own images. Publish puts the files there.
export const MEDIA_DIR = "images/cms/";

const KEY = "[a-f0-9]{32}\\.webp";
const SRC = new RegExp(`^images/cms/${KEY}$`);

export const isMediaSrc = (src: string) => SRC.test(src);

/** The library files a piece of text refers to, each once. */
export const mediaKeysIn = (text: string) => [...new Set([...text.matchAll(new RegExp(`images/cms/(${KEY})`, "g"))].map((m) => m[1]!))];
