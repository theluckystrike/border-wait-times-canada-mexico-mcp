# border-wait-times-canada-mexico-mcp

Live US border wait times for AI assistants. Ask how long the line is at San Ysidro, whether the SENTRI lane at Otay Mesa is faster, which Detroit crossing to take into the US, or which Texas bridge has the shortest truck wait.

This is a Model Context Protocol (MCP) server. It reads the U.S. Customs and Border Protection Border Wait Times feed for every land port of entry on the Canadian and Mexican borders at call time. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `border_wait_times` | Current waits at a crossing or area: cars, SENTRI or NEXUS, Ready Lane, pedestrians and trucks (general and FAST), lanes open, port hours, CBP notices and the time CBP reported. Accepts port and bridge names, the city across the border (Tijuana, Juarez, Windsor, Vancouver), a state or a port number. |
| `border_wait_times_list` | Every crossing on the Mexican or Canadian border, or in one state, for one lane type, sorted by the shortest wait. |
| `border_fastest_crossing` | Rank a list of crossings, or every crossing near an area, by the current wait for your lane and name the fastest. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=border-wait-times-canada-mexico-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- The line right now. CBP officers post the wait at each port about once an hour.
- Which lanes are open: SENTRI and NEXUS, Ready Lane, pedestrian and FAST truck lanes, and the number of booths staffed.
- Which crossing serves a Mexican or Canadian city (Tijuana: San Ysidro and Otay Mesa; Juarez: the El Paso bridges; Windsor: the Detroit crossings).

## Install

### Hosted (custom connector, ChatGPT developer mode, any remote MCP client)

Paste this URL. No token, no sign-up.

```
https://border-wait-times-canada-mexico-mcp.lipmichal.workers.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "border-wait-times": { "url": "https://border-wait-times-canada-mexico-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "border-wait-times": { "type": "http", "url": "https://border-wait-times-canada-mexico-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer, then point your MCP client at `node /path/to/border-wait-times-canada-mexico-mcp/dist/stdio.js`.

```
git clone https://github.com/theluckystrike/border-wait-times-canada-mexico-mcp && cd border-wait-times-canada-mexico-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "What is the wait at San Ysidro right now?"
- "Is SENTRI faster at Otay Mesa or San Ysidro?"
- "Which crossing from Tijuana has the shortest car line?"
- "What are the wait times at the Peace Arch and Pacific Highway crossings?"
- "List the truck waits at every Texas port of entry."

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- [CBP Border Wait Times](https://bwt.cbp.gov/) feed `https://bwt.cbp.gov/api/bwtnew` (U.S. Customs and Border Protection).

## Limitations

- Waits are for entering the United States only. Southbound and Canadian-side waits are not in the feed.
- CBP updates each port about hourly and reports in local port time; a lane can show "update pending" between reports.
- Drive time to each port is not included when ranking crossings.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=border-wait-times-canada-mexico-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
