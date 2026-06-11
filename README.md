# ATES — TXID-Based Provably-Fair Betting Game (Play-Money Prototype)

A play-money prototype of the TXID betting game described in the project
specification. Players bet on the character properties of a transaction-hash
(TXID) that is revealed each round from a provably-fair, multi-chain beacon.

> **This is a play-money prototype.** There is **no real cryptocurrency, no
> custody of funds, no real-money wagering, no KYC/AML, and no gambling
> licence**. Balances are virtual. The real-money, custody, compliance and
> licensing layers from the spec (Sections 6.A, 6.B, 8, 10) are intentionally
> **not** implemented here — those require professional security audits, legal
> counsel, and a licensed operator. See "What is intentionally out of scope".

## What it does

- **Provably-fair rounds** using a commit/reveal scheme combined with a
  simulated multi-chain block-hash beacon (Solana/ETH/BTC/USDT-style). The
  winning TXID cannot be known before bets lock, and anyone can re-derive and
  verify the result afterwards.
- **Per-chain TXID generation & odds.** Each chain has its own alphabet
  (BTC/ETH/TRX use hex, Solana uses base58), so probabilities — and therefore
  fair payout multipliers — are computed per chain.
- **Shared rounds**: every player bets against the single winning TXID of the
  round.
- **Bet types**: last char digit/letter, last char even/odd, first char
  high/low, digit-sum parity, sum-mod-N, exact last char.
- **House edge / RTP**: payouts embed a configurable 6% edge (94% RTP).
- **Jackpots**: Mini/Minor (fixed) + Major/Grand (progressive), funded by a 4%
  bet contribution, plus the pure-chance "last 5 characters identical" Grand
  gate and a win-streak Grand gate.
- **Risk controls**: min/max bet and a per-round max-exposure cap.
- **Independent verification endpoint** and a verification UI page.

## Architecture

```
packages/engine   Pure, framework-agnostic game engine (fully unit-tested)
                  - chains, TXID generation, normalization
                  - commit/reveal fairness + beacon + result derivation
                  - bet evaluation, probabilities, payout multipliers
                  - jackpot logic, round settlement, exposure

apps/server       NestJS + Socket.IO realtime game server (in-memory state)
                  - round lifecycle state machine (betting → locking → result)
                  - play-money wallets, bet placement, jackpots
                  - REST: /api/health, /api/config, /api/bet-types,
                    /api/rounds/recent, /api/verify/:roundId
                  - admin API (auth + RBAC): /api/admin/login,
                    /api/admin/stats, /api/admin/players (see apps/server/src/admin)

apps/web          Next.js player UI + (authenticated) admin panel + verify page
```

The engine is deliberately separate and pure so the fairness maths can be
audited and tested in isolation, exactly as the spec requires ("isolated,
testable, auditable fairness engine").

## Running locally

Requires Node.js >= 20 and pnpm.

```bash
pnpm install
pnpm build

# terminal 1 — game server on :4000
pnpm --filter @ates/server start

# terminal 2 — web UI on :3000
pnpm --filter @ates/web dev
```

Then open http://localhost:3000 (player), http://localhost:3000/admin (operator
view), http://localhost:3000/verify (provably-fair check).

For development with hot reload:

```bash
pnpm dev   # runs server + web together
```

The web app reads the server URL from `NEXT_PUBLIC_SERVER_URL`
(default `http://localhost:4000`).

## Tests, lint, typecheck

```bash
pnpm test       # vitest across engine + server (incl. Monte-Carlo RTP check)
pnpm lint
pnpm typecheck
```

## Provably-fair model (prototype)

1. At round start the server generates a secret `serverSeed` and publishes its
   commitment `sha256(serverSeed)`.
2. Players bet during the betting window. Bets then **lock**.
3. After lock, a multi-chain beacon is captured (simulated here from fresh
   entropy, so it is unknowable to everyone — including the operator — before
   the lock).
4. `resultHash = sha256(serverSeed | beacon(BTC|ETH|TRX|SOL) | roundId)` and the
   winning TXID is derived deterministically from `resultHash`.
5. After the round the `serverSeed` is revealed. Anyone can recompute the result
   from the public commit + beacon + revealed seed via `/api/verify/:roundId`.

In production the simulated beacon would be replaced with real future block
hashes at each chain's safe confirmation depth (Solana primary for speed, BTC as
the delayed 6-block seal), exactly as described in spec Section 3.

## What is intentionally out of scope

These parts of the spec are **not** built here and must not be assumed safe to
ship without the proper professional work:

- Real cryptocurrency deposits/withdrawals, hot/cold wallets, private-key
  custody, on-chain reconciliation.
- KYC/AML, geo-blocking, responsible-gaming enforcement, audit/WORM logging.
- Gambling licensing and any legal/tax/compliance obligations.
- Admin authentication is implemented (login + RBAC roles: superadmin / finance /
  support / readonly; player access to /api/admin/* returns 401/403). Remaining
  production P0: mandatory 2FA + IP allowlist. Local dev passwords default to
  `<role><role>123` and are overridable via `ADMIN_<ROLE>_PASSWORD` env vars.
- Persistent storage (PostgreSQL/Redis). State is in-memory and resets on
  restart.
