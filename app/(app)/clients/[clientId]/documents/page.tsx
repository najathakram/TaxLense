import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import type { DocumentCategory } from "@/app/generated/prisma/client"
import { Section, Card, Btn, Tag } from "@/components/v2/primitives"
import { fmtDate } from "@/components/v2/format"

interface Props {
  params: Promise<{ clientId: string }>
  searchParams: Promise<{ cat?: string }>
}

const CATEGORY_LABELS: Record<string, string> = {
  STATEMENT: "Statements",
  TAX_FORM_RECEIVED: "Tax forms received",
  TAX_FORM_ISSUED: "Tax forms issued",
  ENGAGEMENT_LEGAL: "Engagement & legal",
  IRS_CORRESPONDENCE: "IRS correspondence",
  RECEIPT: "Receipts",
  OTHER: "Other",
}

function isValidCategory(v: string | undefined): v is DocumentCategory {
  return !!v && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, v)
}

export default async function ClientDocumentsPage({ params, searchParams }: Props) {
  const { clientId } = await params
  const { cat } = await searchParams
  await requireAuth()
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const effectiveCpaId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null
  if (!effectiveCpaId) redirect("/dashboard")

  const rel = await prisma.cpaClient.findFirst({
    where: { cpaUserId: effectiveCpaId, clientUserId: clientId },
    include: { client: { select: { id: true, name: true, email: true } } },
  })
  if (!rel) notFound()

  // Always fetch all docs for the per-category counts; filter the visible list separately.
  const allDocuments = await prisma.document.findMany({
    where: { userId: clientId },
    orderBy: { uploadedAt: "desc" },
    include: { uploadedBy: { select: { name: true, email: true } } },
  })
  const activeCategory = isValidCategory(cat) ? cat : null
  const documents = activeCategory
    ? allDocuments.filter((d) => d.category === activeCategory)
    : allDocuments

  const categoryCounts = new Map<string, number>()
  for (const d of allDocuments) categoryCounts.set(d.category, (categoryCounts.get(d.category) ?? 0) + 1)

  return (
    <Section
      sub="DOCUMENTS"
      title={`${documents.length} document${documents.length === 1 ? "" : "s"}${activeCategory ? ` · ${CATEGORY_LABELS[activeCategory]}` : ""} · ${rel.client.name ?? rel.client.email}`}
      right={
        <>
          <Btn icon="↓">Bulk download</Btn>
          <Btn kind="primary" icon="+">Upload</Btn>
        </>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <Link
          href={`/clients/${clientId}/documents`}
          className="tl-pill"
          style={{
            fontSize: 12,
            padding: "6px 14px",
            background: !activeCategory ? "var(--tl-accent)" : "rgba(255,255,255,0.05)",
            color: !activeCategory ? "#0a1428" : "var(--fg-1)",
            fontWeight: !activeCategory ? 700 : 600,
            border: !activeCategory ? "0" : "1px solid var(--hairline)",
            textDecoration: "none",
          }}
        >
          All · {allDocuments.length}
        </Link>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
          const isActive = activeCategory === key
          return (
            <Link
              key={key}
              href={`/clients/${clientId}/documents?cat=${key}`}
              className="tl-pill"
              style={{
                fontSize: 12,
                padding: "6px 14px",
                background: isActive ? "var(--tl-accent)" : "rgba(255,255,255,0.05)",
                color: isActive ? "#0a1428" : "var(--fg-1)",
                fontWeight: isActive ? 700 : 600,
                border: isActive ? "0" : "1px solid var(--hairline)",
                textDecoration: "none",
              }}
            >
              {label} · {categoryCounts.get(key) ?? 0}
            </Link>
          )
        })}
      </div>

      <Card
        pad={20}
        style={{
          marginBottom: 14,
          textAlign: "center",
          border: "2px dashed rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 500 }}>
          Drag PDFs here, or click <strong style={{ color: "var(--tl-accent)" }}>+ Upload</strong>
        </div>
      </Card>

      <Card pad={0}>
        {documents.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
            No documents uploaded yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Title", "Category", "Year", "Tags", "Uploaded", "Size"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: "12px 18px",
                      textAlign: i === 2 || i === 5 ? "right" : "left",
                      fontSize: 10,
                      color: "var(--fg-3)",
                      letterSpacing: 1.2,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      borderBottom: "1px solid var(--hairline)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {documents.map((d, i) => (
                <tr
                  key={d.id}
                  className="row-h"
                  style={{ borderBottom: i < documents.length - 1 ? "1px solid var(--hairline)" : "none" }}
                >
                  <td style={{ padding: "12px 18px" }}>
                    <Link
                      href={`/api/documents/${d.id}/file`}
                      target="_blank"
                      rel="noopener"
                      style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none", color: "inherit" }}
                    >
                      <span
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(122,166,255,0.10)",
                          color: "var(--tl-accent)",
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          fontWeight: 700,
                          border: "1px solid rgba(122,166,255,0.22)",
                          flexShrink: 0,
                        }}
                      >
                        {(d.mimeType?.includes("pdf") ? "PDF" : d.originalFilename.split(".").pop()?.toUpperCase().slice(0, 4)) ??
                          "DOC"}
                      </span>
                      <div>
                        <div style={{ fontWeight: 500 }}>{d.title}</div>
                        {d.linkedTransactionIds.length > 0 && (
                          <div className="mono" style={{ fontSize: 10, color: "var(--tl-accent-2)", marginTop: 2 }}>
                            ↗ linked to {d.linkedTransactionIds.length} txn
                          </div>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td style={{ padding: "12px 18px" }}>
                    <Tag>{CATEGORY_LABELS[d.category] ?? d.category}</Tag>
                  </td>
                  <td className="num" style={{ padding: "12px 18px", textAlign: "right" }}>
                    {d.taxYearId ? <span style={{ color: "var(--fg-2)" }}>·</span> : "—"}
                  </td>
                  <td style={{ padding: "12px 18px" }}>
                    <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {d.tags.map((t) => (
                        <Tag key={t} color="var(--fg-3)">
                          {t}
                        </Tag>
                      ))}
                    </span>
                  </td>
                  <td className="mono" style={{ padding: "12px 18px", color: "var(--fg-3)", fontSize: 11 }}>
                    {d.uploadedBy?.name ?? d.uploadedBy?.email ?? "—"} · {fmtDate(d.uploadedAt)}
                  </td>
                  <td className="mono" style={{ padding: "12px 18px", textAlign: "right", color: "var(--fg-3)", fontSize: 11 }}>
                    {d.sizeBytes ? `${(d.sizeBytes / 1024).toFixed(0)} KB` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Section>
  )
}
