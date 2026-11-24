# u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b-bot

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/lopeprof-design/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b-bot/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/lopeprof-design/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b-bot/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Tide Runner: a launch-sniper paper-trading bot for pump.fun bonding curves. It buys in the first 3 slots after a curve is created — before the crowd arrives — with a small 0.05 SOL stake, skipping launches where the creator already sold, anyone else already sold, or more than 3 wallets piled in at once. Then it gets out within seconds on a take-profit (+15%), a stop-loss (-12%), a hard time limit of 10 slots, or the creator selling. A false start costs little and the five open-position slots keep turning over to fresh launches.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout (hello, one batch per slot, done) through the vendored shim in `vendor/makefun-bot.ts`. It needs no dependencies and no network: every decision is a pure function of the batches it has seen.

---

<sub>Entered on [make.fun](https://make.fun/?ref=lopeprof-design&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
