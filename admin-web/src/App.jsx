
import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { api, getAdminToken, saveAdminToken, clearAdminToken } from './api'
import './App.css'

const target = 10

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function normalizeCustomer(c) {
  return {
    id: c.id,
    memberCode: c.member_code,
    name: c.full_name,
    phone: c.phone || '',
    visits: Number(c.total_visits || 0),
    stamps: Number(c.loyalty_stamps || 0),
    spent: Number(c.total_spent || 0),
    isActivated: Boolean(c.is_activated),
  }
}

function normalizeVisit(v) {
  return {
    id: v.id,
    customer: v.full_name,
    service: v.service,
    barber: v.barber_name || '—',
    amount: Number(v.amount || 0),
    date: formatDate(v.visited_at),
  }
}

function parseVisitQrPayload(rawPayload) {
  const trimmedPayload = String(rawPayload || '').trim()

  if (!trimmedPayload) {
    return null
  }

  try {
    const parsedUrl = new URL(trimmedPayload)
    const visitPath = parsedUrl.protocol.toLowerCase() === 'barberbro:' &&
      parsedUrl.hostname.toLowerCase() === 'visit'
    const match = visitPath && parsedUrl.pathname.match(/^\/([0-9]+)\/([^/]+)\/?$/)
    const customerId = match ? Number(match[1]) : null
    const params = parsedUrl.searchParams
    const service = String(params.get('service') || '').trim()
    const barber = String(params.get('barber') || '').trim()
    const amountValue = params.get('amount')
    const amount = Number(amountValue)

    if (!customerId || !match?.[2] || !service || !barber ||
        amountValue === null || amountValue.trim() === '' ||
        !Number.isFinite(amount) || amount < 0) {
      return null
    }

    return {
      customer_id: customerId,
      service,
      barber_name: barber,
      amount,
    }
  } catch {
    return null
  }
}

function App() {
  const [token, setToken] = useState(() => getAdminToken())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [customers, setCustomers] = useState([])
  const [visits, setVisits] = useState([])
  const [stats, setStats] = useState({
    total_customers: 0,
    visits_today: 0,
    total_revenue: 0,
  })
  const [search, setSearch] = useState('')
  const [activePage, setActivePage] = useState('Dashboard')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [service, setService] = useState('Classic Haircut')
  const [amount, setAmount] = useState('100')
  const [barber, setBarber] = useState('Michael')
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [qrScanStatus, setQrScanStatus] = useState('')
  const [qrScanPaused, setQrScanPaused] = useState(false)
  const qrScannerRef = useRef(null)
  const qrScanHandledRef = useRef(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [barbers, setBarbers] = useState([])
  const [barberForm, setBarberForm] = useState({ name: '', specialty: '' })
  const [editingBarberId, setEditingBarberId] = useState(null)
  const [barberModalOpen, setBarberModalOpen] = useState(false)
  const [rewardTemplates, setRewardTemplates] = useState([])
  const [rewardForm, setRewardForm] = useState({ name: '', description: '', required_stamps: 10 })
  const [editingRewardId, setEditingRewardId] = useState(null)
  const [rewardModalOpen, setRewardModalOpen] = useState(false)

  const logout = useCallback(() => {
    clearAdminToken()
    setToken('')
    setPassword('')
    setLoginError('')
    setError('')
    setNotice('')
    setActivePage('Dashboard')
  }, [])

  const loadData = useCallback(async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const [dashboard, customerRows, visitRows, barberRows, rewardRows] = await Promise.all([
        api.getDashboard(),
        api.getCustomers(),
        api.getVisits(),
        api.getBarbers(),
        api.getRewardTemplates(),
      ])

      setStats(dashboard)
      setCustomers(customerRows.map(normalizeCustomer))
      setVisits(visitRows.map(normalizeVisit))
      setBarbers(Array.isArray(barberRows) ? barberRows : [])
      setRewardTemplates(Array.isArray(rewardRows) ? rewardRows : [])
    } catch (err) {
      setError(err.message || 'Unable to load BarberBro data.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) {
      setCustomers([])
      setVisits([])
      setStats({ total_customers: 0, visits_today: 0, total_revenue: 0 })
      setLoading(false)
      return
    }

    loadData()
  }, [loadData, token])

  useEffect(() => {
    if (!token) return undefined

    const handleUnauthorized = () => {
      logout()
      setLoginError('Your session expired. Please sign in again.')
    }

    window.addEventListener('barberbro-admin-unauthorized', handleUnauthorized)
    return () => {
      window.removeEventListener('barberbro-admin-unauthorized', handleUnauthorized)
    }
  }, [logout, token])

  const recordVisitFromQr = useCallback(async (payload) => {
    const visitPayload = parseVisitQrPayload(payload)

    if (!visitPayload) {
      setQrScanStatus('This QR is not a valid BarberBro visit ticket.')
      return
    }

    setQrScanStatus('Recording visit from QR...')

    try {
      const response = await api.recordVisit({
        customer_id: visitPayload.customer_id,
        service: visitPayload.service,
        barber_name: visitPayload.barber_name,
        amount: Number(visitPayload.amount),
      })

      setQrScanStatus('')
      setQrScannerOpen(false)
      setNotice(`Visit recorded for ${visitPayload.service} by ${visitPayload.barber_name}.`)
      await loadData()
      return response
    } catch (err) {
      setQrScanStatus(err.message || 'Unable to record the visit from this QR code.')
      return null
    }
  }, [loadData])

  useEffect(() => {
    if (!qrScannerOpen) return undefined

    let cancelled = false
    let startTask
    const scanner = new Html5Qrcode('admin-qr-reader')
    qrScannerRef.current = scanner
    qrScanHandledRef.current = false

    startTask = scanner.start(
      { facingMode: { ideal: 'environment' } },
      { fps: 10, qrbox: { width: 260, height: 260 } },
      async (decodedText) => {
        if (qrScanHandledRef.current) return

        qrScanHandledRef.current = true
        scanner.pause(true)
        setQrScanPaused(true)
        await recordVisitFromQr(decodedText)
      },
      () => {}
    ).then(() => {
      if (!cancelled) {
        setQrScanStatus('Point the camera at the customer visit QR.')
      }
    }).catch((err) => {
      if (!cancelled) {
        setQrScanStatus(
          err.message || 'Unable to start the camera. Allow camera access and try again.'
        )
      }
    })

    return () => {
      cancelled = true
      qrScannerRef.current = null
      startTask.then(async () => {
        if (scanner.isScanning) await scanner.stop()
        scanner.clear()
      }).catch((err) => {
        console.error('Unable to stop the QR scanner cleanly:', err)
      })
    }
  }, [qrScannerOpen, recordVisitFromQr])

  function resumeQrScanner() {
    const scanner = qrScannerRef.current
    if (!scanner?.isScanning) return

    qrScanHandledRef.current = false
    setQrScanPaused(false)
    setQrScanStatus('Point the camera at the customer visit QR.')
    scanner.resume()
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginError('')

    if (!email.trim() || !password) {
      setLoginError('Please enter your admin email and password.')
      return
    }

    setLoginLoading(true)

    try {
      const result = await api.login(email.trim(), password)
      if (!result?.token) {
        throw new Error('The server did not return an admin token.')
      }

      saveAdminToken(result.token)
      setToken(result.token)
      setPassword('')
      setNotice('')
    } catch (err) {
      setLoginError(
        err.message === 'Failed to fetch'
          ? 'Cannot connect to the server. Make sure the backend is running.'
          : err.message
      )
    } finally {
      setLoginLoading(false)
    }
  }

  const rewardTarget = Number(rewardTemplates[0]?.required_stamps ?? target)
  const eligible = customers.filter(c => c.stamps >= rewardTarget).length

  const filteredCustomers = customers.filter(c =>
    `${c.name} ${c.phone} ${c.memberCode}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )

  const filteredVisits = visits.filter(v =>
    `${v.customer} ${v.service} ${v.barber}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )

  function recordVisit(customer) {
    if (customer.stamps >= target) {
      setNotice(`${customer.name} has a reward ready. Redeem it before adding another stamp.`)
      return
    }

    setSelectedCustomer(customer)
    setService('Classic Haircut')
    setAmount('100')
    setBarber('Michael')
    setNotice('')
    setError('')
  }

  async function confirmVisit() {
    if (!selectedCustomer || saving) return

    const price = Number(amount)

    if (!Number.isFinite(price) || price < 0 || amount.trim() === '') {
      setError('Please enter a valid service amount.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    try {
      await api.recordVisit({
        customer_id: selectedCustomer.id,
        service,
        barber_name: barber,
        amount: price,
      })

      setSelectedCustomer(null)
      setNotice(`Visit recorded for ${selectedCustomer.name}. One stamp has been added.`)
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to record visit.')
    } finally {
      setSaving(false)
    }
  }

  async function addCustomer(e) {
    e.preventDefault()
    if (saving) return

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const customer = await api.addCustomer({
        full_name: newName.trim(),
        phone: newPhone.trim() || null,
        email: newEmail.trim() || null,
      })

      setShowAddCustomer(false)
      setNewName('')
      setNewPhone('')
      setNewEmail('')
      setSearch('')
      setNotice(`${customer.full_name} has been added successfully.`)
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to add customer.')
    } finally {
      setSaving(false)
    }
  }

  async function createActivationCode(customer) {
    if (!customer || saving) return

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const result = await api.createActivationCode(customer.id)
      setNotice(
        `${customer.name} can activate with member code ${result.member_code} and code ${result.code}.`
      )
    } catch (err) {
      setError(err.message || 'Failed to create activation code.')
    } finally {
      setSaving(false)
    }
  }

  async function redeemReward(customer) {
    if (customer.stamps < target || saving) return

    const confirmed = window.confirm(
      `Redeem the loyalty reward for ${customer.name}? This will reset their ${target} stamps.`
    )

    if (!confirmed) return

    setSaving(true)
    setError('')
    setNotice('')

    try {
      await api.redeemReward(customer.id)
      setNotice(`Reward redeemed for ${customer.name}.`)
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to redeem reward.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCustomer(customer) {
    if (!customer || saving) return

    const confirmed = window.confirm(
      `Delete ${customer.name} (${customer.memberCode})? This will remove the customer record and all related visit history.`
    )

    if (!confirmed) return

    setSaving(true)
    setError('')
    setNotice('')

    try {
      await api.deleteCustomer(customer.id)
      setNotice(`${customer.name} has been deleted from the system.`)
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to delete customer.')
    } finally {
      setSaving(false)
    }
  }

  function openBarberModal(barber = null) {
    if (barber) {
      setEditingBarberId(barber.id)
      setBarberForm({ name: barber.name, specialty: barber.specialty || '' })
    } else {
      setEditingBarberId(null)
      setBarberForm({ name: '', specialty: '' })
    }
    setBarberModalOpen(true)
  }

  async function saveBarber(event) {
    event.preventDefault()
    if (saving) return

    const name = barberForm.name.trim()
    if (!name) {
      setError('Barber name is required.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    try {
      if (editingBarberId) {
        await api.updateBarber(editingBarberId, barberForm)
        setNotice('Barber updated successfully.')
      } else {
        await api.addBarber(barberForm)
        setNotice('Barber added successfully.')
      }

      setBarberModalOpen(false)
      setEditingBarberId(null)
      setBarberForm({ name: '', specialty: '' })
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to save barber.')
    } finally {
      setSaving(false)
    }
  }

  async function removeBarber(barber) {
    if (!barber || saving) return

    const confirmed = window.confirm(`Remove ${barber.name} from the barber list?`)
    if (!confirmed) return

    setSaving(true)
    setError('')
    setNotice('')

    try {
      await api.deleteBarber(barber.id)
      setNotice(`${barber.name} has been removed.`)
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to remove barber.')
    } finally {
      setSaving(false)
    }
  }

  function openRewardModal(reward = null) {
    if (reward) {
      setEditingRewardId(reward.id)
      setRewardForm({
        name: reward.name,
        description: reward.description || '',
        required_stamps: Number(reward.required_stamps || 10),
      })
    } else {
      setEditingRewardId(null)
      setRewardForm({ name: '', description: '', required_stamps: 10 })
    }
    setRewardModalOpen(true)
  }

  async function saveReward(event) {
    event.preventDefault()
    if (saving) return

    const name = rewardForm.name.trim()
    if (!name) {
      setError('Reward name is required.')
      return
    }

    const requiredStamps = Number(rewardForm.required_stamps)
    if (!Number.isFinite(requiredStamps) || requiredStamps <= 0) {
      setError('Required stamps must be a positive number.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    try {
      if (editingRewardId) {
        await api.updateRewardTemplate(editingRewardId, rewardForm)
        setNotice('Reward updated successfully.')
      } else {
        await api.addRewardTemplate(rewardForm)
        setNotice('Reward added successfully.')
      }

      setRewardModalOpen(false)
      setEditingRewardId(null)
      setRewardForm({ name: '', description: '', required_stamps: 10 })
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to save reward.')
    } finally {
      setSaving(false)
    }
  }

  async function removeReward(reward) {
    if (!reward || saving) return

    const confirmed = window.confirm(`Remove the ${reward.name} reward template?`)
    if (!confirmed) return

    setSaving(true)
    setError('')
    setNotice('')

    try {
      await api.deleteRewardTemplate(reward.id)
      setNotice(`${reward.name} has been removed.`)
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to remove reward.')
    } finally {
      setSaving(false)
    }
  }

  if (!token) {
    return (
      <div className="admin-app admin-login-shell">
        <main className="admin-login-card">
          <div className="admin-login-brand">
            <div className="admin-login-mark">B<span>.</span></div>
            <div>
              <div className="admin-login-wordmark">BARBER<span>BRO</span></div>
              <div className="admin-login-subtitle">MANAGEMENT PORTAL</div>
            </div>
          </div>

          <div className="admin-login-eyebrow"><span /> ADMIN ACCESS</div>
          <h1>Welcome <span>back.</span></h1>
          <p className="admin-login-copy">
            Sign in to manage memberships, visits, rewards, and daily shop activity.
          </p>

          <form className="admin-login-form" onSubmit={handleLogin}>
            <label htmlFor="admin-email">Email address</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              placeholder="admin@example.com"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
            />

            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />

            {loginError && <p className="admin-login-error">{loginError}</p>}

            <button className="admin-primary admin-login-button" type="submit" disabled={loginLoading}>
              {loginLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </main>
      </div>
    )
  }

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <a href="#dashboard" className="admin-brand">
          <span className="admin-brand-icon">B</span>
          <span>Barber<span className="admin-gold">Bro.</span></span>
        </a>

        <p className="admin-nav-label">WORKSPACE</p>

        {[
          ['Dashboard', '▦'],
          ['Customers', '♙'],
          ['Barbers', '✂'],
          ['Visit History', '◷'],
          ['Rewards', '✦'],
        ].map(([page, icon]) => (
          <button
            key={page}
            className={`admin-nav-item ${activePage === page ? 'selected' : ''}`}
            onClick={() => {
              setActivePage(page)
              setNotice('')
              setError('')
            }}
          >
            <span>{icon}</span>{page}
          </button>
        ))}

        <div className="admin-sidebar-footer">
          <div className="admin-avatar">MM</div>
          <div>
            <strong>Michael Malveda</strong>
            <span>Shop Owner</span>
          </div>
        </div>
        <button className="admin-logout-button" onClick={logout}>Log out</button>
      </aside>

      <main className="admin-main" id="dashboard">
        <header className="admin-topbar">
          <div>
            <p className="admin-breadcrumb">
              Michael's Barbershop / <strong>{activePage}</strong>
            </p>
            <h1>{activePage}</h1>
          </div>
          <div className="admin-open-label"><span /> Management Portal</div>
        </header>

        {notice && (
          <div className="admin-notice">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss message">×</button>
          </div>
        )}

        {error && (
          <div className="admin-notice" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss error">×</button>
          </div>
        )}

        {loading && <p className="admin-empty">Loading data from BarberBro database...</p>}

        {!loading && error && (
          <button className="admin-outline" onClick={loadData}>Try again</button>
        )}

        {activePage === 'Dashboard' && !loading && (
          <>
            <section className="admin-welcome">
              <div>
                <p className="admin-eyebrow">SHOP OVERVIEW</p>
                <h2>Good day, Michael <span>✦</span></h2>
                <p>Here's what's happening with your membership program.</p>
              </div>
              <button className="admin-primary" onClick={() => setActivePage('Customers')}>
                ＋ Record a Visit
              </button>
            </section>

            <section className="admin-stats">
              <article>
                <span className="admin-stat-icon">♙</span>
                <p>Total Members</p>
                <strong>{stats.total_customers}</strong>
                <small>Registered customers</small>
              </article>
              <article>
                <span className="admin-stat-icon">✂</span>
                <p>Visits Today</p>
                <strong>{stats.visits_today}</strong>
                <small>Recorded haircuts today</small>
              </article>
              <article>
                <span className="admin-stat-icon">₱</span>
                <p>Recorded Sales</p>
                <strong>₱{formatMoney(stats.total_revenue)}</strong>
                <small>Total recorded visit sales</small>
              </article>
              <article>
                <span className="admin-stat-icon">✦</span>
                <p>Rewards Ready</p>
                <strong>{eligible}</strong>
                <small>Members with {target} stamps</small>
              </article>
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><h2>Customer Memberships</h2><p>Search members and record completed haircuts.</p></div>
                <button className="admin-outline" onClick={() => setActivePage('Customers')}>All customers →</button>
              </div>
              <CustomerTable
                customers={filteredCustomers.slice(0, 5)}
                onRecord={recordVisit}
                onRedeem={redeemReward}
                onCreateCode={createActivationCode}
                onDelete={deleteCustomer}
              />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><h2>Recent Visits</h2><p>Latest recorded haircut activity.</p></div>
                <button className="admin-outline" onClick={() => setActivePage('Visit History')}>View history →</button>
              </div>
              <VisitTable visits={visits.slice(0, 5)} />
            </section>
          </>
        )}

        {activePage === 'Barbers' && !loading && (
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div><h2>Barber Directory</h2><p>Manage the barbers available for customer visits.</p></div>
              <button className="admin-primary" onClick={() => openBarberModal()}>＋ Add Barber</button>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>NAME</th><th>SPECIALTY</th><th>ACTION</th></tr></thead>
                <tbody>
                  {barbers.map((barber) => (
                    <tr key={barber.id}>
                      <td><strong>{barber.name}</strong></td>
                      <td>{barber.specialty || 'General barber'}</td>
                      <td className="admin-actions">
                        <div className="admin-action-stack">
                          <button className="admin-action-button" onClick={() => openBarberModal(barber)}>Edit</button>
                          <button className="admin-action-button admin-delete-button" onClick={() => removeBarber(barber)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {barbers.length === 0 && <p className="admin-empty">No barbers have been added yet.</p>}
          </section>
        )}

        {activePage === 'Customers' && !loading && (
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div><h2>Customer Directory</h2><p>Find members and manage their accounts.</p></div>
              <div className="admin-action-group">
                <button
                  className="admin-outline"
                  onClick={() => {
                    setQrScanStatus('Starting camera...')
                    setQrScanPaused(false)
                    setQrScannerOpen(true)
                  }}
                >
                  ◉ Scan Visit QR
                </button>
                <button className="admin-primary" onClick={() => setShowAddCustomer(true)}>＋ Add Customer</button>
              </div>
            </div>
            <SearchBox search={search} setSearch={setSearch} />
            <CustomerTable
              customers={filteredCustomers}
              rewardTarget={rewardTarget}
              onRedeem={redeemReward}
              onCreateCode={createActivationCode}
              onDelete={deleteCustomer}
            />
            <p className="admin-demo-note">Customer records are stored in your database.</p>
          </section>
        )}

        {activePage === 'Visit History' && !loading && (
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div><h2>Visit History</h2><p>Haircuts recorded in the database.</p></div>
            </div>
            <SearchBox search={search} setSearch={setSearch} />
            <VisitTable visits={filteredVisits} />
          </section>
        )}

        {activePage === 'Rewards' && !loading && (
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div><h2>Loyalty Rewards</h2><p>Reward tiers available to your members.</p></div>
              <button className="admin-primary" onClick={() => openRewardModal()}>＋ Add Reward</button>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>REWARD</th><th>REQUIRED STAMPS</th><th>DESCRIPTION</th><th>ACTION</th></tr></thead>
                <tbody>
                  {rewardTemplates.map((reward) => (
                    <tr key={reward.id}>
                      <td><strong>{reward.name}</strong></td>
                      <td>{reward.required_stamps} stamps</td>
                      <td>{reward.description || 'No description'}</td>
                      <td className="admin-actions">
                        <div className="admin-action-stack">
                          <button className="admin-action-button" onClick={() => openRewardModal(reward)}>Edit</button>
                          <button className="admin-action-button admin-delete-button" onClick={() => removeReward(reward)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rewardTemplates.length === 0 && <p className="admin-empty">No reward templates have been created yet.</p>}

            <div className="admin-panel" style={{ marginTop: 24 }}>
              <div className="admin-panel-heading">
                <div><h2>Eligible members</h2><p>Members that already meet the current reward threshold.</p></div>
              </div>
              <CustomerTable
                customers={customers.filter(c => c.stamps >= rewardTarget)}
                rewardTarget={rewardTarget}
                onRedeem={redeemReward}
                onCreateCode={createActivationCode}
                onDelete={deleteCustomer}
              />
              {eligible === 0 && <p className="admin-empty">No rewards are ready to redeem right now.</p>}
            </div>
          </section>
        )}

        <footer className="admin-footer">
          BarberBro Management System · Michael's Barbershop
        </footer>
      </main>

      {qrScannerOpen && (
        <div className="admin-modal-backdrop" onClick={() => setQrScannerOpen(false)}>
          <div className="admin-modal qr-scan-modal" onClick={e => e.stopPropagation()}>
            <button type="button" className="admin-modal-close" onClick={() => setQrScannerOpen(false)}>×</button>
            <p className="admin-eyebrow">CUSTOMER VISIT</p>
            <h2>Scan to record visit</h2>
            <p className="admin-scan-instructions">
              Point the camera at the visit QR in the customer app. The visit details will be recorded automatically.
            </p>
            <div id="admin-qr-reader" />
            {qrScanPaused && (
              <button type="button" className="admin-outline admin-scan-again" onClick={resumeQrScanner}>
                Scan another QR
              </button>
            )}
            {qrScanStatus && <p className="admin-login-error">{qrScanStatus}</p>}
          </div>
        </div>
      )}

      {barberModalOpen && (
        <div className="admin-modal-backdrop" onClick={() => !saving && setBarberModalOpen(false)}>
          <form className="admin-modal" onSubmit={saveBarber} onClick={e => e.stopPropagation()}>
            <button type="button" className="admin-modal-close" disabled={saving} onClick={() => setBarberModalOpen(false)}>×</button>
            <p className="admin-eyebrow">STAFF</p>
            <h2>{editingBarberId ? 'Edit Barber' : 'Add Barber'}</h2>

            <label>Barber name
              <input required maxLength="120" value={barberForm.name} onChange={e => setBarberForm((current) => ({ ...current, name: e.target.value }))} placeholder="Michael" />
            </label>

            <label>Specialty (optional)
              <input maxLength="120" value={barberForm.specialty} onChange={e => setBarberForm((current) => ({ ...current, specialty: e.target.value }))} placeholder="Fade / Beard trim" />
            </label>

            <button className="admin-primary admin-confirm" type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingBarberId ? 'Update Barber' : 'Save Barber'}
            </button>
          </form>
        </div>
      )}

      {rewardModalOpen && (
        <div className="admin-modal-backdrop" onClick={() => !saving && setRewardModalOpen(false)}>
          <form className="admin-modal" onSubmit={saveReward} onClick={e => e.stopPropagation()}>
            <button type="button" className="admin-modal-close" disabled={saving} onClick={() => setRewardModalOpen(false)}>×</button>
            <p className="admin-eyebrow">LOYALTY</p>
            <h2>{editingRewardId ? 'Edit Reward' : 'Add Reward'}</h2>

            <label>Reward name
              <input required maxLength="120" value={rewardForm.name} onChange={e => setRewardForm((current) => ({ ...current, name: e.target.value }))} placeholder="Free haircut" />
            </label>

            <label>Required stamps
              <input type="number" min="1" step="1" value={rewardForm.required_stamps} onChange={e => setRewardForm((current) => ({ ...current, required_stamps: e.target.value }))} />
            </label>

            <label>Description (optional)
              <textarea rows="3" value={rewardForm.description} onChange={e => setRewardForm((current) => ({ ...current, description: e.target.value }))} placeholder="Reward description" />
            </label>

            <button className="admin-primary admin-confirm" type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingRewardId ? 'Update Reward' : 'Save Reward'}
            </button>
          </form>
        </div>
      )}

      {showAddCustomer && (
        <div className="admin-modal-backdrop" onClick={() => !saving && setShowAddCustomer(false)}>
          <form className="admin-modal" onSubmit={addCustomer} onClick={e => e.stopPropagation()}>
            <button type="button" className="admin-modal-close" disabled={saving} onClick={() => setShowAddCustomer(false)}>×</button>
            <p className="admin-eyebrow">MEMBERSHIP</p>
            <h2>Add Customer</h2>

            <label>Full name
              <input required maxLength="120" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Customer's full name" />
            </label>

            <label>Phone number
              <input maxLength="20" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="09XXXXXXXXX" />
            </label>

            <label>Email (optional)
              <input type="email" maxLength="150" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="customer@example.com" />
            </label>

            <button className="admin-primary admin-confirm" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Customer'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function SearchBox({ search, setSearch }) {
  return (
    <div className="admin-search">
      <span>⌕</span>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone number, or member ID..." />
      {search && <button onClick={() => setSearch('')}>Clear</button>}
    </div>
  )
}

function CustomerTable({ customers, rewardTarget, onRedeem, onCreateCode, onDelete }) {
  if (!customers.length) return <p className="admin-empty">No customers found.</p>

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>CUSTOMER</th><th>MEMBER ID</th><th>VISITS</th><th>STAMP PROGRESS</th><th>STATUS</th><th>ACTION</th></tr>
        </thead>
        <tbody>
          {customers.map(c => (
            <tr key={c.id}>
              <td><strong>{c.name}</strong><span className="admin-cell-sub">{c.phone || 'No phone provided'}</span></td>
              <td>{c.memberCode}</td>
              <td>{c.visits}</td>
              <td>
                <div className="admin-progress"><span style={{ width: `${Math.min(c.stamps / (rewardTarget || 10) * 100, 100)}%` }} /></div>
                <span className="admin-cell-sub">{c.stamps}/{rewardTarget || 10} stamps</span>
              </td>
              <td>
                <span className={`admin-tag ${c.isActivated ? (c.stamps >= (rewardTarget || 10) ? 'ready' : 'active-tag') : 'active-tag'}`}>
                  {c.isActivated ? (c.stamps >= (rewardTarget || 10) ? 'Reward ready' : 'Active') : 'Needs activation'}
                </span>
              </td>
              <td className="admin-actions">
                <div className="admin-action-stack">
                {!c.isActivated ? (
                  <button disabled={!onCreateCode} className="admin-action-button" onClick={() => onCreateCode(c)}>Generate code</button>
                ) : c.stamps >= (rewardTarget || 10) ? (
                  <button disabled={!onRedeem} className="admin-action-button reward-button" onClick={() => onRedeem(c)}>Redeem</button>
                ) : (
                  <span className="admin-cell-sub">Visit from customer app</span>
                )}
                {onDelete && (
                  <button className="admin-action-button admin-delete-button" onClick={() => onDelete(c)}>Delete</button>
                )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VisitTable({ visits }) {
  if (!visits.length) return <p className="admin-empty">No visits found.</p>

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>CUSTOMER</th><th>SERVICE</th><th>BARBER</th><th>DATE</th><th>AMOUNT</th></tr></thead>
        <tbody>
          {visits.map((v, i) => (
            <tr key={v.id ?? `${v.customer}-${i}`}>
              <td><strong>{v.customer}</strong></td>
              <td>{v.service}</td>
              <td>{v.barber}</td>
              <td>{v.date}</td>
              <td>₱{formatMoney(v.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default App