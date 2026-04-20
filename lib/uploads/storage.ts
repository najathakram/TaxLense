import { mkdir } from "node:fs/promises"
import { join } from "node:path"

// Static fallback keeps Turbopack happy about dynamic process.cwd() usage.
const DEFAULT_UPLOADS_DIR = join(process.cwd(), "data", "uploads")

export function uploadsBaseDir(): string {
  return process.env.UPLOAD_BASE_DIR ?? DEFAULT_UPLOADS_DIR
}

export async function uploadDir(taxYearId: string): Promise<string> {
  const dir = join(uploadsBaseDir(), taxYearId)
  await mkdir(dir, { recursive: true })
  return dir
}
