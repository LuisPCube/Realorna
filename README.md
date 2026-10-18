# Realorna

Fact and link checking with Regular / Advance plans, username/password accounts, manual bank transfers, and admin-granted check attempts.

Start with **[SETUP.md](SETUP.md)** for Vercel Postgres, your generated admin credentials, bank details, and Gemini API keys.

Private admin credentials are supplied separately and are not part of this repository. No live database credentials or API keys are embedded in the app.

The 18 October rate-limit update is explained in **[RATE-LIMIT-FIX.md](RATE-LIMIT-FIX.md)**. Gemini calls now use shared database pacing, bounded backoff, and a persistent retry countdown.
