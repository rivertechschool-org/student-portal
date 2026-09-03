# Arcade multiplayer setup

Two players make a lobby, join it, and duel. Three things have to be true for
that to work, and they are independent — getting two right still leaves it
broken.

## 1. The service account (once)

The portal mints a Firebase token for each student, which needs a key to sign
with.

1. Firebase Console → Project settings → **Service accounts** → *Generate new
   private key*. A JSON file downloads.
2. Supabase Dashboard → Edge Functions → **Secrets**, add two:

   | Secret | From the JSON |
   |---|---|
   | `FIREBASE_CLIENT_EMAIL` | `client_email` |
   | `FIREBASE_PRIVATE_KEY` | `private_key`, the whole PEM including the BEGIN and END lines |

3. Deploy the function: `supabase functions deploy firebase-token`

**Guard that key.** It can mint a token for *any* uid, which means it can act as
any student in the arcade. It belongs in Supabase secrets and nowhere else —
never in the repo, never in the browser.

## 2. The rules (once, and after any edit)

Firebase Console → Realtime Database → **Rules** → paste `firebase-rules.json`
→ **Publish**.

Committing that file does nothing on its own. It is a copy of what should be
published, not the thing itself.

## 3. Do not enable Anonymous authentication

There is nothing to switch on under Authentication. Custom tokens work without
a sign-in provider.

If anonymous auth gets enabled as a "fix", `auth.uid` becomes a throwaway value
with no relation to the student. Every `auth.uid == $supabase_uid` rule stops
matching, and the arcade fails with permission errors that look like a rules
problem — which is how the last round of this was lost.

## Why identity matters here

This is a duelling game that records wins and ratings. The alternative to
verified identity is `auth != null`, and that lets any signed-in student write
into another student's match node: award themselves a win, edit a rating,
overwrite a profile.

The rules are written as though `auth.uid` is the student. The token is what
makes that true.

## Checking it works

1. Sign in to the portal, open **Riutiz → Multiplayer → Create Lobby**. A join
   code appears.
2. Second student, second browser: **Join Lobby**, enter the code.
3. Both should see each other in the lobby list, and the duel should start when
   both are ready.

If joining fails:

| Symptom | Cause |
|---|---|
| "client doesn't have permission" on **join by code** | rules not published — the query reads the whole `lobbies` node, which needs its own `.read` |
| "The arcade could not verify who you are" | secrets missing, or `firebase-token` not deployed |
| "Arcade identity mismatch" | anonymous auth is enabled and won the sign-in |
| Lobby appears, opponent never does | rules published but `.indexOn` missing — check the browser console for Firebase's index warning |
