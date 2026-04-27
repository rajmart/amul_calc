# Amul Calc — Supplier Manager

A lightweight, offline-capable Progressive Web App built for Amul milk suppliers to manage daily customer orders, billing, ledger tracking, and Amul product ordering — entirely in the browser with no backend required.

---

## Overview

Amul Calc is designed for the day-to-day reality of a small Amul distributorship. Suppliers typically manage dozens of customers across two daily delivery slots (morning and evening), track outstanding balances by hand, and mentally calculate how many crates or boxes to order from Amul each day. This application replaces that manual process with a fast, mobile-first interface that works offline and stores all data locally on the device.

The application is a single HTML file with inlined CSS and JavaScript. There are no build tools, no npm dependencies, and no server-side components. It can be hosted on any static file host — including GitHub Pages — or run directly from the filesystem.

---

## Features

### Customer Management
- Add, edit, and deactivate customers with name, phone number, and address
- Set per-customer custom product rates that override default prices
- View outstanding balance per customer at a glance
- Search and filter customers by name, phone, or active status

### Order Entry
- Record morning and evening orders separately for each customer
- Select product quantities in pieces or in packs (crates / boxes) with automatic conversion
- Live order total calculation as quantities are entered
- Optional order notes
- Edit or delete any past order

### Ledger
- Full transaction ledger showing all orders and payments across all customers or filtered by individual customer
- Date range filters: this week, last week, this month, last month, custom range
- Running balance column updated row by row
- Expand any order row to see per-product breakdown
- Record and edit customer payments
- Multi-row select with batch PDF export
- Send bill directly to customer on WhatsApp from any order row, with crate and box quantities included in the message

### Amul Order Planner
- Aggregates all customer orders for a selected date and slot
- Calculates exact crates and boxes required per product
- Flags products where the total piece count does not divide evenly into full crates or boxes, showing the ceiling value with a warning
- Per-product customer breakdown on tap
- Printable Amul order sheet

### Dashboard
- Daily sales total with morning and evening split
- Current month totals and active day count
- Outstanding balance across all customers
- Top customers by outstanding amount
- Today's Amul requirement snapshot

### Export and Print
- Daily report PDF for any date
- Weekly, monthly, and yearly ledger PDFs
- Single order print with customer details
- Ledger print for selected period and customer
- JSON backup download and restore

### Google Drive Sync
- Optional sync to Google Drive using the Google Identity Services API
- Auto-upload 8 seconds after any data change
- Silent token refresh to maintain the session without re-authentication
- Saves to `My Drive / AmulCalc / amul_calc.json`

### PWA / Offline
- Installable on Android and iOS home screen
- Service worker caches all assets for full offline use
- Data persists in `localStorage` between sessions

---

## Default Product Catalogue

The following products are pre-loaded with standard rates. All rates and pack sizes can be edited from the Products page.

| Product             | Pack Type | Qty per Pack | Rate (per pc) |
|---------------------|-----------|--------------|---------------|
| Gold 500ml          | Crate     | 24           | 33.25         |
| Nani Taaza 500ml    | Crate     | 24           | 27.25         |
| Moti Taaza 1L       | Crate     | 12           | 53.50         |
| Tea Special 500ml   | Crate     | 12           | 61.50         |
| Moti Chaas 200ml    | Crate     | 16           | 19.00         |
| Nani Chaas 200ml    | Crate     | 30           | 14.30         |
| 10rs Dahi Cup       | Box       | 48           | 9.00          |
| 24rs Dahi Cup       | Box       | 24           | 21.667        |
| 400gm Dahi          | Loose     | —            | 32.50         |
| 800gm Dahi          | Loose     | —            | 47.00         |
| 1kg Dahi            | Loose     | —            | 73.00         |
| Amul Masti Dahi 5kg | Crate     | 2            | 685.00        |
| Amul Gold 6L        | Crate     | 2            | 745.00        |

Custom products can be added at any time and will persist alongside the defaults.

---

## Data Storage

All data is stored as a JSON object in the browser's `localStorage` under the key `amulcalc_v1`. The structure is:

```json
{
  "version": 1,
  "products":  [],
  "customers": [],
  "orders":    [],
  "payments":  []
}
```

Data can be exported as a `.json` backup file at any time and re-imported on any device. If Google Drive sync is configured, the same JSON is mirrored to `My Drive / AmulCalc / amul_calc.json` automatically.

---

## Getting Started

### Option 1 — Open directly in a browser

Download or clone this repository and open `index.html` in any modern browser. No installation or server required.

```bash
git clone https://github.com/your-username/amul-calc.git
cd amul-calc
# Open index.html in Chrome, Firefox, or Safari
```

### Option 2 — Host on GitHub Pages

1. Fork or push this repository to your GitHub account.
2. Go to **Settings > Pages** and set the source to the `main` branch, root folder.
3. GitHub Pages will serve the app at `https://your-username.github.io/amul-calc/`.
4. Visit the URL on your phone and use the browser's "Add to Home Screen" option to install it as a PWA.

### Option 3 — Any static host

Upload all files to any static file host (Netlify, Vercel, Cloudflare Pages, a shared web host). The app requires no server-side processing.

---

## Google Drive Sync Setup

Drive sync is optional. To enable it:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or use an existing one).
3. Enable the **Google Drive API**.
4. Under **APIs and Services > Credentials**, create an **OAuth 2.0 Client ID** for a Web Application.
5. Add your app's origin (e.g. `https://your-username.github.io`) to the list of authorised JavaScript origins.
6. Copy the Client ID.
7. In the app, go to **Export > Google Drive Sync**, paste the Client ID, and tap **Save**.
8. Tap **Connect** to authorise. The app will sync automatically from that point.

If the token expires, the app will attempt a silent refresh. If that fails, a reconnect prompt appears.

---

## File Structure

```
amul-calc/
├── index.html          # Complete application (HTML, CSS, JS inlined)
├── app.js              # Application logic (standalone copy for reference)
├── styles.css          # Stylesheet (standalone copy for reference)
├── sw.js               # Service worker for offline caching
├── manifest.json       # PWA manifest
└── icons/
    ├── icon-192.png    # App icon 192x192
    ├── icon-512.png    # App icon 512x512
    ├── icon-maskable.png  # Maskable icon for Android adaptive icons
    └── favicon-64.png  # Browser favicon
```

The `index.html` file is self-contained. The `app.js` and `styles.css` files are provided as separate reference copies for easier code review and contribution. The application runs entirely from `index.html`.

---

## Browser Support

The application targets modern browsers with support for:

- CSS custom properties and Grid layout
- ES2020 JavaScript (async/await, optional chaining, nullish coalescing)
- `localStorage` for data persistence
- Service Worker API for offline caching
- Web Share / Clipboard API for WhatsApp integration

Tested on Chrome for Android, Safari for iOS, and Chrome and Firefox on desktop.

---

## WhatsApp Billing

Each order row in the Ledger includes a Send button. Tapping it opens WhatsApp with a pre-formatted bill message addressed to the customer's saved phone number. The message includes:

- Date and delivery slot
- Customer name and order note
- Each product with piece count, crate or box count in brackets, unit rate, and line total
- Order total

If the customer has a 10-digit Indian mobile number saved, it is auto-formatted with the country code (`91`) before opening WhatsApp. If no number is saved, WhatsApp opens without a pre-selected contact so the user can choose one manually.

---

## Keyboard Shortcuts

| Shortcut      | Action           |
|---------------|------------------|
| Ctrl + S      | Save to localStorage immediately |

---

## Contributing

Contributions are welcome. Since the project has no build step, you can edit `index.html` (or `app.js` / `styles.css` separately) and test by opening the file in a browser.

Please keep the following in mind:

- The application must remain self-contained in a single HTML file deployable without a server.
- All data operations must work offline without any API calls (except the optional Drive sync).
- The UI must remain usable on small mobile screens (minimum viewport width 360px).

---

## License

GPL 3.0. See `LICENSE` for details.

---

## Disclaimer

This project is an independent tool built for personal and small business use. It is not affiliated with, endorsed by, or connected to Amul (Gujarat Cooperative Milk Marketing Federation Ltd.) in any way. All product names and rates used in the default catalogue are for reference only and may not reflect current market prices.
