'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SERVER_URL } from '../../lib/types';

interface Stats {
  players: number;
  roundsPlayed: number;
  recentTotalStaked: number;
  recentTotalPaidOut: number;
  recentHousePnl: number;
  jackpot: { major: number; grand: number };
}

interface RecentRound {
  roundId: string;
  index: number;
  winningChain: string;
  winningTxid: string;
  totalStaked: number;
  totalPaidOut: number;
  awards: { tier: string; amount: number }[];
}

interface AdminPlayer {
  id: string;
  name: string;
  currency: string;
  balance: number;
  streak: number;
}

interface Session {
  token: string;
  role: string;
  permissions: string[];
}

const STORAGE_KEY = 'ates-admin-session';

function AdminLogin({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('superadmin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError('Geçersiz kullanıcı adı veya şifre.');
        return;
      }
      const data = await res.json();
      onLogin({
        token: data.token,
        role: data.role,
        permissions: data.permissions,
      });
    } catch {
      setError('Sunucuya ulaşılamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          ATES<span>.</span> Admin
          <span className="badge">Giriş</span>
        </div>
        <Link className="pill" href="/">
          ← Oyuna dön
        </Link>
      </div>
      <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
        <h2>Operatör Girişi</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          Bu panel yalnızca yetkili operatörler içindir. Oyuncular erişemez.
        </p>
        <form onSubmit={submit}>
          <label style={{ display: 'block', marginTop: 12 }}>
            Kullanıcı adı
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            Şifre
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          {error && (
            <div className="toast err" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
          <button
            className="btn"
            type="submit"
            disabled={busy}
            style={{ marginTop: 16, width: '100%' }}
          >
            {busy ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rounds, setRounds] = useState<RecentRound[]>([]);
  const [players, setPlayers] = useState<AdminPlayer[]>([]);

  useEffect(() => {
    const raw =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;
    if (raw) {
      try {
        setSession(JSON.parse(raw) as Session);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const login = (s: Session) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    setSession(s);
  };

  const logout = useCallback(() => {
    if (session) {
      fetch(`${SERVER_URL}/api/admin/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}` },
      }).catch(() => undefined);
    }
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setStats(null);
    setPlayers([]);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const auth = { authorization: `Bearer ${session.token}` };
    let cancelled = false;
    const load = () => {
      fetch(`${SERVER_URL}/api/admin/stats`, { headers: auth })
        .then((r) => {
          if (r.status === 401) {
            logout();
            return null;
          }
          return r.ok ? r.json() : null;
        })
        .then((d) => !cancelled && d && setStats(d))
        .catch(() => undefined);
      if (session.permissions.includes('players:read')) {
        fetch(`${SERVER_URL}/api/admin/players`, { headers: auth })
          .then((r) => (r.ok ? r.json() : []))
          .then((d) => !cancelled && Array.isArray(d) && setPlayers(d))
          .catch(() => undefined);
      }
      fetch(`${SERVER_URL}/api/rounds/recent`)
        .then((r) => r.json())
        .then((d) => !cancelled && setRounds(d))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [session, logout]);

  if (!session) {
    return <AdminLogin onLogin={login} />;
  }

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          ATES<span>.</span> Admin
          <span className="badge">{session.role}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="pill" href="/">
            ← Oyuna dön
          </Link>
          <button className="pill" onClick={logout}>
            Çıkış
          </button>
        </div>
      </div>

      <div className="toast err" style={{ marginBottom: 16 }}>
        Üretimde bu panel ayrıca zorunlu 2FA + IP allowlist arkasında olmalı
        (spec Bölüm 6.A / 7). Kimlik doğrulama ve RBAC şimdi etkin.
      </div>

      <div className="grid">
        <div className="card">
          <h2>Genel</h2>
          <div className="history-row">
            <span>Oyuncu sayısı</span>
            <b>{stats?.players ?? 0}</b>
          </div>
          <div className="history-row">
            <span>Oynanan tur</span>
            <b>{stats?.roundsPlayed ?? 0}</b>
          </div>
          <div className="history-row">
            <span>Son turlar — toplam bahis (USD)</span>
            <b>{(stats?.recentTotalStaked ?? 0).toFixed(2)}</b>
          </div>
          <div className="history-row">
            <span>Son turlar — toplam ödeme (USD)</span>
            <b>{(stats?.recentTotalPaidOut ?? 0).toFixed(2)}</b>
          </div>
          <div className="history-row">
            <span>Ev kâr/zarar (P&L, USD)</span>
            <b
              style={{
                color:
                  (stats?.recentHousePnl ?? 0) >= 0
                    ? 'var(--accent-2)'
                    : 'var(--danger)',
              }}
            >
              {(stats?.recentHousePnl ?? 0).toFixed(2)}
            </b>
          </div>
        </div>

        <div className="card">
          <h2>Jackpot Havuzları</h2>
          <div className="jackpots">
            <div className="jp">
              <div className="tier">Major</div>
              <div className="amount">
                {(stats?.jackpot.major ?? 0).toFixed(0)}
              </div>
            </div>
            <div className="jp">
              <div className="tier">Grand</div>
              <div className="amount">
                {(stats?.jackpot.grand ?? 0).toFixed(0)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {session.permissions.includes('players:read') && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Oyuncular</h2>
          <table>
            <thead>
              <tr>
                <th>Ad</th>
                <th>Para birimi</th>
                <th>Bakiye</th>
                <th>Streak</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.currency}</td>
                  <td>{p.balance.toFixed(2)}</td>
                  <td>{p.streak}</td>
                </tr>
              ))}
              {players.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--muted)' }}>
                    Henüz oyuncu yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Son Turlar</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Zincir</th>
              <th>Kazanan TXID</th>
              <th>Bahis</th>
              <th>Ödeme</th>
              <th>Jackpot</th>
              <th>Doğrula</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r.roundId}>
                <td>{r.index}</td>
                <td>{r.winningChain}</td>
                <td className="mono">…{r.winningTxid.slice(-12)}</td>
                <td>{r.totalStaked.toFixed(2)}</td>
                <td>{r.totalPaidOut.toFixed(2)}</td>
                <td>
                  {r.awards.length
                    ? r.awards.map((a) => a.tier).join(', ')
                    : '—'}
                </td>
                <td>
                  <Link href={`/verify?roundId=${r.roundId}`}>link</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
