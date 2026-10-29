# InsightDesk — Frontend

React + TypeScript + Vite frontend for **InsightDesk**, an AI-powered document Q&A workspace.

## What it does

- Landing page with animated prism hero
- Auth pages (login, signup, password reset)
- Workspace with chat, sources, agent activity, and message actions
- Sidebar: chat history, pin/export/rename, document upload, settings
- Voice input (Whisper) + voice output (Web Speech API)
- Image input (Qwen Vision OCR)
- Profile, dashboard, and admin pages
- Full dark theme, glass-card aesthetic

## Tech stack

| Layer | Tech |
|---|---|
| Framework | React + TypeScript |
| Build tool | Vite |
| Routing | React Router v6 |
| State | Zustand |
| Styling | Hand-written CSS (no framework) |
| Icons | Inline SVG |

## Setup

### 1. Install dependencies

```bash
npm install