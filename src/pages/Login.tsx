import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'

export function Login({ onSwitch }: { onSwitch: () => void }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="auth-mark">RB</span>
          <div className="brand-text">
            <span className="brand-name">ResBot</span>
            <span className="brand-sub">HR Resource Bot</span>
          </div>
        </div>

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-lede">Sign in to ask about leave, benefits, and policies.</p>

        {error && <div className="error-banner">{error}</div>}

        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-switch">
          New here?{' '}
          <button type="button" onClick={onSwitch}>Create an account</button>
        </p>
      </form>
    </div>
  )
}
