// Tide Runner — a launch sniper with fast exits for the pump.fun replay.
//
// Lesson from the dev window: by the time a coin's tape proves demand, the
// move is already over — chasing momentum buys the top. The only edge left
// is being first: buy in the first few slots after a curve is created,
// before the crowd arrives, with a small stake, and then get out within
// seconds: the launch pop is the whole trade. The exit is a take-profit at
// +15%, a stop-loss at -12%, a hard time limit of about 30 slots, or the
// creator selling — whichever comes first. Losers are cut fast and the five
// open-position slots keep turning over to fresh launches.
//
// Two filters keep the worst launches out: the creator must not have sold,
// nobody else may have sold yet, and a launch bundled by many wallets in
// its first slots is skipped — that cluster is usually waiting to dump.
//
// The bot speaks agent-fun/replay/v2 through the vendored shim: the harness
// sends a hello, then one batch per slot, then done. Every decision is a
// pure function of the batches seen so far — no clock, no randomness, no
// I/O — so the two graded executions agree byte for byte.

import { LAMPORTS_PER_SOL, runBot, type Batch, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

// --- tunables (lamports where a size is meant) --------------------------------

const STAKE_LAMPORTS = (LAMPORTS_PER_SOL * 5n) / 100n; // 0.05 SOL per coin
const MIN_BUY_LAMPORTS = LAMPORTS_PER_SOL / 100n; // 0.01 SOL: the guardrail floor
const MAX_AGE_SLOTS = 3; // a first buy must be decided within 3 slots of launch
const MIN_REAL_SOL_LAMPORTS = (LAMPORTS_PER_SOL * 3n) / 10n; // 0.3 SOL real reserve
const MAX_BUYERS = 3; // more distinct buyers this early smells like a bundle
const MAX_DEV_BUY_LAMPORTS = (LAMPORTS_PER_SOL * 5n) / 2n; // 2.5 SOL creator buy
// Fast exits: the launch pop is the whole trade.
const TAKE_PROFIT_NUM = 125n; // sell at +25% of cost
const TAKE_PROFIT_DEN = 100n;
const STOP_LOSS_NUM = 88n; // sell at -12% of cost
const STOP_LOSS_DEN = 100n;
const MAX_HOLD_SLOTS = 10; // never hold past ~10 slots after the buy
const SLIPPAGE_BPS = 10_000; // fill at the market: never refuse a fill over the price moving in the latency

// --- per-coin tape ------------------------------------------------------------

/** Everything the bot remembers about one curve. */
interface Tape {
  mint: Pubkey;
  createdSlot: number;
  creator: Pubkey;
  /** Launch price as a fraction: virtual quote / virtual token reserves. */
  firstQ: bigint;
  firstT: bigint;
  /** Highest price seen since launch, same fraction form. */
  highQ: bigint;
  highT: bigint;
  trades: number;
  buySol: bigint;
  sellSol: bigint;
  buyers: Set<string>;
  devBuy: bigint; // SOL the creator bought
  devSold: boolean; // the creator sold
  soldByOthers: bigint; // SOL sold by anyone but the creator
  complete: boolean;
  decided: boolean; // a first buy was decided (or the coin aged out)
  boughtSlot: number; // slot the buy was decided on, -1 when never bought
}

const tapes = new Map<Pubkey, Tape>();

/** Compare two fractions a/b and c/d: -1, 0 or 1. */
function cmpFrac(aNum: bigint, aDen: bigint, bNum: bigint, bDen: bigint): number {
  const left = aNum * bDen;
  const right = bNum * aDen;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Fold this batch's events into the tapes. */
function watchBatch(batch: Batch): void {
  for (const e of batch.events) {
    if (e.event === 'CreateEvent') {
      const tape: Tape = {
        mint: e.mint,
        createdSlot: e.slot,
        creator: e.creator,
        firstQ: BigInt(e.virtual_quote_reserves),
        firstT: BigInt(e.virtual_token_reserves),
        highQ: BigInt(e.virtual_quote_reserves),
        highT: BigInt(e.virtual_token_reserves),
        trades: 0,
        buySol: 0n,
        sellSol: 0n,
        buyers: new Set<string>(),
        devBuy: 0n,
        devSold: false,
        soldByOthers: 0n,
        complete: false,
        decided: false,
        boughtSlot: -1,
      };
      tapes.set(e.mint, tape);
    } else if (e.event === 'TradeEvent') {
      const tape = tapes.get(e.mint);
      if (tape === undefined || tape.complete) continue;
      const sol = BigInt(e.sol_amount);
      tape.trades += 1;
      if (e.is_buy) {
        tape.buySol += sol;
        tape.buyers.add(e.user);
        if (e.user === tape.creator) tape.devBuy += sol;
      } else {
        tape.sellSol += sol;
        if (e.user === tape.creator) tape.devSold = true;
        else tape.soldByOthers += sol;
      }
      const q = BigInt(e.virtual_quote_reserves);
      const t = BigInt(e.virtual_token_reserves);
      if (cmpFrac(q, t, tape.highQ, tape.highT) > 0) {
        tape.highQ = q;
        tape.highT = t;
      }
    } else {
      const tape = tapes.get(e.mint);
      if (tape !== undefined) tape.complete = true;
    }
  }
}

/** A launch is buyable when it is fresh, liquid, and nobody is selling yet. */
function entrySignal(
  tape: Tape,
  curve: { real_quote_reserves: bigint } | undefined,
  slot: number,
): boolean {
  if (tape.decided || tape.complete || curve === undefined) return false;
  if (slot - tape.createdSlot > MAX_AGE_SLOTS) return false;
  if (curve.real_quote_reserves < MIN_REAL_SOL_LAMPORTS) return false;
  if (tape.devBuy > MAX_DEV_BUY_LAMPORTS) return false;
  if (tape.devSold) return false;
  if (tape.soldByOthers > 0n) return false;
  if (tape.buyers.size > MAX_BUYERS) return false;
  return true;
}

// --- the bot ------------------------------------------------------------------

await runBot({
  onBatch(state: BotState, batch: Batch): OrderInput[] {
    watchBatch(batch);
    const orders: OrderInput[] = [];
    const caps = state.hello.caps;
    const tx = state.txFeeLamports();
    let free = state.freeCashLamports();
    let slots = caps.max_open_positions - state.committedPositionCount();

    // Exits first: free a slot before deciding new buys.
    for (const [mint, holding] of state.positions) {
      const tape = tapes.get(mint);
      const curve = state.curves.get(mint);
      if (tape === undefined || curve === undefined || curve.complete) continue;
      const tokens = holding.token_amount;
      const cost = holding.cost_lamports;
      // value/cost as a fraction: tokens*q / (t*cost).
      const num = tokens * curve.virtual_quote_reserves;
      const den = curve.virtual_token_reserves * cost;
      const takeProfit = num * TAKE_PROFIT_DEN >= TAKE_PROFIT_NUM * den;
      const stopLoss = num * STOP_LOSS_DEN <= STOP_LOSS_NUM * den;
      const stale = tape.boughtSlot >= 0 && batch.slot - tape.boughtSlot > MAX_HOLD_SLOTS;
      const devDumped = tape.devSold;
      if (takeProfit || stopLoss || stale || devDumped) {
        if (orders.length < caps.max_orders_per_batch) {
          orders.push({ side: 'sell', mint, token_amount: tokens, max_slippage_bps: SLIPPAGE_BPS });
        }
      }
    }

    // Entries: walk the batch's events in order, decide each fresh coin once.
    for (const e of batch.events) {
      if (orders.length >= caps.max_orders_per_batch) break;
      if (e.event !== 'TradeEvent' && e.event !== 'CreateEvent') continue;
      const tape = tapes.get(e.mint);
      if (tape === undefined) continue;
      const curve = state.curves.get(e.mint);
      if (!entrySignal(tape, curve, batch.slot)) continue;
      tape.decided = true;
      if (slots <= 0) continue;
      const cap = state.maxBuyLamports(e.mint);
      const amount = cap < STAKE_LAMPORTS ? cap : STAKE_LAMPORTS;
      if (amount < MIN_BUY_LAMPORTS || free < amount + tx) continue;
      orders.push({ side: 'buy', mint: e.mint, quote_lamports: amount, max_slippage_bps: SLIPPAGE_BPS });
      tape.boughtSlot = batch.slot;
      free -= amount + tx;
      slots -= 1;
    }
    return orders;
  },
});
