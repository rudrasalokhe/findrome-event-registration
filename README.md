# Findrome NMIMS — Event Management, Verification & Admin Platform

A high-performance, full-stack event registration and entry control system for **Findrome 2026** at NMIMS Mumbai (MPSTME).

Crafted with the **"Obsidian & Electric Emerald"** design system, connected to **MongoDB Atlas Cloud**, and optimized for 100% responsiveness across all device sizes (mobile, tablet, desktop).

---

## 📱 Multi-Device Responsive Architecture

- **Mobile Viewports (320px – 480px):** Single-column compact card layouts, touch-friendly buttons, optimized font scaling, and iOS auto-zoom prevention.
- **Tablet Viewports (481px – 1024px):** Bento grid column adaptation, horizontal swipe support with visual scroll hints, and dynamic toolbar wrapping.
- **Desktop Viewports (1025px+):** Full 1200px commanding floating cards with depth elevation and dual-column scanner HUD layouts.

---

## 🔐 Portals & Credentials

| Portal | Route | Access Level | Default Credentials | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Candidate Portal** | `/` | **Public** | *None (Open to all)* | Registration form, dynamic holographic pass generation, and "Find My Pass" lookup. Cleanly isolated with no gate links. |
| **Volunteer Scanner** | `/volunteer` | **Restricted** | **PIN:** `2026` | Live camera QR scanner with Cyber-HUD, Web Audio feedback synthesizer, duplicate pass detector, and manual SAP ID entry. |
| **Admin Console** | `/admin` | **Administrator** | **Password:** `admin` | Real-time attendee roster, live search/filters, manual check-in controls, and **one-click Excel (.CSV) Export**. |

*(Credentials are configurable via `.env`)*

---

## 🗄️ Database: MongoDB Atlas Cloud

- **Cluster:** `cluster0.x5sjia2.mongodb.net` (configured via `atlas-credentials.env` & `.env`)
- **Database:** `findrome_db`
- **Collection:** `registrations`
- **Unique Indexes:** `sap_id` (11-digit uniqueness) & `registration_id` (`FD-NMIMS-XXXX` uniqueness)

---

## 🎨 Design System: "Obsidian & Electric Emerald"

- **Base Canvas:** Soft natural off-white (`#f6f8f7`).
- **Cards & Surfaces:** Deep obsidian (`#0d110f`) with hairline borders (`rgba(255,255,255,0.08)`) and deep elevation shadows.
- **Accents:** Electric Emerald (`#00df82`) for pulsing tags, active focus rings, scanning laser sweep line, and primary action buttons.
- **Typography:** *Plus Jakarta Sans* (bold modern headings) + *Inter* (readable body text & controls).

---

## 🧪 Automated Testing

Run the end-to-end test suite testing MongoDB Atlas, security, and exports:

```bash
python test_app.py
```
