// Where uploaded files live. Routes and Publish only know this interface, so a Vercel Blob or S3 driver can replace the local one.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type MediaStorage = {
  put(key: string, data: Buffer): Promise<void>;
  /** Null if there's no such file. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
};

export const validKey = (key: string) => /^[a-f0-9]{32}\.webp$/.test(key);

/** For hosts with no lasting disk (Vercel) until a Blob driver exists: nothing is stored, so nothing is found. */
export function disabledDriver(): MediaStorage {
  return {
    put: async () => { throw new Error("Media storage is not configured on this server."); },
    get: async () => null,
    remove: async () => {}
  };
}

export function localDriver(root: string): MediaStorage {
  const path = (key: string) => {
    if (!validKey(key)) throw new Error("Invalid media key.");
    return join(root, key);
  };
  return {
    async put(key, data) {
      const file = path(key);
      await mkdir(root, { recursive: true });
      // Written aside and moved in, so a replace can't leave half a file on the site.
      const part = `${file}.${randomBytes(4).toString("hex")}.part`;
      await writeFile(part, data);
      await rename(part, file).catch(async (e) => {
        await rm(part, { force: true });
        throw e;
      });
    },
    get: (key) => readFile(path(key)).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    }),
    remove: (key) => rm(path(key), { force: true })
  };
}
