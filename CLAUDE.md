# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Single-page piano room booking system (纯前端钢琴房预约系统). 19 rooms, 7 time slots (14:00-20:00). Booking window: weekdays 8:00-14:00, view-only 14:00-21:00.

## Architecture

- **Frontend**: Static HTML/CSS/JS served via GitHub Pages (`jijie-cc.github.io/piano-booking`)
- **Data storage**: GitHub API writes JSON files to `data/YYYY-MM-DD.json` (`ghp_*` token in JS)
- **No backend**: All API calls go directly from browser to `api.github.com`
- Data format: `[{r: roomNumber, t: slot, n: name, c: class, p: phone, s: signatureDataUrl}]`

## Key files

- `index.html` — Complete app (HTML + CSS + JS), ~1150 lines
- `data/2026-05-22.json` — Sample booking data

## How to deploy

Push to `main` branch, GitHub Pages auto-deploys from repo root. Git uses SSH (`git@github.com:jijie-cc/piano-booking.git`). HTTPS push may be blocked in China; SSH works.

```
git push origin main
```

## Important patterns

- DOM references stored as `var elXxx = $('id')` using `var $ = function(id) { return document.getElementById(id); }`
- Rendering uses innerHTML string concatenation, NOT createElement/appendChild (caused display bugs)
- GitHub API calls go through `githubApi(path, method, body)` helper
- Signature pad uses 1x resolution JPEG@0.6 to reduce data size
- Optimistic locking with 3 retries for concurrent booking conflicts
- State transitions use smart `setTimeout` scheduling instead of `setInterval` polling
- Admin password: `1111` (hardcoded in `checkPassword()`)
- GitHub token obfuscated via char code array `_c` (decoded into `GITHUB_TOKEN`)

## Libraries (CDN)

- SheetJS (`xlsx.full.min.js`) — Excel export
- jsPDF + jspdf-autotable — PDF export with signatures

## Common issues

- `workers.dev` and `vercel.app` domains are blocked in China — must use `api.github.com` directly
- GitHub Pages CDN caches for 10 min (`Cache-Control: max-age=600`); title has `v2` marker for cache verification
- Extra `}` in JS causes silent script failure (no console output) — always validate brace balance after edits
- Browser hard refresh (Ctrl+F5) needed after deploy due to CDN caching
