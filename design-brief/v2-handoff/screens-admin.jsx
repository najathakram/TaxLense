// Admin tier screens
const { useState: useStateA } = React;

function AdminHome({ ctx }) {
  return (
    <div>
      <SectionHeader sub="ADMIN / DASHBOARD" title="Platform overview"
        right={<><Btn>Export CSV</Btn><Btn kind="primary">+ Add CPA</Btn></>} />
      <KPIStrip>
        <KPI label="Active CPAs" value="7" delta="+1" sub="this week" />
        <KPI label="Total clients" value="101" delta="+3" sub="this week" />
        <KPI label="Locked YTD" value="69" sub="across firm" />
        <KPI label="Deductions YTD" value="$2.60M" sub="claimed across firm" />
        <KPI label="Errors (24h)" value="3" deltaPos={false} delta="+2" sub="parse fails" />
      </KPIStrip>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 0 }}>
        <div style={{ borderRight: '1px solid var(--border)' }}>
          <SectionHeader sub="ALERTS" title="Needs attention" />
          {ADMIN_ALERTS.map((a, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '14px 1fr auto',
              gap: 12, padding: '10px 16px',
              borderBottom: '1px solid var(--border)', alignItems: 'baseline',
            }}>
              <span style={{
                color: a.sev === 'warn' ? 'var(--orange)' : a.sev === 'info' ? 'var(--blue)' : 'var(--fg-3)',
                fontFamily: 'var(--mono)',
              }}>{a.sev === 'warn' ? '▲' : a.sev === 'info' ? '●' : '○'}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{a.title}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{a.detail}</div>
              </div>
              <Btn kind="ghost" onClick={() => ctx.go(`admin/${a.target}`)}>open →</Btn>
            </div>
          ))}
        </div>

        <div>
          <SectionHeader sub="ACTIVITY" title="Recent admin events"
            right={<Btn kind="ghost" onClick={() => ctx.go('admin/audit')}>full log →</Btn>} />
          {ADMIN_RECENT.map((e, i) => (
            <div key={i} style={{
              padding: '8px 16px', borderBottom: '1px solid var(--border)',
              display: 'grid', gridTemplateColumns: '90px 130px 140px 1fr',
              gap: 10, fontSize: 11, alignItems: 'center',
            }}>
              <span className="mono" style={{ color: 'var(--fg-3)' }}>{relTime(e.ts)}</span>
              <span>{e.cpa}</span>
              <span className="mono" style={{ color: 'var(--accent-2)' }}>{e.event}</span>
              <span style={{ color: 'var(--fg-2)' }}>{e.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminCpas({ ctx }) {
  const [filter, setFilter] = useStateA('all');
  const filtered = CPAS.filter(c => filter === 'all' ? true : c.status === filter);
  return (
    <div>
      <SectionHeader sub="ADMIN / CPAs" title={`All CPAs (${CPAS.length})`}
        right={
          <>
            <div style={{ display: 'flex', border: '1px solid var(--border-strong)' }}>
              {['all','active','inactive'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '4px 10px', fontSize: 11, fontFamily: 'var(--mono)',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  background: filter === f ? 'var(--bg-3)' : 'transparent',
                  color: filter === f ? 'var(--fg)' : 'var(--fg-2)',
                  borderRight: f !== 'inactive' ? '1px solid var(--border-strong)' : 0,
                }}>{f}</button>
              ))}
            </div>
            <Btn kind="primary">+ Add CPA</Btn>
          </>
        } />
      <Table
        columns={[
          { label: 'CPA', render: r => (
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <Avatar name={r.name} email={r.email} />
              <div>
                <div style={{fontWeight:600}}>{r.name}</div>
                <div style={{fontSize:10, color:'var(--fg-3)', fontFamily:'var(--mono)'}}>{r.email}</div>
              </div>
            </div>
          )},
          { label: 'Firm', key: 'firm', muted: true },
          { label: 'Status', render: r => <StatusPill s={r.status} /> },
          { label: 'Clients', align: 'right', mono: true, render: r => <span className="num">{fmtNum(r.clients)}</span> },
          { label: 'Locked YTD', align: 'right', mono: true, render: r => <span className="num">{fmtNum(r.locked)}</span> },
          { label: 'Deductions YTD', align: 'right', mono: true, render: r => <span className="num">{fmtUSD(r.deductionsYTD)}</span> },
          { label: 'Last login', align: 'right', mono: true, muted: true, render: r => relTime(r.lastLogin) },
          { label: '', w: 220, render: r => (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Btn kind="purple" onClick={(e) => { e.stopPropagation(); ctx.impersonateCpa(r.id); }}>
                Impersonate →
              </Btn>
              <Btn kind="ghost">Edit</Btn>
            </div>
          )},
        ]}
        rows={filtered}
        onRowClick={r => ctx.go(`admin/cpas/${r.id}`)}
      />
    </div>
  );
}

function AdminAudit({ ctx }) {
  return (
    <div>
      <SectionHeader sub="ADMIN / AUDIT" title="Cross-firm audit log"
        right={<><Btn>Filters</Btn><Btn>Export CSV</Btn></>} />
      <div style={{padding:'10px 16px', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--fg-2)', fontFamily:'var(--mono)'}}>
        Filters: <Tag>actor:admin</Tag> <Tag>last 7d</Tag> <Tag color="var(--purple)">+actorAdminUserId</Tag>
      </div>
      <Table
        columns={[
          { label: 'Timestamp', mono: true, w: 150, render: r => fmtDateTime(r.ts) },
          { label: 'CPA', w: 140, render: r => r.cpa },
          { label: 'Event', mono: true, w: 200, render: r => <span style={{color:'var(--accent-2)'}}>{r.event}</span> },
          { label: 'Detail', muted: true, render: r => r.detail },
        ]}
        rows={[...ADMIN_RECENT, ...ADMIN_RECENT.map(e => ({...e, ts: new Date(new Date(e.ts).getTime()-86400000).toISOString()}))]}
      />
    </div>
  );
}

Object.assign(window, { AdminHome, AdminCpas, AdminAudit });
