import { createContext, useContext, useEffect, useState } from 'react';
import api from '../services/api';
const AuthContext = createContext();
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/auth/me').then(r => setUser(r.data.user)).catch(() => {}).finally(() => setLoading(false)); }, []);
  return <AuthContext.Provider value={{ user, setUser, loading }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
