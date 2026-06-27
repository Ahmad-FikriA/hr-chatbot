import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'

export function Register({ onSwitch }: { onSwitch: () => void }) {
  const { register } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await register(email, password, name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
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

        <h1 className="auth-title">Create your account</h1>
        <p className="auth-lede">Takes a moment — then ask the bot anything.</p>

        {error && <div className="error-banner">{error}</div>}

        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <small className="field-hint">At least 8 characters.</small>
        </label>

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <p className="auth-switch">
          Already have an account?{' '}
          <button type="button" onClick={onSwitch}>Sign in</button>
        </p>
      </form>
    </div>
  )
}
