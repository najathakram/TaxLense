// TaxLens v2 — fluid/iOS aesthetic, all sections.
const { useState, useEffect, useMemo, useRef } = React;

// ───────── Primitives ──────────────────────────────────────────────
const STATUS = {
  CREATED:   { label: 'CREATED',   color: 'var(--fg-3)',  bg: 'rgba(91,98,113,0.18)',  dot: '○' },
  INGESTION: { label: 'INGESTION', color: 'var(--blue)',  bg: 'rgba(122,166,255,0.16)', dot: '◐' },
  REVIEW:    { label: 'REVIEW',    color: 'var(--amber)', bg: 'rgba(244,196,81,0.14)', dot: '◑' },
  LOCKED:    { label: 'LOCKED',    color: 'var(--green)', bg: 'rgba(52,201,138,0.14)', dot: '●' },
  BLOCKER:   { label: 'BLOCKER',   color: 'var(--red)',   bg: 'rgba(255,107,107,0.14)', dot: '●' },
  PENDING:   { label: 'PENDING',   color: 'var(--amber)', bg: 'rgba(244,196,81,0.14)', dot: '●' },
  READY:     { label: 'READY',     color: 'var(--green)', bg: 'rgba(52,201,138,0.14)', dot: '●' },
  DEADLINE:  { label: 'DEADLINE',  color: 'var(--orange)',bg: 'rgba(255,154,87,0.14)', dot: '◆' },
  OPEN:      { label: 'OPEN',      color: 'var(--amber)', bg: 'rgba(244,196,81,0.14)', dot: '●' },
  RESOLVED:  { label: 'RESOLVED',  color: 'var(--green)', bg: 'rgba(52,201,138,0.14)', dot: '✓' },
  active:    { label: 'ACTIVE',    color: 'var(--green)', bg: 'rgba(52,201,138,0.14)', dot: '●' },
  inactive:  { label: 'INACTIVE',  color: 'var(--fg-3)',  bg: 'rgba(91,98,113,0.18)',  dot: '○' },
};
function Pill({ s, children }) {
  const m = STATUS[s] || { color: 'var(--fg-2)', bg: 'rgba(255,255,255,0.06)', dot: '·', label: s };
  return (
    <span className="pill" style={{ color: m.color, background: m.bg }}>
      <span style={{ fontSize: 10 }}>{m.dot}</span>{children || m.label}
    </span>
  );
}
function Risk({ score }) {
  if (score == null || score === 0) return <span style={{color:'var(--fg-3)'}}>—</span>;
  const c = score <= 5 ? 'var(--green)' : score <= 10 ? 'var(--amber)' : score <= 20 ? 'var(--orange)' : 'var(--red)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 32, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.08)', position: 'relative' }}>
        <span style={{ position: 'absolute', inset: 0, width: `${Math.min(100, score*4)}%`, background: c, borderRadius: 999 }} />
      </span>
      <span className="num" style={{ color: c, fontWeight: 600, fontSize: 12 }}>{score}</span>
    </span>
  );
}
function Avi({ name, email, size = 28 }) {
  const hue = avatarHue(email || name);
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', justifyContent:'center',
      width: size, height: size, borderRadius: size,
      background: `linear-gradient(135deg, oklch(0.46 0.10 ${hue}), oklch(0.32 0.08 ${(hue+30)%360}))`,
      color: 'white', fontSize: Math.round(size*0.36), fontWeight: 700,
      letterSpacing: 0.4, flexShrink: 0,
      boxShadow: '0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
    }}>{initials(name)}</span>
  );
}
function Btn({ children, kind='default', onClick, disabled, icon, style, size='md' }) {
  const base = {
    display:'inline-flex', alignItems:'center', gap:7,
    padding: size === 'sm' ? '5px 11px' : '7px 14px',
    fontSize: size === 'sm' ? 12 : 13, fontWeight: 600,
    borderRadius: 999, transition: 'all 160ms ease',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
  const skins = {
    default: { background:'rgba(255,255,255,0.08)', color: 'var(--fg)', border:'1px solid var(--hairline)' },
    primary: { background:'linear-gradient(180deg, #8fb6ff 0%, #6f9bff 100%)', color: '#0a1428', boxShadow: '0 4px 12px rgba(122,166,255,0.35), inset 0 1px 0 rgba(255,255,255,0.4)' },
    ghost:   { background:'transparent', color:'var(--fg-1)' },
    purple:  { background:'rgba(195,155,255,0.14)', color:'var(--purple)', border:'1px solid rgba(195,155,255,0.32)' },
    danger:  { background:'rgba(255,107,107,0.14)', color:'var(--red)', border:'1px solid rgba(255,107,107,0.32)' },
    accent2: { background:'rgba(95,212,177,0.12)', color:'var(--accent-2)', border:'1px solid rgba(95,212,177,0.28)' },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...skins[kind], ...style }}>
      {icon}{children}
    </button>
  );
}
function Tag({ children, color='var(--fg-2)' }) {
  return (
    <span style={{
      fontFamily:'var(--mono)', fontSize: 10, padding:'2px 8px',
      borderRadius: 999, background: 'rgba(255,255,255,0.05)',
      color, border: `1px solid ${color}33`,
    }}>{children}</span>
  );
}
function Card({ children, style, pad=18, hoverable=false, onClick }) {
  return (
    <div onClick={onClick} className="glass" style={{
      padding: pad, ...(hoverable ? { cursor:'pointer', transition:'transform 200ms ease, box-shadow 200ms ease' } : {}),
      ...style,
    }}
    onMouseEnter={hoverable ? e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow)'; } : undefined}
    onMouseLeave={hoverable ? e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; } : undefined}
    >
      {children}
    </div>
  );
}
function Section({ title, sub, right, children, pad=true }) {
  return (
    <section className="fade-up" style={{padding: pad ? '20px 28px 8px' : 0}}>
      {(title || right) && (
        <header style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom: 14 }}>
          <div>
            {sub && <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', letterSpacing:1.6, textTransform:'uppercase', marginBottom:3}}>{sub}</div>}
            {title && <h2 style={{margin:0, fontSize:20, fontWeight:700, letterSpacing:-0.2}}>{title}</h2>}
          </div>
          {right && <div style={{ display:'flex', gap:8, alignItems:'center' }}>{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
function KPI({ label, value, sub, accent }) {
  return (
    <Card pad={16} style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, color: accent || 'var(--fg)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}
function Switch({ on, onChange }) {
  return <span className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on} />;
}
function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}{o.badge != null && <span style={{marginLeft:6, fontSize:10, opacity:0.7}}>{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}
function ProgressArc({ pct, size = 56, label }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct/100);
  const color = pct === 100 ? 'var(--green)' : pct >= 60 ? 'var(--accent)' : 'var(--amber)';
  return (
    <div style={{position:'relative', width:size, height:size, flexShrink:0}}>
      <svg width={size} height={size} style={{transform:'rotate(-90deg)'}}>
        <circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="4" fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth="4" fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{transition:'stroke-dashoffset 600ms ease'}} />
      </svg>
      <div style={{
        position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
        fontSize: 11, fontWeight: 700, fontFamily:'var(--mono)', color,
      }}>{label || `${pct}%`}</div>
    </div>
  );
}

// ───────── Top bar / banners / sidebar ─────────────────────────────
function TopBar({ ctx, isAdmin, cpa }) {
  return (
    <header style={{
      display:'flex', alignItems:'center', height: 56, padding: '0 18px',
      gap: 14, flexShrink: 0, position:'relative', zIndex: 5,
      borderBottom:'1px solid var(--hairline)',
      background: 'rgba(11,13,18,0.55)', backdropFilter:'blur(14px)', WebkitBackdropFilter:'blur(14px)',
    }}>
      <div onClick={() => ctx.go(isAdmin ? 'admin' : 'workspace')} style={{display:'flex', alignItems:'center', gap:10, cursor:'pointer'}}>
        <div style={{
          width: 30, height: 30, borderRadius: 9,
          background: 'linear-gradient(135deg, #7aa6ff 0%, #c39bff 100%)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontWeight: 800, color: '#0a1428', fontSize: 15,
          boxShadow: '0 4px 14px rgba(122,166,255,0.4), inset 0 1px 0 rgba(255,255,255,0.4)',
        }}>T</div>
        <span style={{fontSize: 16, fontWeight: 700, letterSpacing: -0.3}}>TaxLens</span>
      </div>
      <div className="glass" style={{
        display:'flex', alignItems:'center', gap:10, padding:'7px 14px',
        flex: 1, maxWidth: 520, borderRadius: 999, marginLeft: 12,
      }}>
        <span style={{color:'var(--fg-3)'}}>⌕</span>
        <span style={{fontSize:13, color:'var(--fg-3)', flex:1}}>
          {isAdmin ? 'Search CPAs, clients, audit events…' : 'Search clients, years, documents…'}
        </span>
        <span style={{
          fontFamily:'var(--mono)', fontSize:10, padding:'2px 7px', borderRadius:6,
          background:'rgba(255,255,255,0.06)', color:'var(--fg-2)',
        }}>⌘K</span>
      </div>
      <div style={{flex:1}} />
      <button style={{
        width:34, height:34, borderRadius:999, background:'rgba(255,255,255,0.05)',
        display:'flex', alignItems:'center', justifyContent:'center', position:'relative',
        border:'1px solid var(--hairline)',
      }}>
        <span style={{fontSize:14}}>🔔</span>
        <span style={{position:'absolute', top:6, right:7, width:7, height:7, background:'var(--red)', borderRadius:999}} />
      </button>
      <div className="glass" style={{
        display:'flex', alignItems:'center', gap:10, padding:'5px 14px 5px 6px', borderRadius: 999,
        ...(isAdmin ? { borderColor: 'rgba(195,155,255,0.4)', background: 'rgba(195,155,255,0.08)' } : {}),
      }}>
        <Avi name={isAdmin ? ADMIN.name : (cpa?.name || 'Najath Akram')} email={isAdmin ? ADMIN.email : (cpa?.email || 'najath@taxlens.app')} size={28} />
        <div style={{lineHeight:1.15}}>
          <div style={{fontSize: 9, fontWeight:600, letterSpacing:1.2, color: isAdmin ? 'var(--purple)' : 'var(--fg-3)'}}>
            {isAdmin ? 'SUPER ADMIN' : cpa ? 'CPA · IMPERSONATED' : 'CPA'}
          </div>
          <div style={{fontSize:13, fontWeight:600}}>{isAdmin ? 'Anthropic Ops' : (cpa?.name?.split(' ')[0] + ' ' + (cpa?.name?.split(' ')[1]?.[0] || '') || 'Najath A.')}</div>
        </div>
      </div>
    </header>
  );
}
function Banner({ tone, children, onExit, exitLabel }) {
  const isAdmin = tone === 'admin';
  const c = isAdmin ? 'var(--purple)' : 'var(--amber)';
  const bg = isAdmin ? 'linear-gradient(90deg, rgba(195,155,255,0.18), rgba(195,155,255,0.08))'
                     : 'linear-gradient(90deg, rgba(244,196,81,0.18), rgba(244,196,81,0.08))';
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'8px 22px', background: bg, borderBottom:`1px solid ${c}33`,
      fontSize: 12, color: c, fontWeight: 600, letterSpacing: 0.2,
      backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)',
    }}>
      <div style={{display:'flex', alignItems:'center', gap:12}}>
        <span className="pill" style={{ background: `${c}1f`, color: c, border: `1px solid ${c}55`, fontSize: 10, letterSpacing: 1.2 }}>
          {isAdmin ? '◆ ADMIN' : '● CPA'}
        </span>
        <span>{children}</span>
      </div>
      <button onClick={onExit} className="pill" style={{
        background:'rgba(0,0,0,0.2)', color: c, border: `1px solid ${c}55`,
        fontSize: 11, padding:'4px 12px', cursor:'pointer',
      }}>{exitLabel}</button>
    </div>
  );
}

function Sidebar({ ctx, route, activeClient, activeYear, isAdmin }) {
  const a = (p) => route.path.join('/') === p;
  const inClient = activeClient && CLIENTS_NAJATH.find(c => c.id === activeClient);

  const Item = ({ id, label, badge, indent = 0, accent, onClick, active }) => (
    <button onClick={onClick} style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      width:'100%', padding: `8px 12px 8px ${12 + indent*14}px`,
      borderRadius: 10, fontSize: 13, fontWeight: 500,
      color: active ? 'var(--fg)' : 'var(--fg-1)',
      background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
      transition: 'background 160ms ease',
      marginBottom: 1,
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{display:'inline-flex', alignItems:'center', gap:10, minWidth:0, overflow:'hidden'}}>
        {accent && <span style={{ width:6, height:6, borderRadius:6, background: accent, flexShrink:0 }} />}
        <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{label}</span>
      </span>
      {badge != null && (
        typeof badge === 'object' ? (
          <span style={{
            fontSize: 10, padding:'1px 7px', borderRadius:999,
            background: badge.bg || 'rgba(255,255,255,0.08)',
            color: badge.color, fontWeight: 700,
          }}>{badge.text}</span>
        ) : (
          <span style={{
            fontSize: 10, padding:'1px 7px', borderRadius:999,
            background:'rgba(255,255,255,0.08)', color:'var(--fg-1)', fontWeight: 700,
          }}>{badge}</span>
        )
      )}
    </button>
  );
  const Grp = ({ label, children }) => (
    <div style={{padding:'10px 8px 6px'}}>
      {label && <div style={{padding:'4px 14px 6px', fontSize: 10, fontWeight:700, letterSpacing:1.4, color:'var(--fg-3)', textTransform:'uppercase'}}>{label}</div>}
      {children}
    </div>
  );

  return (
    <aside style={{
      width: 248, flexShrink: 0, padding: 12,
      display:'flex', flexDirection:'column', minHeight: 0, overflow:'auto',
    }}>
      <div className="glass-strong" style={{padding:6, display:'flex', flexDirection:'column', flex:1, borderRadius: 18}}>
      {isAdmin ? (
        <>
          <Grp label="Admin">
            <Item label="Dashboard"  active={a('admin')}          onClick={() => ctx.go('admin')}          accent="var(--purple)" />
            <Item label="CPAs"       active={a('admin/cpas')}     onClick={() => ctx.go('admin/cpas')}     accent="var(--purple)" badge={CPAS.length} />
            <Item label="Audit log"  active={a('admin/audit')}    onClick={() => ctx.go('admin/audit')}    accent="var(--purple)" badge={{text:'HOT', color:'var(--orange)', bg:'rgba(255,154,87,0.14)'}} />
            <Item label="Settings"   active={a('admin/settings')} onClick={() => ctx.go('admin/settings')} accent="var(--purple)" />
          </Grp>
        </>
      ) : (
        <>
          <Grp label="Workspace">
            <Item label="Inbox"         active={a('workspace')}          onClick={() => ctx.go('workspace')}          accent="var(--accent)" badge={{text: '4', color:'var(--red)', bg:'rgba(255,107,107,0.14)'}} />
            <Item label="Firm overview" active={a('workspace/firm')}     onClick={() => ctx.go('workspace/firm')}     accent="var(--accent)" />
            <Item label="Calendar"      active={a('workspace/calendar')} onClick={() => ctx.go('workspace/calendar')} accent="var(--accent)" />
          </Grp>
          <Grp label={`Clients · ${CLIENTS_NAJATH.length}`}>
            <Item label="All clients" active={a('clients')} onClick={() => ctx.go('clients')} />
            {CLIENTS_NAJATH.slice(0, 6).map(c => (
              <button key={c.id} onClick={() => { ctx.setClient(c.id); ctx.go(`clients/${c.id}`); }} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                width:'100%', padding:'6px 12px', borderRadius:10, marginBottom: 1,
                background: activeClient === c.id && route.path.length === 2 ? 'rgba(255,255,255,0.07)' : 'transparent',
              }}>
                <span style={{display:'flex', alignItems:'center', gap:9, minWidth:0}}>
                  <Avi name={c.name} email={c.email} size={20} />
                  <span style={{fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{c.name}</span>
                </span>
                {c.blockers > 0 ? <span style={{fontSize:10, padding:'1px 7px', borderRadius:999, background:'rgba(255,107,107,0.14)', color:'var(--red)', fontWeight:700}}>B{c.blockers}</span>
                  : c.stops > 0 ? <span style={{fontSize:10, padding:'1px 7px', borderRadius:999, background:'rgba(244,196,81,0.14)', color:'var(--amber)', fontWeight:700}}>{c.stops}</span> : null}
              </button>
            ))}
          </Grp>
          {inClient && activeYear && (
            <Grp label={`${inClient.name.split(' ')[0]} / ${activeYear}`}>
              <Item label="Year overview" active={route.path[2]==='years' && !route.path[4]} onClick={() => ctx.go(`clients/${activeClient}/years/${activeYear}`)} />
              <Item label="Documents" active={route.path[2]==='documents'} onClick={() => ctx.go(`clients/${activeClient}/documents`)} badge={DOCS_ATIF.length} />
              {[
                ['INGEST', [['upload','Upload'], ['coverage','Coverage', {text:'3', color:'var(--red)'}]]],
                ['PROCESS', [['pipeline','Pipeline'], ['stops','STOPs', 4]]],
                ['REVIEW', [['ledger','Ledger'], ['risk','Risk'], ['analytics','Analytics']]],
                ['DELIVER', [['lock','Lock'], ['download','Download'], ['audit-trail','Audit trail']]],
              ].map(([stage, items]) => (
                <div key={stage} style={{marginTop:6}}>
                  <div style={{padding:'2px 14px', fontSize:9, fontWeight:700, letterSpacing:1.2, color:'var(--fg-3)', textTransform:'uppercase', display:'flex', alignItems:'center', gap:6}}>
                    {stage}{stage === 'PROCESS' && <span style={{width:5, height:5, borderRadius:5, background:'var(--red)'}}/>}
                  </div>
                  {items.map(([id, lbl, badge]) => (
                    <Item key={id} indent={1} label={lbl}
                      active={route.path[4] === id}
                      onClick={() => ctx.go(`clients/${activeClient}/years/${activeYear}/${id}`)}
                      badge={badge}
                    />
                  ))}
                </div>
              ))}
            </Grp>
          )}
          {inClient && !activeYear && (
            <Grp label={inClient.name}>
              <div style={{padding:'8px 14px', fontSize:11, color:'var(--fg-3)', fontStyle:'italic'}}>Pick a year to expand →</div>
            </Grp>
          )}
        </>
      )}

      <div style={{flex:1}} />
      <div style={{padding:'10px 14px', fontSize: 11, color:'var(--fg-3)', borderTop:'1px solid var(--hairline)'}}>
        <div className="mono">{isAdmin ? 'ops@anthropic.com' : 'najath@taxlens.app'}</div>
        <button style={{marginTop: 4, color:'var(--fg-2)'}}>sign out →</button>
      </div>
      </div>
    </aside>
  );
}

function ContextBar({ ctx, clientId, year }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  const data = year ? YEARS_GRID[clientId]?.[year] : null;
  if (!c) return null;
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:10, padding:'12px 28px',
      borderBottom:'1px solid var(--hairline)',
      background:'rgba(11,13,18,0.4)', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)',
    }}>
      <button onClick={() => ctx.go(`clients/${clientId}`)} className="glass" style={{
        display:'flex', alignItems:'center', gap:8, padding:'4px 12px 4px 6px', borderRadius:999,
      }}>
        <Avi name={c.name} email={c.email} size={20} />
        <span style={{fontWeight:600, fontSize:13}}>{c.name}</span>
        <span style={{color:'var(--fg-3)', fontSize:11}}>▾</span>
      </button>
      {year && (
        <>
          <span style={{color:'var(--fg-3)'}}>›</span>
          <button className="glass" style={{padding:'4px 14px', borderRadius:999, fontWeight:700, fontSize:13, fontFamily:'var(--mono)'}}>
            {year} ▾
          </button>
        </>
      )}
      {data && <Pill s={data.status} />}
      <div style={{flex:1}} />
      {c.blockers > 0 && <Pill s="BLOCKER">{c.blockers} blocker{c.blockers > 1 ? 's' : ''}</Pill>}
      {c.stops > 0 && <Pill s="OPEN">{c.stops} STOP{c.stops > 1 ? 's' : ''}</Pill>}
      <span style={{fontSize:11, color:'var(--fg-3)'}}>last action {relTime('2026-05-06T11:42:00Z')}</span>
    </div>
  );
}

// ───────── Admin tier ──────────────────────────────────────────────
function AdminHome({ ctx }) {
  return (
    <>
      <Section sub="ADMIN · DASHBOARD" title="Platform overview"
        right={<><Btn icon="↓">Export</Btn><Btn kind="primary" icon="+">Add CPA</Btn></>}>
        <div style={{display:'flex', gap:12, marginBottom:18}}>
          <KPI label="Active CPAs" value="7" sub="+1 this week" accent="var(--accent)" />
          <KPI label="Total clients" value="101" sub="+3 this week" />
          <KPI label="Locked YTD" value="69" sub="across firm" accent="var(--green)" />
          <KPI label="Deductions YTD" value="$2.60M" sub="claimed across firm" />
          <KPI label="Errors (24h)" value="3" sub="+2 vs yesterday" accent="var(--red)" />
        </div>
      </Section>

      <div style={{display:'grid', gridTemplateColumns:'1.15fr 1fr', gap: 16, padding:'0 28px 28px'}}>
        <Card pad={0}>
          <div style={{padding:'16px 18px 12px', borderBottom:'1px solid var(--hairline)', display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
            <div>
              <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.4, textTransform:'uppercase', fontWeight:700}}>ALERTS</div>
              <div style={{fontSize:16, fontWeight:700, marginTop:2}}>Needs attention</div>
            </div>
            <span className="mono" style={{fontSize:11, color:'var(--fg-3)'}}>{ADMIN_ALERTS.length} items</span>
          </div>
          {ADMIN_ALERTS.map((a, i) => (
            <div key={i} className="row-h" style={{
              display:'grid', gridTemplateColumns:'auto 1fr auto', gap:14,
              padding:'12px 18px', borderBottom: i < ADMIN_ALERTS.length-1 ? '1px solid var(--hairline)' : 'none',
              alignItems:'center',
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 999, display:'flex', alignItems:'center', justifyContent:'center',
                background: a.sev === 'warn' ? 'rgba(255,154,87,0.14)' : a.sev === 'info' ? 'rgba(122,166,255,0.14)' : 'rgba(91,98,113,0.14)',
                color: a.sev === 'warn' ? 'var(--orange)' : a.sev === 'info' ? 'var(--accent)' : 'var(--fg-3)',
                fontSize: 14,
              }}>{a.sev === 'warn' ? '!' : a.sev === 'info' ? 'i' : '·'}</span>
              <div>
                <div style={{fontSize:13, fontWeight:600}}>{a.title}</div>
                <div style={{fontSize:12, color:'var(--fg-2)', marginTop:1}}>{a.detail}</div>
              </div>
              <Btn size="sm" onClick={() => ctx.go(`admin/${a.target}`)}>open →</Btn>
            </div>
          ))}
        </Card>

        <Card pad={0}>
          <div style={{padding:'16px 18px 12px', borderBottom:'1px solid var(--hairline)', display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
            <div>
              <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.4, textTransform:'uppercase', fontWeight:700}}>ACTIVITY</div>
              <div style={{fontSize:16, fontWeight:700, marginTop:2}}>Recent admin events</div>
            </div>
            <Btn size="sm" kind="ghost" onClick={() => ctx.go('admin/audit')}>full log →</Btn>
          </div>
          {ADMIN_RECENT.map((e, i) => (
            <div key={i} className="row-h" style={{
              display:'grid', gridTemplateColumns:'70px 1fr auto', gap:14, alignItems:'center',
              padding:'10px 18px', borderBottom: i < ADMIN_RECENT.length-1 ? '1px solid var(--hairline)' : 'none',
              fontSize: 12,
            }}>
              <span className="mono" style={{color:'var(--fg-3)', fontSize:11}}>{relTime(e.ts)}</span>
              <div>
                <div style={{fontWeight:600, fontSize:12.5}}>{e.cpa}</div>
                <div className="mono" style={{fontSize:10, color:'var(--accent-2)', marginTop:1}}>{e.event} · {e.detail}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function AdminCpas({ ctx }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const filtered = CPAS.filter(c => (filter==='all' || c.status===filter) && (!search || (c.name+c.email).toLowerCase().includes(search.toLowerCase())));
  return (
    <>
      <Section sub="ADMIN · CPAs" title={`All CPAs (${CPAS.length})`}
        right={
          <>
            <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} style={{
              padding:'8px 14px', borderRadius:999, fontSize:12,
              background:'rgba(255,255,255,0.06)', border:'1px solid var(--hairline)', color:'var(--fg)',
              width: 200, fontFamily:'var(--mono)',
            }} />
            <Seg value={filter} onChange={setFilter} options={[
              {id:'all', label:'All'}, {id:'active', label:'Active'}, {id:'inactive', label:'Inactive'},
            ]} />
            <Btn kind="primary" icon="+">Add CPA</Btn>
          </>
        }>
        <Card pad={0}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr>
                {['CPA','Firm','Status','Clients','Locked YTD','Deductions YTD','Last login',''].map((h,i) => {
                  const isNum = ['Clients','Locked YTD','Deductions YTD','Last login'].includes(h);
                  return <th key={i} style={{
                    textAlign: isNum ? 'right' : 'left', padding:'12px 18px',
                    fontSize:10, fontWeight:700, color:'var(--fg-3)', letterSpacing:1.2,
                    textTransform:'uppercase', borderBottom:'1px solid var(--hairline)',
                  }}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} className="row-h" style={{
                  borderBottom: i < filtered.length-1 ? '1px solid var(--hairline)' : 'none',
                  cursor: 'pointer',
                }} onClick={() => ctx.go(`admin/cpas/${c.id}`)}>
                  <td style={{padding:'12px 18px'}}>
                    <div style={{display:'flex', alignItems:'center', gap:11}}>
                      <Avi name={c.name} email={c.email} size={32} />
                      <div>
                        <div style={{fontWeight:600}}>{c.name}</div>
                        <div className="mono" style={{fontSize:11, color:'var(--fg-3)', marginTop:1}}>{c.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{padding:'12px 18px', color:'var(--fg-2)'}}>{c.firm}</td>
                  <td style={{padding:'12px 18px'}}><Pill s={c.status} /></td>
                  <td className="num" style={{padding:'12px 18px', textAlign:'right'}}>{c.clients}</td>
                  <td className="num" style={{padding:'12px 18px', textAlign:'right', color:'var(--green)'}}>{c.locked}</td>
                  <td className="num" style={{padding:'12px 18px', textAlign:'right'}}>{fmtUSD(c.deductionsYTD)}</td>
                  <td className="mono" style={{padding:'12px 18px', textAlign:'right', color:'var(--fg-3)', fontSize:11}}>{relTime(c.lastLogin)}</td>
                  <td style={{padding:'8px 18px', textAlign:'right'}}>
                    <Btn size="sm" kind="purple" onClick={(e)=>{e.stopPropagation(); ctx.impersonateCpa(c.id);}}>Impersonate →</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>
    </>
  );
}

function AdminAudit({ ctx }) {
  const rows = [...ADMIN_RECENT, ...ADMIN_RECENT.map(e => ({...e, ts: new Date(new Date(e.ts).getTime()-86400000).toISOString()}))];
  return (
    <Section sub="ADMIN · AUDIT" title="Cross-firm audit log"
      right={<><Btn>Filter</Btn><Btn icon="↓">Export CSV</Btn></>}>
      <div style={{display:'flex', gap:8, marginBottom:14, flexWrap:'wrap'}}>
        <Tag color="var(--purple)">+actorAdminUserId</Tag>
        <Tag>actor:any</Tag><Tag>events:all</Tag><Tag>last 7d</Tag>
      </div>
      <Card pad={0}>
        {rows.map((e, i) => (
          <div key={i} className="row-h" style={{
            display:'grid', gridTemplateColumns:'130px 160px 200px 1fr', gap: 16,
            padding:'12px 18px', alignItems:'center',
            borderBottom: i < rows.length-1 ? '1px solid var(--hairline)' : 'none',
            fontSize: 12.5,
          }}>
            <span className="mono" style={{color:'var(--fg-3)', fontSize:11}}>{fmtDateTime(e.ts)}</span>
            <span style={{fontWeight:600}}>{e.cpa}</span>
            <Tag color="var(--accent-2)">{e.event}</Tag>
            <span style={{color:'var(--fg-2)'}}>{e.detail}</span>
          </div>
        ))}
      </Card>
    </Section>
  );
}

function AdminSettings() {
  return (
    <Section sub="ADMIN · SETTINGS" title="Platform settings">
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 16}}>
        {[
          ['Pinned RuleVersion', '2026.04.18 (rev. 142)', 'mono'],
          ['Default model — classification', 'claude-sonnet-4.6'],
          ['Default model — memos', 'claude-opus-4.7'],
          ['Default model — PDF cleanup', 'claude-haiku-4.5'],
          ['UPLOAD_BASE_DIR', '/var/taxlens/uploads', 'mono'],
          ['Admin session TTL', '8 hours'],
          ['Idle impersonation drop', '30 minutes'],
          ['Cookie collision policy', 'deepest wins (client > admin > session)'],
        ].map(([k,v,kind], i) => (
          <Card key={i} pad={16}>
            <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom:5}}>{k}</div>
            <div style={{fontSize:14, fontFamily: kind==='mono' ? 'var(--mono)' : 'inherit'}}>{v}</div>
            <div style={{marginTop: 10, fontSize: 11, color:'var(--fg-3)'}}>read-only · mutate via DB script</div>
          </Card>
        ))}
        <Card pad={16} style={{gridColumn:'1 / -1'}}>
          <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom:5}}>Feature flags</div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:10, marginTop:10}}>
            {[
              ['STOP gray-zone autosuggest', true],
              ['Receipt-to-txn linking', true],
              ['Multi-CPA firm roles (V2)', false],
              ['SSO (V2)', false],
              ['Plaid sync (V2)', false],
              ['Email reminders (V2)', false],
            ].map(([k, on], i) => (
              <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0'}}>
                <span style={{fontSize:13}}>{k}</span>
                <Switch on={on} onChange={()=>{}} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Section>
  );
}

// ───────── CPA tier ────────────────────────────────────────────────
function Workspace({ ctx }) {
  const grouped = ['BLOCKER','PENDING','READY','DEADLINE'].map(s => [s, INBOX.filter(i => i.sev === s)]);
  const click = (it) => { ctx.setClient(it.client); ctx.setYear(it.year); ctx.go(`clients/${it.client}/years/${it.year}/${it.target}`); };
  return (
    <>
      <Section sub="WORKSPACE · TRIAGE" title="Inbox"
        right={<span className="mono" style={{fontSize:12, color:'var(--fg-2)'}}>{INBOX.length} items · {new Set(INBOX.map(i=>i.client)).size} clients</span>}>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom: 16}}>
          {grouped.map(([sev, items]) => (
            <Card key={sev} pad={14} style={{minHeight: 0}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 4}}>
                <Pill s={sev} />
                <span className="num" style={{fontSize: 22, fontWeight: 700, color: STATUS[sev].color}}>{items.length}</span>
              </div>
              <div style={{fontSize: 11, color:'var(--fg-3)'}}>
                {sev === 'BLOCKER' && 'must fix before lock'}
                {sev === 'PENDING' && 'awaiting review'}
                {sev === 'READY' && 'queue to lock'}
                {sev === 'DEADLINE' && 'time-sensitive'}
              </div>
            </Card>
          ))}
        </div>
        <Card pad={0}>
          {grouped.map(([sev, items]) => items.length > 0 && (
            <div key={sev}>
              <div style={{
                padding:'10px 18px', display:'flex', alignItems:'center', gap:10,
                background:'rgba(255,255,255,0.02)', borderBottom:'1px solid var(--hairline)',
              }}>
                <Pill s={sev} />
                <span className="mono" style={{fontSize:11, color:'var(--fg-3)'}}>{items.length}</span>
              </div>
              {items.map((it, i) => {
                const cli = CLIENTS_NAJATH.find(c => c.id === it.client);
                return (
                  <button key={i} onClick={() => click(it)} className="row-h" style={{
                    display:'grid', gridTemplateColumns:'200px 60px 1fr 80px',
                    gap:14, padding:'12px 18px', alignItems:'center', width:'100%', textAlign:'left',
                    borderBottom:'1px solid var(--hairline)',
                  }}>
                    <span style={{display:'flex', alignItems:'center', gap:10, minWidth:0}}>
                      <Avi name={cli.name} email={cli.email} size={26} />
                      <span style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{cli.name}</span>
                    </span>
                    <span className="num" style={{color:'var(--fg-2)'}}>{it.year}</span>
                    <span style={{fontSize:13}}>{it.msg}</span>
                    <span className="mono" style={{fontSize:10, color:'var(--fg-3)', textAlign:'right'}}>{it.age}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </Card>
      </Section>

      <Section sub="FIRM · KPIs" title="Practice overview">
        <div style={{display:'flex', gap:12}}>
          <KPI label="Active clients" value="12" sub="of 25 capacity" />
          <KPI label="Locked YTD" value="7" sub="+2 vs last week" accent="var(--green)" />
          <KPI label="Pending lock" value="4" sub="ready or near-ready" accent="var(--accent)" />
          <KPI label="Deductions claimed" value="$318K" sub="across all clients" />
          <KPI label="Avg risk score" value="5.4" sub="weighted by receipts" />
        </div>
      </Section>
    </>
  );
}

function Firm({ ctx }) {
  return (
    <Section sub="WORKSPACE · FIRM" title="Firm overview">
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 16}}>
        <Card>
          <div style={{fontSize:14, fontWeight:700, marginBottom: 12}}>Lock cadence — last 90 days</div>
          {/* Bar chart */}
          <div style={{display:'flex', gap:6, alignItems:'flex-end', height: 130, padding:'8px 0'}}>
            {[2,3,1,4,2,5,3,6,4,7,5,8,6].map((h, i) => (
              <div key={i} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
                <div style={{width:'100%', height: `${h*12}px`, background:`linear-gradient(180deg, var(--accent) 0%, var(--accent-2) 100%)`, borderRadius:6, opacity: 0.3 + h*0.08}} />
                <span className="mono" style={{fontSize:9, color:'var(--fg-3)'}}>W{i+1}</span>
              </div>
            ))}
          </div>
          <div style={{fontSize: 11, color:'var(--fg-3)', marginTop: 8}}>+24% vs prior 90d · 56 locks total</div>
        </Card>
        <Card>
          <div style={{fontSize:14, fontWeight:700, marginBottom: 12}}>Deductions by category</div>
          {[
            ['Travel & lodging', 84200, 'var(--accent)'],
            ['Equipment & supplies', 62100, 'var(--accent-2)'],
            ['Software & subscriptions', 48400, 'var(--purple)'],
            ['Meals (50%)', 31200, 'var(--orange)'],
            ['Phone / utilities', 18900, 'var(--pink)'],
            ['Contract labor', 73620, 'var(--amber)'],
          ].map(([k, v, c], i) => (
            <div key={i} style={{display:'grid', gridTemplateColumns:'180px 1fr 80px', gap: 12, alignItems:'center', padding:'7px 0'}}>
              <span style={{fontSize:12}}>{k}</span>
              <div style={{height:6, borderRadius:999, background:'rgba(255,255,255,0.05)', overflow:'hidden'}}>
                <div style={{height:'100%', width:`${(v/84200)*100}%`, background: c, borderRadius:999}} />
              </div>
              <span className="num" style={{fontSize:12, textAlign:'right', color:'var(--fg-1)'}}>{fmtUSD(v)}</span>
            </div>
          ))}
        </Card>
        <Card style={{gridColumn:'1 / -1'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:12}}>
            <div style={{fontSize:14, fontWeight:700}}>Risk distribution across clients</div>
            <span className="mono" style={{fontSize:11, color:'var(--fg-3)'}}>12 clients · weighted</span>
          </div>
          <div style={{display:'flex', gap: 6, alignItems:'flex-end', height: 80}}>
            {[3,5,2,6,8,4,7,9,5,3,4,6].map((h, i) => {
              const c = h <= 5 ? 'var(--green)' : h <= 10 ? 'var(--amber)' : 'var(--orange)';
              return (
                <div key={i} style={{flex:1, height:`${h*8}px`, background: c, borderRadius:6, opacity: 0.85}} />
              );
            })}
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Calendar({ ctx }) {
  const events = [
    { date: '2026-05-08', label: 'Q1 estimated tax — clients due', type: 'irs' },
    { date: '2026-05-12', label: 'Sara Mendoza — engagement renewal', type: 'firm' },
    { date: '2026-05-15', label: 'Atif Khan — 2025 lock target', type: 'firm' },
    { date: '2026-06-15', label: 'Q2 estimated tax', type: 'irs' },
    { date: '2026-07-31', label: 'Form 5500 (if applicable)', type: 'irs' },
    { date: '2026-09-15', label: 'Q3 estimated tax', type: 'irs' },
    { date: '2026-10-15', label: 'Extended return deadline', type: 'irs' },
  ];
  const today = new Date('2026-05-06');
  const days = Array.from({length: 35}, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - today.getDay() + i);
    return d;
  });
  return (
    <Section sub="WORKSPACE · CALENDAR" title="Deadlines & milestones"
      right={<><Seg value="month" onChange={()=>{}} options={[{id:'week',label:'Week'},{id:'month',label:'Month'},{id:'quarter',label:'Quarter'}]} /><Btn icon="+" kind="primary">Event</Btn></>}>
      <div style={{display:'grid', gridTemplateColumns:'1.6fr 1fr', gap:16}}>
        <Card pad={0}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(7, 1fr)', borderBottom:'1px solid var(--hairline)'}}>
            {['SUN','MON','TUE','WED','THU','FRI','SAT'].map(d => (
              <div key={d} style={{padding:'10px 12px', fontSize:10, fontWeight:700, color:'var(--fg-3)', letterSpacing:1.2}}>{d}</div>
            ))}
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(7, 1fr)'}}>
            {days.map((d, i) => {
              const ds = d.toISOString().split('T')[0];
              const ev = events.filter(e => e.date === ds);
              const isToday = ds === today.toISOString().split('T')[0];
              return (
                <div key={i} style={{
                  minHeight: 80, padding: 8, borderBottom:'1px solid var(--hairline)',
                  borderRight: i % 7 < 6 ? '1px solid var(--hairline)' : 'none',
                  background: isToday ? 'rgba(122,166,255,0.06)' : 'transparent',
                }}>
                  <div className="num" style={{
                    fontSize: 12, fontWeight: isToday ? 700 : 500,
                    color: isToday ? 'var(--accent)' : 'var(--fg-2)',
                    marginBottom: 4,
                  }}>{d.getDate()}</div>
                  {ev.map((e, j) => (
                    <div key={j} style={{
                      fontSize: 10, padding:'2px 6px', borderRadius: 5,
                      background: e.type === 'irs' ? 'rgba(255,107,107,0.16)' : 'rgba(122,166,255,0.16)',
                      color: e.type === 'irs' ? 'var(--red)' : 'var(--accent)',
                      marginBottom: 3, fontWeight: 600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>{e.label}</div>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
        <Card pad={0}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--hairline)', fontSize:14, fontWeight:700}}>Upcoming</div>
          {events.map((e, i) => {
            const d = new Date(e.date);
            return (
              <div key={i} className="row-h" style={{display:'grid', gridTemplateColumns:'56px 1fr', gap: 14, padding:'12px 18px', borderBottom: i < events.length-1 ? '1px solid var(--hairline)' : 'none'}}>
                <div style={{textAlign:'center'}}>
                  <div className="mono" style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1}}>{d.toLocaleString('en-US',{month:'short'}).toUpperCase()}</div>
                  <div className="num" style={{fontSize:22, fontWeight:700, color: e.type === 'irs' ? 'var(--red)' : 'var(--fg)'}}>{d.getDate()}</div>
                </div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:600}}>{e.label}</div>
                  <div style={{fontSize:11, color:'var(--fg-3)', marginTop:2}}>{e.type === 'irs' ? 'IRS deadline' : 'firm milestone'}</div>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </Section>
  );
}

function ClientsMatrix({ ctx }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const years = [2026, 2025, 2024, 2023];
  const filtered = CLIENTS_NAJATH.filter(c => {
    if (filter === 'blockers' && c.blockers === 0) return false;
    if (filter === 'locked' && !Object.values(YEARS_GRID[c.id]).some(y => y && y.status === 'LOCKED')) return false;
    if (search && !(c.name + c.email).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  return (
    <Section sub="CPA · CLIENTS" title={`All clients (${CLIENTS_NAJATH.length})`}
      right={
        <>
          <input placeholder="Search clients…" value={search} onChange={e=>setSearch(e.target.value)} style={{
            padding:'8px 14px', borderRadius:999, fontSize:12,
            background:'rgba(255,255,255,0.06)', border:'1px solid var(--hairline)', color:'var(--fg)',
            width: 220, fontFamily:'var(--mono)',
          }} />
          <Seg value={filter} onChange={setFilter} options={[
            {id:'all', label:'All'}, {id:'blockers', label:'Blockers'}, {id:'locked', label:'Locked YTD'},
          ]} />
          <Btn kind="primary" icon="+">Add client</Btn>
        </>
      }>
      <Card pad={0} style={{overflow:'hidden'}}>
        <div style={{overflow:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize: 13}}>
            <thead>
              <tr style={{background:'rgba(255,255,255,0.02)'}}>
                <th style={{position:'sticky', left:0, background:'rgba(28,32,42,0.95)', padding:'12px 18px', textAlign:'left',
                  fontSize:10, fontWeight:700, color:'var(--fg-3)', letterSpacing:1.2, textTransform:'uppercase',
                  borderBottom:'1px solid var(--hairline)', minWidth: 280, zIndex: 2,
                }}>Client</th>
                <th style={{padding:'12px 18px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--fg-3)', letterSpacing:1.2, textTransform:'uppercase', borderBottom:'1px solid var(--hairline)'}}>Industry</th>
                <th style={{padding:'12px 18px', textAlign:'right', fontSize:10, fontWeight:700, color:'var(--fg-3)', letterSpacing:1.2, textTransform:'uppercase', borderBottom:'1px solid var(--hairline)'}}>Stops</th>
                {years.map(y => (
                  <th key={y} style={{padding:'12px 18px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--fg-3)', letterSpacing:1.2, textTransform:'uppercase', borderBottom:'1px solid var(--hairline)', minWidth: 140}}>{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} className="row-h" style={{borderBottom: i < filtered.length-1 ? '1px solid var(--hairline)' : 'none'}}>
                  <td onClick={() => { ctx.setClient(c.id); ctx.go(`clients/${c.id}`); }} style={{
                    position:'sticky', left:0, background:'rgba(20,24,32,0.95)',
                    padding:'12px 18px', cursor:'pointer', minWidth: 280, zIndex: 1,
                    borderRight:'1px solid var(--hairline)',
                  }}>
                    <div style={{display:'flex', alignItems:'center', gap:11}}>
                      <Avi name={c.name} email={c.email} size={32} />
                      <div style={{minWidth:0}}>
                        <div style={{display:'flex', alignItems:'center', gap:8, fontWeight:600}}>
                          {c.name}
                          {c.blockers > 0 && <span style={{fontSize:9, padding:'1px 6px', borderRadius:999, background:'rgba(255,107,107,0.16)', color:'var(--red)', fontWeight:700}}>B{c.blockers}</span>}
                        </div>
                        <div className="mono" style={{fontSize:10, color:'var(--fg-3)', marginTop:1}}>{c.email} · {c.entity} · {c.state}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{padding:'12px 18px', color:'var(--fg-2)'}}>
                    <div style={{fontSize:12}}>{c.industry}</div>
                    <div className="mono" style={{fontSize:10, color:'var(--fg-3)', marginTop:1}}>NAICS {c.naics}</div>
                  </td>
                  <td className="num" style={{padding:'12px 18px', textAlign:'right'}}>
                    {c.stops > 0 ? <span style={{color:'var(--amber)', fontWeight:600}}>{c.stops}</span> : <span style={{color:'var(--fg-3)'}}>—</span>}
                  </td>
                  {years.map(y => {
                    const data = YEARS_GRID[c.id][y];
                    return (
                      <td key={y} style={{padding: 6}}>
                        {data ? (
                          <button onClick={() => { ctx.setClient(c.id); ctx.setYear(y); ctx.go(`clients/${c.id}/years/${y}`); }} className="row-h" style={{
                            display:'block', width:'100%', textAlign:'left', padding:'8px 12px',
                            borderRadius: 10, background:'rgba(255,255,255,0.025)',
                            border:'1px solid var(--hairline)',
                          }}>
                            <Pill s={data.status} />
                            <div className="num" style={{marginTop: 4, fontSize:12, color:'var(--fg-1)'}}>{fmtUSD(data.deductions)}</div>
                          </button>
                        ) : (
                          <button style={{padding:'10px 12px', fontSize:11, color:'var(--fg-3)', fontFamily:'var(--mono)'}}>+ add year</button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  );
}

function ClientHome({ ctx, clientId }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  const grid = YEARS_GRID[clientId];
  if (!c) return <div style={{padding:24}}>Client not found.</div>;
  return (
    <>
      <Section sub="CPA · CLIENT" title=" "
        right={<>
          <Btn onClick={() => ctx.go(`clients/${clientId}/profile`)}>Profile</Btn>
          <Btn onClick={() => ctx.go(`clients/${clientId}/documents`)}>Documents</Btn>
          <Btn kind="primary" icon="+">New tax year</Btn>
        </>}>
        <Card pad={22}>
          <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:18, alignItems:'center'}}>
            <Avi name={c.name} email={c.email} size={64} />
            <div>
              <h1 style={{margin:0, fontSize: 28, fontWeight: 700, letterSpacing: -0.5}}>{c.name}</h1>
              <div className="mono" style={{fontSize:12, color:'var(--fg-2)', marginTop: 4}}>{c.email}</div>
              <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop: 12}}>
                <Tag>NAICS {c.naics}</Tag>
                <Tag>{c.industry}</Tag>
                <Tag>{c.state}</Tag>
                <Tag>{c.entity}</Tag>
                <Tag color="var(--accent-2)">{c.method}</Tag>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <Section sub="YEARS" title="Tax years">
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12}}>
          {[2026, 2025, 2024, 2023].map(y => {
            const d = grid[y];
            return (
              <Card key={y} pad={16} hoverable={!!d} onClick={() => { if (d) { ctx.setYear(y); ctx.go(`clients/${clientId}/years/${y}`); } }}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                  <div className="num" style={{fontSize: 28, fontWeight: 800, letterSpacing:-0.5}}>{y}</div>
                  {d && <ProgressArc pct={d.status==='LOCKED'?100:d.status==='REVIEW'?70:d.status==='INGESTION'?30:5} size={48} />}
                </div>
                {d ? (
                  <>
                    <div style={{marginTop:10}}><Pill s={d.status} /></div>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop: 12, fontSize:11}}>
                      <div>
                        <div style={{color:'var(--fg-3)', fontSize:10, letterSpacing:1, fontWeight:600}}>RECEIPTS</div>
                        <div className="num" style={{fontSize:13, marginTop:2}}>{fmtUSD(d.receipts)}</div>
                      </div>
                      <div>
                        <div style={{color:'var(--fg-3)', fontSize:10, letterSpacing:1, fontWeight:600}}>DEDUCT.</div>
                        <div className="num" style={{fontSize:13, marginTop:2}}>{fmtUSD(d.deductions)}</div>
                      </div>
                      <div>
                        <div style={{color:'var(--fg-3)', fontSize:10, letterSpacing:1, fontWeight:600}}>NET</div>
                        <div className="num" style={{fontSize:13, marginTop:2, color: d.net < 0 ? 'var(--red)' : 'var(--fg)'}}>{fmtUSD(d.net)}</div>
                      </div>
                      <div>
                        <div style={{color:'var(--fg-3)', fontSize:10, letterSpacing:1, fontWeight:600}}>RISK</div>
                        <div style={{marginTop:4}}><Risk score={d.risk} /></div>
                      </div>
                    </div>
                    {d.lockedAt && <div className="mono" style={{marginTop:12, fontSize:10, color:'var(--green)', display:'flex', alignItems:'center', gap:6}}>● locked {fmtDate(d.lockedAt)}</div>}
                  </>
                ) : (
                  <div style={{marginTop: 26, color:'var(--fg-3)', fontSize:12}}>+ create tax year</div>
                )}
              </Card>
            );
          })}
        </div>
      </Section>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, padding:'8px 28px 28px'}}>
        <Card pad={0}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--hairline)', display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
            <div style={{fontSize:14, fontWeight:700}}>Recent documents</div>
            <Btn size="sm" kind="ghost" onClick={() => ctx.go(`clients/${clientId}/documents`)}>view all →</Btn>
          </div>
          {DOCS_ATIF.slice(0, 5).map((d, i) => (
            <div key={d.id} className="row-h" style={{display:'grid', gridTemplateColumns:'1fr auto auto', gap:12, padding:'10px 18px', alignItems:'center', borderBottom: i<4 ? '1px solid var(--hairline)' : 'none', fontSize:12}}>
              <div>
                <div style={{fontWeight:500}}>{d.title}</div>
                <div style={{fontSize:10, color:'var(--fg-3)', marginTop:2}}>{d.cat}</div>
              </div>
              <span className="num" style={{color:'var(--fg-2)'}}>{d.year}</span>
              <span className="mono" style={{fontSize:10, color:'var(--fg-3)'}}>{relTime(d.at)}</span>
            </div>
          ))}
        </Card>
        <Card pad={0}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--hairline)', fontSize:14, fontWeight:700}}>Recent activity</div>
          {AUDIT_ATIF_2025.slice(0, 5).map((e, i) => (
            <div key={i} style={{padding:'10px 18px', borderBottom: i<4 ? '1px solid var(--hairline)' : 'none', fontSize:12}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:3}}>
                <Tag color="var(--accent-2)">{e.event}</Tag>
                <span className="mono" style={{fontSize:10, color:'var(--fg-3)'}}>{relTime(e.ts)}</span>
              </div>
              <div style={{color:'var(--fg-2)', fontSize:11.5}}>
                {e.actor.type==='AI' ? `${e.actor.model} · ` : ''}
                {e.actor.cpa && `${e.actor.cpa}${e.actor.user ? ' on behalf of ' + e.actor.user : ''}`}
                {e.actor.type==='SYSTEM' && 'System'}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function ClientProfile({ clientId }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  if (!c) return null;
  return (
    <Section sub="CPA · CLIENT · PROFILE" title="Business profile" right={<Btn kind="primary">Edit profile</Btn>}>
      <Card>
        <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:24}}>
          {[
            ['Legal name', c.name], ['Email', c.email],
            ['Entity type', c.entity], ['State of formation', c.state],
            ['NAICS code', c.naics], ['Industry', c.industry],
            ['Accounting method', c.method], ['Tax ID', '***-**-' + (c.id.length*137%10000).toString().padStart(4,'0')],
            ['Engagement letter', 'Signed Feb 1, 2026'], ['Default rule version', '2026.04.18 (rev. 142)'],
          ].map(([k,v], i) => (
            <div key={i} style={{paddingBottom: 12, borderBottom: i < 8 ? '1px solid var(--hairline)' : 'none'}}>
              <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>{k}</div>
              <div style={{fontSize:14, marginTop:4}}>{v}</div>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}

// ───────── Year tier ───────────────────────────────────────────────
function YearOverview({ ctx, clientId, year }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  const data = YEARS_GRID[clientId][year];
  if (!data) return <div style={{padding:24}}>Year not started.</div>;
  const stages = [
    { id:'ingest',  label: 'Ingest',  pct: 88, sub: 'Statements 7/8 · 3 coverage gaps', target: 'upload' },
    { id:'process', label: 'Process', pct: 72, sub: 'Pipeline OK · 4 STOPs open',       target: 'stops'  },
    { id:'review',  label: 'Review',  pct: 30, sub: 'Ledger 73% · Risk pending',         target: 'ledger' },
    { id:'deliver', label: 'Deliver', pct: 0,  sub: 'Lock not started',                  target: 'lock'   },
  ];
  return (
    <>
      <Section sub={`${c.name} · ${year}`} title={`Tax year ${year}`}
        right={<><Pill s={data.status} /><Btn kind="primary" onClick={() => ctx.go(`clients/${clientId}/years/${year}/lock`)}>Lock year →</Btn></>}>
        <div style={{display:'flex', gap:12}}>
          <KPI label="Gross receipts" value={fmtUSD(data.receipts)} sub={`${year} to date`} />
          <KPI label="Deductions" value={fmtUSD(data.deductions)} sub="+8.2% vs 2024" accent="var(--accent)" />
          <KPI label="Net Schedule C" value={fmtUSD(data.net)} sub="receipts − deductions" accent={data.net < 0 ? 'var(--red)' : 'var(--green)'} />
          <KPI label="Risk score" value={data.risk} sub={data.risk <= 5 ? 'low' : data.risk <= 10 ? 'moderate' : 'high'} />
          <KPI label="Open STOPs" value="4" sub="2 blockers" accent="var(--amber)" />
        </div>
      </Section>

      <Section sub="PROGRESS" title="Stages">
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12}}>
          {stages.map(s => (
            <Card key={s.id} pad={18} hoverable onClick={() => ctx.go(`clients/${clientId}/years/${year}/${s.target}`)}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                <div>
                  <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>STAGE</div>
                  <div style={{fontSize:18, fontWeight:700, marginTop:2}}>{s.label}</div>
                </div>
                <ProgressArc pct={s.pct} size={56} />
              </div>
              <div style={{fontSize:11, color:'var(--fg-3)', marginTop: 14}}>{s.sub}</div>
            </Card>
          ))}
        </div>
      </Section>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, padding:'8px 28px 28px'}}>
        <Card pad={0}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--hairline)', fontSize:14, fontWeight:700}}>Year-over-year</div>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
            <thead>
              <tr>
                {['Year','Receipts','Deductions','Net','Risk'].map((h,i) => (
                  <th key={i} style={{padding:'10px 18px', textAlign: i===0 ? 'left' : 'right', fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', borderBottom:'1px solid var(--hairline)'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[2025, 2024, 2023].map(y => {
                const d = YEARS_GRID[clientId][y] || {};
                return (
                  <tr key={y}>
                    <td className="num" style={{padding:'12px 18px', fontWeight:700}}>{y}</td>
                    <td className="num" style={{padding:'12px 18px', textAlign:'right'}}>{fmtUSD(d.receipts)}</td>
                    <td className="num" style={{padding:'12px 18px', textAlign:'right'}}>{fmtUSD(d.deductions)}</td>
                    <td className="num" style={{padding:'12px 18px', textAlign:'right'}}>{fmtUSD(d.net)}</td>
                    <td style={{padding:'12px 18px', textAlign:'right'}}><Risk score={d.risk} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card pad={0}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--hairline)', fontSize:14, fontWeight:700}}>What's in the way</div>
          {INBOX.filter(i => i.client === clientId && i.year === year).map((it, i, arr) => (
            <div key={i} className="row-h" style={{display:'grid', gridTemplateColumns:'auto 1fr auto', gap:14, padding:'12px 18px', alignItems:'center', borderBottom: i < arr.length-1 ? '1px solid var(--hairline)' : 'none'}}>
              <Pill s={it.sev} />
              <span style={{fontSize:13}}>{it.msg}</span>
              <Btn size="sm" onClick={() => ctx.go(`clients/${clientId}/years/${year}/${it.target}`)}>open →</Btn>
            </div>
          ))}
          {INBOX.filter(i => i.client === clientId && i.year === year).length === 0 && (
            <div style={{padding:48, textAlign:'center', color:'var(--fg-3)', fontSize:13}}>No blockers.</div>
          )}
        </Card>
      </div>
    </>
  );
}

function Upload({ ctx, clientId, year }) {
  const [drag, setDrag] = useState(false);
  return (
    <Section sub={`${year} · UPLOAD`} title="Upload statements"
      right={<Btn>Connect bank (V2)</Btn>}>
      <Card
        onDragEnter={e=>{e.preventDefault(); setDrag(true);}}
        onDragLeave={()=>setDrag(false)}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault(); setDrag(false);}}
        style={{
          padding: 48, textAlign:'center',
          border: `2px dashed ${drag ? 'var(--accent)' : 'rgba(255,255,255,0.12)'}`,
          background: drag ? 'rgba(122,166,255,0.06)' : 'rgba(255,255,255,0.02)',
          transition: 'all 200ms ease',
        }}>
        <div style={{
          width: 64, height: 64, borderRadius: 999, margin: '0 auto 14px',
          background: 'linear-gradient(135deg, rgba(122,166,255,0.18), rgba(195,155,255,0.10))',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize: 28,
        }}>↑</div>
        <div style={{fontSize:16, fontWeight:700, marginBottom:6}}>{drag ? 'Drop to upload' : 'Drag PDFs or images here'}</div>
        <div style={{fontSize:12, color:'var(--fg-3)'}}>Bank statements, credit-card statements, processor reports — Haiku will normalize text.</div>
        <div style={{marginTop: 18}}><Btn kind="primary">Choose files</Btn></div>
      </Card>

      <div style={{marginTop: 16}}>
        <div style={{fontSize:14, fontWeight:700, marginBottom: 12}}>Recently uploaded</div>
        <Card pad={0}>
          {[
            { f: 'Chase 4421 2025-03.pdf', size: '1.4 MB', state: 'parsed', n: 47 },
            { f: 'Amex 3007 2025-03.pdf', size: '880 KB', state: 'parsed', n: 32 },
            { f: 'Chase 4421 2025-04.pdf', size: '1.6 MB', state: 'parsing', n: null },
            { f: 'WellsFargo 8821 2025-04.pdf', size: '2.1 MB', state: 'failed', n: null },
          ].map((r, i, arr) => (
            <div key={i} style={{display:'grid', gridTemplateColumns:'30px 1fr 90px 90px 120px', gap:14, padding:'12px 18px', alignItems:'center', borderBottom: i<arr.length-1 ? '1px solid var(--hairline)' : 'none'}}>
              <span style={{
                fontFamily:'var(--mono)', fontSize:9, padding:'2px 5px', borderRadius:4,
                border:'1px solid var(--hairline)', color:'var(--fg-3)', textAlign:'center',
              }}>PDF</span>
              <span style={{fontSize:13}}>{r.f}</span>
              <span className="mono" style={{fontSize:11, color:'var(--fg-3)', textAlign:'right'}}>{r.size}</span>
              <span className="num" style={{fontSize:11, color:'var(--fg-2)', textAlign:'right'}}>{r.n ? `${r.n} txns` : '—'}</span>
              <span style={{textAlign:'right'}}>
                {r.state === 'parsed' && <Pill s="LOCKED">parsed</Pill>}
                {r.state === 'parsing' && <Pill s="INGESTION">parsing…</Pill>}
                {r.state === 'failed' && <Pill s="BLOCKER">failed</Pill>}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </Section>
  );
}

function Coverage({ ctx, year }) {
  const accts = [
    { name: 'Chase Checking 4421', months: [1,1,1,1,0,1,1,1,1,1,0,1] },
    { name: 'Chase Sapphire 0091', months: [1,1,1,1,1,1,1,1,1,1,1,1] },
    { name: 'Amex Gold 3007',      months: [1,1,1,0,1,1,1,1,1,1,1,1] },
    { name: 'Stripe Account',       months: [1,1,1,1,1,1,1,1,1,1,1,1] },
  ];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return (
    <Section sub={`${year} · COVERAGE`} title="Statement coverage"
      right={<><Btn kind="accent2">Auto-fix (V2)</Btn><Btn kind="primary">Request from client</Btn></>}>
      <div style={{display:'flex', gap:12, marginBottom: 16}}>
        <KPI label="Accounts tracked" value="4" />
        <KPI label="Months covered" value="45 / 48" sub="93.8%" accent="var(--accent)" />
        <KPI label="Gaps" value="3" sub="2 require client" accent="var(--red)" />
        <KPI label="Last gap-fill" value="4d ago" sub="Chase 4421 2024-12" />
      </div>
      <Card pad={0}>
        <div style={{display:'grid', gridTemplateColumns:'200px repeat(12, 1fr) 70px', borderBottom:'1px solid var(--hairline)'}}>
          <div style={{padding:'12px 18px', fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>Account</div>
          {months.map(m => (
            <div key={m} style={{padding:'12px 4px', fontSize:10, color:'var(--fg-3)', letterSpacing:1, fontWeight:700, textAlign:'center'}}>{m}</div>
          ))}
          <div style={{padding:'12px 12px', fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textAlign:'right'}}>%</div>
        </div>
        {accts.map(a => {
          const pct = Math.round(a.months.reduce((s,v)=>s+v,0) / 12 * 100);
          return (
            <div key={a.name} style={{display:'grid', gridTemplateColumns:'200px repeat(12, 1fr) 70px', borderBottom:'1px solid var(--hairline)', alignItems:'center'}}>
              <div style={{padding:'12px 18px', fontSize:13, fontWeight:500}}>{a.name}</div>
              {a.months.map((m, i) => (
                <div key={i} style={{padding: 4, display:'flex', justifyContent:'center'}}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 8,
                    background: m ? 'rgba(52,201,138,0.18)' : 'rgba(255,107,107,0.18)',
                    border: `1px solid ${m ? 'rgba(52,201,138,0.4)' : 'rgba(255,107,107,0.5)'}`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color: m ? 'var(--green)' : 'var(--red)', fontSize: 11, fontWeight: 700,
                  }}>{m ? '✓' : '!'}</div>
                </div>
              ))}
              <div className="num" style={{padding:'12px 12px', textAlign:'right', fontWeight:600, color: pct === 100 ? 'var(--green)' : 'var(--amber)'}}>{pct}%</div>
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

function Pipeline({ ctx, year }) {
  const steps = [
    { n: 1, label: 'Normalize PDFs (Haiku)',         status: 'done',    tokens: '12,400', dur: '14s' },
    { n: 2, label: 'Extract transactions',           status: 'done',    tokens: '8,200',  dur: '8s'  },
    { n: 3, label: 'Pair statements & reconcile',    status: 'done',    tokens: '—',      dur: '2s'  },
    { n: 4, label: 'Known-entity match',             status: 'done',    tokens: '—',      dur: '1s'  },
    { n: 5, label: 'Apply merchant rules',           status: 'done',    tokens: '—',      dur: '1s'  },
    { n: 6, label: 'AI classify (Sonnet 4.6)',       status: 'running', tokens: '23,118 / 32,000', dur: '— / 28s' },
    { n: 7, label: 'Compute deductibles',            status: 'pending' },
    { n: 8, label: 'Run assertions A01–A13',         status: 'pending' },
    { n: 9, label: 'Build position memos (Opus 4.7)',status: 'pending' },
  ];
  return (
    <Section sub={`${year} · PIPELINE`} title="Run pipeline"
      right={<><Btn>View logs</Btn><Btn kind="danger">Abort</Btn><Btn kind="primary" disabled>Re-run from step ⋯</Btn></>}>
      <Card style={{marginBottom: 16}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div>
            <div style={{fontSize:14, fontWeight:700}}>Run #2026-05-06-001 · in progress</div>
            <div style={{fontSize:11, color:'var(--fg-3)', marginTop:3, fontFamily:'var(--mono)'}}>started 11:41:08 · ~62% · ETA ~21s</div>
          </div>
          <ProgressArc pct={62} size={64} />
        </div>
      </Card>
      <Card pad={0}>
        {steps.map((s, i) => (
          <div key={s.n} style={{display:'grid', gridTemplateColumns:'40px 1fr 140px 100px 100px', gap:14, padding:'14px 18px', alignItems:'center', borderBottom: i < steps.length-1 ? '1px solid var(--hairline)' : 'none'}}>
            <span style={{
              width:30, height:30, borderRadius:999, display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:'var(--mono)', fontSize:12, fontWeight:700,
              background: s.status === 'done' ? 'rgba(52,201,138,0.16)' : s.status === 'running' ? 'rgba(122,166,255,0.16)' : 'rgba(255,255,255,0.05)',
              color: s.status === 'done' ? 'var(--green)' : s.status === 'running' ? 'var(--accent)' : 'var(--fg-3)',
              border: `1px solid ${s.status === 'done' ? 'rgba(52,201,138,0.4)' : s.status === 'running' ? 'rgba(122,166,255,0.4)' : 'var(--hairline)'}`,
            }}>{s.status === 'done' ? '✓' : s.status === 'running' ? '⟳' : s.n}</span>
            <span style={{fontSize:13, fontWeight:500}}>{s.label}</span>
            <span className="mono" style={{fontSize:11, color:'var(--fg-3)'}}>{s.tokens || '—'}</span>
            <span className="mono" style={{fontSize:11, color:'var(--fg-3)'}}>{s.dur || '—'}</span>
            <span style={{textAlign:'right'}}>
              {s.status === 'done' && <Pill s="LOCKED">done</Pill>}
              {s.status === 'running' && <Pill s="INGESTION">running</Pill>}
              {s.status === 'pending' && <Pill s="CREATED">pending</Pill>}
            </span>
          </div>
        ))}
      </Card>
    </Section>
  );
}

function Ledger({ ctx, year }) {
  const [drawer, setDrawer] = useState(null);
  const total = LEDGER_ATIF_2025.reduce((a,r)=>a+(r.deductible||0),0);
  const receipts = LEDGER_ATIF_2025.reduce((a,r)=>a+(r.credit||0),0);
  const stops = LEDGER_ATIF_2025.filter(r=>r.code==='????').length;
  return (
    <>
      <Section sub={`${year} · LEDGER`} title="Master ledger"
        right={<><Btn icon="↓">XLSX</Btn><Btn>Reclassify</Btn><Btn kind="primary">{stops} STOPs →</Btn></>}>
        <div style={{display:'flex', gap:12, marginBottom: 16}}>
          <KPI label="Receipts" value={fmtUSD(receipts)} sub={`${LEDGER_ATIF_2025.filter(r=>r.credit>0).length} txns`} accent="var(--green)" />
          <KPI label="Deductible total" value={fmtUSD(total)} sub="≡ A03 ≡ FS" />
          <KPI label="STOPs open" value={stops} sub="blocking lock" accent="var(--amber)" />
          <KPI label="Avg confidence" value="87%" sub="0.42 min" />
        </div>
        <Card pad={0} style={{overflow:'hidden'}}>
          <div style={{maxHeight: '52vh', overflow:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize: 12.5}}>
              <thead>
                <tr style={{background:'rgba(20,24,32,0.95)'}}>
                  {[['Date','left'],['Account','left'],['Memo','left'],['Debit','right'],['Credit','right'],['Code','left'],['Category','left'],['Deductible','right'],['Conf','right']].map(([h,al],i) => (
                    <th key={i} style={{
                      padding:'10px 14px', textAlign: al,
                      fontSize:10, fontWeight:700, color:'var(--fg-3)', letterSpacing:1.2, textTransform:'uppercase',
                      position:'sticky', top:0, background:'rgba(20,24,32,0.95)', borderBottom:'1px solid var(--hairline)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LEDGER_ATIF_2025.map((r, i) => {
                  const stop = r.code === '????';
                  return (
                    <tr key={i} onClick={() => setDrawer(r)} className="row-h" style={{
                      borderBottom:'1px solid var(--hairline)', cursor:'pointer',
                      background: stop ? 'rgba(244,196,81,0.04)' : 'transparent',
                    }}>
                      <td className="mono" style={{padding:'9px 14px', color:'var(--fg-2)'}}>{r.date}</td>
                      <td className="mono" style={{padding:'9px 14px', color:'var(--fg-2)', fontSize:11}}>{r.acct}</td>
                      <td style={{padding:'9px 14px'}}>{r.memo}{r.note && <span className="mono" style={{fontSize:10, color:'var(--fg-3)', marginLeft:8}}>· {r.note}</span>}</td>
                      <td className="num" style={{padding:'9px 14px', textAlign:'right', color: r.debit ? 'var(--fg)' : 'var(--fg-3)'}}>{r.debit ? fmtUSD(r.debit, {cents:true}) : '—'}</td>
                      <td className="num" style={{padding:'9px 14px', textAlign:'right', color: r.credit ? 'var(--green)' : 'var(--fg-3)'}}>{r.credit ? fmtUSD(r.credit, {cents:true}) : '—'}</td>
                      <td style={{padding:'9px 14px'}}>{stop ? <Pill s="OPEN">STOP</Pill> : <Tag color="var(--accent-2)">{r.code}</Tag>}</td>
                      <td style={{padding:'9px 14px', color: stop ? 'var(--amber)' : 'var(--fg-1)', fontSize:11.5}}>{r.cat}</td>
                      <td className="num" style={{padding:'9px 14px', textAlign:'right', color: r.deductible > 0 ? 'var(--fg)' : 'var(--fg-3)'}}>{r.deductible > 0 ? fmtUSD(r.deductible, {cents:true}) : '—'}</td>
                      <td className="num" style={{padding:'9px 14px', textAlign:'right', color: r.confidence < 0.6 ? 'var(--amber)' : 'var(--fg-2)', fontSize:11}}>{Math.round(r.confidence*100)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Drawer open={!!drawer} onClose={() => setDrawer(null)} title="Transaction detail">
        {drawer && <TxnDetail r={drawer} />}
      </Drawer>
    </>
  );
}

function TxnDetail({ r }) {
  return (
    <div style={{padding:20, fontSize:13}}>
      <div className="mono" style={{fontSize:11, color:'var(--fg-3)', marginBottom:6}}>{r.date} · {r.acct}</div>
      <div style={{fontSize:18, fontWeight:700, letterSpacing:-0.3, marginBottom:18}}>{r.memo}</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom: 18}}>
        {[
          ['Debit', fmtUSD(r.debit, {cents:true})],
          ['Credit', fmtUSD(r.credit, {cents:true})],
          ['Code', r.code],
          ['Category', r.cat],
          ['Deductible', fmtUSD(r.deductible, {cents:true})],
          ['Confidence', Math.round(r.confidence*100)+'%'],
        ].map(([k,v], i) => (
          <Card key={i} pad={12}>
            <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>{k}</div>
            <div className="num" style={{fontSize:14, marginTop:4}}>{v}</div>
          </Card>
        ))}
      </div>
      <Card pad={14}>
        <div style={{fontSize:10, color:'var(--accent-2)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom:8}}>Audit trail</div>
        <div style={{fontSize:12, color:'var(--fg-1)', lineHeight:1.7}}>
          <div>· classified by sonnet-4.6 · {Math.round(r.confidence*100)}% confidence</div>
          <div>· source: {r.acct} statement · Haiku-cleaned</div>
          <div>· {r.note || 'no overrides'}</div>
        </div>
      </Card>
    </div>
  );
}

function Drawer({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(6px)', WebkitBackdropFilter:'blur(6px)', zIndex:50, animation:'fadeUp 200ms'}}>
      <aside onClick={e=>e.stopPropagation()} className="glass-strong" style={{
        position:'absolute', right: 14, top: 14, bottom: 14, width: 460,
        borderRadius: 18, display:'flex', flexDirection:'column',
      }}>
        <div style={{padding:'16px 20px', borderBottom:'1px solid var(--hairline)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div style={{fontSize:14, fontWeight:700}}>{title}</div>
          <button onClick={onClose} style={{
            width:30, height:30, borderRadius:999, background:'rgba(255,255,255,0.06)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:14,
          }}>✕</button>
        </div>
        <div style={{flex:1, overflow:'auto'}}>{children}</div>
      </aside>
    </div>
  );
}

function Stops({ ctx, clientId, year }) {
  const [stops, setStops] = useState(STOPS_ATIF_2025);
  const [active, setActive] = useState(stops.find(s => s.state === 'OPEN'));
  const [pick, setPick] = useState(null);
  const resolve = () => {
    if (pick == null || !active) return;
    const next = stops.find(s => s.state === 'OPEN' && s.id !== active.id);
    setStops(prev => prev.map(s => s.id === active.id ? { ...s, state: 'RESOLVED', resolution: active.options[pick] } : s));
    setActive(next || null); setPick(null);
  };
  return (
    <div style={{display:'flex', height:'100%', minHeight:0, padding: 20, gap: 12}}>
      <Card pad={0} style={{width: 380, display:'flex', flexDirection:'column', minHeight:0, overflow:'hidden'}}>
        <div style={{padding:'14px 16px', borderBottom:'1px solid var(--hairline)'}}>
          <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>STOPs</div>
          <div style={{fontSize:14, fontWeight:700, marginTop:2}}>{stops.filter(s=>s.state==='OPEN').length} open · {stops.filter(s=>s.state==='RESOLVED').length} resolved</div>
        </div>
        <div style={{flex:1, overflow:'auto'}}>
          {stops.map(s => (
            <button key={s.id} onClick={() => { setActive(s); setPick(null); }} style={{
              display:'block', width:'100%', textAlign:'left',
              padding:'14px 16px', borderBottom:'1px solid var(--hairline)',
              background: active?.id === s.id ? 'rgba(122,166,255,0.06)' : 'transparent',
              borderLeft: active?.id === s.id ? '3px solid var(--accent)' : '3px solid transparent',
              transition: 'all 160ms ease',
            }}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:6}}>
                <Tag color={s.cat==='DEPOSIT'?'var(--accent)':s.cat==='MEAL'?'var(--orange)':'var(--fg-2)'}>{s.cat}</Tag>
                <Pill s={s.state} />
              </div>
              <div style={{fontSize:13, fontWeight:600, marginBottom:3}}>{s.payer}</div>
              <div className="mono" style={{fontSize:11, color:'var(--fg-3)'}}>{s.date} · {fmtUSD(s.amount, {cents:true})}</div>
            </button>
          ))}
        </div>
      </Card>
      <div style={{flex:1, minWidth:0, overflow:'auto'}}>
        {active ? (
          <Card pad={0}>
            <div style={{padding:'18px 22px', borderBottom:'1px solid var(--hairline)', display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
              <div>
                <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>STOP · {active.cat}</div>
                <div style={{fontSize:18, fontWeight:700, marginTop:4}}>{active.payer}</div>
              </div>
              <div style={{display:'flex', gap:8}}>
                <Btn>Skip</Btn>
                <Btn kind="primary" disabled={pick == null || active.state === 'RESOLVED'} onClick={resolve}>Resolve & next →</Btn>
              </div>
            </div>
            <div style={{padding: 22}}>
              <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom: 22}}>
                {[['Date',active.date],['Amount',fmtUSD(active.amount,{cents:true})],['Account',active.acct],['State',active.state]].map(([k,v],i) => (
                  <Card key={i} pad={12}>
                    <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>{k}</div>
                    <div className="num" style={{fontSize:13, marginTop:3}}>{v}</div>
                  </Card>
                ))}
              </div>
              <Card pad={16} style={{background:'rgba(95,212,177,0.06)', borderColor:'rgba(95,212,177,0.22)', marginBottom: 18}}>
                <div style={{fontSize:10, color:'var(--accent-2)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom:6}}>Sonnet-4.6 asks</div>
                <div style={{fontSize:14, lineHeight:1.5}}>{active.q}</div>
              </Card>
              <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom: 10}}>Resolution</div>
              {active.options.map((opt, i) => {
                const isResolved = active.state === 'RESOLVED';
                const sel = isResolved ? i === 0 : pick === i;
                return (
                  <button key={i} onClick={() => !isResolved && setPick(i)} disabled={isResolved} style={{
                    display:'flex', alignItems:'center', gap: 12, width:'100%', textAlign:'left',
                    padding:'14px 18px', marginBottom: 8, borderRadius: 12,
                    background: sel ? 'rgba(122,166,255,0.10)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${sel ? 'var(--accent)' : 'var(--hairline)'}`,
                    transition: 'all 160ms ease', fontSize: 13,
                    cursor: isResolved ? 'default' : 'pointer',
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                      background: sel ? 'var(--accent)' : 'transparent',
                      border: `2px solid ${sel ? 'var(--accent)' : 'rgba(255,255,255,0.18)'}`,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      color:'#0a1428', fontWeight: 800, fontSize: 12,
                    }}>{sel ? '✓' : ''}</span>
                    {opt}
                  </button>
                );
              })}
              {active.state === 'RESOLVED' && (
                <Card pad={14} style={{marginTop: 14, background:'rgba(52,201,138,0.08)', borderColor:'rgba(52,201,138,0.32)', color:'var(--green)'}}>
                  <div style={{fontFamily:'var(--mono)', fontSize:12}}>✓ RESOLVED — {active.resolution || active.options[0]}</div>
                </Card>
              )}
            </div>
          </Card>
        ) : (
          <Card pad={48} style={{textAlign:'center'}}>
            <div style={{fontSize:48, marginBottom:12}}>🎯</div>
            <div style={{fontSize:18, fontWeight:700, marginBottom:8}}>All STOPs cleared.</div>
            <Btn kind="primary" onClick={() => ctx.go(`clients/${clientId}/years/${year}/lock`)}>Continue to Lock →</Btn>
          </Card>
        )}
      </div>
    </div>
  );
}

function RiskPage({ year }) {
  const findings = [
    { sev: 'CRITICAL', code: 'A03', msg: 'Schedule C deductible total mismatch with FS line 28', at: '2025-04-30' },
    { sev: 'HIGH', code: 'A07', msg: 'Meals: 2 transactions w/ insufficient §274(d) attendee data', at: '2025-02-19' },
    { sev: 'MODERATE', code: 'A11', msg: 'Phone allocation 80% — no contemporaneous log on file', at: '2025-03-18' },
    { sev: 'LOW', code: 'A12', msg: 'Equipment >$2,500: confirm de minimis safe harbor election filed', at: '2025-03-15' },
    { sev: 'OK', code: 'A01–A02, A04–A06, A08–A10, A13', msg: 'Pass — no findings', at: null },
  ];
  const sevColor = (s) => s === 'CRITICAL' ? 'var(--red)' : s === 'HIGH' ? 'var(--orange)' : s === 'MODERATE' ? 'var(--amber)' : s === 'LOW' ? 'var(--accent)' : 'var(--green)';
  return (
    <Section sub={`${year} · RISK`} title="Risk & assertions"
      right={<><Btn>Re-run assertions</Btn><Btn kind="primary">Generate position memo</Btn></>}>
      <div style={{display:'grid', gridTemplateColumns:'320px 1fr', gap:16}}>
        <Card pad={20} style={{textAlign:'center'}}>
          <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>Composite risk</div>
          <div style={{position:'relative', width:200, height:200, margin:'14px auto'}}>
            <svg width={200} height={200} style={{transform:'rotate(-90deg)'}}>
              <circle cx={100} cy={100} r={86} stroke="rgba(255,255,255,0.06)" strokeWidth="14" fill="none" />
              <circle cx={100} cy={100} r={86} stroke="var(--amber)" strokeWidth="14" fill="none"
                strokeDasharray={2*Math.PI*86} strokeDashoffset={2*Math.PI*86*(1 - 0.18)} strokeLinecap="round" />
            </svg>
            <div style={{position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'}}>
              <div className="num" style={{fontSize: 56, fontWeight:800, color:'var(--amber)', letterSpacing:-1}}>18</div>
              <div style={{fontSize:11, color:'var(--fg-3)', marginTop:-4, letterSpacing:1, fontWeight:600, textTransform:'uppercase'}}>moderate</div>
            </div>
          </div>
          <div style={{fontSize:12, color:'var(--fg-2)', lineHeight: 1.6}}>1 critical · 1 high · 1 moderate · 1 low · 9 passing</div>
        </Card>
        <Card pad={0}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid var(--hairline)', fontSize:14, fontWeight:700}}>Findings</div>
          {findings.map((f, i) => (
            <div key={i} className="row-h" style={{display:'grid', gridTemplateColumns:'120px 100px 1fr 90px', gap:14, padding:'14px 18px', alignItems:'center', borderBottom: i<findings.length-1 ? '1px solid var(--hairline)' : 'none'}}>
              <span className="pill" style={{background:`${sevColor(f.sev)}1c`, color: sevColor(f.sev), border:`1px solid ${sevColor(f.sev)}55`}}>{f.sev}</span>
              <Tag color="var(--accent-2)">{f.code}</Tag>
              <span style={{fontSize:13}}>{f.msg}</span>
              <span className="mono" style={{fontSize:10, color:'var(--fg-3)', textAlign:'right'}}>{f.at || '—'}</span>
            </div>
          ))}
        </Card>
      </div>
    </Section>
  );
}

function Analytics({ year }) {
  return (
    <Section sub={`${year} · ANALYTICS`} title="Analytics & trends">
      <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:16}}>
        <Card>
          <div style={{fontSize:14, fontWeight:700, marginBottom: 16}}>Monthly receipts vs deductions</div>
          <div style={{display:'flex', alignItems:'flex-end', gap: 8, height: 200}}>
            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => {
              const r = [3120,5240,4200,3187,2800,3400,4100,3600,2900,3200,3800,4400][i];
              const d = [1840,2100,3220,2800,3100,3500,3800,3400,3000,3300,3500,4200][i];
              return (
                <div key={m} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'stretch', gap:3}}>
                  <div style={{display:'flex', gap: 2, alignItems:'flex-end', height: 170}}>
                    <div style={{flex:1, height:`${(r/5240)*100}%`, background:'linear-gradient(180deg, var(--green), var(--accent-2))', borderRadius: 4}} />
                    <div style={{flex:1, height:`${(d/5240)*100}%`, background:'linear-gradient(180deg, var(--accent), var(--purple))', borderRadius: 4}} />
                  </div>
                  <div className="mono" style={{fontSize:9, color:'var(--fg-3)', textAlign:'center', letterSpacing: 0.5}}>{m}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:'flex', gap:18, marginTop: 14, fontSize:11, color:'var(--fg-2)'}}>
            <span style={{display:'flex', alignItems:'center', gap:6}}><span style={{width:10, height:10, borderRadius:3, background:'var(--green)'}}/> Receipts</span>
            <span style={{display:'flex', alignItems:'center', gap:6}}><span style={{width:10, height:10, borderRadius:3, background:'var(--accent)'}}/> Deductions</span>
          </div>
        </Card>
        <Card>
          <div style={{fontSize:14, fontWeight:700, marginBottom: 12}}>Top categories</div>
          {[
            ['Travel', 41200, 'var(--accent)'],
            ['Equipment', 18400, 'var(--accent-2)'],
            ['Software', 8200, 'var(--purple)'],
            ['Phone/util', 4900, 'var(--orange)'],
            ['Meals (50%)', 3600, 'var(--pink)'],
          ].map(([k,v,c], i) => (
            <div key={i} style={{display:'grid', gridTemplateColumns:'90px 1fr 80px', gap:10, alignItems:'center', padding:'8px 0'}}>
              <span style={{fontSize:12}}>{k}</span>
              <div style={{height:5, borderRadius:999, background:'rgba(255,255,255,0.05)'}}>
                <div style={{height:'100%', width:`${(v/41200)*100}%`, background: c, borderRadius:999}} />
              </div>
              <span className="num" style={{fontSize:11.5, textAlign:'right'}}>{fmtUSD(v)}</span>
            </div>
          ))}
        </Card>
      </div>
    </Section>
  );
}

function Lock({ ctx, clientId, year }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  const checks = [
    ['All STOPs resolved', false, '4 open'],
    ['Coverage gaps closed', false, '3 gaps'],
    ['Risk assertions pass / accepted', true, '13/13'],
    ['Position memos generated', true, '2 memos'],
    ['Engagement letter signed', true, 'Feb 1, 2026'],
    ['Form 8879 e-file authorization', false, 'Pending Atif'],
    ['Schedule C totals match (B8)', true, '$40,891 ≡ A03'],
  ];
  const ok = checks.every(([_,v]) => v);
  return (
    <Section sub={`${year} · LOCK`} title="Lock tax year">
      <div style={{display:'grid', gridTemplateColumns:'1fr 360px', gap:16}}>
        <Card pad={0}>
          <div style={{padding:'16px 22px', borderBottom:'1px solid var(--hairline)', fontSize:14, fontWeight:700}}>Pre-flight checks</div>
          {checks.map(([k,v,sub], i) => (
            <div key={i} style={{display:'grid', gridTemplateColumns:'30px 1fr 110px', gap:14, padding:'14px 22px', alignItems:'center', borderBottom: i<checks.length-1 ? '1px solid var(--hairline)' : 'none'}}>
              <span style={{
                width:24, height:24, borderRadius:999, display:'flex', alignItems:'center', justifyContent:'center',
                background: v ? 'rgba(52,201,138,0.18)' : 'rgba(255,107,107,0.16)',
                color: v ? 'var(--green)' : 'var(--red)',
                border: `1px solid ${v ? 'rgba(52,201,138,0.4)' : 'rgba(255,107,107,0.4)'}`,
                fontSize: 12, fontWeight: 800,
              }}>{v ? '✓' : '!'}</span>
              <div>
                <div style={{fontSize:13, fontWeight:500}}>{k}</div>
                <div style={{fontSize:11, color: v ? 'var(--fg-3)' : 'var(--red)', marginTop:1}}>{sub}</div>
              </div>
              {!v && <Btn size="sm">resolve →</Btn>}
            </div>
          ))}
        </Card>
        <div>
          <Card pad={20} style={{textAlign:'center'}}>
            <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase'}}>Locking</div>
            <div style={{fontSize:22, fontWeight:700, marginTop:6}}>{c.name}</div>
            <div className="num" style={{fontSize:38, fontWeight:800, color:'var(--accent)', marginTop:4, letterSpacing:-1}}>{year}</div>
            <div style={{fontSize:12, color:'var(--fg-3)', marginTop:14, lineHeight:1.6}}>
              Locking writes a snapshot to <span className="mono" style={{color:'var(--fg-2)'}}>TaxYear.lockedAt</span>, freezes the master ledger, and produces audit-defensible deliverables.
            </div>
            <Btn kind="primary" disabled={!ok} style={{marginTop:18, width:'100%', justifyContent:'center'}}>
              {ok ? 'Lock 2025 →' : 'Resolve blockers first'}
            </Btn>
            <div style={{fontSize:11, color:'var(--fg-3)', marginTop: 10}}>You can unlock within 30 days with rationale</div>
          </Card>
          <Card pad={16} style={{marginTop: 12}}>
            <div style={{fontSize:12, fontWeight:600, marginBottom: 8}}>What gets generated</div>
            {['Audit packet (PDF, 47 pages)','Master ledger (XLSX)','Schedule C draft (PDF)','Position memos (×2 PDF)','Financial statements (PDF)','Form 8879 request (email)'].map(x => (
              <div key={x} style={{display:'flex', alignItems:'center', gap:8, padding:'4px 0', fontSize:12, color:'var(--fg-2)'}}>
                <span style={{color:'var(--accent-2)'}}>·</span>{x}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Section>
  );
}

function Download({ year }) {
  const files = [
    { kind: 'Audit packet',         f: 'audit-packet-2025.pdf',          size: '4.2 MB', when: '2026-04-30' },
    { kind: 'Master ledger',        f: 'master-ledger-2025.xlsx',        size: '380 KB', when: '2026-04-30' },
    { kind: 'Schedule C',           f: 'schedule-c-2025-draft.pdf',      size: '120 KB', when: '2026-04-30' },
    { kind: 'Position memo: travel',f: 'memo-travel-§162-2025.pdf',      size: '210 KB', when: '2026-04-29' },
    { kind: 'Position memo: phone', f: 'memo-phone-allocation-2025.pdf', size: '180 KB', when: '2026-04-29' },
    { kind: 'Financial statements', f: 'fs-2025.pdf',                    size: '410 KB', when: '2026-04-30' },
    { kind: 'Tax package (zip)',    f: 'taxlens-package-2025.zip',       size: '6.1 MB', when: '2026-04-30' },
  ];
  return (
    <Section sub={`${year} · DOWNLOAD`} title="Deliverables"
      right={<Btn kind="primary" icon="↓">Download all (.zip)</Btn>}>
      <Card pad={0}>
        {files.map((r, i) => (
          <div key={i} className="row-h" style={{display:'grid', gridTemplateColumns:'auto 1fr 90px 110px auto', gap:14, padding:'14px 22px', alignItems:'center', borderBottom: i<files.length-1 ? '1px solid var(--hairline)' : 'none'}}>
            <span style={{
              width:36, height:36, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center',
              background:'rgba(122,166,255,0.10)', color:'var(--accent)', fontSize:11, fontWeight:700, fontFamily:'var(--mono)',
              border:'1px solid rgba(122,166,255,0.25)',
            }}>{r.f.split('.').pop().toUpperCase().slice(0,4)}</span>
            <div>
              <div style={{fontSize:13, fontWeight:600}}>{r.kind}</div>
              <div className="mono" style={{fontSize:11, color:'var(--fg-3)', marginTop:1}}>{r.f}</div>
            </div>
            <span className="mono" style={{fontSize:11, color:'var(--fg-3)', textAlign:'right'}}>{r.size}</span>
            <span className="mono" style={{fontSize:11, color:'var(--fg-3)', textAlign:'right'}}>{fmtDate(r.when)}</span>
            <Btn size="sm">Download</Btn>
          </div>
        ))}
      </Card>
    </Section>
  );
}

function Documents({ ctx, clientId }) {
  const [tab, setTab] = useState('all');
  const [drag, setDrag] = useState(false);
  const cats = ['Statements','Tax forms received','Tax forms issued','Engagement & legal','IRS correspondence','Receipts'];
  const filtered = tab==='all' ? DOCS_ATIF : DOCS_ATIF.filter(d => d.cat === tab);
  return (
    <Section sub="DOCUMENTS" title={`${DOCS_ATIF.length} documents`}
      right={<><Btn icon="↓">Bulk download</Btn><Btn kind="primary" icon="+">Upload</Btn></>}>
      <div style={{display:'flex', gap:8, marginBottom: 14, flexWrap:'wrap'}}>
        <button onClick={() => setTab('all')} className="pill" style={{
          fontSize:12, padding:'6px 14px',
          background: tab==='all' ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
          color: tab==='all' ? '#0a1428' : 'var(--fg-1)',
          fontWeight: 700, cursor:'pointer', border:'1px solid var(--hairline)',
        }}>All · {DOCS_ATIF.length}</button>
        {cats.map(c => (
          <button key={c} onClick={() => setTab(c)} className="pill" style={{
            fontSize:12, padding:'6px 14px',
            background: tab===c ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
            color: tab===c ? '#0a1428' : 'var(--fg-1)',
            fontWeight: 600, cursor:'pointer', border:'1px solid var(--hairline)',
          }}>{c} · {DOCS_ATIF.filter(d => d.cat === c).length}</button>
        ))}
      </div>

      <Card
        onDragEnter={e=>{e.preventDefault(); setDrag(true);}}
        onDragLeave={()=>setDrag(false)}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault(); setDrag(false);}}
        pad={20}
        style={{
          marginBottom: 14, textAlign:'center',
          border: `2px dashed ${drag ? 'var(--accent)' : 'rgba(255,255,255,0.10)'}`,
          background: drag ? 'rgba(122,166,255,0.05)' : 'rgba(255,255,255,0.02)',
        }}
      >
        <div style={{fontSize: 13, color: drag ? 'var(--accent)' : 'var(--fg-3)', fontWeight: 500}}>
          {drag ? 'Release to upload — category will be auto-detected' : 'Drag PDFs here, or click + Upload'}
        </div>
      </Card>

      <Card pad={0}>
        <table style={{width:'100%', borderCollapse:'collapse', fontSize: 13}}>
          <thead>
            <tr>
              {['Title','Category','Year','Tags','Uploaded','Size'].map((h,i)=>(
                <th key={i} style={{padding:'12px 18px', textAlign: i===2 || i===5 ? 'right' : 'left', fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', borderBottom:'1px solid var(--hairline)'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, i) => (
              <tr key={d.id} className="row-h" style={{borderBottom: i<filtered.length-1 ? '1px solid var(--hairline)' : 'none'}}>
                <td style={{padding:'12px 18px'}}>
                  <div style={{display:'flex', alignItems:'center', gap:11}}>
                    <span style={{
                      width:32, height:32, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center',
                      background:'rgba(122,166,255,0.10)', color:'var(--accent)', fontFamily:'var(--mono)', fontSize:10, fontWeight:700,
                      border:'1px solid rgba(122,166,255,0.22)', flexShrink:0,
                    }}>PDF</span>
                    <div>
                      <div style={{fontWeight:500}}>
                        {d.title}
                        {d.sensitive && <span style={{marginLeft: 8, fontSize:9, padding:'1px 7px', borderRadius:999, background:'rgba(255,107,107,0.16)', color:'var(--red)', fontWeight:700, letterSpacing:1}}>SENSITIVE</span>}
                      </div>
                      {d.linkedTxn && <div className="mono" style={{fontSize:10, color:'var(--accent-2)', marginTop:2}}>↗ linked: {d.linkedTxn}</div>}
                    </div>
                  </div>
                </td>
                <td style={{padding:'12px 18px'}}><Tag>{d.cat}</Tag></td>
                <td className="num" style={{padding:'12px 18px', textAlign:'right'}}>{d.year}</td>
                <td style={{padding:'12px 18px'}}><span style={{display:'flex', gap:5, flexWrap:'wrap'}}>{d.tags.map(t => <Tag key={t} color="var(--fg-3)">{t}</Tag>)}</span></td>
                <td className="mono" style={{padding:'12px 18px', color:'var(--fg-3)', fontSize:11}}>{d.by} · {fmtDate(d.at)}</td>
                <td className="mono" style={{padding:'12px 18px', textAlign:'right', color:'var(--fg-3)', fontSize:11}}>{d.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

function AuditTrail({ year }) {
  const [drawer, setDrawer] = useState(null);
  return (
    <>
      <Section sub={`${year} · AUDIT TRAIL`} title={`${AUDIT_ATIF_2025.length} events`}
        right={<><Btn>Filter</Btn><Btn icon="↓">Export CSV</Btn></>}>
        <div style={{display:'flex', gap:8, marginBottom:14, flexWrap:'wrap'}}>
          <Tag>actor:any</Tag><Tag>events:all</Tag><Tag>last 7d</Tag>
        </div>
        <Card pad={0}>
          {AUDIT_ATIF_2025.map((e, i) => (
            <div key={i} className="row-h" style={{
              display:'grid', gridTemplateColumns:'140px 1fr 200px auto', gap: 14,
              padding:'14px 18px', alignItems:'center', cursor:'pointer',
              borderBottom: i<AUDIT_ATIF_2025.length-1 ? '1px solid var(--hairline)' : 'none',
              fontSize:12.5,
            }} onClick={() => setDrawer(e)}>
              <span className="mono" style={{color:'var(--fg-3)', fontSize:11}}>{fmtDateTime(e.ts)}</span>
              <span style={{fontSize:12.5}}>
                {e.actor.type === 'AI' && <Tag color="var(--accent-2)">AI · {e.actor.model}</Tag>}
                {e.actor.type === 'SYSTEM' && <Tag color="var(--fg-3)">SYSTEM</Tag>}
                {e.actor.type === 'USER' && <span><span style={{fontWeight:600}}>{e.actor.cpa}</span> <span style={{color:'var(--fg-3)'}}>on behalf of</span> <span style={{color:'var(--amber)'}}>{e.actor.user}</span></span>}
              </span>
              <Tag color="var(--accent-2)">{e.event}</Tag>
              <Btn size="sm" kind="ghost">peek →</Btn>
            </div>
          ))}
        </Card>
      </Section>
      <Drawer open={!!drawer} onClose={() => setDrawer(null)} title="Audit event">
        {drawer && (
          <div style={{padding: 20}}>
            <div className="mono" style={{fontSize:11, color:'var(--fg-3)'}}>{fmtDateTime(drawer.ts)}</div>
            <div className="mono" style={{fontSize:18, fontWeight:700, color:'var(--accent-2)', marginTop:6, marginBottom: 16}}>{drawer.event}</div>
            <Card pad={14} style={{marginBottom: 12}}>
              <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom: 6}}>Entity</div>
              <div className="mono" style={{fontSize:13}}>{drawer.entity}</div>
            </Card>
            <Card pad={14} style={{marginBottom: 12}}>
              <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom: 6}}>Actor</div>
              {drawer.actor.type === 'USER' && (
                <div style={{fontSize:12, lineHeight:1.7}}>
                  <div>actorCpaUserId · <span style={{color:'var(--accent-2)'}}>{drawer.actor.cpa}</span></div>
                  <div>userId (impersonated) · <span style={{color:'var(--amber)'}}>{drawer.actor.user}</span></div>
                </div>
              )}
              {drawer.actor.type === 'AI' && <div style={{fontSize:12}}>AI · {drawer.actor.model}</div>}
              {drawer.actor.type === 'SYSTEM' && <div style={{fontSize:12}}>System</div>}
            </Card>
            {drawer.diff && (
              <Card pad={14} style={{marginBottom: 12}}>
                <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom: 6}}>Diff</div>
                <pre style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--fg-1)', margin:0, whiteSpace:'pre-wrap'}}>{JSON.stringify(drawer.diff, null, 2)}</pre>
              </Card>
            )}
            <Card pad={14}>
              <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom: 6}}>Rationale</div>
              <div style={{fontSize:13, fontStyle:'italic', color:'var(--fg-1)', lineHeight: 1.6}}>{drawer.rationale}</div>
            </Card>
          </div>
        )}
      </Drawer>
    </>
  );
}

// ───────── Tweaks panel ────────────────────────────────────────────
function FloatingTweaks({ tweaks, setTweaks }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === '__activate_edit_mode') setOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({type:'__edit_mode_available'}, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);
  if (!open) return null;
  return (
    <div className="glass-strong" style={{
      position:'fixed', bottom: 24, right: 24, width: 280, padding: 16,
      borderRadius: 18, zIndex: 100,
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 14}}>
        <div style={{fontSize: 14, fontWeight: 700}}>Tweaks</div>
        <button onClick={() => { setOpen(false); window.parent.postMessage({type:'__edit_mode_dismissed'}, '*'); }} style={{
          width:24, height:24, borderRadius:999, background:'rgba(255,255,255,0.06)', fontSize:12,
        }}>✕</button>
      </div>
      <div style={{fontSize:10, color:'var(--fg-3)', letterSpacing:1.2, fontWeight:700, textTransform:'uppercase', marginBottom: 8}}>Banners</div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0'}}>
        <span style={{fontSize:12.5}}>Show impersonation banners</span>
        <Switch on={tweaks.showBanners} onChange={v => setTweaks(t => ({...t, showBanners: v}))} />
      </div>
      <div style={{fontSize:11, color:'var(--fg-2)', lineHeight:1.5, marginTop: 12, paddingTop: 12, borderTop:'1px solid var(--hairline)'}}>
        Toggle off to preview the CPA workspace as a real CPA login (no impersonation chain). Re-enter from <span className="mono">/admin/cpas</span>.
      </div>
    </div>
  );
}

// ───────── App ─────────────────────────────────────────────────────
function App() {
  const [route, setRoute] = useState({ tier: 'admin', path: ['admin'] });
  const [impersonatedCpa, setImpersonatedCpa] = useState(null);
  const [activeClient, setActiveClient] = useState(null);
  const [activeYear, setActiveYear] = useState(null);
  const [tweaks, setTweaks] = useState({ showBanners: true });

  const go = (path) => {
    const segs = path.split('/').filter(Boolean);
    const tier = segs[0] === 'admin' ? 'admin' : 'cpa';
    setRoute({ tier, path: segs });
    if (segs[0] === 'clients' && segs[1]) setActiveClient(segs[1]);
    if (segs[2] === 'years' && segs[3]) setActiveYear(parseInt(segs[3]));
  };

  const ctx = {
    go, setClient: setActiveClient, setYear: setActiveYear,
    impersonateCpa: (id) => { setImpersonatedCpa(id); setRoute({ tier:'cpa', path: ['workspace'] }); },
    exitCpa: () => { setImpersonatedCpa(null); setActiveClient(null); setActiveYear(null); setRoute({ tier:'admin', path:['admin','cpas'] }); },
    exitClient: () => { setActiveClient(null); setActiveYear(null); setRoute({ tier:'cpa', path:['workspace'] }); },
  };

  const cpa = impersonatedCpa ? CPAS.find(c => c.id === impersonatedCpa) : null;
  const isAdmin = route.tier === 'admin' && !impersonatedCpa;
  const inClientCtx = activeClient && route.path[0] === 'clients';

  return (
    <>
      <TopBar ctx={ctx} cpa={cpa} isAdmin={isAdmin} />
      {tweaks.showBanners && impersonatedCpa && (
        <Banner tone="admin" onExit={ctx.exitCpa} exitLabel="Exit admin ✕">
          <span style={{color:'var(--fg-1)'}}>{ADMIN.name}</span>
          <span style={{margin:'0 8px', color:'var(--fg-3)'}}>→</span>
          <span style={{fontWeight:700}}>acting as CPA · {cpa.name}</span>
        </Banner>
      )}
      {tweaks.showBanners && impersonatedCpa && inClientCtx && activeClient && (
        <Banner tone="cpa" onExit={ctx.exitClient} exitLabel="Exit client ✕">
          <span style={{fontWeight:700}}>{cpa.name}</span>
          <span style={{margin:'0 6px', color:'var(--fg-3)'}}>on behalf of</span>
          <span style={{fontWeight:700}}>{CLIENTS_NAJATH.find(c => c.id === activeClient)?.name}</span>
          <span style={{margin:'0 6px', color:'var(--fg-3)'}}>·</span>
          <span style={{color:'var(--fg-2)'}}>{CLIENTS_NAJATH.find(c => c.id === activeClient)?.email}</span>
        </Banner>
      )}

      <div style={{display:'flex', flex:1, minHeight: 0}}>
        <Sidebar ctx={ctx} route={route} activeClient={activeClient} activeYear={activeYear} isAdmin={isAdmin} />
        <main style={{flex:1, minWidth:0, overflow:'auto', display:'flex', flexDirection:'column'}}>
          {!isAdmin && activeClient && <ContextBar ctx={ctx} clientId={activeClient} year={activeYear} />}
          <div style={{flex:1, minHeight:0}}>
            <Router route={route} ctx={ctx} />
          </div>
        </main>
      </div>
      <FloatingTweaks tweaks={tweaks} setTweaks={setTweaks} />
    </>
  );
}

function Router({ route, ctx }) {
  const p = route.path;
  if (p[0] === 'admin') {
    if (p[1] === 'cpas') return <AdminCpas ctx={ctx} />;
    if (p[1] === 'audit') return <AdminAudit ctx={ctx} />;
    if (p[1] === 'settings') return <AdminSettings />;
    return <AdminHome ctx={ctx} />;
  }
  if (p[0] === 'workspace') {
    if (p[1] === 'firm') return <Firm ctx={ctx} />;
    if (p[1] === 'calendar') return <Calendar ctx={ctx} />;
    return <Workspace ctx={ctx} />;
  }
  if (p[0] === 'clients') {
    if (!p[1]) return <ClientsMatrix ctx={ctx} />;
    const clientId = p[1];
    if (p[2] === 'profile') return <ClientProfile clientId={clientId} />;
    if (p[2] === 'documents') return <Documents ctx={ctx} clientId={clientId} />;
    if (p[2] === 'years' && p[3]) {
      const year = parseInt(p[3]);
      const sub = p[4];
      if (sub === 'upload')      return <Upload ctx={ctx} clientId={clientId} year={year} />;
      if (sub === 'coverage')    return <Coverage ctx={ctx} year={year} />;
      if (sub === 'pipeline')    return <Pipeline ctx={ctx} year={year} />;
      if (sub === 'stops')       return <Stops ctx={ctx} clientId={clientId} year={year} />;
      if (sub === 'ledger')      return <Ledger ctx={ctx} year={year} />;
      if (sub === 'risk')        return <RiskPage year={year} />;
      if (sub === 'analytics')   return <Analytics year={year} />;
      if (sub === 'lock')        return <Lock ctx={ctx} clientId={clientId} year={year} />;
      if (sub === 'download')    return <Download year={year} />;
      if (sub === 'audit-trail') return <AuditTrail year={year} />;
      return <YearOverview ctx={ctx} clientId={clientId} year={year} />;
    }
    return <ClientHome ctx={ctx} clientId={clientId} />;
  }
  return <AdminHome ctx={ctx} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
