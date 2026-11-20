import { createContext, useContext, useEffect, useState } from 'react';
import { authApi, setAccessToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function handleSessionExpired() {
      setAccessToken('');
      setUser(null);
    }

    window.addEventListener('auth:expired', handleSessionExpired);
    return () => window.removeEventListener('auth:expired', handleSessionExpired);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // try refresh first for cookie sessions
        const r = await authApi.refresh().catch(() => null);
        if (r?.accessToken) setAccessToken(r.accessToken);
        if (r?.user) { setUser(r.user); return; }
        const data = await authApi.me();
        setUser(data.user);
      } catch {
        setAccessToken('');
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email, password) {
    const data = await authApi.login(email, password);
    if (data.accessToken) setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function register(name, email, password) {
    const data = await authApi.register(name, email, password);
    if (data.accessToken) setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    try { await authApi.logout(); } catch { /* logging out locally anyway */ }
    setAccessToken('');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() { return useContext(AuthContext); }
