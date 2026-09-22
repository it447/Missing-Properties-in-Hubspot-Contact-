import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertTriangle, CheckCircle2, Users, UserX } from 'lucide-react'
import { T } from './theme.js'

// ============================================================
// TESTING MODE — login is disabled for now.
//
// This file has NO Google sign-in: instead there's a "Viewing as" dropdown
// (populated from /api/owners) that lets you pick any AE and see what
// their My List / Unowned tabs would show, by passing ?ownerId=... to
// /api/data.
//
// To re-enable real login later:
//   1. src/App.withLogin.jsx.bak has the original sign-in version of this
//      file — restore it (or ask Claude to re-merge it with any changes
//      made here since).
//   2. In api/data.js, swap the query-param block back to the real
//      session check (marked "RE-ENABLE LOGIN HERE" in that file).
//   3. api/auth.js, api/session.js, api/logout.js and api/_auth.js were
//      left untouched the whole time and are ready to use as-is.
// ============================================================

const PROP_LABELS = {
  mql: 'MQL',
  sql: 'SQL',
  sal: 'SAL',
  initial_meeting_outcome: 'Initial Meeting Outcome',
}

function OwnerPicker({ owners, value, onChange }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      style={styles.select}
    >
      <option value="">— Viewing as (pick an AE) —</option>
      {owners.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  )
}

function PropChip({ label }) {
  return (
    <span style={styles.chip}>
      <AlertTriangle size={12} style={{ marginRight: 4 }} />
      {label}
    </span>
  )
}

function ReasonChip({ label }) {
  return (
    <span style={{ ...styles.chip, background: T.warningBg, borderColor: T.warningBorder, color: T.warningText }}>
      <UserX size={12} style={{ marginRight: 4 }} />
      {label}
    </span>
  )
}

function RecordCard({ record, showReasons }) {
  const hasIssues = record.missingContactProps.length > 0 || (showReasons && record.reasons?.length > 0)
  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{record.name}</div>
          {record.email && <div style={{ color: T.cloudMed, fontSize: 13 }}>{record.email}</div>}
        </div>
        {!hasIssues && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: T.green, fontSize: 12 }}>
            <CheckCircle2 size={14} /> Complete
          </span>
        )}
      </div>

      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {record.missingContactProps.map((key) => (
          <PropChip key={key} label={`Missing ${PROP_LABELS[key] || key}`} />
        ))}
        {showReasons && record.reasons?.map((r) => <ReasonChip key={r} label={r} />)}
      </div>

      <div style={styles.dealRow}>
        {record.deal ? (
          <>
            <span style={{ color: T.cloudDark }}>Deal:</span>{' '}
            <span style={{ fontWeight: 500 }}>{record.deal.name}</span>
            {record.deal.stage && <span style={{ color: T.cloudMed }}> · {record.deal.stage}</span>}
            <span style={{ color: T.cloudMed }}> · Owner: {record.deal.ownerName || 'None'}</span>
          </>
        ) : (
          <span style={{ color: T.cloudMed }}>No primary deal found</span>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [owners, setOwners] = useState([])
  const [viewAsOwnerId, setViewAsOwnerId] = useState(null)
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('mine')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/owners')
      .then((res) => (res.ok ? res.json() : { owners: [] }))
      .then((body) => setOwners(body.owners || []))
      .catch(() => setOwners([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = viewAsOwnerId ? `?ownerId=${encodeURIComponent(viewAsOwnerId)}` : ''
      const res = await fetch(`/api/data${qs}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed (${res.status})`)
      }
      setData(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [viewAsOwnerId])

  useEffect(() => { load() }, [load])

  const mine = data?.mine || []
  const unowned = data?.unowned || []
  const active = tab === 'mine' ? mine : unowned

  return (
    <div style={styles.page}>
      <div style={styles.testingBanner}>
        Testing mode — login is disabled. Pick an AE below to preview their view.
      </div>

      <header style={styles.header}>
        <div>
          <h1 style={{ ...styles.title, marginBottom: 8 }}>AE Missing Properties</h1>
          <OwnerPicker owners={owners} value={viewAsOwnerId} onChange={setViewAsOwnerId} />
        </div>
        <button style={styles.iconButton} onClick={load} title="Refresh">
          <RefreshCw size={16} />
        </button>
      </header>

      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(tab === 'mine' ? styles.tabActive : {}) }}
          onClick={() => setTab('mine')}
        >
          <Users size={14} style={{ marginRight: 6 }} />
          My List ({mine.length})
        </button>
        <button
          style={{ ...styles.tab, ...(tab === 'unowned' ? styles.tabActive : {}) }}
          onClick={() => setTab('unowned')}
        >
          <UserX size={14} style={{ marginRight: 6 }} />
          Unowned ({unowned.length})
        </button>
      </div>

      <main style={styles.main}>
        {!viewAsOwnerId && tab === 'mine' && (
          <p style={{ color: T.cloudMed }}>Pick an AE above to see their My List.</p>
        )}
        {loading && <p style={{ color: T.cloudMed }}>Loading…</p>}
        {error && (
          <div style={{ ...styles.card, borderColor: T.criticalBorder, color: T.criticalText }}>
            {error}
          </div>
        )}
        {!loading && !error && viewAsOwnerId !== null && active.length === 0 && tab === 'mine' && (
          <p style={{ color: T.cloudMed }}>No deals owned by this AE in the list right now.</p>
        )}
        {!loading && !error && tab === 'unowned' && active.length === 0 && (
          <p style={{ color: T.cloudMed }}>Nothing unowned right now.</p>
        )}
        {!loading && !error && active.map((r) => (
          <RecordCard key={r.contactId} record={r} showReasons={tab === 'unowned'} />
        ))}
      </main>

      {data?.meta && (
        <footer style={{ color: T.cloudMed, fontSize: 12, padding: '12px 24px' }}>
          List {data.meta.listId} · {data.meta.totalInList} contacts · updated{' '}
          {new Date(data.meta.fetchedAt).toLocaleString()}
        </footer>
      )}
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: T.ivory, color: T.slate },
  testingBanner: {
    background: T.warningBg, borderBottom: `1px solid ${T.warningBorder}`, color: T.warningText,
    fontSize: 13, padding: '8px 24px', textAlign: 'center',
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
    padding: '20px 24px', borderBottom: `1px solid ${T.stone}`,
  },
  select: {
    background: T.oat, border: `1px solid ${T.stone}`, color: T.slate,
    borderRadius: 8, padding: '8px 12px', fontSize: 14, minWidth: 240,
  },
  iconButton: {
    background: T.oat, border: `1px solid ${T.stone}`, color: T.slate,
    borderRadius: 8, padding: 8, cursor: 'pointer', display: 'flex',
  },
  tabs: { display: 'flex', gap: 8, padding: '16px 24px 0' },
  tab: {
    display: 'flex', alignItems: 'center', background: 'transparent', border: 'none',
    color: T.cloudDark, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 14,
  },
  tabActive: { background: T.manilla, color: T.clay, fontWeight: 600 },
  main: { padding: 24, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 900 },
  card: {
    background: T.ivoryLight, border: `1px solid ${T.stone}`, borderRadius: 12, padding: 16,
  },
  dealRow: { marginTop: 10, fontSize: 13 },
  chip: {
    display: 'inline-flex', alignItems: 'center', fontSize: 11.5,
    background: T.criticalBg, border: `1px solid ${T.criticalBorder}`, color: T.criticalText,
    borderRadius: 999, padding: '3px 8px',
  },
}
