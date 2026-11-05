
function resolveApiUrl() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || ''

    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      return 'http://localhost:5000/api'
    }

    if (host.includes('onrender.com') || host.includes('render.com')) {
      return 'https://barberbro-1.onrender.com/api'
    }
  }

  return import.meta.env.VITE_API_URL || 'https://barberbro-1.onrender.com/api'
}

const API_URL = resolveApiUrl()

export async function checkBackend() {
  const response = await fetch(`${API_URL}/health`)

  if (!response.ok) {
    throw new Error('Backend connection failed')
  }

  return response.json()
}

export default API_URL
