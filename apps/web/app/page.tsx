'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useGame } from '../lib/useGame';
import {
  CURRENCY_SYMBOL,
  SERVER_URL,
  SettledRound,
  WalletTx,
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
  const { connected, player, limits, state, lastResult, myResult, placeBet, autoPick } =
    useGame('Guest', currency);
  const [coinNames, setCoinNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<BetOption>(BET_OPTIONS[0]);
  const [amount, setAmount] = useState(5);
  const [autoCount, setAutoCount] = useState(3);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{ kind: string; msg: string } | null>(null);
  const [history, setHistory] = useState<SettledRound[]>([]);
  const [walletCoin, setWalletCoin] = useState('USDT');
  const [walletAmount, setWalletAmount] = useState(100);
  const [depositCoins, setDepositCoins] = useState<string[]>([]);
  const [lastTx, setLastTx] = useState<WalletTx | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/coins`)
      .then((r) => r.json())
      .then((coins: { id: string; name: string }[]) =>
        setCoinNames(Object.fromEntries(coins.map((c) => [c.id, c.name]))),
      )
      .catch(() => undefined);
    fetch(`${SERVER_URL}/api/fx/rates`)
      .then((r) => r.json())
      .then((d: { depositCoins: string[] }) => setDepositCoins(d.depositCoins))
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
        ? { kind: 'win', msg: `Kazandın! +${total.toFixed(2)} ${player?.currency ?? currency}` }
        : { kind: 'lose', msg: 'Bu tur kaybettin.' },
    );
  }, [myResult, lastResult, state, currency, player]);

  const remainingMs = state ? Math.max(0, state.phaseEndsAt - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

  const symbol = CURRENCY_SYMBOL[player?.currency ?? currency] ?? '';
  const coinLabel = (id: string) => coinNames[id] ?? id;

  const range = useMemo(() => {
    if (!state) return null;
    return state.multiplierRanges?.[selected.type] ?? null;
  }, [state, selected]);

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

  async function onAutoPick() {
    setToast(null);
    const resp = await autoPick(autoCount, amount);
    if (!resp.ok) {
      setToast({ kind: 'err', msg: resp.error ?? 'Oto doldur başarısız' });
    } else {
      setToast({
        kind: 'win',
        msg: `Oto doldur: ${resp.placed?.length ?? 0} bahis alındı (her biri ${amount} ${player?.currency})`,
      });
    }
  }

  async function wallet(kind: 'deposit' | 'withdraw') {
    setToast(null);
    if (!player) return;
    try {
      const r = await fetch(
        `${SERVER_URL}/api/wallet/${player.id}/${kind}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coin: walletCoin, amount: walletAmount }),
        },
      );
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setToast({ kind: 'err', msg: data.message ?? 'İşlem başarısız' });
        return;
      }
      setLastTx(data.tx as WalletTx);
      const tx = data.tx as WalletTx;
      setToast({
        kind: 'win',
        msg:
          kind === 'deposit'
            ? `Yatırım: ${tx.coinAmount} ${tx.coin} → ${tx.fiatAmount.toFixed(2)} ${tx.currency} (kur ${tx.rate.toFixed(4)})`
            : `Çekim: ${tx.fiatAmount.toFixed(2)} ${tx.currency} → ${tx.coinAmount.toFixed(8)} ${tx.coin} (kur ${tx.rate.toFixed(4)})`,
      });
    } catch {
      setToast({ kind: 'err', msg: 'Sunucuya ulaşılamadı' });
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
              {symbol}
              {(player?.balance ?? 0).toFixed(2)}
            </div>
          </div>
          <span className="pill">Streak: {player?.streak ?? 0}</span>
          <span className="pill">Oyuncu: {player?.name ?? 'Guest'}</span>
          {limits && (
            <span className="pill" title="Min bahis 0.50 USD'nin para birimindeki karşılığıdır">
              Min bahis: {symbol}
              {limits.min.toFixed(2)}
            </span>
          )}
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
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <span className="muted">Cüzdan (mock):</span>
          <select value={walletCoin} onChange={(e) => setWalletCoin(e.target.value)}>
            {depositCoins.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={walletAmount}
            onChange={(e) => setWalletAmount(Number(e.target.value))}
            style={{ width: 110 }}
          />
          <button className="btn" onClick={() => wallet('deposit')}>
            Yatır (coin → {player?.currency ?? currency})
          </button>
          <button className="btn" onClick={() => wallet('withdraw')}>
            Çek ({player?.currency ?? currency} → coin)
          </button>
        </div>
        {lastTx && (
          <div className="muted" style={{ marginTop: 6 }}>
            Son işlem: {lastTx.type === 'deposit' ? 'yatırım' : 'çekim'} ·{' '}
            {lastTx.coinAmount.toFixed(8)} {lastTx.coin} ↔ {lastTx.fiatAmount.toFixed(2)}{' '}
            {lastTx.currency} · kur {lastTx.rate.toFixed(4)}
          </div>
        )}
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
              Tur #{state?.index ?? '-'} ·{' '}
              {state?.winningChain
                ? `Kazanan coin: ${coinLabel(state.winningChain)}`
                : `Kazanan, ${state?.coinPool?.length ?? 20} coin'lik havuzdan beacon ile seçilecek`}
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
                Kazanan TXID ({coinLabel(lastResult.winningChain)})
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

          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              Bu turun coin havuzu ({state?.coinPool?.length ?? 0} coin · commit + tur
              id&apos;den türetilir, doğrulanabilir)
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {state?.coinPool?.map((c) => (
                <span
                  key={c.id}
                  className="pill"
                  style={
                    state.winningChain === c.id
                      ? { borderColor: 'var(--accent-2)', color: 'var(--accent-2)' }
                      : undefined
                  }
                  title={c.name}
                >
                  {c.id}
                </span>
              ))}
            </div>
          </div>
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
            Canlı havuz: <b>{(state?.totalStaked ?? 0).toFixed(2)}</b> USD ·{' '}
            {state?.betCount ?? 0} bahis
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Bahis Yap</h2>
        <div className="bet-types">
          {BET_OPTIONS.map((opt) => {
            const r = state?.multiplierRanges?.[opt.type];
            return (
              <button
                key={opt.id}
                className={`bet-btn ${selected.id === opt.id ? 'active' : ''}`}
                onClick={() => setSelected(opt)}
              >
                <div className="label">{opt.label}</div>
                <div className="mult">
                  {r
                    ? r.min === r.max
                      ? `${r.min.toFixed(2)}x`
                      : `${r.min.toFixed(2)}–${r.max.toFixed(2)}x`
                    : '—'}
                </div>
              </button>
            );
          })}
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          Oran aralığı: kazanan coin havuzdan çıkar; oran kazanan coin&apos;in
          alfabesine göre kesinleşir (hex / base58).
        </div>

        <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
          <span className="muted">Tutar</span>
          <input
            type="number"
            min={limits?.min ?? 0.5}
            step={0.5}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ width: 120 }}
          />
          <span className="muted">
            Olası ödeme:{' '}
            {range
              ? range.min === range.max
                ? (amount * range.min).toFixed(2)
                : `${(amount * range.min).toFixed(2)}–${(amount * range.max).toFixed(2)}`
              : '—'}{' '}
            {player?.currency}
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

        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <span className="muted">Oto Doldur</span>
          <select
            value={autoCount}
            onChange={(e) => setAutoCount(Number(e.target.value))}
            title="Kaç bahis otomatik doldurulsun"
          >
            <option value={3}>3 bahis</option>
            <option value={5}>5 bahis</option>
            <option value={10}>10 bahis</option>
          </select>
          <button className="btn" disabled={!canBet} onClick={onAutoPick}>
            Oto Doldur ({autoCount} × {amount} {player?.currency ?? currency})
          </button>
          <span className="muted">
            Oto seçim elle seçimle birebir aynı oran tablosunu kullanır.
          </span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Son Turlar</h2>
        {history.length === 0 && <div className="muted">Henüz tur yok…</div>}
        {history.map((h) => (
          <div className="history-row" key={h.roundId}>
            <span>
              #{h.index} · {coinLabel(h.winningChain)}
            </span>
            <span className="mono">…{h.winningTxid.slice(-10)}</span>
            <Link href={`/verify?roundId=${h.roundId}`}>doğrula</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
