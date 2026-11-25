
import { Capacitor } from '@capacitor/core'

const DEFAULT_API_URL = 'https://barberbro-1.onrender.com/api'

function resolveApiUrl() {
  const configuredApiUrl = import.meta.env.VITE_API_URL

  if (Capacitor.isNativePlatform()) {
    return configuredApiUrl || DEFAULT_API_URL
  }

  if (configuredApiUrl) {
    return configuredApiUrl
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname || ''

    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      return 'http://localhost:5000/api'
    }
  }

  return DEFAULT_API_URL
}

const API_URL = resolveApiUrl()

export function subscribeToUpdates(token, onUpdate, onStatus, onUnauthorized) {
  let active = true
  let controller
  let retryTimer
  let retryResolver

  async function connect() {
    onStatus('connecting')

    while (active) {
      controller = new AbortController()

      try {
        const response = await fetch(`${API_URL}/events`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (response.status === 401) {
          onUnauthorized()
          return
        }
        if (!response.ok || !response.body) {
          throw new Error(`Realtime connection failed (${response.status})`)
        }

        onStatus('connected')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (active) {
            const { value, done } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
            const messages = buffer.split('\n\n')
            buffer = messages.pop() || ''

            for (const message of messages) {
              if (message.split('\n').some((line) => line === 'event: update')) {
                onUpdate()
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        if (active) onStatus('reconnecting')
      } catch (error) {
        if (!active || error.name === 'AbortError') return
        onStatus('reconnecting')
      }

      if (!active) return
      await new Promise((resolve) => {
        retryResolver = resolve
        retryTimer = window.setTimeout(resolve, 3000)
      })
      retryResolver = null
      retryTimer = null
    }
  }

  connect()

  return () => {
    active = false
    controller?.abort()
    window.clearTimeout(retryTimer)
    retryResolver?.()
  }
}

export async function checkBackend() {
  const response = await fetch(`${API_URL}/health`)

  if (!response.ok) {
    throw new Error('Backend connection failed')
  }

  return response.json()
}

export default API_URL
