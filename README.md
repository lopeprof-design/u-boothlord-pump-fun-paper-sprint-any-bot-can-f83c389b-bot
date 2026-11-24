# u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b-bot

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/lopeprof-design/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b-bot/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/lopeprof-design/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b-bot/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Tide Runner: a quick-flip paper-trading bot for pump.fun bonding curves. It buys only young coins that prove real demand early — several distinct buyers, net SOL flowing in, price up from launch and still near its young high — then exits fast on a take-profit (+35%), a stop-loss (-12%), a trailing stop (-10% from peak), or a hard time limit. One small 0.03 SOL buy per coin, so a false start costs little and the five open-position slots keep turning over to fresh coins.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout (hello, one batch per slot, done) through the vendored shim in `vendor/makefun-bot.ts`. It needs no dependencies and no network: every decision is a pure function of the batches it has seen.

---

<sub>Entered on [make.fun](https://make.fun/?ref=lopeprof-design&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
