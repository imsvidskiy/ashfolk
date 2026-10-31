# Roadmap

What Ashfolk is heading for and why. [plan.md](plan.md) is the how: the architecture these goals stand on.

Last reviewed at v0.10.0. There are no dates. **Now** is being built, **Next** is shaped and comes after it, **Later** is
the direction. The roadmap is reviewed at every minor release: finished items move to [Recently done](#recently-done),
dead ones are deleted, and an item enters Now only when it is small or medium and says when it's done.

## Contents

- [How an item reads](#how-an-item-reads)
- [Now](#now)
- [Next](#next)
- [Later](#later)
- [Paid content](#paid-content)
- [Won't do](#wont-do)
- [Recently done](#recently-done)

## How an item reads

- **Goal**: what players get, in one sentence.
- **Why**: the problem or the chance.
- **Scope**: what is in, and what is out.
- **Done when**: checks anyone can repeat: a test, a scene link, a save that loads.
- **Depends on**: other items or sections of [plan.md](plan.md).
- **Size**: S is up to a week, M is two to four weeks, L is longer and must be split before it enters Now.

## Now

### Restructure the code as in plan.md

- **Goal**: a new power, hazard or page is one folder and a few typed registry entries.
- **Why**: everything below adds powers, systems and pages. Today each one touches many files by hand.
- **Scope**: the [Migration](architecture/migration.md) phases, including determinism, a command-only simulation,
  replays and translation; Phase L (lockstep) is tracked under [online play](#online-play-with-lockstep). Out: a full
  rewrite (leaf code moves once, by script), and loading saves from before format 2 (beta,
  [decision 1](architecture/decisions.md#owner-decisions)).
- **Done when**: the [checklists](architecture/walkthroughs.md#checklists) hold for a new power, saves from format 2 on
  keep loading, and a seed gives the same island and the same game in Chromium, Firefox and WebKit.
- **Depends on**: nothing. Size: L, done in the plan's steps.

### Smoother, cleaner relief

- **Goal**: islands read like real land: even slopes, valleys that drain, lakes with irregular shores, no stray
  creases or stamped shapes.
- **Why**: generation still shows hard biome borders, bowl-shaped lakes and bare-rock patches where deserts should not
  be.
- **Scope**: bare rock and ore veins, climate by height and rain shadow, soft biome borders. Out: rivers by discharge and
  erosion by stream power, which are in Next.
- **Done when**: metrics per seed (slope, rock share, biome patch size) improve on a fixed set of seeds, and the land
  fingerprint changes once per phase.
- **Depends on**: nothing. Size: M per phase.

### Localization

- **Goal**: the interface, powers and chronicle in more languages, starting with Russian.
- **Scope**: Lingui catalogs per module and for built-in text ([I2](architecture/migration.md#phase-i-interface)), the
  browser language by default, a language setting, Russian first. Out: translated release notes.
- **Done when**: the whole interface, powers and chronicle show in Russian, and CI fails on a missing Russian line
  (`lingui check missing`).
- **Depends on**: the interface moves (M4) in the restructure. Size: M.

### Supporter membership on Whop

- **Goal**: players who want to support the game can join a membership and get recognition and early builds.
- **Why**: Sponsors reaches developers. Players need a simple checkout.
- **Scope**: the membership is live at $9 a month on [Whop](https://whop.com/ashfolk/ashfolk-supporter/), and Sponsor in the
  game opens it. Left: a Discord role, names in the credits, votes on what comes next. Out: accounts in the game,
  anything that locks a feature.
- **Done when**: a purchase gives the Discord role, and supporters' names show in the credits.
- **Depends on**: nothing. Size: S. More in [Paid content](#paid-content).

## Next

### Online play with lockstep

- **Goal**: two to four players share one island. Later each player can be the god of their own tribe, and gods can
  rival and wage war.
- **How**: deterministic [lockstep](architecture/determinism.md#replays-and-lockstep). Players send only commands, every
  browser runs the same simulation, and a hash every turn catches a desync. A Cloudflare Durable Object per room orders
  the commands, keeps the log and the latest snapshot, and runs no simulation. Joiners load the host's save instead of
  generating. A delay of a few hundred milliseconds is fine for a god game.
- **Steps**:
  1. A command-only simulation and replays (K3, D6 in the restructure).
  2. The same results in Chromium, Firefox and WebKit (D2, D5).
  3. Lockstep turns and versioned builds (L1, L2).
  4. Rooms on a relay, a desync check and a resync (L3, L4).
  5. Rival gods (L5).
  6. Late join, reconnect, speed limits per room (L6).
- **Risks**: hidden nondeterminism, players on different builds, slow phones holding back a fast room.
- **Size**: L, split into the [L steps](architecture/migration.md#phase-l-lockstep) before it enters Now.

### Deeper tribes

- **Goal**: tribes live through more than food and raids: sickness, diplomacy and beliefs shape their history.
- **Why**: after the Iron Age, tribes have little new to do, and the chronicle repeats.
- **Scope**: sickness that spreads through camps and herds, and healers. Diplomacy: alliances, trade agreements,
  marriages between tribes, tribute. Beliefs: what a tribe worships shapes its choices and how it answers your powers.
  Out: player-written rules.
- **Done when**: each system has its own tests, shows in the journal and the chronicle, and a save keeps it.
- **Depends on**: the restructure (systems and saves) and [online play](#online-play-with-lockstep), which comes first
  ([decision 6](architecture/decisions.md#owner-decisions)); diplomacy builds on the built-in rivalry system. Size: M
  each.

### Better models and animation

- **Goal**: people, animals and buildings look and move better close up, while staying cheap far away.
- **Scope**: walk and work cycles, more animal behaviors, cleaner silhouettes, level-of-detail steps checked by eye.
  Out: textures that break the painted look.
- **Done when**: close and far scenes compare well at the three sizes, and frame time doesn't grow.
- **Size**: M, in steps.

### Scenarios and goals

- **Goal**: besides free play, a player can pick a challenge: bring a tribe to the Iron Age, keep three tribes alive
  through a volcano, settle an archipelago.
- **Scope**: a scenario is data: a start, rules and goals, with progress in the interface. Out: a campaign story.
- **Done when**: three scenarios ship, each with a test that plays it to its goal.
- **Depends on**: the restructure (G1). Size: M.

### Tribe-built bridges

- **Goal**: tribes build pole bridges over wide deep rivers in a later era.
- **Scope**: building, navigation and rendering of bridges. Fords and logs stay as they are.
- **Depends on**: the restructure. Size: M.

## Later

### Mobile app

- **Goal**: Ashfolk is in the App Store and Google Play.
- **Scope**: store builds of the web app, which already installs from the menu and plays offline since 0.9.1.
- **Size**: M.

### Cloud saves and shared worlds

- **Goal**: worlds follow a player between devices, and an island can be shared by a link.
- **Scope**: full worlds (the [`WorldBase`](architecture/saves.md#the-world-base) and the save sections) stored in
  Cloudflare R2 per account, a link that opens a shared world, a small gallery.
- **Depends on**: sign-in through Whop. Size: M.

## Paid content

The code is MIT and runs in the browser. Anything gated only in the client can be switched on by anyone, and forks are
legal. So Ashfolk sells what isn't code, and the free game never shrinks.

- **Free forever**: the whole game, local saves and every power that exists today.
- **Supporter**, $9 a month, live on Whop: credits, a Discord role, votes, early builds, cosmetics.
- **Patron**, a higher tier later: everything in Supporter, plus cloud saves, shared worlds, world presets and, later,
  hosting online rooms. This tier pays for the servers.
- **Founder**, a one-time price for the first supporters: Supporter for life and a founder frame.
- **Packs**, a few dollars each: themes, palettes, scenarios, music.

Ideas, from the safest to the hardest to protect:

| What | How it's protected |
| --- | --- |
| Credits, Discord role, votes | Whop manages the role |
| Early builds: new elements and powers a release or two before everyone | A separate host checks the membership; the code goes public at release |
| Cosmetics: island themes, palettes, icon variants, frames, backdrops | Art under its own license in a private repository, served after a membership check |
| Deeper world settings: more shapes and sizes, climate and era presets | Presets as paid data; the controls themselves stay MIT |
| Cloud saves, shared worlds, a gallery | Server-side |
| Hosting online rooms | Server-side; guests join free |
| Scenario packs with leaderboards | Scenario data under its own license; results verified by replaying on the server |
| Timelapse and high-resolution export | Honor, or rendered on the server |
| A soundtrack pack | Audio under its own license |

Rules:

- A world made with paid content still loads for everyone. Paid looks fall back to the default ones.
- New elements are early access, not a permanent wall: they go free with a later release.
- No ads, no loot boxes, no timers, and nothing that is free today becomes paid.
- Whop checks happen in a Worker: sign-in with Whop, membership checked on the server, webhooks keep it current. The
  engine never knows about money.
- Whop takes about 3% plus $0.30 per card payment, more abroad, so nothing costs less than $4.

## Won't do

- **Dates on this page.** Releases get dates when they ship.
- **Pay to win, ads or locking today's free powers.**
- **Rollback netcode.** Lockstep with a delay suits a god game; rollback would re-simulate a large world.
- **Peer-to-peer rooms first.** A relay on Cloudflare avoids NAT trouble and keeps the log for resyncs.
- **Mods from outside players.** New content is written in this repository as modules and catalog rows.
- What [the plan](architecture/decisions.md#what-we-deliberately-dont-do) rules out for the code.

## Recently done

- **0.10**: the game is Ashfolk at ashfolk.com, with a new logo, a share card for links, and a supporter membership on
  Whop.
- **0.9.1**: a Photo tab for screenshots and video, install from the menu, play without a connection.
- **0.9**: sound: calm music, nature that follows the place, the weather and the hour, sounds for every power,
  people at work and the interface, and volume settings.
- **0.8.3**: objects dissolve around a close camera, the hand grabs animals up close, plainer people, shorter power
  descriptions, a clean loading island.
- **0.8.0–0.8.2**: three cleanup passes, raids that survive loading, tribes that settle on open ground, far rivers
  and plants that hold up at a distance.
- **0.7**: a different island from every seed, the hand, the volcano, island sizes.
