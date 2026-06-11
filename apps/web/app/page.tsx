'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useGame } from '../lib/useGame';
import {
  BetCatalogueItem,
  ChainId,
  SERVER_URL,
  SettledRound,
} from '../lib/types';

interface BetOption {
  id: string;
  label: string;
  type: string;
  selection: Record<string, unknown>;
}

const BET_OPTIONS: BetOption[] = [
  { id: 'digit', label: 'Son karakter RAKAM', type: 'LAST_CHAR_DIGIT', selection: {} },
  { id: 'letter', label: 'Son karakter HARF', type: 'LAST_CHAR_LETTER', selection: {} },
  { id: 'even', label: 'Son karakter ÇİFT', type: 'LAST_CHAR_PARITY', selection: { parity: 'even' } },
  { id: 'odd', label: 'Son karakter TEK', type: 'LAST_CHAR_PARITY', selection: { parity: 'odd' } },
  { id: 'high', label: 'İlk karakter YÜKSEK', type: 'FIRST_CHAR_RANGE', selection: { range: 'high' } },
  { id: 'low', label: 'İlk karakter DÜŞÜK', type: 'FIRST_CHAR_RANGE', selection: { range: 'low' } },
  { id: 'sumEven', label: 'Toplam ÇİFT', type: 'SUM_PARITY', selection: { parity: 'even' } },
  { id: 'sumOdd', label: 'Toplam TEK', type: 'SUM_PARITY', selection: { parity: 'odd' } },
];

const CHAIN_LABEL: Record<ChainId, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  TRX: 'Tron',
  SOL: 'Solana',
};

function RevealTxid({ txid }: { txid: string }) {
  // Highlight the last character (most bets resolve on it).
  return (
    <div className="txid">
      {[...txid].map((ch, i) => (
        <span
          key={i}
          className={`ch ${i === txid.length - 1 ? 'hit' : ''}`}
          style={{ animationDelay: `${Math.min(i, 40) * 0.012}s` }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

export default function GamePage() {
  const [currency, setCurrency] = useState('USD');
  const { connected, player, state, lastResult, myResult, placeBet } = useGame(
    'Guest',
    currency,
  );
  const [catalogue, setCatalogue] = useState<BetCatalogueItem[]>([]);
  const [selected, setSelected] = useState<BetOption>(BET_OPTIONS[0]);
  const [amount, setAmount] = useState(5);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{ kind: string; msg: string } | null>(null);
  const [history, setHistory] = useState<SettledRound[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/bet-types`)
      .then((r) => r.json())
      .then(setCatalogue)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (lastResult) {
      setHistory((h) => [lastResult, ...h].slice(0, 8));
    }
  }, [lastResult]);

  useEffect(() => {
    if (!myResult || !state) {
      return;
    }
    if (myResult.roundId !== lastResult?.roundId) {
      return;
    }
    const won = myResult.results.some((r) => r.won);
    const total = myResult.results.reduce((s, r) => s + r.payout, 0);
    setToast(
      won
        ? { kind: 'win', msg: `Kazandın! +${total.toFixed(2)} ${currency}` }
        : { kind: 'lose', msg: 'Bu tur kaybettin.' },
    );
  }, [myResult, lastResult, state, currency]);

  const remainingMs = state ? Math.max(0, state.phaseEndsAt - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

  const multiplier = useMemo(() => {
    if (!state) return 0;
    const item = catalogue.find((c) => c.type === selected.type);
    return item ? item.multipliers[state.winningChain] : 0;
  }, [catalogue, selected, state]);

  const canBet = state?.phase === 'betting' && connected && !!player;

  async function onPlace() {
    setToast(null);
    const resp = await placeBet(selected.type, selected.selection, amount);
    if (!resp.ok) {
      setToast({ kind: 'err', msg: resp.error ?? 'Bahis başarısız' });
    } else {
      setToast({ kind: 'win', msg: `Bahis alındı: ${selected.label}` });
    }
  }

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          ATES<span>.</span> TXID Game
          <span className="badge">Play-Money</span>
        </div>
        <div className="row">
          <Link className="pill" href="/admin">
            Admin
          </Link>
          <span className={`pill`}>{connected ? '● Bağlı' : '○ Bağlanıyor'}</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="wallet">
          <div>
            <div className="muted">Bakiye ({player?.currency ?? currency})</div>
            <div className="balance">
              {(player?.balance ?? 0).toFixed(2)}
            </div>
          </div>
          <span className="pill">Streak: {player?.streak ?? 0}</span>
          <span className="pill">Oyuncu: {player?.name ?? 'Guest'}</span>
          <div style={{ marginLeft: 'auto' }} className="row">
            <span className="muted">Para birimi</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              title="Yeni oyuncu için para birimi (sayfayı yenileyince geçerli)"
            >
              <option>USD</option>
              <option>EUR</option>
              <option>TRY</option>
              <option>GBP</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="phase">
            <span className="name">
              {state?.phase === 'betting' && <span className="betting">BAHİS AÇIK</span>}
              {state?.phase === 'locking' && <span className="locking">SONUÇ HESAPLANIYOR</span>}
              {state?.phase === 'result' && <span className="result">SONUÇ</span>}
            </span>
            <span className="muted">
              Tur #{state?.index ?? '-'} · Zincir:{' '}
              {state ? CHAIN_LABEL[state.winningChain] : '-'}
            </span>
          </div>

          {state?.phase !== 'result' && (
            <>
              <div className="countdown">{remainingSec}s</div>
              <div className="bar">
                <div
                  style={{
                    width: `${
                      state ? Math.min(100, (remainingMs / 20000) * 100) : 0
                    }%`,
                  }}
                />
              </div>
            </>
          )}

          {state?.phase === 'result' && lastResult ? (
            <>
              <div className="muted" style={{ marginBottom: 6 }}>
                Kazanan TXID ({CHAIN_LABEL[lastResult.winningChain]})
              </div>
              <RevealTxid txid={lastResult.winningTxid} />
              {toast && (
                <div className={`toast ${toast.kind}`}>{toast.msg}</div>
              )}
              {lastResult.awards.length > 0 && (
                <div className="toast win">
                  🎉 Jackpot:{' '}
                  {lastResult.awards
                    .map((a) => `${a.tier} +${a.amount.toFixed(2)}`)
                    .join(', ')}
                </div>
              )}
              <div className="muted" style={{ marginTop: 8 }}>
                Doğrula:{' '}
                <Link href={`/verify?roundId=${lastResult.roundId}`}>
                  bu turun adaletini kontrol et
                </Link>
              </div>
            </>
          ) : (
            <div className="muted">
              Commit: <code>{state?.commitHash?.slice(0, 24)}…</code>
              <br />
              Sonucun kaynağı bahisler kilitlenmeden açıklanmaz (provably fair).
            </div>
          )}
        </div>

        <div className="card">
          <h2>Jackpot</h2>
          <div className="jackpots">
            <div className="jp">
              <div className="tier">Major</div>
              <div className="amount">{(state?.jackpot.major ?? 0).toFixed(0)}</div>
            </div>
            <div className="jp">
              <div className="tier">Grand</div>
              <div className="amount">{(state?.jackpot.grand ?? 0).toFixed(0)}</div>
            </div>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Canlı havuz: <b>{(state?.totalStaked ?? 0).toFixed(2)}</b> ·{' '}
            {state?.betCount ?? 0} bahis
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Bahis Yap</h2>
        <div className="bet-types">
          {BET_OPTIONS.map((opt) => {
            const item = catalogue.find((c) => c.type === opt.type);
            const mult =
              item && state ? item.multipliers[state.winningChain] : 0;
            return (
              <button
                key={opt.id}
                className={`bet-btn ${selected.id === opt.id ? 'active' : ''}`}
                onClick={() => setSelected(opt)}
              >
                <div className="label">{opt.label}</div>
                <div className="mult">{mult ? `${mult.toFixed(2)}x` : '—'}</div>
              </button>
            );
          })}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <span className="muted">Tutar</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ width: 120 }}
          />
          <span className="muted">
            Olası ödeme: {(amount * multiplier).toFixed(2)} {player?.currency}
          </span>
          <button
            className="btn"
            disabled={!canBet}
            onClick={onPlace}
            style={{ marginLeft: 'auto' }}
          >
            {canBet ? `Bahis Yap (${selected.label})` : 'Bahis Kapalı'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Son Turlar</h2>
        {history.length === 0 && <div className="muted">Henüz tur yok…</div>}
        {history.map((h) => (
          <div className="history-row" key={h.roundId}>
            <span>
              #{h.index} · {CHAIN_LABEL[h.winningChain]}
            </span>
            <span className="mono">…{h.winningTxid.slice(-10)}</span>
            <Link href={`/verify?roundId=${h.roundId}`}>doğrula</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
