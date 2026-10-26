# Name gate

Recorded 2026-10-26. This is a spot-check, not a trademark clearance and not a legal opinion.

## GitHub

The public repository is [omerTajElsir/solemcp](https://github.com/omerTajElsir/solemcp). It is a user repository. A GitHub organization named solemcp was not created.

## npm

`https://registry.npmjs.org/solemcp` returned HTTP 404 on 2026-10-26, so the package name was not published. `npm whoami` on this machine failed with `ENEEDAUTH` (not logged in). This project did not claim `solemcp` on npm.

Publish is deferred. `package.json` stays `"private": true` so a release workflow cannot publish a broken or unauthenticated package. The release workflow's npm job exits successfully when `NPM_TOKEN` is missing or `private` is still true. Provenance publish runs only after both the package is public and a token exists.

## Trademark spot-check

A web search on 2026-10-26 for SoleMCP / solemcp trademark did not return a USPTO registration for that word.

`https://tmsearch.uspto.gov/` returned HTTP 200 for the homepage. A guessed JSON search POST to `https://tmsearch.uspto.gov/api-v1-0-0/search` returned HTTP 405, so no serial number or status was retrieved from USPTO search. Do not treat this note as clearance.

A nearby name that did appear is Solem (`solem.ai`), a different product with its own MCP server at `https://mcp.solem.ai/mcp`. That is not the SoleMCP mark.
