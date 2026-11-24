// Tide Runner — a quick-flip paper bot for the pump.fun replay.
//
// Idea: most new bonding curves die within minutes, but a small share catch a
// wave of real buyers right after launch. This bot only buys a coin that
// proves demand early — several distinct buyers, net SOL flowing in, price
// already up from its launch price and still near its young high — then gets
// out fast: a take-profit, a stop-loss, a trailing stop from the peak, or a
// hard time limit, whichever comes first. One small buy per coin, never an
// add, so a false start costs little and the five open-position slots keep
// turning over to fresh coins.
//
// The bot speaks agent-fun/replay/v2 through the vendored shim: the harness
// sends a hello, then one batch per slot, then done. Every decision is a pure
// function of the batches seen so far — no clock, no randomness, no I/O —
// so the two graded executions agree byte for byte.

import { LAMPORTS_PER_SOL, runBot, type Batch, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

// --- tunables (lamports where a size is meant) --------------------------------

const STAKE_LAMPORTS = (LAMPORTS_PER_SOL * 3n) / 100n; // 0.03 SOL per coin
const MIN_BUY_LAMPORTS = LAMPORTS_PER_SOL / 100n; // 0.01 SOL: the guardrail floor
const MAX_AGE_SLOTS = 600; // a first buy must be decided within ~2 minutes of launch
const MIN_TRADES = 4; // trades seen before entry
const MIN_BUYERS = 3; // distinct wallets that bought before entry
const MIN_NET_BUY_LAMPORTS = (LAMPORTS_PER_SOL * 2n) / 10n; // 0.2 SOL net inflow
const MIN_PRICE_UP_NUM = 103n; // price at least 3% above launch price
const MIN_PRICE_UP_DEN = 100n;
const NEAR_HIGH_NUM = 95n; // price within 5% of its young high
const NEAR_HIGH_DEN = 100n;
const TAKE_PROFIT_NUM = 135n; // sell at +35% of cost
const TAKE_PROFIT_DEN = 100n;
const STOP_LOSS_NUM = 88n; // sell at -12% of cost
const STOP_LOSS_DEN = 100n;
const TRAIL_NUM = 90n; // sell after falling 10% from the peak value
const TRAIL_DEN = 100n;
const MAX_HOLD_SLOTS = 1500; // never hold past ~5 minutes
const SLIPPAGE_BPS = 1000; // 10%: wide enough to fill through two slots of latency

// --- per-coin tape ------------------------------------------------------------

/** Everything the bot remembers about one curve. */
interface Tape {
  mint: Pubkey;
  createdSlot: number;
  /** Launch price as a fraction: virtual quote / virtual token reserves. */
  firstQ: bigint;
  firstT: bigint;
  /** Highest price seen since launch, same fraction form. */
  highQ: bigint;
  highT: bigint;
  trades: number;
  buys: number;
  buySol: bigint;
  sellSol: bigint;
  buyers: Set<string>;
  complete: boolean;
  decided: boolean; // a first buy was decided (or the coin aged out)
  boughtSlot: number; // slot the buy was decided on, -1 when never bought
  /** Best value/cost ratio seen while holding, as a fraction. */
  peakNum: bigint;
  peakDen: bigint;
}

const tapes = new Map<Pubkey, Tape>();

/** Compare two fractions a/b and c/d: -1, 0 or 1. */
function cmpFrac(aNum: bigint, aDen: bigint, bNum: bigint, bDen: bigint): number {
  const left = aNum * bDen;
  const right = bNum * aDen;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Is price q/t at least `num/den` times the launch price firstQ/firstT? */
function priceUpAtLeast(q: bigint, t: bigint, tape: Tape, num: bigint, den: bigint): boolean {
  // q/t >= num/den * firstQ/firstT  <=>  q * den * firstT >= num * firstQ * t
  return q * den * tape.firstT >= num * tape.firstQ * t;
}

function noteTrade(tape: Tape, e: { is_buy: boolean; sol_amount: string; user: string }): void {
  const sol = BigInt(e.sol_amount);
  tape.trades += 1;
  if (e.is_buy) {
    tape.buys += 1;
    tape.buySol += sol;
    tape.buyers.add(e.user);
  } else {
    tape.sellSol += sol;
  }
}

/** Fold this batch's events into the tapes. */
function watchBatch(batch: Batch): void {
  for (const e of batch.events) {
    if (e.event === 'CreateEvent') {
      const tape: Tape = {
        mint: e.mint,
        createdSlot: e.slot,
        firstQ: BigInt(e.virtual_quote_reserves),
        firstT: BigInt(e.virtual_token_reserves),
        highQ: BigInt(e.virtual_quote_reserves),
        highT: BigInt(e.virtual_token_reserves),
        trades: 0,
        buys: 0,
        buySol: 0n,
        sellSol: 0n,
        buyers: new Set<string>(),
        complete: false,
        decided: false,
        boughtSlot: -1,
        peakNum: 0n,
        peakDen: 1n,
      };
      tapes.set(e.mint, tape);
    } else if (e.event === 'TradeEvent') {
      const tape = tapes.get(e.mint);
      if (tape === undefined || tape.complete) continue;
      noteTrade(tape, e);
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

/** A coin is buyable when its young tape proves real demand. */
function entrySignal(tape: Tape, curve: { virtual_quote_reserves: bigint; virtual_token_reserves: bigint } | undefined, slot: number): boolean {
  if (tape.decided || tape.complete || curve === undefined) return false;
  if (slot - tape.createdSlot > MAX_AGE_SLOTS) return false;
  if (tape.trades < MIN_TRADES) return false;
  if (tape.buyers.size < MIN_BUYERS) return false;
  if (tape.buySol - tape.sellSol < MIN_NET_BUY_LAMPORTS) return false;
  const q = curve.virtual_quote_reserves;
  const t = curve.virtual_token_reserves;
  if (!priceUpAtLeast(q, t, tape, MIN_PRICE_UP_NUM, MIN_PRICE_UP_DEN)) return false;
  // Still near its young high: not already rolling over.
  if (cmpFrac(q, t, tape.highQ, tape.highT) < 0) {
    // price < high; require price >= 95% of the high
    if (q * NEAR_HIGH_DEN * tape.highT < NEAR_HIGH_NUM * tape.highQ * t) return false;
  }
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
      // Current value in lamports: tokens * quote / token reserves.
      const value = (tokens * curve.virtual_quote_reserves) / curve.virtual_token_reserves;
      // value/cost as a fraction: tokens*q / (t*cost).
      const num = tokens * curve.virtual_quote_reserves;
      const den = curve.virtual_token_reserves * cost;
      if (cmpFrac(tape.peakNum, tape.peakDen, num, den) < 0) {
        tape.peakNum = num;
        tape.peakDen = den;
      }
      const takeProfit = num * TAKE_PROFIT_DEN >= TAKE_PROFIT_NUM * den;
      const stopLoss = num * STOP_LOSS_DEN <= STOP_LOSS_NUM * den;
      // Trailing stop: current value at most 90% of the best value seen.
      const trailed = tape.peakNum > 0n && num * tape.peakDen * TRAIL_DEN <= TRAIL_NUM * tape.peakNum * den;
      const stale = tape.boughtSlot >= 0 && batch.slot - tape.boughtSlot > MAX_HOLD_SLOTS;
      void value;
      if (takeProfit || stopLoss || trailed || stale) {
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
