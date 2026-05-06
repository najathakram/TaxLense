// UI primitives — Bloomberg-terminal aesthetic
const { useState, useEffect, useRef, useMemo, createContext, useContext } = React;

// ─── Status pill (color + 1-letter code) ───────────────────────────────
const STATUS_MAP = {
  CREATED:   { code: 'C', color: 'var(--fg-3)',   label: 'CREATED' },
  INGESTION: { code: 'I', color: 'var(--blue)',   label: 'INGESTION' },
  REVIEW:    { code: 'R', color: 'var(--amber)',  label: 'REVIEW' },
  LOCKED:    { code: 'L', color: 'var(--green)',  label: 'LOCKED' },
  BLOCKER:   { code: 'B', color: 'var(--red)',    label: 'BLOCKER' },
  PENDING:   { code: 'P', color: 'var(--amber)',  label: 'PENDING' },
  READY:     { code: 'K', color: 'var(--green)',  label: 'READY' },
  DEADLINE:  { code: 'D', color: 'var(--orange)', label: 'DEADLINE' },
  OPEN:      { code: 'O', color: 'var(--amber)',  label: 'OPEN' },
  RESOLVED:  { code: 'R', color: 'var(--green)',  label: 'RESOLVED' },
  active:    { code: '●', color: 'var(--green)',  label: 'ACTIVE' },
  inactive:  { code: '○', color: 'var(--fg-3)',   label: 'INACTIVE' },
};
function StatusPill({ s, mini = false, label }) {
  const m = STATUS_MAP[s] || { code: '?', color: 'var(--fg-3)', label: s };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
      color: m.color, letterSpacing: 0.5,
    }} aria-label={m.label}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, border: `1px solid ${m.color}`,
        background: 'transparent', color: m.color, fontSize: 10,
      }}>{m.code}</span>
      {!mini && <span>{label || m.label}</span>}
    </span>
  );
}

function RiskCell({ score }) {
  if (score == null || score === 0) return <span style={{color:'var(--fg-3)'}}>—</span>;
  const c = score <= 5 ? 'var(--green)' : score <= 10 ? 'var(--amber)' : score <= 20 ? 'var(--orange)' : 'var(--red)';
  return <span className="num" style={{color: c, fontWeight: 600}}>{score}</span>;
}

function Avatar({ name, email, size = 22 }) {
  const hue = avatarHue(email || name);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, fontSize: Math.round(size*0.42), fontWeight: 600,
      background: `oklch(0.32 0.06 ${hue})`,
      color: `oklch(0.86 0.07 ${hue})`,
      border: `1px solid oklch(0.42 0.06 ${hue})`,
      fontFamily: 'var(--mono)', letterSpacing: 0.3, flexShrink: 0,
    }}>{initials(name)}</span>
  );
}

function Kbd({ children }) {
  return <kbd style={{
    fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 5px',
    background: 'var(--bg-2)', border: '1px solid var(--border)',
    color: 'var(--fg-2)', borderRadius: 2,
  }}>{children}</kbd>;
}

// ─── KPI tile ──────────────────────────────────────────────────────────
function KPI({ label, value, delta, deltaPos, sub }) {
  return (
    <div style={{
      flex: 1, padding: '10px 14px', borderRight: '1px solid var(--border)',
      background: 'var(--bg-1)', minWidth: 0,
    }}>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)',
        letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4,
      }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 11 }}>
        {delta != null && (
          <span className="num" style={{ color: deltaPos === false ? 'var(--red)' : 'var(--green)' }}>
            {deltaPos === false ? '▼' : '▲'} {delta}
          </span>
        )}
        {sub && <span style={{ color: 'var(--fg-3)' }}>{sub}</span>}
      </div>
    </div>
  );
}
function KPIStrip({ children }) {
  return (
    <div style={{
      display: 'flex', borderBottom: '1px solid var(--border)',
      borderTop: '1px solid var(--border)',
    }}>{children}</div>
  );
}

// ─── Section header ────────────────────────────────────────────────────
function SectionHeader({ title, sub, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      padding: '14px 16px 8px', borderBottom: '1px solid var(--border)',
      gap: 16,
    }}>
      <div>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.5,
          color: 'var(--fg-3)', textTransform: 'uppercase',
        }}>{sub}</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{title}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{right}</div>
    </div>
  );
}

// ─── Buttons ───────────────────────────────────────────────────────────
function Btn({ children, kind = 'default', onClick, disabled, title, style, icon }) {
  const styles = {
    default: { background: 'var(--bg-2)', border: '1px solid var(--border-strong)', color: 'var(--fg)' },
    primary: { background: 'var(--accent)', border: '1px solid var(--accent)', color: '#1a1208' },
    ghost:   { background: 'transparent', border: '1px solid transparent', color: 'var(--fg-1)' },
    danger:  { background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)' },
    purple:  { background: 'transparent', border: '1px solid var(--purple)', color: 'var(--purple)' },
    amber:   { background: 'transparent', border: '1px solid var(--amber)', color: 'var(--amber)' },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', fontSize: 12, fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...styles[kind], ...style,
    }}>
      {icon}{children}
    </button>
  );
}

// ─── Tag ───────────────────────────────────────────────────────────────
function Tag({ children, color = 'var(--fg-2)' }) {
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px',
      border: `1px solid ${color}`, color, letterSpacing: 0.5,
    }}>{children}</span>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────────
function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', borderBottom: '1px solid var(--border)',
      background: 'var(--bg-1)', paddingLeft: 16, gap: 0,
    }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: '10px 14px', fontSize: 12, fontWeight: 500,
          color: active === t.id ? 'var(--fg)' : 'var(--fg-2)',
          borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
          marginBottom: -1,
          fontFamily: 'var(--mono)', letterSpacing: 0.5,
        }}>
          {t.label}
          {t.badge != null && <span style={{
            marginLeft: 6, fontSize: 10, padding: '1px 5px',
            background: 'var(--bg-3)', color: 'var(--fg-2)',
          }}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Sidebar nav row ───────────────────────────────────────────────────
function NavRow({ children, active, onClick, badge, indent = 0, accent }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%', padding: `4px 12px 4px ${12 + indent * 12}px`,
      fontSize: 12, lineHeight: '20px',
      color: active ? 'var(--fg)' : 'var(--fg-1)',
      background: active ? 'var(--bg-3)' : 'transparent',
      borderLeft: `2px solid ${active ? (accent || 'var(--accent)') : 'transparent'}`,
      textAlign: 'left', minHeight: 24,
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-2)'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {badge != null && (
        <span className="num" style={{
          fontSize: 10, padding: '0 5px', minWidth: 18, textAlign: 'center',
          background: typeof badge === 'object' ? badge.bg : 'var(--bg-3)',
          color: typeof badge === 'object' ? badge.color : 'var(--fg-1)',
          border: typeof badge === 'object' ? `1px solid ${badge.color}` : '1px solid var(--border)',
        }}>{typeof badge === 'object' ? badge.text : badge}</span>
      )}
    </button>
  );
}
function NavGroup({ children, label }) {
  return (
    <div style={{ paddingTop: 8, paddingBottom: 4 }}>
      {label && (
        <div style={{
          padding: '4px 14px 4px', fontFamily: 'var(--mono)', fontSize: 9,
          letterSpacing: 1.2, color: 'var(--fg-3)', textTransform: 'uppercase',
        }}>{label}</div>
      )}
      {children}
    </div>
  );
}

// ─── Table primitive ───────────────────────────────────────────────────
function Table({ columns, rows, onRowClick, emptyText = 'No rows.' }) {
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg-1)' }}>
            {columns.map((c, i) => (
              <th key={i} style={{
                textAlign: c.align || 'left', padding: '7px 12px',
                borderBottom: '1px solid var(--border-strong)',
                fontFamily: 'var(--mono)', fontWeight: 500, fontSize: 10,
                letterSpacing: 1, color: 'var(--fg-3)', textTransform: 'uppercase',
                width: c.w, position: 'sticky', top: 0, background: 'var(--bg-1)',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>{emptyText}</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} onClick={() => onRowClick?.(r)} style={{
              cursor: onRowClick ? 'pointer' : 'default',
              borderBottom: '1px solid var(--border)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; }}
            >
              {columns.map((c, j) => (
                <td key={j} style={{
                  padding: '6px 12px', textAlign: c.align || 'left',
                  fontFamily: c.mono ? 'var(--mono)' : 'inherit',
                  whiteSpace: c.nowrap ? 'nowrap' : 'normal',
                  color: c.muted ? 'var(--fg-2)' : 'inherit',
                  verticalAlign: 'middle',
                }}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Banner row (for impersonation) ────────────────────────────────────
function ImpersonationBanner({ tone, children, onExit, exitLabel }) {
  const c = tone === 'admin' ? 'var(--purple)' : 'var(--amber)';
  const bg = tone === 'admin' ? 'rgba(157,109,214,0.10)' : 'rgba(212,160,23,0.10)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 16px', background: bg,
      borderBottom: `1px solid ${c}`,
      borderTop: `1px solid ${c}`,
      fontFamily: 'var(--mono)', fontSize: 11, color: c, letterSpacing: 0.5,
    }}>
      <div style={{display:'flex', alignItems:'center', gap: 10}}>
        <span style={{
          padding: '1px 6px', border: `1px solid ${c}`,
          background: tone === 'admin' ? 'rgba(157,109,214,0.18)' : 'rgba(212,160,23,0.18)',
          fontWeight: 700, letterSpacing: 1,
        }}>{tone === 'admin' ? 'ADMIN' : 'CPA'}</span>
        <span>{children}</span>
      </div>
      <button onClick={onExit} style={{
        fontFamily: 'var(--mono)', fontSize: 11, color: c,
        border: `1px solid ${c}`, padding: '2px 10px',
        background: 'transparent', letterSpacing: 0.5,
      }}>{exitLabel || 'Exit ✕'}</button>
    </div>
  );
}

// ─── Drawer (right-side audit peek) ────────────────────────────────────
function Drawer({ open, onClose, title, children, width = 420 }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50,
    }}>
      <aside onClick={e => e.stopPropagation()} style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width,
        background: 'var(--bg-1)', borderLeft: '1px solid var(--border-strong)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} style={{ fontSize: 14, color: 'var(--fg-2)' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </aside>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, width = 560 }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width, maxWidth: '92vw', maxHeight: '90vh',
        background: 'var(--bg-1)', border: '1px solid var(--border-strong)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} style={{ fontSize: 14, color: 'var(--fg-2)' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Year-strip cell (used in /clients matrix) ─────────────────────────
function YearCell({ data, onClick }) {
  if (!data) {
    return (
      <button onClick={onClick} style={{
        width: '100%', padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: 11,
        color: 'var(--fg-3)', background: 'transparent', textAlign: 'left',
      }}>+ add year</button>
    );
  }
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '6px 8px', textAlign: 'left',
      background: 'transparent', display: 'flex', flexDirection: 'column', gap: 2,
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <StatusPill s={data.status} mini />
      <span className="num" style={{ fontSize: 11, color: 'var(--fg-1)' }}>
        {fmtUSD(data.deductions)}
      </span>
    </button>
  );
}

Object.assign(window, {
  StatusPill, RiskCell, Avatar, Kbd, KPI, KPIStrip, SectionHeader,
  Btn, Tag, Tabs, NavRow, NavGroup, Table, ImpersonationBanner,
  Drawer, Modal, YearCell, STATUS_MAP,
});
