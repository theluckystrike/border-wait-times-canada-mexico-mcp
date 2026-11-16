# Data sources

All sources are public, keyless and read at call time. The test fixture in `test/fixtures/` was downloaded on 2026-11-16.

| Data | URL | Notes |
|---|---|---|
| CBP Border Wait Times | https://bwt.cbp.gov/api/bwtnew | One JSON array of every land port of entry (85 crossings on 2026-11-16: 55 on the Mexican border, 30 on the Canadian). Passenger (general, NEXUS/SENTRI, Ready Lane), pedestrian (general, Ready Lane) and commercial (general, FAST) lanes with status, delay minutes, lanes open and the local report time. Fixture: San Ysidro cars 150 min, SENTRI 30 min, pedestrians 70 min. |

The US state of each port comes from the CBP port code (district prefix). City-to-crossing names (Tijuana, Juarez, Windsor and others) are a small table in `src/core.ts`. The hosted server caches the feed for 5 minutes. CBP data is a US government work.
