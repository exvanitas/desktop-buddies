# Performance

What Desktop Buddies costs while it runs for hours, measured two ways: a soak test on GitHub's Windows runner, and a read-only sample on a real PC. The runner draws without a graphics card, so its CPU numbers are higher than a real PC's. Budgets compare the runner with itself; the real numbers come from a real PC.

Last measured on the owner's PC, 2026-11-06: 110 MB and 0.06% CPU with no buddies out, 145 MB and about 1.4% CPU with one, up to 175 MB while she's thrown ([native-shell-design.md](native-shell-design.md#results)).

## The soak test

`.github/workflows/soak.yml` runs the real exe and the built app in four states, a job each, on its own runner:

| State | What's going on |
|---|---|
| `walking` | Three copies of the test buddy out, left alone |
| `hidden` | Three out, then Hide all with the Manager's own button, and the Manager closed |
| `manager` | Three out, and the Manager open |
| `api` | One out, the local API on with one app allowed, asking every 5 s: a line to say every 20 s, a wave in between (the API allows 4 lines a minute from one app) |

Each job starts the exe once for 40 s on a fresh data folder, so the buddy is imported and saved, then starts it again and puts it in its state. Every 10 s it reads the exe and every process under it (its WebView2): working set, private working set, private bytes, handles, GDI and USER objects, threads, CPU time and context switches. It reads them from the system's process list in one call, and checks that reading against .NET's own numbers for its own process first.

Run it from the Actions tab: **soak**, Run workflow, with the minutes per state (120 by default, at most 300). By default it uses the exe from the latest shell build on the branch; with that unticked, or with no such build, it builds one. A push to `next` that changes the soak's own files runs it for 10 minutes a state, to prove the harness. A weekly run is in the workflow, commented out until the owner wants it.

Locally, on a Windows PC with Desktop Buddies not running:

```powershell
pnpm --filter @buddies/desktop build
apps/desktop/shell-check/soak.ps1 -Exe <path to desktop-buddies.exe> -App apps/desktop/dist/app -State walking -Minutes 10
```

`-SetupOnly` checks the sampler and the budgets and stops before anything starts.

### Reading it

Each job's summary on the run's page has a table: mean and peak over the steady part of the run, and the change an hour. Each job's artifact, `soak-<state>`, has:

- `soak.json`, the summary
- `soak.csv`, a row per process and a `total` row per sample, to plot
- `soak.txt`, every check as PASS, FAIL or INFO, and the budgets
- `soak.log` and `soak-prime.log`, the app's own logs

The steady part is the last 75% of the run, past the start's own climb. In it:

- **Leak slope** (`leak_mb_per_h`): a least-squares line through private bytes, in MB an hour. One spike can't make a slope; memory that keeps growing does.
- **Handles, GDI and USER an hour** (`handles_per_h`, `gdi_per_h`, `user_per_h`): the same fit. A leak of handles or window objects shows here long before it fails.
- **CPU** (`idle_cpu_pct_core`): the mean, as a percentage of one core. The runner's processor, clock and core count are in `runner_cpu`.
- **Wakeups** (`wakeups_per_s`): context switches a second, all processes together: how often the app's threads wake. A hidden app that wakes often drains a battery even at low CPU.
- `by_kind_mean`: memory and CPU for the exe and each kind of WebView2 process (browser, renderer, gpu-process, utility).
- `by_process`: each process on its own, in the order it started (`started_s`, seconds after the exe). The hub's page opens before the overlays, so this tells the renderers apart.

The job fails when the harness does (the app didn't reach its state, quit early, logged an error, didn't quit by its own time limit, or left processes behind) or when a judged budget is over.

### Baseline

The 120-minute run 43541724508, 2026-11-14, means over the steady part:

| State | Private working set | Private bytes | Change an hour | Wakeups a second | CPU, % of one core |
|---|---|---|---|---|---|
| walking | 78 MB | 189 MB | +6.0 MB | 2058 | 4.1 |
| hidden | 43 MB | 158 MB | +7.6 MB | 789 | 4.1 |
| manager | 87 MB | 222 MB | +3.6 MB | 1997 | 2.0 |
| api | 66 MB | 184 MB | +11.6 MB | 1120 | 1.5 |

What grows is one WebView2 renderer in each state, by 3 to 8 MB an hour; the exe, the browser process and the GPU process are flat. Its first half hour is the heap filling before a full collection (up to 1 MB a minute, then a drop of about 20 MB), which is why a 10-minute run reads 60 to 110 MB an hour. Handles change by under 15 an hour, GDI and USER objects not at all. Renderers own no GDI or USER objects at all: Chromium runs them locked out of the window system, so their 0 is real.

### What changed after it

The baseline found the app busy with nothing to show, and the app now isn't:

- **A still world doesn't tick.** Paused, hidden or away, the world's 16 ms timer stops (`apps/desktop/src/host.ts`). A change that shows meanwhile, a bring, a line, a window that moved, an overlay that joined or a timer of the world's own, is drawn there and then by one step. A hand holding someone keeps it ticking until it lets go. Coming back, the first tick takes one tick's time, not the pause's.
- **An overlay draws only when there's something to draw.** It asks for an animation frame only until the last frame that came is drawn (`pacing.ts`), and renews its hold on the mouse on a timer that runs only while it holds it (`capture.ts`). Hidden or still, it doesn't wake.
- **Nothing changed is found out without writing it out.** The world compared each overlay's frame with the last one sent as JSON text, 62 times a second; it compares them where they lie (`same` in `host.ts`), with JSON's rules.

Run locally, the world (host and engine, three buddies, on the sample) holds no memory over four simulated hours: 13.3 MB after a full collection at the start, 14.0 MB at the end, flat after the first hour. So the renderer's creep is the heap growing with garbage, not a leak in the world's code. Paused, the world made 330 MB of garbage in 15 minutes before, about none now; walking, about 11% less. The frames sent are the same, at the same ticks: an old and a new host over half an hour of walking, a drop and a line sent the same frames. The next 120-minute run measures what's left.

### Budgets

`apps/desktop/shell-check/soak-budgets.json`, set from the baseline:

| Budget | Value | Judged |
|---|---|---|
| Leak slope, every state | under 15 MB an hour | runs of 60 minutes or more |
| Handles, GDI and USER objects | under 50 more an hour each | runs of 60 minutes or more |
| Wakeups a second | walking 2400, hidden 950, manager 2400, api 1350 | every run |
| Private working set | the baseline (walking 78 MB, hidden 50, manager 87, api 66) plus 20% | every run |
| Hidden CPU | under 6% of one core, a tripwire | every run |

Wakeups are budgeted and CPU isn't. The same work cost the hidden state 1.4% of a core on one runner and 4.1% on another, with the same wakeups within 1%: the four jobs of one run land on different hardware, and a wakeup costs what that hardware makes it cost. Wakeups count the work itself, and two runs agreed on them within 6% in every state, so each budget is its mean plus about 20%. CPU is reported with the runner's processor beside it, and only the hidden tripwire can fail a run.

A slope needs time: the leak budget is 15 MB an hour, under which the creep above passes and the first half hour's climb, kept up, would not. Once the renderer's creep is found it comes down to 5, and the plan's 2 needs 4-hour runs to judge. The private working set baseline for hidden is the 10-minute run's 50 MB, the higher of the two.

A budget that's judged is a PASS or a FAIL in `soak.txt`; one that isn't is an INFO line saying within or OVER. With `enforce` false, none is judged.

## On a real PC

`apps/desktop/shell-check/sample-pc.ps1` samples the same numbers for 30 minutes while the app runs as the owner uses it. It only reads: it never starts or stops anything, and writes two files to Downloads, a CSV and a summary like the soak's, with numbers only. With Desktop Buddies running and `soak-sampler.ps1` in the same folder:

```powershell
powershell -ExecutionPolicy Bypass -File sample-pc.ps1
```

The summary also says the app's version, how it was installed (installer, zip or Store), the Windows version, the core count, and whether the PC was on battery when it started. If the app is restarted during the sample, it follows the new one and counts the restart.
