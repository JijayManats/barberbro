
const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

export async function checkBackend() {
  const response = await fetch(`${API_URL}/health`)

  if (!response.ok) {
    throw new Error('Backend connection failed')
  }

  return response.json()
}

export default API_URL
