
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getAdminToken, saveAdminToken, clearAdminToken, subscribeToUpdates } from './api'
import './App.css'

const target = 10
const emailDeliveryGuidance =
  'Configure EMAIL_USER and the Google OAuth values GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN. Authorize the Gmail API with the gmail.send scope; this HTTPS method works on Render Free and needs no custom domain or Resend.'

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
    email: c.email || '',
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

function normalizeRewardRedemption(redemption) {
  return {
    id: redemption.id,
    customer: redemption.full_name,
    memberCode: redemption.member_code,
    reward: redemption.reward_name,
    stamps: Number(redemption.stamps_required || 0),
    date: formatDate(redemption.redeemed_at),
  }
}

function normalizeBarberStats(barber) {
  return {
    id: barber.id,
    name: barber.name,
    specialty: barber.specialty || 'General barber',
    isActive: Boolean(barber.is_active),
    haircuts: {
      today: Number(barber.haircuts_today || 0),
      week: Number(barber.haircuts_this_week || 0),
      month: Number(barber.haircuts_this_month || 0),
      year: Number(barber.haircuts_this_year || 0),
    },
    earnings: {
      today: Number(barber.earnings_today || 0),
      week: Number(barber.earnings_this_week || 0),
      month: Number(barber.earnings_this_month || 0),
      year: Number(barber.earnings_this_year || 0),
    },
    topServices: Array.isArray(barber.top_services) ? barber.top_services : [],
    topCustomers: Array.isArray(barber.top_customers) ? barber.top_customers : [],
  }
}

function createQrDetector() {
  if (typeof window.BarcodeDetector !== 'function') return null

  try {
    return new window.BarcodeDetector({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

async function decodeQrImage(file) {
  const [
    { default: jsQR },
    { BrowserQRCodeReader },
    { DecodeHintType },
  ] = await Promise.all([
    import('jsqr'),
    import('@zxing/browser'),
    import('@zxing/library'),
  ])
  const qrReader = new BrowserQRCodeReader(
    new Map([[DecodeHintType.TRY_HARDER, true]])
  )
  const nativeDetector = createQrDetector()
  const bitmap = await createImageBitmap(file)

  try {
    const sources = [
      { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
      {
        x: bitmap.width * 0.1,
        y: bitmap.height * 0.1,
        width: bitmap.width * 0.8,
        height: bitmap.height * 0.8,
      },
    ]

    for (const source of sources) {
      const scale = Math.min(3, 1800 / Math.max(source.width, source.height))
      const width = Math.round(source.width * scale)
      const height = Math.round(source.height * scale)
      const imageCanvas = document.createElement('canvas')
      imageCanvas.width = width
      imageCanvas.height = height
      const imageContext = imageCanvas.getContext('2d', { willReadFrequently: true })
      if (!imageContext) throw new Error('This browser cannot read the selected image.')
      imageContext.drawImage(
        bitmap,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        width,
        height
      )

      const candidates = [imageCanvas]
      const quietZone = Math.max(16, Math.round(Math.min(width, height) * 0.12))
      for (const color of ['#fffaf4', '#171a2c']) {
        const paddedCanvas = document.createElement('canvas')
        paddedCanvas.width = width + quietZone * 2
        paddedCanvas.height = height + quietZone * 2
        const paddedContext = paddedCanvas.getContext('2d', { willReadFrequently: true })
        if (!paddedContext) throw new Error('This browser cannot prepare the selected image.')
        paddedContext.fillStyle = color
        paddedContext.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height)
        paddedContext.drawImage(imageCanvas, quietZone, quietZone)
        candidates.push(paddedCanvas)
      }

      for (const candidate of candidates) {
        if (nativeDetector) {
          try {
            const results = await nativeDetector.detect(candidate)
            if (results[0]?.rawValue) return results[0].rawValue
          } catch {
            // Some browsers expose BarcodeDetector but do not support canvas input.
          }
        }

        const context = candidate.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('This browser cannot read the selected image.')
        const image = context.getImageData(0, 0, candidate.width, candidate.height)
        const result = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'attemptBoth',
        })
        if (result?.data) return result.data

        try {
          return qrReader.decodeFromCanvas(candidate).getText()
        } catch {
          continue
        }
      }
    }

    return ''
  } finally {
    bitmap.close()
  }
}

function parseVisitQrPayload(rawPayload, barberRows = []) {
  const trimmedPayload = String(rawPayload || '').trim()

  if (!trimmedPayload) {
    return null
  }

  const compactFields = trimmedPayload.split('|')
  if (compactFields.length === 5 && compactFields[0] === 'BBV3') {
    const customerId = Number(compactFields[1])
    const serviceByCode = {
      1: 'Buzz Cut',
      2: 'Crew Cut',
      3: 'Low Fade',
      4: 'High Fade',
      5: 'Taper Cut',
      6: 'Undercut',
      7: 'Pompadour',
      8: 'Side Part',
      9: 'Textured Crop',
      10: 'Slick Back',
      11: 'Spiky Top',
      12: 'Curly Top',
      13: 'Medium Flow',
    }
    const service = serviceByCode[compactFields[2]]
    const barberId = compactFields[3]
    const selectedBarber = barberRows.find((barber) => String(barber.id) === barberId)
    const amount = Number(compactFields[4])

    if (!Number.isInteger(customerId) || customerId <= 0 ||
        !service || !selectedBarber?.name ||
        compactFields[4].trim() === '' || !Number.isFinite(amount) || amount < 0) {
      return null
    }

    return {
      customer_id: customerId,
      service,
      barber_name: selectedBarber.name,
      amount,
    }
  }

  if (compactFields.length === 5 && compactFields[0] === 'BBV2') {
    const customerId = Number(compactFields[1])
    const serviceByCode = {
      1: 'Classic Haircut',
      2: 'Haircut + Styling',
      3: 'Haircut + Shave',
    }
    const service = serviceByCode[compactFields[2]]
    const barberId = compactFields[3]
    const selectedBarber = barberRows.find((barber) => String(barber.id) === barberId)
    const amount = Number(compactFields[4])

    if (!Number.isInteger(customerId) || customerId <= 0 ||
        !service || !selectedBarber?.name ||
        compactFields[4].trim() === '' || !Number.isFinite(amount) || amount < 0) {
      return null
    }

    return {
      customer_id: customerId,
      service,
      barber_name: selectedBarber.name,
      amount,
    }
  }

  if (compactFields.length === 6 && compactFields[0] === 'BBV1') {
    try {
      const customerId = Number(compactFields[1])
      const memberCode = decodeURIComponent(compactFields[2]).trim()
      const service = decodeURIComponent(compactFields[3]).trim()
      const barber = decodeURIComponent(compactFields[4]).trim()
      const amount = Number(compactFields[5])

      if (!Number.isInteger(customerId) || customerId <= 0 ||
          !memberCode || !service || !barber ||
          compactFields[5].trim() === '' || !Number.isFinite(amount) || amount < 0) {
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

function getCameraStartupError(error) {
  const detail = typeof error === 'string'
    ? error
    : error?.message || String(error || '')

  if (!window.isSecureContext) {
    return 'Camera access requires a secure HTTPS page. Open the admin site using its HTTPS address.'
  }

  if (/notallowederror|permission denied|not allowed/i.test(detail)) {
    return 'Camera access was blocked by the browser. Allow camera access for this site, then try again.'
  }

  if (/notfounderror|no camera|device not found/i.test(detail)) {
    return 'No available camera was found. Connect a camera and try again.'
  }

  if (/notreadableerror|could not start video source|device in use/i.test(detail)) {
    return 'The camera is already in use by another app or browser tab. Close it and try again.'
  }

  return detail
    ? `Unable to start the camera: ${detail}`
    : 'Unable to start the camera. Check that the browser can access a camera and try again.'
}

function App() {
  const [token, setToken] = useState(() => getAdminToken())
  const [username, setUsername] = useState('')
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
  const [activationEmailRetryCustomer, setActivationEmailRetryCustomer] = useState(null)
  const [activationCodeCustomerId, setActivationCodeCustomerId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null)
  const [liveStatus, setLiveStatus] = useState('connecting')
  const [saving, setSaving] = useState(false)
  const [barbers, setBarbers] = useState([])
  const [barberStats, setBarberStats] = useState([])
  const [selectedBarberId, setSelectedBarberId] = useState(null)
  const [rewardRedemptions, setRewardRedemptions] = useState([])
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [qrScanStatus, setQrScanStatus] = useState('')
  const [qrScanPaused, setQrScanPaused] = useState(false)
  const [qrFacingMode, setQrFacingMode] = useState('environment')
  const qrScanHandledRef = useRef(false)
  const [qrScannerRestartKey, setQrScannerRestartKey] = useState(0)
  const qrVideoRef = useRef(null)
  const qrImageInputRef = useRef(null)
  const qrScannerControlsRef = useRef(null)
  const qrFallbackTimerRef = useRef(null)
  const barbersRef = useRef(barbers)
  const recordVisitHandlerRef = useRef(null)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [barberForm, setBarberForm] = useState({ name: '', specialty: '' })
  const [editingBarberId, setEditingBarberId] = useState(null)
  const [barberModalOpen, setBarberModalOpen] = useState(false)
  const [rewardTemplates, setRewardTemplates] = useState([])
  const [rewardForm, setRewardForm] = useState({ name: '', description: '', required_stamps: 10 })
  const [editingRewardId, setEditingRewardId] = useState(null)
  const [rewardModalOpen, setRewardModalOpen] = useState(false)
  const dataRefreshInFlightRef = useRef(null)

  const handleDetectedQr = useCallback((payload, scanControls) => {
    if (qrScanHandledRef.current) return

    qrScanHandledRef.current = true
    setQrScanStatus('QR detected. Recording visit...')
    setQrScanPaused(true)
    scanControls?.stop()
    qrScannerControlsRef.current?.stop()
    window.clearInterval(qrFallbackTimerRef.current)
    recordVisitHandlerRef.current?.(payload)
  }, [])

  const logout = useCallback(() => {
    clearAdminToken()
    setToken('')
    setPassword('')
    setLoginError('')
    setError('')
    setNotice('')
    setActivationEmailRetryCustomer(null)
    setSelectedBarberId(null)
    setActivePage('Dashboard')
  }, [])

  const loadData = useCallback(async ({ background = false } = {}) => {
    if (!token) return

    if (dataRefreshInFlightRef.current) {
      await dataRefreshInFlightRef.current
      return
    }

    if (!background) setLoading(true)
    if (!background) setError('')

    const refresh = (async () => {
      try {
        const [dashboard, customerRows, visitRows, barberRows, barberStatRows, rewardRows, redemptionRows] = await Promise.all([
          api.getDashboard(),
          api.getCustomers(),
          api.getVisits(),
          api.getBarbers(),
          api.getBarberStats(),
          api.getRewardTemplates(),
          api.getRewardRedemptions(),
        ])

        setStats(dashboard)
        setCustomers(customerRows.map(normalizeCustomer))
        setVisits(visitRows.map(normalizeVisit))
        setBarbers(Array.isArray(barberRows) ? barberRows : [])
        setBarberStats(Array.isArray(barberStatRows) ? barberStatRows.map(normalizeBarberStats) : [])
        setRewardTemplates(Array.isArray(rewardRows) ? rewardRows : [])
        setRewardRedemptions(redemptionRows.map(normalizeRewardRedemption))
        setLastRefreshedAt(new Date())
      } catch (err) {
        setError(err.message || 'Unable to load BarberBro data.')
      } finally {
        if (!background) setLoading(false)
      }
    })()

    dataRefreshInFlightRef.current = refresh
    try {
      await refresh
    } finally {
      dataRefreshInFlightRef.current = null
    }
  }, [token])

  useEffect(() => {
    if (!token) {
      setCustomers([])
      setVisits([])
      setBarbers([])
      setBarberStats([])
      setRewardRedemptions([])
      setStats({ total_customers: 0, visits_today: 0, total_revenue: 0 })
      setLoading(false)
      return
    }

    loadData()
  }, [loadData, token])

  useEffect(() => {
    if (!token) return undefined

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadData({ background: true })
    }

    const refreshTimer = window.setInterval(refreshWhenVisible, 30000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)

    return () => {
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [loadData, token])

  useEffect(() => {
    if (!token) return undefined

    return subscribeToUpdates(
      token,
      () => {
        if (document.visibilityState === 'visible') loadData({ background: true })
      },
      setLiveStatus,
      () => window.dispatchEvent(new Event('barberbro-admin-unauthorized'))
    )
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
    const visitPayload = parseVisitQrPayload(payload, barbersRef.current)

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
    barbersRef.current = barbers
    recordVisitHandlerRef.current = recordVisitFromQr
  }, [barbers, recordVisitFromQr])

  useEffect(() => {
    if (!qrScannerOpen || !qrVideoRef.current) return undefined

    let cancelled = false
    let controls
    qrScanHandledRef.current = false

    async function startScanner() {
      try {
        const [
          { BrowserCodeReader, BrowserQRCodeReader },
          { DecodeHintType },
          { default: jsQR },
        ] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
          import('jsqr'),
        ])
        if (cancelled) return

        const cameras = await BrowserCodeReader.listVideoInputDevices()
        if (cancelled) return
        if (cameras.length === 0) {
          throw new Error('No camera was detected on this device.')
        }

        const scanner = new BrowserQRCodeReader(
          new Map([[DecodeHintType.TRY_HARDER, true]]),
          { delayBetweenScanAttempts: 250 }
        )
        const nativeDetector = createQrDetector()

        setQrScanStatus('Starting camera and focusing on the QR code...')
        controls = await scanner.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: qrFacingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          qrVideoRef.current,
          (result, _decodeError, scanControls) =>
            result && handleDetectedQr(result.getText(), scanControls)
        )

        if (cancelled || qrScanHandledRef.current) {
          controls.stop()
          return
        }

        qrScannerControlsRef.current = controls
        const fallbackCanvas = document.createElement('canvas')
        const fallbackContext = fallbackCanvas.getContext('2d', { willReadFrequently: true })
        if (!fallbackContext) {
          throw new Error('The browser could not initialize QR camera decoding.')
        }

        let fallbackBusy = false
        qrFallbackTimerRef.current = window.setInterval(async () => {
          const video = qrVideoRef.current
          if (cancelled || fallbackBusy || qrScanHandledRef.current ||
              !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
              !video.videoWidth || !video.videoHeight) return

          fallbackBusy = true
          try {
            if (nativeDetector) {
              try {
                const results = await nativeDetector.detect(video)
                if (results[0]?.rawValue) {
                  handleDetectedQr(results[0].rawValue)
                  return
                }
              } catch {
                // Continue with the JavaScript decoders if native decoding fails.
              }
            }

            const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
            fallbackCanvas.width = Math.round(video.videoWidth * scale)
            fallbackCanvas.height = Math.round(video.videoHeight * scale)
            fallbackContext.drawImage(video, 0, 0, fallbackCanvas.width, fallbackCanvas.height)
            const frame = fallbackContext.getImageData(0, 0, fallbackCanvas.width, fallbackCanvas.height)
            const result = jsQR(frame.data, frame.width, frame.height, {
              inversionAttempts: 'attemptBoth',
            })
            if (result) handleDetectedQr(result.data)
          } finally {
            fallbackBusy = false
          }
        }, 500)

        const decoderNames = [
          nativeDetector && 'native QR',
          'ZXing',
          'jsQR',
        ].filter(Boolean).join(', ')
        const facingLabel = qrFacingMode === 'environment' ? 'rear' : 'front'
        setQrScanStatus(`Camera ready (${facingLabel}). ${decoderNames} are scanning; hold the full code in view.`)
      } catch (err) {
        if (cancelled) return
        setQrScanStatus(getCameraStartupError(err))
      }
    }

    startScanner()

    return () => {
      cancelled = true
      window.clearInterval(qrFallbackTimerRef.current)
      qrFallbackTimerRef.current = null
      qrScannerControlsRef.current?.stop()
      qrScannerControlsRef.current = null
    }
  }, [handleDetectedQr, qrFacingMode, qrScannerOpen, qrScannerRestartKey])

  function switchQrCamera() {
    setQrFacingMode((current) => current === 'environment' ? 'user' : 'environment')
    setQrScanStatus('Switching camera...')
  }

  async function handleQrImageChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setQrScanStatus('Reading QR code from image...')
    try {
      const payload = await decodeQrImage(file)
      if (!payload) {
        setQrScanStatus('No QR code was found in that image. Try a sharper, uncropped image.')
        return
      }

      handleDetectedQr(payload)
    } catch (err) {
      setQrScanStatus(err.message || 'Unable to read a QR code from that image.')
    }
  }

  function resumeQrScanner() {
    qrScanHandledRef.current = false
    setQrScanPaused(false)
    setQrScannerRestartKey((current) => current + 1)
    setQrScanStatus('Point the camera at the customer visit QR.')
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginError('')

    if (!username.trim() || !password) {
      setLoginError('Please enter your admin username and password.')
      return
    }

    setLoginLoading(true)

    try {
      const result = await api.login(username.trim(), password)
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
    setActivationCodeCustomerId(String(customer.id))
    setError('')
    setNotice('')
    setActivationEmailRetryCustomer(null)

    try {
      const result = await api.createActivationCode(customer.id)
      const activationDetails =
        `${customer.name} can activate with member code ${result.member_code} and code ${result.code}.`

      if (result.email_sent) {
        setNotice(`${activationDetails} Email accepted by the mail server for ${result.email}.`)
      } else {
        setNotice(`${activationDetails} Email was not sent.`)
        if (result.email) {
          setActivationEmailRetryCustomer({
            id: customer.id,
            email: result.email,
          })
        }
        setError(
          `The activation code was generated, but the email was NOT sent${result.email ? ` to ${result.email}` : ''}. ` +
          `${result.email_error || 'No email delivery details were returned.'} ` +
          `${emailDeliveryGuidance} The existing code remains active for 24 hours.`
        )
      }
    } catch (err) {
      setError(err.message || 'Failed to create activation code.')
    } finally {
      setActivationCodeCustomerId(null)
      setSaving(false)
    }
  }

  async function retryActivationEmail() {
    if (!activationEmailRetryCustomer || saving) return

    setSaving(true)
    setError('')

    try {
      const result = await api.resendActivationEmail(activationEmailRetryCustomer.id)
      if (!result.email_sent) {
        setError(
          `The email was not accepted for ${activationEmailRetryCustomer.email}. ` +
          `${result.email_error || 'Check the email provider configuration.'} ` +
          emailDeliveryGuidance
        )
        return
      }

      setNotice(`Activation email accepted by the SMTP server for ${result.email}.`)
      setActivationEmailRetryCustomer(null)
    } catch (err) {
      setError(
        `${err.message || 'Failed to resend activation email.'} ` +
        emailDeliveryGuidance
      )
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
      if (selectedBarberId === barber.id) setSelectedBarberId(null)
      setNotice(`${barber.name} has been removed.`)
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to remove barber.')
    } finally {
      setSaving(false)
    }
  }

  const selectedBarberRow = barbers.find((barber) => barber.id === selectedBarberId)
  const selectedBarberStats = barberStats.find((barber) => barber.id === selectedBarberId)
  const selectedBarber = selectedBarberRow
    ? {
        ...(selectedBarberStats || normalizeBarberStats(selectedBarberRow)),
        name: selectedBarberRow.name,
        specialty: selectedBarberRow.specialty || 'General barber',
        isActive: Boolean(selectedBarberRow.is_active),
      }
    : null

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
            <label htmlFor="admin-username">Username</label>
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              placeholder="Enter your username"
              value={username}
              onChange={event => setUsername(event.target.value)}
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

        <nav className="admin-nav-items" aria-label="Workspace">
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
              aria-current={activePage === page ? 'page' : undefined}
              onClick={() => {
                if (page === 'Barbers') setSelectedBarberId(null)
                setActivePage(page)
                setNotice('')
                setError('')
                setActivationEmailRetryCustomer(null)
              }}
            >
              <span>{icon}</span>{page}
            </button>
          ))}
        </nav>

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
          <div className={`admin-open-label ${liveStatus === 'connected' ? '' : 'admin-live-reconnecting'}`}>
            <span />
            {liveStatus === 'connected'
              ? lastRefreshedAt
                ? `Live · refreshed ${lastRefreshedAt.toLocaleTimeString()}`
                : 'Live updates connected'
              : liveStatus === 'reconnecting'
                ? 'Reconnecting to live updates...'
                : 'Connecting to live updates...'}
          </div>
        </header>

        {notice && (
          <div className="admin-notice">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss message">×</button>
          </div>
        )}

        {activationCodeCustomerId && (
          <div className="admin-notice admin-progress-notice" role="status">
            <span className="admin-progress-spinner" aria-hidden="true" />
            <span>
              Generating the activation code and trying to send the email. This may take up to 30 seconds.
            </span>
          </div>
        )}

        {error && (
          <div className="admin-notice admin-notice-error" role="alert">
            <span>{error}</span>
            {activationEmailRetryCustomer && (
              <button
                type="button"
                className="admin-outline admin-email-retry"
                disabled={saving}
                onClick={retryActivationEmail}
              >
                {saving ? 'Sending...' : 'Retry activation email'}
              </button>
            )}
            <button
              onClick={() => {
                setError('')
                setActivationEmailRetryCustomer(null)
              }}
              aria-label="Dismiss error"
            >×</button>
          </div>
        )}

        {loading && <p className="admin-empty">Loading data from BarberBro database...</p>}

        {!loading && error && !activationEmailRetryCustomer && (
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
                activationCodeCustomerId={activationCodeCustomerId}
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
              <div>
                <h2>Barbers</h2>
                <p>Select a barber to see haircut, earnings, and customer insights.</p>
              </div>
              <button className="admin-primary" onClick={() => openBarberModal()}>＋ Add Barber</button>
            </div>

            <div className="barber-workspace">
              <div className="barber-selector-list" role="group" aria-label="Barber list">
                {barbers.map((barber) => (
                  <button
                    className={`barber-selector ${selectedBarberId === barber.id ? 'selected' : ''}`}
                    key={barber.id}
                    type="button"
                    aria-pressed={selectedBarberId === barber.id}
                    onClick={() => setSelectedBarberId(barber.id)}
                  >
                    <span className="barber-selector-copy">
                      <strong>{barber.name}</strong>
                      <small>{barber.specialty || 'General barber'}</small>
                    </span>
                    <span className={`barber-selector-status ${barber.is_active ? 'active' : ''}`}>
                      {barber.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </button>
                ))}
                {barbers.length === 0 && (
                  <p className="admin-empty">No barbers yet. Add one to start tracking performance.</p>
                )}
              </div>

              <div className="barber-detail-panel">
                {selectedBarber ? (
                  <BarberPerformanceDetails
                    barber={selectedBarber}
                    onEdit={() => openBarberModal(selectedBarber)}
                    onDelete={() => removeBarber(selectedBarber)}
                  />
                ) : (
                  <p className="barber-detail-empty">Choose a barber to view their performance.</p>
                )}
              </div>
            </div>
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
              activationCodeCustomerId={activationCodeCustomerId}
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
                <div><h2>Reward eligibility</h2><p>Members redeem eligible rewards directly from the customer app.</p></div>
              </div>
              <p className="admin-empty">
                {eligible === 0
                  ? 'No members currently meet the reward threshold.'
                  : `${eligible} ${eligible === 1 ? 'member' : 'members'} currently meet the reward threshold. They can redeem in the customer app.`}
              </p>
            </div>

            <div className="admin-panel" style={{ marginTop: 24 }}>
              <div className="admin-panel-heading">
                <div><h2>Redemption History</h2><p>Rewards claimed by customers, newest first.</p></div>
                <span className="admin-tag active-tag">{rewardRedemptions.length} shown</span>
              </div>
              <RewardRedemptionTable redemptions={rewardRedemptions} />
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
              Hold the customer app QR steady, fully inside the camera view, and make sure it is well lit. The visit will record automatically when detected.
            </p>
            <video
              id="admin-qr-reader"
              ref={qrVideoRef}
              autoPlay
              muted
              playsInline
            />
            <div className="admin-scan-actions">
              <button type="button" className="admin-outline" onClick={switchQrCamera}>
                Switch to {qrFacingMode === 'environment' ? 'front' : 'rear'} camera
              </button>
              <button
                type="button"
                className="admin-outline"
                onClick={() => qrImageInputRef.current?.click()}
              >
                Scan QR from image or screenshot
              </button>
              <input
                ref={qrImageInputRef}
                className="admin-scan-image-input"
                type="file"
                accept="image/*"
                onChange={handleQrImageChange}
              />
            </div>
            {qrScanPaused && (
              <button type="button" className="admin-outline admin-scan-again" onClick={resumeQrScanner}>
                Scan another QR
              </button>
            )}
            {qrScanStatus && (
              <p className={`admin-scan-status ${/unable|invalid|failed|not valid|no camera|blocked|not found|no qr code/i.test(qrScanStatus) ? 'admin-scan-status-error' : ''}`}>
                {qrScanStatus}
              </p>
            )}
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

function BarberPerformanceDetails({ barber, onEdit, onDelete }) {
  const periods = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'year', label: 'This year' },
  ]

  return (
    <div className="barber-performance-details" aria-live="polite">
      <header className="barber-performance-header">
        <div>
          <h3>{barber.name}</h3>
          <p>{barber.specialty}</p>
        </div>
        <div className="barber-detail-actions">
          <span className={`admin-tag ${barber.isActive ? 'active-tag' : 'barber-inactive-tag'}`}>
            {barber.isActive ? 'Active' : 'Inactive'}
          </span>
          <button className="admin-action-button" onClick={onEdit} type="button">Edit</button>
          <button className="admin-action-button admin-delete-button" onClick={onDelete} type="button">Delete</button>
        </div>
      </header>

      <div className="barber-charts-grid">
        <BarberPeriodChart
          title="Haircuts"
          variant="haircuts"
          metrics={periods.map((period) => ({
            label: period.label,
            value: barber.haircuts[period.key],
          }))}
          formatValue={(value) => String(value)}
        />
        <BarberPeriodChart
          title="Earnings"
          variant="earnings"
          metrics={periods.map((period) => ({
            label: period.label,
            value: barber.earnings[period.key],
          }))}
          formatValue={(value) => `₱${formatMoney(value)}`}
        />
      </div>

      <div className="barber-insights">
        <section>
          <h4>Most requested haircut</h4>
          {barber.topServices.length ? (
            <ul>
              {barber.topServices.map((service) => (
                <li key={service.name}>
                  <span>{service.name}</span>
                  <strong>{service.count} visits</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="barber-insight-empty">No repeat style recorded yet.</p>
          )}
        </section>
        <section>
          <h4>Repeat customers</h4>
          {barber.topCustomers.length ? (
            <ul>
              {barber.topCustomers.map((customer) => (
                <li key={customer.name}>
                  <span>{customer.name}</span>
                  <strong>{customer.count} visits</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="barber-insight-empty">No repeat customer recorded yet.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function BarberPeriodChart({ title, variant, metrics, formatValue }) {
  const maximum = Math.max(...metrics.map((metric) => metric.value), 0)

  return (
    <section className="barber-chart" aria-label={`${title} by period`}>
      <h4>{title}</h4>
      <ul className="barber-chart-list">
        {metrics.map((metric) => {
          const width = maximum > 0 && metric.value > 0
            ? Math.max(4, (metric.value / maximum) * 100)
            : 0

          return (
            <li className="barber-chart-row" key={metric.label}>
              <span className="barber-chart-label">{metric.label}</span>
              <span className="barber-chart-track" aria-hidden="true">
                <span
                  className={`barber-chart-fill barber-chart-fill-${variant}`}
                  style={{ width: `${width}%` }}
                />
              </span>
              <strong className="barber-chart-value">{formatValue(metric.value)}</strong>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CustomerTable({ customers, rewardTarget, activationCodeCustomerId, onCreateCode, onDelete }) {
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
              <td>
                <strong>{c.name}</strong>
                <span className="admin-cell-sub">
                  {c.email || 'No email address'}{c.phone ? ` · ${c.phone}` : ''}
                </span>
              </td>
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
                  <button
                    disabled={!onCreateCode || Boolean(activationCodeCustomerId)}
                    className="admin-action-button"
                    onClick={() => onCreateCode(c)}
                  >
                    {activationCodeCustomerId === String(c.id) ? 'Sending email...' : 'Generate code'}
                  </button>
                ) : c.stamps >= (rewardTarget || 10) ? (
                  <span className="admin-cell-sub">Redeem in customer app</span>
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

function RewardRedemptionTable({ redemptions }) {
  if (!redemptions.length) {
    return <p className="admin-empty">No rewards have been redeemed yet.</p>
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>CUSTOMER</th><th>REWARD</th><th>STAMPS</th><th>REDEEMED</th></tr></thead>
        <tbody>
          {redemptions.map((redemption) => (
            <tr key={redemption.id}>
              <td>
                <strong>{redemption.customer || 'Member'}</strong>
                <span className="admin-cell-sub">{redemption.memberCode}</span>
              </td>
              <td>{redemption.reward}</td>
              <td>{redemption.stamps} stamps</td>
              <td>{redemption.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default App