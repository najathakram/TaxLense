// CPA tier screens (workspace, clients matrix, client home)
const { useState: useStateC, useMemo: useMemoC } = React;

function Workspace({ ctx }) {
  const grouped = {
    BLOCKER: INBOX.filter(i => i.sev === 'BLOCKER'),
    PENDING: INBOX.filter(i => i.sev === 'PENDING'),
    READY: INBOX.filter(i => i.sev === 'READY'),
    DEADLINE: INBOX.filter(i => i.sev === 'DEADLINE'),
  };

  const handleClick = (item) => {
    ctx.setClient(item.client);
    ctx.setYear(item.year);
    ctx.go(`clients/${item.client}/years/${item.year}/${item.target}`);
  };

  return (
    <div>
      <SectionHeader sub="WORKSPACE / TRIAGE" title="Inbox"
        right={
          <span style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--fg-2)'}}>
            {INBOX.length} items · across {new Set(INBOX.map(i => i.client)).size} clients
          </span>
        } />

      {Object.entries(grouped).map(([sev, items]) => items.length > 0 && (
        <div key={sev}>
          <div style={{
            padding: '6px 16px', background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <StatusPill s={sev} />
            <span style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)'}}>{items.length}</span>
          </div>
          {items.map((it, i) => {
            const cli = CLIENTS_NAJATH.find(c => c.id === it.client);
            return (
              <button key={i} onClick={() => handleClick(it)} style={{
                width: '100%', display: 'grid',
                gridTemplateColumns: '180px 60px 1fr 80px',
                gap: 14, padding: '8px 16px',
                borderBottom: '1px solid var(--border)',
                background: 'transparent', textAlign: 'left',
                alignItems: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{display:'flex', alignItems:'center', gap:8, minWidth:0}}>
                  <Avatar name={cli.name} email={cli.email} size={20} />
                  <span style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{cli.name}</span>
                </div>
                <span className="num" style={{color:'var(--fg-2)', fontSize:11}}>{it.year}</span>
                <span style={{color:'var(--fg-1)', fontSize:12}}>{it.msg}</span>
                <span className="mono" style={{color:'var(--fg-3)', fontSize:10, textAlign:'right'}}>{it.age}</span>
              </button>
            );
          })}
        </div>
      ))}

      <SectionHeader sub="FIRM / KPIs" title="Najath Akram — practice overview" />
      <KPIStrip>
        <KPI label="Active clients" value="12" sub="of 25 capacity" />
        <KPI label="Locked YTD" value="7" delta="+2" sub="vs last week" />
        <KPI label="Pending lock" value="4" sub="ready or near-ready" />
        <KPI label="Deductions claimed" value="$318,420" sub="across all clients" />
        <KPI label="Avg risk score" value="5.4" sub="weighted by receipts" />
      </KPIStrip>
    </div>
  );
}

function ClientsMatrix({ ctx }) {
  const [search, setSearch] = useStateC('');
  const [filter, setFilter] = useStateC('all');
  const years = [2026, 2025, 2024, 2023];

  const filtered = useMemoC(() => CLIENTS_NAJATH.filter(c => {
    if (filter === 'blockers' && c.blockers === 0) return false;
    if (filter === 'locked' && !Object.values(YEARS_GRID[c.id]).some(y => y && y.status === 'LOCKED')) return false;
    if (search && !(c.name + c.email).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [search, filter]);

  return (
    <div>
      <SectionHeader sub="CPA / CLIENTS" title={`All clients (${CLIENTS_NAJATH.length})`}
        right={
          <>
            <input placeholder="Search clients…" value={search} onChange={e => setSearch(e.target.value)} style={{
              fontSize: 12, padding: '4px 10px', background: 'var(--bg-2)',
              border: '1px solid var(--border-strong)', color: 'var(--fg)',
              fontFamily: 'var(--mono)', width: 220,
            }} />
            <div style={{ display: 'flex', border: '1px solid var(--border-strong)' }}>
              {[['all','ALL'],['blockers','BLOCKERS'],['locked','LOCKED']].map(([f,l]) => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '4px 10px', fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: 0.5,
                  background: filter === f ? 'var(--bg-3)' : 'transparent',
                  color: filter === f ? 'var(--fg)' : 'var(--fg-2)',
                  borderRight: f !== 'locked' ? '1px solid var(--border-strong)' : 0,
                }}>{l}</button>
              ))}
            </div>
            <Btn kind="primary">+ Add client</Btn>
          </>
        } />
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-1)' }}>
              <th style={{
                position: 'sticky', left: 0, background: 'var(--bg-1)', textAlign: 'left',
                padding: '7px 12px', borderBottom: '1px solid var(--border-strong)',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1,
                color: 'var(--fg-3)', textTransform: 'uppercase', width: 280, zIndex: 2,
              }}>Client</th>
              <th style={{
                padding: '7px 12px', borderBottom: '1px solid var(--border-strong)',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1, color: 'var(--fg-3)',
                textTransform: 'uppercase', textAlign: 'left', width: 130,
              }}>Industry</th>
              <th style={{
                padding: '7px 12px', borderBottom: '1px solid var(--border-strong)',
                fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1, color: 'var(--fg-3)',
                textTransform: 'uppercase', textAlign: 'right', width: 60,
              }}>Stops</th>
              {years.map(y => (
                <th key={y} style={{
                  padding: '7px 12px', borderBottom: '1px solid var(--border-strong)',
                  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1, color: 'var(--fg-3)',
                  textTransform: 'uppercase', textAlign: 'left', width: 130,
                }}>{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <td style={{
                  position: 'sticky', left: 0, background: 'var(--bg)',
                  padding: '8px 12px', cursor: 'pointer', zIndex: 1,
                  borderRight: '1px solid var(--border)',
                }} onClick={() => { ctx.setClient(c.id); ctx.go(`clients/${c.id}`); }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={c.name} email={c.email} size={26} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, display:'flex', alignItems:'center', gap:6 }}>
                        {c.name}
                        {c.blockers > 0 && <span style={{
                          fontSize: 10, color: 'var(--red)', fontFamily:'var(--mono)',
                          border: '1px solid var(--red)', padding: '0 4px',
                        }}>B{c.blockers}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--mono)' }}>
                        {c.email} · {c.entity} · {c.state}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--fg-2)', fontSize: 11 }}>
                  <div>{c.industry}</div>
                  <div style={{fontSize:10, color:'var(--fg-3)', fontFamily:'var(--mono)'}}>NAICS {c.naics}</div>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }} className="num">
                  {c.stops > 0 ? <span style={{color:'var(--amber)'}}>{c.stops}</span> : <span style={{color:'var(--fg-3)'}}>—</span>}
                </td>
                {years.map(y => (
                  <td key={y} style={{ padding: 0, borderLeft: '1px solid var(--border)' }}>
                    <YearCell data={YEARS_GRID[c.id][y]}
                      onClick={() => {
                        ctx.setClient(c.id);
                        if (YEARS_GRID[c.id][y]) {
                          ctx.setYear(y);
                          ctx.go(`clients/${c.id}/years/${y}`);
                        }
                      }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClientHome({ ctx, clientId }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  const grid = YEARS_GRID[clientId];
  if (!c) return <div style={{padding:24}}>Client not found.</div>;

  return (
    <div>
      <SectionHeader sub={`CPA / CLIENT`} title={c.name}
        right={
          <>
            <Btn onClick={() => ctx.go(`clients/${clientId}/profile`)}>Profile</Btn>
            <Btn onClick={() => ctx.go(`clients/${clientId}/documents`)}>Documents</Btn>
            <Btn kind="primary">+ New tax year</Btn>
          </>
        } />

      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border)',
        display: 'grid', gridTemplateColumns: '60px 1fr', gap: 16,
      }}>
        <Avatar name={c.name} email={c.email} size={48} />
        <div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{c.name}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)' }}>{c.email}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tag>NAICS {c.naics}</Tag>
            <Tag>{c.industry}</Tag>
            <Tag>{c.state}</Tag>
            <Tag>{c.entity}</Tag>
            <Tag color="var(--accent-2)">{c.method}</Tag>
          </div>
        </div>
      </div>

      <SectionHeader sub="YEARS" title="Tax years" />
      <Table
        columns={[
          { label: 'Year', mono: true, w: 80, render: r => <span className="num" style={{fontWeight:600, fontSize:13}}>{r.year}</span> },
          { label: 'Status', w: 130, render: r => r.data ? <StatusPill s={r.data.status} /> : <span style={{color:'var(--fg-3)'}}>—</span> },
          { label: 'Receipts', align: 'right', mono: true, render: r => fmtUSD(r.data?.receipts) },
          { label: 'Deductions', align: 'right', mono: true, render: r => fmtUSD(r.data?.deductions) },
          { label: 'Net', align: 'right', mono: true, render: r => {
            if (!r.data) return '—';
            const v = r.data.net;
            return <span style={{color: v < 0 ? 'var(--red)' : 'var(--fg)'}}>{fmtUSD(v)}</span>;
          }},
          { label: 'Risk', align: 'right', render: r => <RiskCell score={r.data?.risk} /> },
          { label: 'Locked', align: 'right', mono: true, muted: true, render: r => r.data?.lockedAt ? fmtDate(r.data.lockedAt) : '—' },
        ]}
        rows={[2026, 2025, 2024, 2023].map(y => ({ year: y, data: grid[y] }))}
        onRowClick={r => { if (r.data) { ctx.setYear(r.year); ctx.go(`clients/${clientId}/years/${r.year}`); } }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border)' }}>
        <div style={{ borderRight: '1px solid var(--border)' }}>
          <SectionHeader sub="DOCUMENTS" title="Recent documents"
            right={<Btn kind="ghost" onClick={() => ctx.go(`clients/${clientId}/documents`)}>view all →</Btn>} />
          {DOCS_ATIF.slice(0, 5).map(d => (
            <div key={d.id} style={{
              padding: '8px 16px', borderBottom: '1px solid var(--border)',
              display: 'grid', gridTemplateColumns: '1fr 90px 80px',
              gap: 10, fontSize: 11, alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 500 }}>{d.title}</div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--mono)' }}>{d.cat}</div>
              </div>
              <span className="num" style={{ color: 'var(--fg-2)' }}>{d.year}</span>
              <span className="mono" style={{ color: 'var(--fg-3)', textAlign: 'right' }}>{relTime(d.at)}</span>
            </div>
          ))}
        </div>
        <div>
          <SectionHeader sub="ACTIVITY" title="Recent activity" />
          {AUDIT_ATIF_2025.slice(0, 5).map((e, i) => (
            <div key={i} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span className="mono" style={{ color: 'var(--accent-2)' }}>{e.event}</span>
                <span className="mono" style={{ color: 'var(--fg-3)' }}>{relTime(e.ts)}</span>
              </div>
              <div style={{ color: 'var(--fg-2)' }}>
                {e.actor.type === 'AI' ? `${e.actor.model} ` : ''}
                {e.actor.cpa && `${e.actor.cpa}${e.actor.user ? ' on behalf of ' + e.actor.user : ''}`}
                {e.actor.type === 'SYSTEM' && 'System'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientProfile({ ctx, clientId }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  if (!c) return null;
  return (
    <div>
      <SectionHeader sub="CPA / CLIENT / PROFILE" title="Business profile" />
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {[
          ['Legal name', c.name],
          ['Email', c.email],
          ['Entity type', c.entity],
          ['State', c.state],
          ['NAICS code', c.naics],
          ['Industry', c.industry],
          ['Accounting method', c.method],
          ['Tax ID', '***-**-' + (c.id.length * 137 % 10000).toString().padStart(4,'0')],
        ].map(([k,v], i) => (
          <div key={i} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1, color: 'var(--fg-3)', textTransform: 'uppercase' }}>{k}</div>
            <div style={{ fontSize: 13, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Workspace, ClientsMatrix, ClientHome, ClientProfile });
