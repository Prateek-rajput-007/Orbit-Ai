# Orbit frontend

## Firebase sign-in

Copy `.env.example` to `.env` and fill in the Firebase web app configuration
from Firebase Console → Project settings → General → Your apps. Enable Google
as a sign-in provider in Firebase Authentication, and add the frontend origin
to the authorized domains list.

`VITE_SERVER_URL` should point to the backend gateway. Firebase is the source
of truth for the frontend sign-in state. On startup, the frontend restores the
Firebase user (including a completed Google redirect), exchanges that user's
ID token at `/api/auth/login`, and uses the resulting HTTP-only session cookie
for authenticated API requests. When no Firebase user exists, the frontend
does not call protected session endpoints.

## Source structure

```text
src/
  api/                 Shared HTTP client
  components/
    chat/               Chat view, messages, composer, empty state
    layout/             Page header and notices
    sidebar/            Conversation list and workspace profile
  config/               Firebase client initialization
  features/
    auth/               Firebase sign-in and session hook
    conversations/      Conversation API and state hook
    queryKeys.js        Shared TanStack Query cache keys
  providers/            TanStack Query client provider
  pages/                Page-level composition
```

Page components compose feature hooks and UI components. API calls and feature
state live under `features`; shared visual components are grouped by UI domain.
Firebase handles Google sign-in and sign-out, while TanStack Query caches the
current user and manages conversation server state, including fetching,
optimistic message updates, and mutations. React state handles view-only state
such as the active sidebar panel and message draft.

## Development

Run `npm run dev` to start the Vite development server, `npm run lint` to run
ESLint, and `npm run build` to create a production bundle.
