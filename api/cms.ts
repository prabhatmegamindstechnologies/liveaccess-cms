// Vercel Function for the CMS API. vercel.json rewrites /<ADMIN_PATH>/api/* here; the app itself is in cms/api.
import { vercelHandler } from "../cms/api/vercel.ts";

export const GET = vercelHandler;
export const HEAD = vercelHandler;
export const POST = vercelHandler;
export const PUT = vercelHandler;
export const PATCH = vercelHandler;
export const DELETE = vercelHandler;
export const OPTIONS = vercelHandler;
