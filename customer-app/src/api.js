
const API_URL =
  import.meta.env.VITE_API_URL || 'https://barberbro-1.onrender.com/api'

export async function checkBackend() {
  const response = await fetch(`${API_URL}/health`)

  if (!response.ok) {
    throw new Error('Backend connection failed')
  }

  return response.json()
}

export default API_URL
