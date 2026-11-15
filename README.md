# Fuel Map (Tut Benzin)

A crowdsourced live map of fuel availability at filling stations in Russia. Drivers mark where fuel is available, where there are queues or limits, and what it costs - without registration.

Deployed at tytbenzin.ru (state as of September 2026).

## Problem

During regional fuel shortages drivers have no reliable way to learn which stations actually have fuel right now. Official data does not exist, and chat groups do not scale.

## Solution

A mobile-first web app with a map of 26,000+ stations imported from OpenStreetMap. Any visitor can leave a mark in a few taps. Marks age over time: a fresh status, then "getting old", then "this week's data", then hidden. Prices age on a separate, shorter schedule.

## Features

- Map with clustering and custom status pins (Yandex Maps JS API), station card, route hand-off
- Marks without registration: availability, queue, limits, price; contradiction badges when recent marks disagree
- Geolocation state machine with accuracy refinement and per-platform failure handling
- City, highway and fuel-type landing pages for search traffic; fuel price index with history
- Anonymous-first product analytics: HMAC device hashes instead of IDs, no IP or coordinates stored; funnels, sources, API latency percentiles, Web Vitals
- Owner admin panel: live counters, funnel, data quality, technical health, CSV export
- Rate limiting (in-memory and persistent), CSRF protection, allow-lists for events and metadata
- Consent management, privacy policy, data retention job
- PWA: manifest and install prompts
- Isolated demo layer: seeded marks are kept apart from real ones by a `source` field, and real marks always win

## Tech stack

Next.js 16 (App Router, Server Components), React 19, TypeScript, Tailwind CSS 4, Prisma 7 with PostgreSQL 16, Docker, Caddy.

## Layout

```
src/app/            pages and API routes (stations, marks, history, activity, consent, admin)
src/components/     map application, consent, install prompt, admin widgets
src/lib/            status ageing rules, brands, cities, analytics, admin auth, fuel index
prisma/             schema, seed, retention job, price and legal self-tests
scripts/            OpenStreetMap import, brand coverage, coverage checks, offline conversions upload
docs/               decision log, assumptions, backlog, release notes
```

## Run locally

Requires Node.js 22 and PostgreSQL 16.

```bash
cp .env.example .env      # database URL and secrets
npm install
npx prisma db push          # the schema is applied without migration files
npm run import:osm        # import stations from OpenStreetMap
npm run dev
```

Other scripts: `npm run seed:demo`, `npm run test:price`, `npm run test:legal`, `npm run retention`, `npm run coverage:check`.

The map needs a Yandex Maps API key.

## Status and limitations

- A working product that went from zero to production in July 2026 and was developed through 21 numbered releases.
- Self-tests cover price logic and legal requirements; there is no general test suite.
- Deployment configuration, server details and data exports are not part of this repository.
- The repository is a snapshot of the latest release, without earlier history.

## How this was built

My role: founder, product owner and development lead. I made the product and architecture decisions (see `docs/DECISIONS.md`) and accepted each release; the code was written together with an AI coding agent (Claude Code).
