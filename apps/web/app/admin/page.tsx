'use client';

import { useEffect, useState } from 'react';
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

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rounds, setRounds] = useState<RecentRound[]>([]);

  useEffect(() => {
    const load = () => {
      fetch(`${SERVER_URL}/api/admin/stats`)
        .then((r) => r.json())
        .then(setStats)
        .catch(() => undefined);
      fetch(`${SERVER_URL}/api/rounds/recent`)
        .then((r) => r.json())
        .then(setRounds)
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          ATES<span>.</span> Admin
          <span className="badge">Play-Money</span>
        </div>
        <Link className="pill" href="/">
          ← Oyuna dön
        </Link>
      </div>

      <div className="toast err" style={{ marginBottom: 16 }}>
        Bu panel prototipte korumasızdır. Üretimde RBAC + zorunlu 2FA + IP
        allowlist arkasında olmalı (spec Bölüm 6.A / 7).
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
            <span>Son turlar — toplam bahis</span>
            <b>{(stats?.recentTotalStaked ?? 0).toFixed(2)}</b>
          </div>
          <div className="history-row">
            <span>Son turlar — toplam ödeme</span>
            <b>{(stats?.recentTotalPaidOut ?? 0).toFixed(2)}</b>
          </div>
          <div className="history-row">
            <span>Ev kâr/zarar (P&L)</span>
            <b
              style={{
                color:
                  (stats?.recentHousePnl ?? 0) >= 0 ? 'var(--accent-2)' : 'var(--danger)',
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
              <div className="amount">{(stats?.jackpot.major ?? 0).toFixed(0)}</div>
            </div>
            <div className="jp">
              <div className="tier">Grand</div>
              <div className="amount">{(stats?.jackpot.grand ?? 0).toFixed(0)}</div>
            </div>
          </div>
        </div>
      </div>

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
                <td>{r.awards.length ? r.awards.map((a) => a.tier).join(', ') : '—'}</td>
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
