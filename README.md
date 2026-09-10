# Apollo Lead Manager

A private, browser-based lead tracker for Apollo Music Academy. It is designed for quick manual entry—there is no scraping or automatic lead collection.

## Current prototype

- Prioritized follow-up queue with Day 0/2/5/8 cadence
- Weekend, major U.S. holiday, and recurring availability awareness
- Call and text activity logging
- Trial booking, hold-form, attendance, and enrollment tracking
- Advertising source, cost-per-lead, and cost-per-student views
- Demo mode with fictional leads only
- Supabase-ready schema with Row Level Security

## Run locally

```bash
npm install
npm run dev
```

The app starts in demo mode unless Supabase variables are configured. Never commit a `.env` file.

## Connect Supabase later

1. Review and run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL editor.
2. Copy `.env.example` to `.env.local`.
3. Add the Supabase project URL and **publishable** key. Never use the service-role key in a browser app.
4. Restart the development server.

Real authentication and database persistence will be connected after the prototype workflow is approved.

## Deployment plan

Deploy the browser app to Cloudflare Pages. Store code in this private GitHub repository and real lead records in Supabase—not GitHub or ChatGPT.
