
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import './App.css'

const API_URL =
  import.meta.env.VITE_API_URL || 'https://barberbro-1.onrender.com/api'

const menuItems = [
  { id: 'dashboard', icon: '▦', label: 'Dashboard' },
  { id: 'visit', icon: '✂', label: 'Visit' },
  { id: 'rewards', icon: '✧', label: 'My Rewards' },
  { id: 'visits', icon: '◷', label: 'Visit History' },
  { id: 'profile', icon: '♙', label: 'My Profile' },
]

const money = (value) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)

const formatDate = (value) => {
  if (!value) return 'Date unavailable'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'

  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
}

function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem('barberbro_token') || ''
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [memberCode, setMemberCode] = useState('')
  const [activationCode, setActivationCode] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const [apiStatus, setApiStatus] = useState('checking')
  const [activePage, setActivePage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [customer, setCustomer] = useState(null)
  const [visits, setVisits] = useState([])
  const [barbers, setBarbers] = useState([])
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState('')
  const [visitService, setVisitService] = useState('Classic Haircut')
  const [visitBarber, setVisitBarber] = useState('Michael')
  const [visitAmount, setVisitAmount] = useState('100')
  const [generatedVisitQr, setGeneratedVisitQr] = useState('')

  const logout = useCallback(() => {
    localStorage.removeItem('barberbro_token')
    setToken('')
    setCustomer(null)
    setVisits([])
    setPassword('')
    setLoginError('')
    setDataError('')
    setActivePage('dashboard')
    setGeneratedVisitQr('')
  }, [])

  const apiRequest = useCallback(async (path, accessToken) => {
    const response = await fetch(`${API_URL}${path}`, {
      headers: {
                                ...( accessToken ? { Authorization: "Bearer " + accessToken } : {}),
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 401) {
      throw new Error('SESSION_EXPIRED')
    }

    if (!response.ok) {
      throw new Error(`Unable to load data (${response.status})`)
    }

    return response.json()
  }, [])
  useEffect(() => {
    let active = true

    fetch(`${API_URL}/health`)
      .then((response) => {
        if (!response.ok) throw new Error('Backend unavailable')
        return response.json()
      })
      .then(() => {
        if (active) setApiStatus('connected')
      })
      .catch(() => {
        if (active) setApiStatus('disconnected')
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    fetch(`${API_URL}/barbers`)
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load barbers')
        return response.json()
      })
      .then((rows) => {
        if (!active) return
        const loadedBarbers = Array.isArray(rows) && rows.length > 0 ? rows : [{ id: 1, name: 'Michael', specialty: 'General barber' }]
        setBarbers(loadedBarbers)
        setVisitBarber((current) => current || loadedBarbers[0]?.name || 'Michael')
      })
      .catch(() => {
        if (active) {
          setBarbers([{ id: 1, name: 'Michael', specialty: 'General barber' }])
          setVisitBarber('Michael')
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setCustomer(null)
      setVisits([])
      setDataLoading(false)
      return
    }

    let active = true

    async function loadCustomerData() {
      setDataLoading(true)
      setDataError('')

      try {
        const [profile, visitHistory] = await Promise.all([
          apiRequest('/auth/me', token),
          apiRequest('/auth/visits', token),
        ])

        if (!active) return

        setCustomer(profile)
        setVisits(Array.isArray(visitHistory) ? visitHistory : [])
      } catch (error) {
        if (!active) return

        if (error.message === 'SESSION_EXPIRED') {
          logout()
          setLoginError('Your session expired. Please sign in again.')
        } else {
          setDataError(
            'Unable to load your membership data. Please check your connection and try again.'
          )
        }
      } finally {
        if (active) setDataLoading(false)
      }
    }

    loadCustomerData()

    return () => {
      active = false
    }
  }, [token, apiRequest, logout])

  async function handleLogin(event) {
    event.preventDefault()
    setLoginError('')

    if (!email.trim() || !password) {
      setLoginError('Please enter your email and password.')
      return
    }

    setLoginLoading(true)

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          result.error || 'Unable to sign in. Please try again.'
        )
      }

      if (!result.token) {
        throw new Error('The server did not return a login token.')
      }

      localStorage.setItem('barberbro_token', result.token)
      setToken(result.token)
      setPassword('')
    } catch (error) {
      setLoginError(
        error.message === 'Failed to fetch'
          ? 'Cannot connect to the server. Make sure the backend is running.'
          : error.message
      )
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleActivate(event) {
    event.preventDefault()
    setLoginError('')

    if (!memberCode.trim() || !activationCode.trim() || !email.trim() || !password) {
      setLoginError('Please complete all activation fields.')
      return
    }

    if (password.length < 8) {
      setLoginError('Create a password with at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setLoginError('Passwords do not match.')
      return
    }

    setLoginLoading(true)

    try {
      const response = await fetch(`${API_URL}/auth/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_code: memberCode.trim(),
          activation_code: activationCode.trim(),
          email: email.trim(),
          password,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to activate the account.')
      }

      setAuthMode('login')
      setMemberCode('')
      setActivationCode('')
      setConfirmPassword('')
      setPassword('')
      setLoginError('Account activated successfully. You can sign in now.')
    } catch (error) {
      setLoginError(
        error.message === 'Failed to fetch'
          ? 'Cannot connect to the server. Make sure the backend is running.'
          : error.message
      )
    } finally {
      setLoginLoading(false)
    }
  }

  function navigate(page) {
    setActivePage(page)
    setSidebarOpen(false)
  }

  const pageTitle =
    menuItems.find((item) => item.id === activePage)?.label || 'Dashboard'

  const totalVisits = Number(customer?.total_visits) || 0
  const stamps = Number(customer?.loyalty_stamps) || 0
  const totalSpent = Number(customer?.total_spent) || 0
  const stampsRequired = 10
  const stampsRemaining = Math.max(0, stampsRequired - stamps)
  const displayName =
    customer?.full_name ||
    customer?.email?.split('@')[0]?.trim() ||
    customer?.member_code ||
    'BarberBro Member'

  const visitQrValue = customer
    ? [
        'BBV1',
        customer.id,
        encodeURIComponent(customer.member_code || ''),
        encodeURIComponent(visitService),
        encodeURIComponent(visitBarber),
        String(Number(visitAmount) || 0),
      ].join('|')
    : ''

  function generateVisitQr(event) {
    event.preventDefault()
    setGeneratedVisitQr(visitQrValue)
  }

  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  if (!token) {
    return (
      <div className="app-shell login-shell">
        <main className="login-main">
          <section className="login-card">
            <div className="brand login-brand">
              <div className="brand-mark">B<span>.</span></div>
              <div>
                <div className="brand-name">BARBER<span>BRO</span></div>
                <div className="brand-subtitle">CUSTOMER CLUB</div>
              </div>
            </div>

            <div className="auth-switcher" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={authMode === 'login' ? 'auth-tab active' : 'auth-tab'}
                onClick={() => {
                  setAuthMode('login')
                  setLoginError('')
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={authMode === 'activate' ? 'auth-tab active' : 'auth-tab'}
                onClick={() => {
                  setAuthMode('activate')
                  setLoginError('')
                }}
              >
                Activate account
              </button>
            </div>

            {authMode === 'login' ? (
              <>
                <div className="eyebrow"><span /> YOUR PERSONAL BARBERSHOP CLUB</div>
                <h1>Welcome <span>back.</span></h1>
                <p className="login-description">
                  Sign in to view your membership, track your visits, and check your rewards.
                </p>

                <form onSubmit={handleLogin} className="login-form">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />

                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />

                  <button
                    className="gold-button login-submit"
                    type="submit"
                    disabled={loginLoading}
                  >
                    {loginLoading ? 'Signing in...' : 'Sign in'}
                    {!loginLoading && <span>→</span>}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="eyebrow"><span /> ACTIVATE YOUR MEMBERSHIP</div>
                <h1>Set up <span>account.</span></h1>
                <p className="login-description">
                  Use your member code and activation code to create a password and unlock your account.
                </p>

                <form onSubmit={handleActivate} className="login-form">
                  <label htmlFor="memberCode">Member code</label>
                  <input
                    id="memberCode"
                    placeholder="BB-12345"
                    value={memberCode}
                    onChange={(event) => setMemberCode(event.target.value)}
                    required
                  />

                  <label htmlFor="activationCode">Activation code</label>
                  <input
                    id="activationCode"
                    placeholder="BB-ABC123"
                    value={activationCode}
                    onChange={(event) => setActivationCode(event.target.value)}
                    required
                  />

                  <label htmlFor="activate-email">Email address</label>
                  <input
                    id="activate-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />

                  <label htmlFor="new-password">Create password</label>
                  <input
                    id="new-password"
                    type="password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />

                  <label htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />

                  <button
                    className="gold-button login-submit"
                    type="submit"
                    disabled={loginLoading}
                  >
                    {loginLoading ? 'Activating...' : 'Activate account'}
                    {!loginLoading && <span>→</span>}
                  </button>
                </form>
              </>
            )}

            {loginError && (
              <p className="form-error" role="alert">{loginError}</p>
            )}

            <div className="sidebar-footer login-status">
              <span className={`status-dot ${apiStatus}`} />
              <span>
                {apiStatus === 'checking'
                  ? 'Checking server connection...'
                  : apiStatus === 'connected'
                    ? 'Server connected'
                    : 'Server unavailable'}
              </span>
            </div>
          </section>
          <footer className="page-footer">
            <span>© 2026 BarberBro</span>
            <span>Crafted for your confidence <b>✦</b></span>
          </footer>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">B<span>.</span></div>
          <div>
            <div className="brand-name">BARBER<span>BRO</span></div>
            <div className="brand-subtitle">CUSTOMER CLUB</div>
          </div>
          <button
            className="mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>

        <div className="sidebar-label">MENU</div>
        <nav className="navigation" aria-label="Main navigation">
          {menuItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activePage === item.id ? 'nav-active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {activePage === item.id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-promo">
          <div className="promo-icon">✦</div>
          <h3>Good style.<br />Great rewards.</h3>
          <p>Every visit brings you closer to a free haircut.</p>
          <button onClick={() => navigate('rewards')}>
            Explore rewards <span>↗</span>
          </button>
        </div>

        <div className="sidebar-footer">
          <span className={`status-dot ${apiStatus}`} />
          <span>
            {apiStatus === 'checking'
              ? 'Connecting to server...'
              : apiStatus === 'connected'
                ? 'System connected'
                : 'Server unavailable'}
          </span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <div className="breadcrumb">
              <span>BarberBro</span><span className="breadcrumb-slash">/</span>
              <strong>{pageTitle}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-date">
              <span className="calendar-icon">▦</span>
              <span>{displayName}</span>
            </div>
            <div className="avatar">{initials || 'C'}</div>
            <button className="text-button" onClick={logout}>Log out</button>
          </div>
        </header>

        <div className="page-content">
          {dataError && (
            <div className="form-error" role="alert">
              {dataError}
              <button
                className="text-button"
                onClick={() => setToken((current) => {
                  setDataError('')
                  return current
                })}
              >
                Retry
              </button>
            </div>
          )}

          {dataLoading && (
            <div className="panel loading-panel">Loading your membership data...</div>
          )}

          {!dataLoading && !customer && !dataError && (
            <div className="panel loading-panel">
              Your customer profile could not be loaded.
            </div>
          )}

          {!dataLoading && customer && activePage === 'dashboard' && (
            <>
              <section className="welcome-section">
                <div>
                  <div className="eyebrow"><span /> YOUR PERSONAL BARBERSHOP CLUB</div>
                  <h1>Look sharp. <span>Feel confident.</span></h1>
                  <p>Welcome back, {displayName}. Your style and rewards, all in one place.</p>
                </div>
                <div className="welcome-decoration" aria-hidden="true">
                  <span className="decoration-ring ring-one" />
                  <span className="decoration-ring ring-two" />
                  <span className="decoration-letter">B.</span>
                </div>
              </section>

              <section className="stats-grid">
                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon gold-icon">✂</span>
                    <span className="stat-caption">LIFETIME</span>
                  </div>
                  <div className="stat-number">{totalVisits}</div>
                  <div className="stat-label">Total Visits</div>
                  <div className="stat-note">Your recorded barbershop visits</div>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon purple-icon">✧</span>
                    <span className="stat-caption">YOUR PROGRESS</span>
                  </div>
                  <div className="stat-number">
                    {stamps}<span className="stat-muted">/{stampsRequired}</span>
                  </div>
                  <div className="stat-label">Loyalty Stamps</div>
                  <div className="mini-progress">
                    <span style={{ width: `${Math.min(100, stamps / stampsRequired * 100)}%` }} />
                  </div>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon green-icon">₱</span>
                    <span className="stat-caption">LIFETIME</span>
                  </div>
                  <div className="stat-number">{money(totalSpent)}</div>
                  <div className="stat-label">Total Spent</div>
                  <div className="stat-note">Thanks for your support</div>
                </article>
              </section>

              <section className="membership-card">
                <div className="membership-content">
                  <div className="membership-kicker"><span /> BARBERBRO LOYALTY CLUB</div>
                  <h2>Your next haircut<br />could be <em>on us.</em></h2>
                  <p>Collect {stampsRequired} stamps and enjoy a reward on us.</p>
                  <div className="stamp-row" aria-label={`${stamps} of ${stampsRequired} stamps collected`}>
                    {Array.from({ length: stampsRequired }, (_, index) => (
                      <div
                        key={index}
                        className={`stamp ${index < stamps ? 'stamp-earned' : ''}`}
                      >
                        {index < stamps ? '✓' : <span>{String(index + 1).padStart(2, '0')}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="stamp-legend">
                    <span><b>{stamps} stamps earned</b></span>
                    <span>
                      {stampsRemaining === 0
                        ? 'Reward threshold reached!'
                        : `${stampsRemaining} more to unlock`}
                    </span>
                  </div>
                  <button className="gold-button" onClick={() => navigate('rewards')}>
                    View my rewards <span>→</span>
                  </button>
                </div>
                <div className="membership-art" aria-hidden="true">
                  <div className="art-circle">
                    <div className="art-inner">
                      <span className="art-star">✦</span>
                      <span className="art-b">B.</span>
                      <span className="art-label">EST. FOR YOUR STYLE</span>
                    </div>
                  </div>
                  <div className="art-small-label">MEMBER<br />BENEFITS</div>
                </div>
                <div className="membership-watermark">BB</div>
              </section>

              <section className="bottom-grid">
                <article className="panel visit-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent visits</h2>
                      <p>Your latest barbershop sessions</p>
                    </div>
                    <button className="text-button" onClick={() => navigate('visits')}>
                      View all <span>→</span>
                    </button>
                  </div>
                  <div className="visit-list">
                    {visits.slice(0, 3).map((visit) => (
                      <div className="visit-row" key={visit.id}>
                        <div className="visit-date-icon"><span>✂</span></div>
                        <div className="visit-info">
                          <strong>{visit.service || 'Barbershop service'}</strong>
                          <span>{formatDate(visit.visited_at)} · {visit.barber_name || 'Barber'}</span>
                        </div>
                        <div className="visit-amount">
                          <strong>{money(visit.amount)}</strong>
                          <span>Recorded</span>
                        </div>
                      </div>
                    ))}
                    {visits.length === 0 && <p>No visits have been recorded yet.</p>}
                  </div>
                </article>

                <article className="panel reward-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Member perks</h2>
                      <p>A little extra for you</p>
                    </div>
                    <span className="perk-sparkle">✦</span>
                  </div>
                  <div className="perk-item">
                    <div className="perk-icon">✂</div>
                    <div><strong>Free haircut</strong><span>When you collect {stampsRequired} stamps</span></div>
                  </div>
                  <div className="perk-item">
                    <div className="perk-icon">♛</div>
                    <div><strong>Member recognition</strong><span>Your visits, remembered</span></div>
                  </div>
                  <button className="outline-button" onClick={() => navigate('rewards')}>
                    Explore rewards <span>→</span>
                  </button>
                </article>
              </section>
            </>
          )}

          {!dataLoading && customer && activePage === 'visit' && (
            <section className="inner-page">
              <div className="page-heading">
                <div className="eyebrow"><span /> CREATE A VISIT TICKET</div>
                <h1>Record a <span>Visit</span></h1>
                <p>Enter your service details, then show the temporary QR code to the admin to record your visit.</p>
              </div>
              <div className="visit-ticket-layout">
                <form className="panel visit-ticket-form" onSubmit={generateVisitQr}>
                  <div className="panel-heading">
                    <div><h2>Visit details</h2><p>Confirm these with the barber before generating your code.</p></div>
                  </div>
                  <div className="visit-qr-form">
                    <label>
                      Service
                      <select
                        value={visitService}
                        onChange={(event) => {
                          setVisitService(event.target.value)
                          setGeneratedVisitQr('')
                        }}
                      >
                        <option>Classic Haircut</option>
                        <option>Haircut + Styling</option>
                        <option>Haircut + Shave</option>
                      </select>
                    </label>
                    <label>
                      Barber
                      <select
                        value={visitBarber}
                        onChange={(event) => {
                          setVisitBarber(event.target.value)
                          setGeneratedVisitQr('')
                        }}
                      >
                        {barbers.length > 0 ? barbers.map((barber) => (
                          <option key={barber.id} value={barber.name}>{barber.name}</option>
                        )) : <option>Michael</option>}
                      </select>
                    </label>
                    <label>
                      Amount paid (₱)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={visitAmount}
                        onChange={(event) => {
                          setVisitAmount(event.target.value)
                          setGeneratedVisitQr('')
                        }}
                        required
                      />
                    </label>
                  </div>
                  <button className="gold-button visit-ticket-submit" type="submit">
                    Generate visit QR <span>→</span>
                  </button>
                </form>

                <div className="panel visit-ticket-qr">
                  {generatedVisitQr ? (
                    <>
                      <QRCode value={generatedVisitQr} size={280} level="L" bgColor="#fffaf4" fgColor="#171a2c" />
                      <h2>Show this code to the admin</h2>
                      <p>{visitService} · {visitBarber} · {money(visitAmount)}</p>
                      <span className="ticket-member-code">{customer.member_code}</span>
                    </>
                  ) : (
                    <div className="visit-ticket-placeholder">
                      <span className="ticket-placeholder-icon">▦</span>
                      <h2>Your visit QR will appear here</h2>
                      <p>Generate it after confirming the service, barber, and amount paid.</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {!dataLoading && customer && activePage === 'rewards' && (
            <section className="inner-page">
              <div className="page-heading">
                <div className="eyebrow"><span /> LOYALTY CLUB</div>
                <h1>My <span>Rewards</span></h1>
                <p>Every visit gets you one step closer to a reward.</p>
              </div>
              <div className="reward-feature">
                <div className="reward-feature-icon">✂</div>
                <div className="reward-feature-copy">
                  <div className="membership-kicker"><span /> YOUR NEXT REWARD</div>
                  <h2>One free haircut</h2>
                  <p>Collect {stampsRequired} loyalty stamps to unlock your reward.</p>
                  <div className="mini-progress large-progress">
                    <span style={{ width: `${Math.min(100, stamps / stampsRequired * 100)}%` }} />
                  </div>
                  <div className="stamp-legend">
                    <b>{stamps} of {stampsRequired} stamps</b>
                    <span>{stampsRemaining} remaining</span>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-heading">
                  <div><h2>How it works</h2><p>Simple visits. Better rewards.</p></div>
                </div>
                <div className="steps-grid">
                  <div className="step-card"><span>01</span><h3>Visit the shop</h3><p>Enjoy your regular haircut or barber service.</p></div>
                  <div className="step-card"><span>02</span><h3>Earn a stamp</h3><p>Your visit earns a loyalty stamp according to shop policy.</p></div>
                  <div className="step-card"><span>03</span><h3>Claim your reward</h3><p>Once eligible, ask the shop to confirm and redeem your reward.</p></div>
                </div>
              </div>
            </section>
          )}

          {!dataLoading && customer && activePage === 'visits' && (
            <section className="inner-page">
              <div className="page-heading">
                <div className="eyebrow"><span /> YOUR BARBERSHOP JOURNEY</div>
                <h1>Visit <span>History</span></h1>
                <p>Keep track of your recent visits and services.</p>
              </div>
              <div className="panel history-panel">
                <div className="panel-heading">
                  <div><h2>Recent sessions</h2><p>Your recorded visit history</p></div>
                  <span className="history-count">{visits.length} visits</span>
                </div>
                {visits.map((visit) => (
                  <div className="visit-row history-row" key={visit.id}>
                    <div className="visit-date-icon"><span>✂</span></div>
                    <div className="visit-info">
                      <strong>{visit.service || 'Barbershop service'}</strong>
                      <span>{formatDate(visit.visited_at)} · {visit.barber_name || 'Barber'}</span>
                    </div>
                    <div className="visit-amount">
                      <strong>{money(visit.amount)}</strong>
                      <span>Recorded</span>
                    </div>
                  </div>
                ))}
                {visits.length === 0 && <p>No visits have been recorded yet.</p>}
              </div>
            </section>
          )}

          {!dataLoading && customer && activePage === 'profile' && (
            <section className="inner-page">
              <div className="page-heading">
                <div className="eyebrow"><span /> YOUR ACCOUNT</div>
                <h1>My <span>Profile</span></h1>
                <p>Your membership information in one place.</p>
              </div>
              <div className="panel profile-panel">
                <div className="profile-avatar">{initials || 'C'}</div>
                <div className="profile-details">
                  <span className="membership-kicker"><span /> BARBERBRO MEMBER</span>
                  <h2>{displayName}</h2>
                  <p>Your verified membership information.</p>
                  <div className="profile-field"><span>Member code</span><strong>{customer.member_code || 'Not assigned'}</strong></div>
                  <div className="profile-field"><span>Email address</span><strong>{customer.email || 'Not provided'}</strong></div>
                  <div className="profile-field"><span>Phone number</span><strong>{customer.phone || 'Not provided'}</strong></div>
                  <div className="profile-field"><span>Member since</span><strong>{formatDate(customer.created_at)}</strong></div>
                </div>
              </div>
            </section>
          )}

          <footer className="page-footer">
            <span>© 2026 BarberBro</span>
            <span>Crafted for your confidence <b>✦</b></span>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App
