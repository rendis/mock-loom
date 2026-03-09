function randomString(size: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('')
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = randomString(64)
  const encoder = new TextEncoder()
  const hashed = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  const challenge = toBase64Url(hashed)
  const state = randomString(32)
  return { verifier, challenge, state }
}
