// Year-tier screens (year overview, ledger, stops, documents, audit-trail)
const { useState: useStateY } = React;

function YearOverview({ ctx, clientId, year }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  const data = YEARS_GRID[clientId][year];
  if (!data) return <div style={{padding:24}}>Year not started.</div>;

  const stages = [
    { label: 'Ingest',  pct: 88, items: 'Statements 7/8 · Coverage 3 gaps' },
    { label: 'Process', pct: 72, items: 'Pipeline OK · 4 STOPs open' },
    { label: 'Review',  pct: 30, items: 'Ledger 73% · Risk pending' },
    { label: 'Deliver', pct: 0,  items: 'Lock not started' },
  ];

  return (
    <div>
      <SectionHeader sub={`${c.name} / ${year} / OVERVIEW`} title={`Tax year ${year}`}
        right={
          <>
            <StatusPill s={data.status} />
            <Btn kind="primary" onClick={() => ctx.go(`clients/${clientId}/years/${year}/lock`)}>Lock year →</Btn>
          </>
        } />
      <KPIStrip>
        <KPI label="Gross receipts" value={fmtUSD(data.receipts)} sub="2025 to date" />
        <KPI label="Deductions" value={fmtUSD(data.deductions)} delta="+8.2%" sub="vs 2024" />
        <KPI label="Net Schedule C" value={fmtUSD(data.net)} deltaPos={data.net >= 0} sub="(receipts − deductions)" />
        <KPI label="Risk score" value={data.risk} sub={data.risk <= 5 ? 'low' : data.risk <= 10 ? 'moderate' : 'high'} />
        <KPI label="Open STOPs" value="4" sub="2 blockers" />
      </KPIStrip>

      <SectionHeader sub="PROGRESS" title="Stages" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {stages.map((s, i) => (
          <div key={i} style={{
            padding: '14px 16px', borderRight: i < 3 ? '1px solid var(--border)' : 'none',
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</span>
              <span className="num" style={{ fontSize: 11, color: 'var(--fg-2)' }}>{s.pct}%</span>
            </div>
            <div style={{ height: 3, background: 'var(--bg-3)', position: 'relative', marginBottom: 6 }}>
              <div style={{ height: '100%', width: `${s.pct}%`, background: s.pct === 100 ? 'var(--green)' : 'var(--accent)' }} />
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)' }}>{s.items}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ borderRight: '1px solid var(--border)' }}>
          <SectionHeader sub="YoY" title="Year-over-year"
            right={<span style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)'}}>3yr</span>} />
          <Table
            columns={[
              { label: 'Year', mono: true, w: 70 },
              { label: 'Receipts', align: 'right', mono: true, render: r => fmtUSD(r.receipts) },
              { label: 'Deductions', align: 'right', mono: true, render: r => fmtUSD(r.deductions) },
              { label: 'Net', align: 'right', mono: true, render: r => fmtUSD(r.net) },
              { label: 'Risk', align: 'right', render: r => <RiskCell score={r.risk} /> },
            ]}
            rows={[2025, 2024, 2023].map(y => ({
              year: y, ...(YEARS_GRID[clientId][y] || {}),
            }))}
          />
        </div>
        <div>
          <SectionHeader sub="BLOCKERS" title="What's in the way" />
          {INBOX.filter(i => i.client === clientId && i.year === year).map((it, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '60px 1fr auto',
              gap: 10, padding: '8px 16px',
              borderBottom: '1px solid var(--border)', alignItems: 'center',
            }}>
              <StatusPill s={it.sev} mini />
              <span style={{ fontSize: 12 }}>{it.msg}</span>
              <Btn kind="ghost" onClick={() => ctx.go(`clients/${clientId}/years/${year}/${it.target}`)}>open →</Btn>
            </div>
          ))}
          {INBOX.filter(i => i.client === clientId && i.year === year).length === 0 && (
            <div style={{padding:24, textAlign:'center', color:'var(--fg-3)', fontSize:12}}>No blockers.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Ledger({ ctx, clientId, year }) {
  const [drawer, setDrawer] = useStateY(null);
  const total = LEDGER_ATIF_2025.reduce((a,r) => a + (r.deductible || 0), 0);
  const receipts = LEDGER_ATIF_2025.reduce((a,r) => a + (r.credit || 0), 0);
  const stops = LEDGER_ATIF_2025.filter(r => r.code === '????').length;

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100%', minHeight:0}}>
      <SectionHeader sub={`ATIF KHAN / ${year} / LEDGER`} title="Master ledger"
        right={
          <>
            <Btn>XLSX</Btn>
            <Btn>Reclassify</Btn>
            <Btn kind="amber">{stops} STOPs</Btn>
          </>
        } />
      <KPIStrip>
        <KPI label="Receipts" value={fmtUSD(receipts)} sub={`${LEDGER_ATIF_2025.filter(r => r.credit > 0).length} txns`} />
        <KPI label="Deductible total" value={fmtUSD(total)} sub="Schedule C ≡ A03 ≡ FS" />
        <KPI label="STOPs open" value={stops} sub="blocking lock" />
        <KPI label="Confidence avg" value="87%" sub="0.42 min" />
      </KPIStrip>
      <div style={{flex:1, minHeight:0, overflow:'auto'}}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: 'var(--bg-1)' }}>
              {['Date','Account','Memo','Debit','Credit','Code','Category','Deductible','Conf'].map((h,i) => {
                const align = ['Debit','Credit','Deductible','Conf'].includes(h) ? 'right' : 'left';
                return <th key={i} style={{
                  padding: '6px 10px', textAlign: align,
                  borderBottom: '1px solid var(--border-strong)',
                  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1,
                  color: 'var(--fg-3)', textTransform: 'uppercase',
                  position:'sticky', top:0, background:'var(--bg-1)',
                }}>{h}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {LEDGER_ATIF_2025.map((r, i) => {
              const isStop = r.code === '????';
              return (
                <tr key={i} onClick={() => setDrawer(r)} style={{
                  borderBottom: '1px solid var(--border)', cursor:'pointer',
                  background: isStop ? 'rgba(212,160,23,0.04)' : 'transparent',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = isStop ? 'rgba(212,160,23,0.04)' : 'transparent'}
                >
                  <td className="mono" style={{padding:'5px 10px', color:'var(--fg-2)'}}>{r.date}</td>
                  <td className="mono" style={{padding:'5px 10px', color:'var(--fg-2)', fontSize:11}}>{r.acct}</td>
                  <td style={{padding:'5px 10px'}}>{r.memo}{r.note && <span style={{fontSize:10, color:'var(--fg-3)', marginLeft:8, fontFamily:'var(--mono)'}}>· {r.note}</span>}</td>
                  <td className="num" style={{padding:'5px 10px', textAlign:'right', color: r.debit ? 'var(--fg)' : 'var(--fg-3)'}}>{r.debit ? fmtUSD(r.debit, {cents:true}) : '—'}</td>
                  <td className="num" style={{padding:'5px 10px', textAlign:'right', color: r.credit ? 'var(--green)' : 'var(--fg-3)'}}>{r.credit ? fmtUSD(r.credit, {cents:true}) : '—'}</td>
                  <td className="mono" style={{padding:'5px 10px', color: isStop ? 'var(--amber)' : 'var(--accent-2)'}}>{r.code}</td>
                  <td style={{padding:'5px 10px', color: isStop ? 'var(--amber)' : 'var(--fg-1)', fontSize:11}}>{r.cat}</td>
                  <td className="num" style={{padding:'5px 10px', textAlign:'right', color: r.deductible > 0 ? 'var(--fg)' : 'var(--fg-3)'}}>{r.deductible > 0 ? fmtUSD(r.deductible, {cents:true}) : '—'}</td>
                  <td className="num" style={{padding:'5px 10px', textAlign:'right', color: r.confidence < 0.6 ? 'var(--amber)' : 'var(--fg-2)', fontSize:11}}>{Math.round(r.confidence*100)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Drawer open={!!drawer} onClose={() => setDrawer(null)} title="Transaction detail">
        {drawer && (
          <div style={{padding:16, fontSize:12}}>
            <div style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--fg-3)', marginBottom:6}}>
              {drawer.date} · {drawer.acct}
            </div>
            <div style={{fontSize:14, fontWeight:600, marginBottom:12}}>{drawer.memo}</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16}}>
              {[
                ['Debit', fmtUSD(drawer.debit, {cents:true})],
                ['Credit', fmtUSD(drawer.credit, {cents:true})],
                ['Code', drawer.code],
                ['Category', drawer.cat],
                ['Deductible', fmtUSD(drawer.deductible, {cents:true})],
                ['Confidence', Math.round(drawer.confidence*100)+'%'],
              ].map(([k,v], i) => (
                <div key={i}>
                  <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', textTransform:'uppercase', letterSpacing:1}}>{k}</div>
                  <div style={{fontSize:13}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{borderTop:'1px solid var(--border)', paddingTop:12, marginTop:8}}>
              <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', letterSpacing:1, textTransform:'uppercase', marginBottom:6}}>Audit trail</div>
              <div style={{fontSize:11, color:'var(--fg-2)', lineHeight:1.6}}>
                <div>· classified by sonnet-4.6 · {Math.round(drawer.confidence*100)}% confidence</div>
                <div>· source: Chase 4421 statement 2025-03 (Haiku-cleaned)</div>
                <div>· {drawer.note || 'no overrides'}</div>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Stops({ ctx, clientId, year }) {
  const [stops, setStops] = useStateY(STOPS_ATIF_2025);
  const [active, setActive] = useStateY(stops.find(s => s.state === 'OPEN'));
  const [pick, setPick] = useStateY(null);

  const resolve = () => {
    if (pick == null || !active) return;
    setStops(prev => prev.map(s => s.id === active.id ? { ...s, state: 'RESOLVED', resolution: active.options[pick] } : s));
    const next = stops.find(s => s.state === 'OPEN' && s.id !== active.id);
    setActive(next || null);
    setPick(null);
  };

  return (
    <div style={{display:'flex', height:'100%', minHeight:0}}>
      <div style={{width: 380, borderRight:'1px solid var(--border)', overflow:'auto'}}>
        <SectionHeader sub="STOPs" title={`${stops.filter(s=>s.state==='OPEN').length} open · ${stops.filter(s=>s.state==='RESOLVED').length} resolved`} />
        {stops.map(s => (
          <button key={s.id} onClick={() => { setActive(s); setPick(null); }} style={{
            display:'block', width:'100%', textAlign:'left',
            padding:'10px 14px', borderBottom:'1px solid var(--border)',
            background: active?.id === s.id ? 'var(--bg-3)' : 'transparent',
            borderLeft: active?.id === s.id ? '2px solid var(--accent)' : '2px solid transparent',
          }}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:4}}>
              <Tag color={s.cat === 'DEPOSIT' ? 'var(--blue)' : s.cat === 'MEAL' ? 'var(--orange)' : 'var(--fg-2)'}>{s.cat}</Tag>
              <StatusPill s={s.state} mini />
            </div>
            <div style={{fontSize:12, fontWeight:500, marginBottom:2}}>{s.payer}</div>
            <div className="mono" style={{fontSize:11, color:'var(--fg-3)'}}>{s.date} · {fmtUSD(s.amount, {cents:true})}</div>
          </button>
        ))}
      </div>
      <div style={{flex:1, overflow:'auto'}}>
        {active ? (
          <>
            <SectionHeader sub={`STOP / ${active.cat}`} title={active.payer}
              right={<><Btn>Skip</Btn><Btn kind="primary" disabled={pick==null || active.state==='RESOLVED'} onClick={resolve}>Resolve & next →</Btn></>} />
            <div style={{padding:16}}>
              <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:20}}>
                {[
                  ['Date', active.date],
                  ['Amount', fmtUSD(active.amount, {cents:true})],
                  ['Account', active.acct],
                  ['State', active.state],
                ].map(([k,v], i) => (
                  <div key={i}>
                    <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', textTransform:'uppercase', letterSpacing:1}}>{k}</div>
                    <div style={{fontSize:13, marginTop:2}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{padding:14, border:'1px solid var(--border)', background:'var(--bg-1)', marginBottom:16}}>
                <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--accent-2)', letterSpacing:1, marginBottom:6}}>SONNET-4.6 ASKS</div>
                <div style={{fontSize:13}}>{active.q}</div>
              </div>
              <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', letterSpacing:1, marginBottom:8, textTransform:'uppercase'}}>Resolution</div>
              {active.options.map((opt, i) => {
                const isResolved = active.state === 'RESOLVED';
                const selected = isResolved ? 0 === i : pick === i;
                return (
                  <button key={i} onClick={() => !isResolved && setPick(i)} disabled={isResolved} style={{
                    display:'block', width:'100%', textAlign:'left',
                    padding:'10px 14px', marginBottom: 6,
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    background: selected ? 'rgba(212,160,23,0.08)' : 'var(--bg-1)',
                    color: 'var(--fg)', fontSize: 12,
                    cursor: isResolved ? 'default' : 'pointer',
                  }}>
                    <span style={{
                      display:'inline-block', width:14, height:14, marginRight:10,
                      border:`1px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
                      background: selected ? 'var(--accent)' : 'transparent',
                      verticalAlign:'middle',
                    }} />
                    {opt}
                  </button>
                );
              })}
              {active.state === 'RESOLVED' && (
                <div style={{marginTop:16, padding:12, border:'1px solid var(--green)', background:'rgba(47,179,128,0.08)', color:'var(--green)', fontSize:12, fontFamily:'var(--mono)'}}>
                  ✓ RESOLVED — {active.resolution || active.options[0]}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{padding:48, textAlign:'center', color:'var(--fg-3)'}}>
            <div style={{fontSize:14, marginBottom:8}}>All STOPs cleared.</div>
            <Btn kind="primary" onClick={() => ctx.go(`clients/${clientId}/years/${year}/lock`)}>Continue to Lock →</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function Documents({ ctx, clientId }) {
  const [tab, setTab] = useStateY('all');
  const [drag, setDrag] = useStateY(false);

  const cats = ['Statements','Tax forms received','Tax forms issued','Engagement & legal','IRS correspondence','Receipts'];
  const filtered = tab === 'all' ? DOCS_ATIF : DOCS_ATIF.filter(d => d.cat === tab);

  return (
    <div>
      <SectionHeader sub="ATIF KHAN / DOCUMENTS" title={`${DOCS_ATIF.length} documents`}
        right={<><Btn>Bulk download</Btn><Btn kind="primary">+ Upload</Btn></>} />
      <Tabs
        tabs={[
          { id: 'all', label: 'All', badge: DOCS_ATIF.length },
          ...cats.map(c => ({ id: c, label: c, badge: DOCS_ATIF.filter(d => d.cat === c).length })),
        ]}
        active={tab} onChange={setTab}
      />
      <div
        onDragEnter={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={e => setDrag(false)}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); setDrag(false); }}
        style={{
          margin: 16, padding: 14, border: `1px dashed ${drag ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: drag ? 'rgba(212,160,23,0.06)' : 'transparent',
          textAlign:'center', fontSize:12, color: drag ? 'var(--accent)' : 'var(--fg-3)',
          fontFamily:'var(--mono)',
        }}
      >
        {drag ? 'Drop to upload — category will be auto-detected' : 'Drag PDFs here, or click + Upload'}
      </div>
      <Table
        columns={[
          { label: 'Title', render: r => (
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <span style={{
                fontFamily:'var(--mono)', fontSize:9, padding:'2px 5px',
                border:'1px solid var(--border-strong)', color:'var(--fg-2)',
              }}>PDF</span>
              <div>
                <div style={{fontWeight:500}}>{r.title}{r.sensitive && <span style={{marginLeft:8, color:'var(--red)', fontSize:10, fontFamily:'var(--mono)'}}>SENSITIVE</span>}</div>
                {r.linkedTxn && <div style={{fontSize:10, color:'var(--accent-2)', fontFamily:'var(--mono)', marginTop:2}}>↗ linked: {r.linkedTxn}</div>}
              </div>
            </div>
          )},
          { label: 'Category', render: r => <Tag>{r.cat}</Tag> },
          { label: 'Year', mono: true, w: 60, render: r => <span className="num">{r.year}</span> },
          { label: 'Tags', render: r => <span style={{display:'flex', gap:4, flexWrap:'wrap'}}>{r.tags.map(t => <Tag key={t} color="var(--fg-3)">{t}</Tag>)}</span> },
          { label: 'Uploaded', mono: true, muted: true, render: r => `${r.by} · ${fmtDate(r.at)}` },
          { label: 'Size', mono: true, align: 'right', muted: true, render: r => r.size },
        ]}
        rows={filtered}
      />
    </div>
  );
}

function AuditTrail({ ctx, clientId, year }) {
  const [drawer, setDrawer] = useStateY(null);
  return (
    <div>
      <SectionHeader sub={`ATIF KHAN / ${year} / AUDIT TRAIL`} title={`${AUDIT_ATIF_2025.length} events`}
        right={<><Btn>Filter</Btn><Btn>Export CSV</Btn></>} />
      <div style={{padding:'10px 16px', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--fg-2)', fontFamily:'var(--mono)', display:'flex', gap:8}}>
        <Tag>actor:any</Tag><Tag>events:all</Tag><Tag>last 7d</Tag>
      </div>
      <Table
        columns={[
          { label: 'Timestamp', mono: true, w: 150, render: r => fmtDateTime(r.ts) },
          { label: 'Actor', w: 240, render: r => (
            <span style={{fontSize:11}}>
              {r.actor.type === 'AI' && <Tag color="var(--accent-2)">AI · {r.actor.model}</Tag>}
              {r.actor.type === 'SYSTEM' && <Tag color="var(--fg-3)">SYSTEM</Tag>}
              {r.actor.type === 'USER' && <span>{r.actor.cpa} <span style={{color:'var(--fg-3)'}}>on behalf of</span> {r.actor.user}</span>}
            </span>
          )},
          { label: 'Event', mono: true, w: 180, render: r => <span style={{color:'var(--accent-2)'}}>{r.event}</span> },
          { label: 'Entity', muted: true, render: r => r.entity },
          { label: '', w: 80, align: 'right', render: r => <Btn kind="ghost" onClick={(e) => { e.stopPropagation(); setDrawer(r); }}>peek →</Btn> },
        ]}
        rows={AUDIT_ATIF_2025}
        onRowClick={setDrawer}
      />
      <Drawer open={!!drawer} onClose={() => setDrawer(null)} title="Audit event">
        {drawer && (
          <div style={{padding:16, fontSize:12}}>
            <div style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--fg-3)', marginBottom:6}}>{fmtDateTime(drawer.ts)}</div>
            <div style={{fontSize:14, fontWeight:600, color:'var(--accent-2)', fontFamily:'var(--mono)', marginBottom:12}}>{drawer.event}</div>
            <div style={{marginBottom:12}}>
              <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', letterSpacing:1, textTransform:'uppercase', marginBottom:4}}>Entity</div>
              <div>{drawer.entity}</div>
            </div>
            <div style={{marginBottom:12}}>
              <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', letterSpacing:1, textTransform:'uppercase', marginBottom:4}}>Actor</div>
              <div style={{fontSize:12}}>
                {drawer.actor.type === 'USER' && (
                  <>
                    <div>actorCpaUserId: <span style={{color:'var(--accent-2)'}}>{drawer.actor.cpa}</span></div>
                    <div>userId (impersonated): <span style={{color:'var(--amber)'}}>{drawer.actor.user}</span></div>
                  </>
                )}
                {drawer.actor.type === 'AI' && <div>AI · {drawer.actor.model}</div>}
                {drawer.actor.type === 'SYSTEM' && <div>System</div>}
              </div>
            </div>
            {drawer.diff && (
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', letterSpacing:1, textTransform:'uppercase', marginBottom:4}}>Diff</div>
                <pre style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--fg-1)', background:'var(--bg-2)', padding:10, margin:0, border:'1px solid var(--border)', whiteSpace:'pre-wrap'}}>
{JSON.stringify(drawer.diff, null, 2)}
                </pre>
              </div>
            )}
            <div>
              <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', letterSpacing:1, textTransform:'uppercase', marginBottom:4}}>Rationale</div>
              <div style={{fontSize:12, fontStyle:'italic', color:'var(--fg-1)', lineHeight:1.5}}>{drawer.rationale}</div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Placeholder({ title, sub }) {
  return (
    <div>
      <SectionHeader sub={sub} title={title} />
      <div style={{padding:48, textAlign:'center', color:'var(--fg-3)', fontSize:13}}>
        <div style={{fontFamily:'var(--mono)', fontSize:11, marginBottom:8, letterSpacing:1, textTransform:'uppercase'}}>WIRED IN V2</div>
        Not part of this prototype slice — see /workspace, /clients, ledger, STOPs, documents, audit-trail for the active surfaces.
      </div>
    </div>
  );
}

Object.assign(window, { YearOverview, Ledger, Stops, Documents, AuditTrail, Placeholder });
