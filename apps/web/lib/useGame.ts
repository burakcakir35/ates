'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  BetLimits,
  BetResult,
  PlayerInfo,
  PublicRoundState,
  SettledRound,
  SERVER_URL,
} from './types';

interface BetSelection {
  parity?: 'even' | 'odd';
  range?: 'low' | 'high';
  mod?: number;
  residue?: number;
  char?: string;
}

export interface MyResult {
  roundId: string;
  results: BetResult[];
}

export interface PlaceBetResponse {
  ok: boolean;
  betId?: string;
  error?: string;
}

export interface AutoPickResponse {
  ok: boolean;
  placed?: { betId: string; type: string; selection: Record<string, unknown> }[];
  error?: string;
}

export function useGame(name: string, currency: string) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [limits, setLimits] = useState<BetLimits | null>(null);
  const [state, setState] = useState<PublicRoundState | null>(null);
  const [lastResult, setLastResult] = useState<SettledRound | null>(null);
  const [myResult, setMyResult] = useState<MyResult | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      const storedId = localStorage.getItem('ates:playerId') ?? undefined;
      socket.emit(
        'player:hello',
        { playerId: storedId, name, currency },
        (resp: {
          ok: boolean;
          player: PlayerInfo;
          limits: BetLimits;
          state: PublicRoundState;
        }) => {
          if (resp?.ok) {
            localStorage.setItem('ates:playerId', resp.player.id);
            setPlayer(resp.player);
            setLimits(resp.limits ?? null);
            setState(resp.state);
          }
        },
      );
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('round:state', (s: PublicRoundState) => setState(s));
    socket.on('wallet', (w: { balance: number; streak: number }) => {
      setPlayer((p) => (p ? { ...p, balance: w.balance, streak: w.streak } : p));
    });
    socket.on('round:result', (r: SettledRound) => setLastResult(r));
    socket.on('round:myResult', (r: MyResult) => setMyResult(r));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placeBet = useCallback(
    (type: string, selection: BetSelection, amount: number) =>
      new Promise<PlaceBetResponse>((resolve) => {
        const socket = socketRef.current;
        if (!socket || !player) {
          resolve({ ok: false, error: 'Not connected' });
          return;
        }
        socket.emit(
          'bet:place',
          { playerId: player.id, type, selection, amount },
          (resp: PlaceBetResponse) => resolve(resp),
        );
      }),
    [player],
  );

  const autoPick = useCallback(
    (count: number, amount: number) =>
      new Promise<AutoPickResponse>((resolve) => {
        const socket = socketRef.current;
        if (!socket || !player) {
          resolve({ ok: false, error: 'Not connected' });
          return;
        }
        socket.emit(
          'bet:autopick',
          { playerId: player.id, count, amount },
          (resp: AutoPickResponse) => resolve(resp),
        );
      }),
    [player],
  );

  return {
    connected,
    player,
    limits,
    state,
    lastResult,
    myResult,
    placeBet,
    autoPick,
  };
}
