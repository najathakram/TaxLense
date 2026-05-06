// Top-level app shell: nav, top-bar, route handling, impersonation state
const { useState: useStateApp, useEffect: useEffectApp } = React;

function App() {
  // route: { tier: 'admin' | 'cpa', path: string[] }
  const [route, setRoute] = useStateApp({ tier: 'admin', path: ['admin'] });
  // impersonation chain
  const [impersonatedCpa, setImpersonatedCpa] = useStateApp(null); // cpa id
  const [activeClient, setActiveClient] = useStateApp(null);
  const [activeYear, setActiveYear] = useStateApp(null);
  const [tweaks, setTweaks] = useStateApp({ showBanners: true });

  // Tweaks panel wiring
  useEffectApp(() => {
    const onMsg = (e) => {
      if (e.data?.type === '__activate_edit_mode') window.__tweaksOpen?.(true);
      if (e.data?.type === '__deactivate_edit_mode') window.__tweaksOpen?.(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({type: '__edit_mode_available'}, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const go = (path) => {
    const segs = path.split('/').filter(Boolean);
    const tier = segs[0] === 'admin' ? 'admin' : 'cpa';
    setRoute({ tier, path: segs });
    // sync active client/year from URL
    if (segs[0] === 'clients' && segs[1]) setActiveClient(segs[1]);
    if (segs[2] === 'years' && segs[3]) setActiveYear(parseInt(segs[3]));
  };

  const ctx = {
    go,
    setClient: setActiveClient,
    setYear: setActiveYear,
    impersonateCpa: (id) => {
      setImpersonatedCpa(id);
      setRoute({ tier: 'cpa', path: ['workspace'] });
    },
    exitCpa: () => {
      setImpersonatedCpa(null);
      setActiveClient(null);
      setActiveYear(null);
      setRoute({ tier: 'admin', path: ['admin', 'cpas'] });
    },
    exitClient: () => {
      setActiveClient(null);
      setActiveYear(null);
      setRoute({ tier: 'cpa', path: ['workspace'] });
    },
  };

  const cpa = impersonatedCpa ? CPAS.find(c => c.id === impersonatedCpa) : null;
  const isAdmin = route.tier === 'admin' && !impersonatedCpa;
  const inClientCtx = activeClient && route.path[0] === 'clients';

  return (
    <>
      <TopBar ctx={ctx} cpa={cpa} isAdmin={isAdmin} />

      {tweaks.showBanners && impersonatedCpa && (
        <ImpersonationBanner tone="admin" onExit={ctx.exitCpa}
          exitLabel="Exit admin ✕">
          <span style={{color:'var(--fg-1)'}}>{ADMIN.name}</span>
          <span style={{margin:'0 8px', color:'var(--fg-3)'}}>→</span>
          <span style={{fontWeight:600}}>acting as CPA: {cpa.name}</span>
        </ImpersonationBanner>
      )}
      {tweaks.showBanners && impersonatedCpa && inClientCtx && activeClient && (
        <ImpersonationBanner tone="cpa" onExit={ctx.exitClient}
          exitLabel="Exit client ✕">
          <span style={{fontWeight:600}}>{cpa.name}</span>
          <span style={{margin:'0 6px', color:'var(--fg-3)'}}>on behalf of</span>
          <span style={{fontWeight:600}}>{CLIENTS_NAJATH.find(c => c.id === activeClient)?.name}</span>
          <span style={{margin:'0 6px', color:'var(--fg-3)'}}>·</span>
          <span style={{color:'var(--fg-2)'}}>{CLIENTS_NAJATH.find(c => c.id === activeClient)?.email}</span>
        </ImpersonationBanner>
      )}

      <div style={{display:'flex', flex:1, minHeight: 0}}>
        {isAdmin
          ? <AdminSidebar ctx={ctx} route={route} />
          : <CpaSidebar ctx={ctx} route={route} activeClient={activeClient} activeYear={activeYear} />}

        <main style={{flex: 1, minWidth: 0, overflow:'auto', display:'flex', flexDirection:'column'}}>
          {/* Context bar (only for client/year context) */}
          {!isAdmin && activeClient && (
            <ContextBar ctx={ctx} clientId={activeClient} year={activeYear} />
          )}
          <div style={{flex:1, minHeight:0}}>
            <Router route={route} ctx={ctx} />
          </div>
        </main>
      </div>

      <TweaksPanelMount tweaks={tweaks} setTweaks={setTweaks} />
    </>
  );
}

function TweaksPanelMount({ tweaks, setTweaks }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { window.__tweaksOpen = setOpen; }, []);
  if (!open) return null;
  return (
    <TweaksPanel onClose={() => setOpen(false)}>
      <TweakSection title="Banners">
        <TweakToggle label="Show impersonation banners" value={tweaks.showBanners}
          onChange={v => setTweaks(t => ({ ...t, showBanners: v }))} />
      </TweakSection>
      <TweakSection title="Notes">
        <div style={{fontSize:11, color:'var(--fg-2)', lineHeight:1.5}}>
          Toggle banners off to see how the CPA workspace looks for a real CPA login (no impersonation chain).
          Re-enter impersonation from <code>/admin/cpas</code>.
        </div>
      </TweakSection>
    </TweaksPanel>
  );
}

// ─── Top bar ───────────────────────────────────────────────────────────
function TopBar({ ctx, cpa, isAdmin }) {
  return (
    <header style={{
      display:'flex', alignItems:'center', height: 40,
      background: 'var(--bg-1)', borderBottom:'1px solid var(--border)',
      padding:'0 12px', gap: 14, flexShrink: 0,
    }}>
      <div style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}
        onClick={() => ctx.go(isAdmin ? 'admin' : 'workspace')}>
        <div style={{
          width: 22, height: 22, background:'var(--accent)',
          color:'#1a1208', display:'flex', alignItems:'center', justifyContent:'center',
          fontWeight:700, fontFamily:'var(--mono)', fontSize: 13,
        }}>T</div>
        <span style={{fontWeight:600, fontSize:13, letterSpacing:0.3}}>TaxLens</span>
        <span style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-3)', letterSpacing:1, padding:'1px 6px', border:'1px solid var(--border)'}}>v6</span>
      </div>
      <div style={{
        display:'flex', alignItems:'center', gap:8, padding:'4px 10px',
        background: 'var(--bg-2)', border:'1px solid var(--border)',
        flex: 1, maxWidth: 460,
      }}>
        <span style={{color:'var(--fg-3)', fontSize:12}}>⌕</span>
        <span style={{fontSize:12, color:'var(--fg-3)', flex:1}}>
          {isAdmin ? 'Search CPAs & clients…' : 'Search clients & years…'}
        </span>
        <Kbd>⌘K</Kbd>
      </div>
      <div style={{flex:1}} />
      <button style={{fontSize:14, color:'var(--fg-2)', padding:'4px 6px'}}>🔔</button>
      <button style={{fontSize:11, fontFamily:'var(--mono)', color:'var(--fg-2)', padding:'4px 6px', border:'1px solid var(--border)'}}>?</button>
      <div style={{
        display:'flex', alignItems:'center', gap:8, padding:'3px 10px',
        background: isAdmin ? 'rgba(157,109,214,0.14)' : 'var(--bg-2)',
        border: `1px solid ${isAdmin ? 'var(--purple)' : 'var(--border-strong)'}`,
      }}>
        <Avatar name={isAdmin ? ADMIN.name : (cpa?.name || 'Najath Akram')} email={isAdmin ? ADMIN.email : (cpa?.email || 'najath@taxlens.app')} size={20} />
        <div style={{fontSize:11, lineHeight:1.2}}>
          <div style={{fontFamily:'var(--mono)', fontSize:9, letterSpacing:1, color: isAdmin ? 'var(--purple)' : 'var(--fg-3)'}}>
            {isAdmin ? 'ADMIN' : cpa ? 'CPA (impersonated)' : 'CPA'}
          </div>
          <div style={{fontWeight:600}}>{isAdmin ? 'Anthropic' : (cpa?.name?.split(' ')[0] || 'Najath')}</div>
        </div>
      </div>
    </header>
  );
}

// ─── Context bar ───────────────────────────────────────────────────────
function ContextBar({ ctx, clientId, year }) {
  const c = CLIENTS_NAJATH.find(x => x.id === clientId);
  const data = year ? YEARS_GRID[clientId]?.[year] : null;
  if (!c) return null;
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:14, padding:'6px 16px',
      background:'var(--bg-1)', borderBottom:'1px solid var(--border)',
      fontSize: 12, fontFamily:'var(--mono)', flexShrink: 0,
    }}>
      <button onClick={() => ctx.go(`clients/${clientId}`)} style={{
        display:'flex', alignItems:'center', gap:8, color:'var(--fg)',
        padding:'2px 8px', border:'1px solid var(--border)', background:'var(--bg-2)',
      }}>
        <Avatar name={c.name} email={c.email} size={16} />
        <span style={{fontWeight:600}}>{c.name}</span>
        <span style={{color:'var(--fg-3)'}}>▾</span>
      </button>
      {year && (
        <>
          <span style={{color:'var(--fg-3)'}}>/</span>
          <button style={{
            color:'var(--fg)', padding:'2px 8px', border:'1px solid var(--border)',
            background:'var(--bg-2)', fontWeight:600,
          }}>{year} ▾</button>
        </>
      )}
      {data && <StatusPill s={data.status} />}
      <div style={{flex:1}} />
      {c.blockers > 0 && (
        <span style={{color:'var(--red)'}}>● {c.blockers} blocker{c.blockers > 1 ? 's' : ''}</span>
      )}
      {c.stops > 0 && (
        <span style={{color:'var(--amber)'}}>◆ {c.stops} STOP{c.stops > 1 ? 's' : ''}</span>
      )}
      <span style={{color:'var(--fg-3)'}}>last action {relTime('2026-05-06T11:42:00Z')}</span>
    </div>
  );
}

// ─── Sidebars ──────────────────────────────────────────────────────────
function AdminSidebar({ ctx, route }) {
  const a = (p) => route.path.join('/') === p;
  return (
    <nav style={{
      width: 220, background:'var(--bg-1)', borderRight:'1px solid var(--border)',
      display:'flex', flexDirection:'column', flexShrink: 0,
    }}>
      <NavGroup label="Admin">
        <NavRow active={a('admin')} onClick={() => ctx.go('admin')} accent="var(--purple)">
          <span style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--purple)', marginRight:8}}>◆</span>
          Dashboard
        </NavRow>
        <NavRow active={a('admin/cpas')} onClick={() => ctx.go('admin/cpas')} badge={CPAS.length} accent="var(--purple)">
          CPAs
        </NavRow>
        <NavRow active={a('admin/audit')} onClick={() => ctx.go('admin/audit')} badge={{text:'HOT', color:'var(--orange)', bg:'transparent'}} accent="var(--purple)">
          Audit log
        </NavRow>
        <NavRow active={a('admin/settings')} onClick={() => ctx.go('admin/settings')} accent="var(--purple)">
          Settings
        </NavRow>
      </NavGroup>
      <div style={{flex:1}} />
      <div style={{padding:'10px 14px', borderTop:'1px solid var(--border)', fontSize:11, color:'var(--fg-3)', fontFamily:'var(--mono)'}}>
        ops@anthropic.com<br/>
        <button style={{color:'var(--fg-2)', marginTop:4}}>sign out</button>
      </div>
    </nav>
  );
}

function CpaSidebar({ ctx, route, activeClient, activeYear }) {
  const a = (p) => route.path.join('/') === p;
  const inClient = activeClient && CLIENTS_NAJATH.find(c => c.id === activeClient);
  const yearStages = [
    { label: 'INGEST', items: [
      { id: 'upload', label: 'Upload', badge: null },
      { id: 'coverage', label: 'Coverage', badge: { text: '3', color: 'var(--red)', bg: 'transparent' } },
    ]},
    { label: 'PROCESS', items: [
      { id: 'pipeline', label: 'Pipeline' },
      { id: 'stops', label: 'STOPs', badge: 4 },
    ]},
    { label: 'REVIEW', items: [
      { id: 'ledger', label: 'Ledger' },
      { id: 'risk', label: 'Risk' },
      { id: 'analytics', label: 'Analytics' },
    ]},
    { label: 'DELIVER', items: [
      { id: 'lock', label: 'Lock' },
      { id: 'download', label: 'Download' },
      { id: 'audit-trail', label: 'Audit trail' },
    ]},
  ];

  return (
    <nav style={{
      width: 240, background:'var(--bg-1)', borderRight:'1px solid var(--border)',
      display:'flex', flexDirection:'column', flexShrink: 0, overflow:'auto',
    }}>
      <NavGroup label="Workspace">
        <NavRow active={a('workspace')} onClick={() => ctx.go('workspace')}>
          <span style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--accent)', marginRight:8}}>●</span>
          Inbox
          <span style={{color:'var(--red)', marginLeft:4, fontSize:10}}>4</span>
        </NavRow>
        <NavRow active={a('workspace/firm')} onClick={() => ctx.go('workspace/firm')}>Firm overview</NavRow>
        <NavRow active={a('workspace/calendar')} onClick={() => ctx.go('workspace/calendar')}>Calendar</NavRow>
      </NavGroup>

      <NavGroup label={`Clients · ${CLIENTS_NAJATH.length}`}>
        <NavRow active={a('clients')} onClick={() => ctx.go('clients')}>
          <span style={{fontFamily:'var(--mono)', fontSize:11, marginRight:8, color:'var(--fg-3)'}}>≡</span>
          All clients
        </NavRow>
        {CLIENTS_NAJATH.slice(0, 6).map(c => (
          <NavRow key={c.id}
            active={activeClient === c.id && route.path.length === 2}
            onClick={() => { ctx.setClient(c.id); ctx.go(`clients/${c.id}`); }}
            badge={c.blockers > 0 ? { text: 'B'+c.blockers, color: 'var(--red)', bg: 'transparent' }
                   : c.stops > 0 ? c.stops : null}>
            <span style={{display:'inline-flex', alignItems:'center', gap:8}}>
              <Avatar name={c.name} email={c.email} size={16} />
              {c.name}
            </span>
          </NavRow>
        ))}
      </NavGroup>

      {inClient && (
        <NavGroup label={`${inClient.name}${activeYear ? ' / ' + activeYear : ''}`}>
          {!activeYear && (
            <NavRow active onClick={() => {}}>Pick a year →</NavRow>
          )}
          {activeYear && (
            <>
              <NavRow active={route.path[4] === undefined && route.path[2] === 'years'}
                onClick={() => ctx.go(`clients/${activeClient}/years/${activeYear}`)}>
                Year overview
              </NavRow>
              <NavRow active={route.path[2] === 'documents'}
                onClick={() => ctx.go(`clients/${activeClient}/documents`)}
                badge={DOCS_ATIF.length}>
                Documents
              </NavRow>
              {yearStages.map(stage => (
                <div key={stage.label}>
                  <div style={{
                    padding:'6px 14px 2px', fontFamily:'var(--mono)', fontSize:9,
                    letterSpacing:1.2, color:'var(--fg-3)', textTransform:'uppercase',
                    display:'flex', alignItems:'center', gap:6,
                  }}>
                    <span>{stage.label}</span>
                    {stage.label === 'PROCESS' && <span style={{color:'var(--red)', fontSize:8}}>●</span>}
                  </div>
                  {stage.items.map(it => (
                    <NavRow key={it.id} indent={1}
                      active={route.path[4] === it.id}
                      onClick={() => ctx.go(`clients/${activeClient}/years/${activeYear}/${it.id}`)}
                      badge={it.badge}>
                      {it.label}
                    </NavRow>
                  ))}
                </div>
              ))}
            </>
          )}
        </NavGroup>
      )}

      <div style={{flex:1}} />
      <div style={{padding:'10px 14px', borderTop:'1px solid var(--border)', fontSize:11, color:'var(--fg-3)', fontFamily:'var(--mono)'}}>
        najath@taxlens.app<br/>
        <button style={{color:'var(--fg-2)', marginTop:4}}>sign out</button>
      </div>
    </nav>
  );
}

// ─── Router ────────────────────────────────────────────────────────────
function Router({ route, ctx }) {
  const p = route.path;
  if (p[0] === 'admin') {
    if (p[1] === 'cpas') return <AdminCpas ctx={ctx} />;
    if (p[1] === 'audit') return <AdminAudit ctx={ctx} />;
    if (p[1] === 'settings') return <Placeholder title="Platform settings" sub="ADMIN / SETTINGS" />;
    return <AdminHome ctx={ctx} />;
  }
  if (p[0] === 'workspace') {
    if (p[1] === 'firm') return <Placeholder title="Firm overview" sub="WORKSPACE / FIRM" />;
    if (p[1] === 'calendar') return <Placeholder title="Calendar" sub="WORKSPACE / CALENDAR" />;
    return <Workspace ctx={ctx} />;
  }
  if (p[0] === 'clients') {
    if (!p[1]) return <ClientsMatrix ctx={ctx} />;
    const clientId = p[1];
    if (p[2] === 'profile') return <ClientProfile ctx={ctx} clientId={clientId} />;
    if (p[2] === 'documents') return <Documents ctx={ctx} clientId={clientId} />;
    if (p[2] === 'years' && p[3]) {
      const year = parseInt(p[3]);
      const sub = p[4];
      if (sub === 'ledger') return <Ledger ctx={ctx} clientId={clientId} year={year} />;
      if (sub === 'stops') return <Stops ctx={ctx} clientId={clientId} year={year} />;
      if (sub === 'audit-trail') return <AuditTrail ctx={ctx} clientId={clientId} year={year} />;
      if (sub === 'upload') return <Placeholder title="Upload statements" sub={`${year} / UPLOAD`} />;
      if (sub === 'coverage') return <Placeholder title="Coverage gaps" sub={`${year} / COVERAGE`} />;
      if (sub === 'pipeline') return <Placeholder title="Pipeline" sub={`${year} / PIPELINE`} />;
      if (sub === 'risk') return <Placeholder title="Risk" sub={`${year} / RISK`} />;
      if (sub === 'analytics') return <Placeholder title="Analytics" sub={`${year} / ANALYTICS`} />;
      if (sub === 'lock') return <Placeholder title="Lock year" sub={`${year} / LOCK`} />;
      if (sub === 'download') return <Placeholder title="Download deliverables" sub={`${year} / DOWNLOAD`} />;
      return <YearOverview ctx={ctx} clientId={clientId} year={year} />;
    }
    return <ClientHome ctx={ctx} clientId={clientId} />;
  }
  return <AdminHome ctx={ctx} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
