# Realorna

A claim-level news and spoken-video fact checker with **Real / Nah**, corrections, and clickable comparison evidence. The active provider is OpenAI, with mandatory web search and shared request pacing.

Start with **[OPENAI-REAL-NAH.md](OPENAI-REAL-NAH.md)** for this update and Vercel configuration. **[SETUP.md](SETUP.md)** covers accounts, the existing admin, Postgres, transfer verification, API settings, and limits. **[VERIFICATION.md](VERIFICATION.md)** records tests and unverified live behavior.

The free homepage examples and standalone `realorna-real-nah.html` preview use explicitly simulated IHSG values. They do not call an API or claim current market prices. Real link verification requires the full server application and your configured OpenAI API access.
