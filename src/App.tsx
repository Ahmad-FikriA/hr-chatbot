import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Chat } from './pages/Chat'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import './App.css'

function Gate() {
  const { user, loading } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="spinner" aria-label="Loading" />
      </div>
    )
  }

  if (!user) {
    return mode === 'login'
      ? <Login onSwitch={() => setMode('register')} />
      : <Register onSwitch={() => setMode('login')} />
  }

  return <Chat />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
