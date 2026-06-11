'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SERVER_URL } from '../../lib/types';

interface VerifyResult {
  roundId: string;
  valid: boolean;
  commitHash: string;
  serverSeed: string;
  beacon: Record<string, string>;
  resultHash: string;
  coinPool: string[];
  winningChain: string;
  winningTxid: string;
}

function VerifyInner() {
  const params = useSearchParams();
  const [roundId, setRoundId] = useState(params.get('roundId') ?? '');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify(id: string) {
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`${SERVER_URL}/api/verify/${id}`);
      if (!r.ok) {
        setError('Tur bulunamadı (yalnızca son turlar saklanır).');
        return;
      }
      setResult(await r.json());
    } catch {
      setError('Sunucuya ulaşılamadı.');
    }
  }

  useEffect(() => {
    const id = params.get('roundId');
    if (id) {
      void verify(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          ATES<span>.</span> Provably Fair
        </div>
        <Link className="pill" href="/">
          ← Oyuna dön
        </Link>
      </div>

      <div className="card">
        <h2>Tur Doğrulama</h2>
        <div className="row">
          <input
            value={roundId}
            onChange={(e) => setRoundId(e.target.value)}
            placeholder="roundId"
            style={{ flex: 1, minWidth: 240 }}
          />
          <button className="btn" onClick={() => verify(roundId)}>
            Doğrula
          </button>
        </div>
        <p className="muted">
          Sunucu, açıklanan server seed + zincir beacon hash&apos;lerinden sonucu
          yeniden hesaplar. 20-coin havuzu commit + tur id&apos;den, kazanan coin
          ise sonuç hash&apos;inden yeniden türetilir. Hepsi birebir eşleşiyorsa
          tur adildir.
        </p>

        {error && <div className="toast err">{error}</div>}

        {result && (
          <>
            <div className={`toast ${result.valid ? 'win' : 'err'}`}>
              {result.valid
                ? '✓ Doğrulandı — sonuç açıklanan girdilerle birebir yeniden üretildi.'
                : '✗ Doğrulama başarısız — girdiler sonuçla eşleşmiyor.'}
            </div>
            <table style={{ marginTop: 12 }}>
              <tbody>
                <tr>
                  <th>Round ID</th>
                  <td className="mono">{result.roundId}</td>
                </tr>
                <tr>
                  <th>Commit Hash</th>
                  <td className="mono">{result.commitHash}</td>
                </tr>
                <tr>
                  <th>Server Seed</th>
                  <td className="mono">{result.serverSeed}</td>
                </tr>
                {Object.entries(result.beacon).map(([chain, hash]) => (
                  <tr key={chain}>
                    <th>Beacon · {chain}</th>
                    <td className="mono">{hash}</td>
                  </tr>
                ))}
                <tr>
                  <th>Result Hash</th>
                  <td className="mono">{result.resultHash}</td>
                </tr>
                {result.coinPool && (
                  <tr>
                    <th>Coin Havuzu ({result.coinPool.length})</th>
                    <td className="mono">{result.coinPool.join(' · ')}</td>
                  </tr>
                )}
                <tr>
                  <th>Kazanan Coin (havuzdan)</th>
                  <td>{result.winningChain}</td>
                </tr>
                <tr>
                  <th>Kazanan TXID</th>
                  <td className="mono">{result.winningTxid}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="container">Yükleniyor…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
