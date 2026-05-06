import { Section, Card } from "@/components/v2/primitives"

export default function CalendarPage() {
  return (
    <Section sub="WORKSPACE · CALENDAR" title="Deadlines & milestones">
      <Card pad={48} style={{ textAlign: "center", color: "var(--fg-3)" }}>
        <div style={{ fontSize: 14 }}>Calendar view — coming in V2</div>
        <div style={{ fontSize: 11, marginTop: 8 }}>
          Full IRS deadlines + per-client milestones will populate here.
        </div>
      </Card>
    </Section>
  )
}
