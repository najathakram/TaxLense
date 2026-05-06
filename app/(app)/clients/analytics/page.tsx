import { redirect } from "next/navigation"

// Firm overview analytics — replaced by /workspace/firm in v2 design.
// Keep this route alive as a redirect so old bookmarks don't 404.
export default function ClientsAnalyticsPage() {
  redirect("/workspace/firm")
}
