# DeckBoss — Captain's Guide

No jargon, no assumptions. This is everything you need to actually use
DeckBoss on the boat. If something here doesn't match what you're seeing,
that's worth telling us — see [If something's wrong](#if-somethings-wrong)
at the bottom.

## What DeckBoss actually does

You tap one big button, say what's happening, tap it again. That's it.
DeckBoss writes down the time, your GPS position, and (when it can) what
you said. It works with no signal — the app doesn't need internet to
record, only to send a backup copy somewhere if you set that up.

Nobody but you can see your notes. There's no account, no login, no
company collecting your data. Your notes live on your phone. You decide
if and where a copy goes.

## Getting started

### 1. Install it to your home screen

Don't just bookmark the page — install it like an app. This matters more
than it sounds: phones periodically clear out data from websites you
haven't "installed," and installing is what tells your phone this one's
different.

- **iPhone (Safari):** open the DeckBoss link, tap the Share button (the
  square with an arrow), scroll down, tap **Add to Home Screen**.
- **Android (Chrome):** open the DeckBoss link, tap the three-dot menu,
  tap **Install app** or **Add to Home Screen**.

Once it's installed, open it from your home screen icon from now on, not
from a browser bookmark.

### 2. Record your first note

Open the app. You'll land on the Record screen — it's just one big red
button in the middle. Tap it. Say what's happening. Tap it again to stop.

You'll feel a short buzz and see "Saved" — that's your confirmation. If
your phone doesn't buzz (some phones/browsers don't support it), the
"Saved" text on screen is the same signal.

If you tap and hold the button for about two seconds while recording,
it cancels instead of saving — useful if you tapped by accident.

### 3. Check it saved

Tap **Log** at the bottom. You'll see your note in a list, newest first,
with the time and your location. Tap it to see the full detail and play
the recording back.

## What "No transcript — audio saved" means

Sometimes a note shows up with no written text, just that line. This is
normal and **your note is not lost** — the audio and the time/location
are safely saved either way. It usually means one of two things:

- **You had no cell signal.** DeckBoss's default transcription needs a
  connection to turn speech into text. No signal, no text — but your
  actual recording is still there, and you can always play it back.
- **The app just didn't catch any words** (background noise, mumbling,
  a very short tap).

Either way: tap into the entry and play the audio. It's there.

## Backing up your notes

By default, your notes only live on this one phone. If you lose the
phone, you lose the notes — same as a paper logbook falling overboard.
Setting up a backup takes a few minutes and is worth doing on day one,
not after something goes wrong.

Go to **Settings → Storage**. Four options:

- **Export ZIP** — the simplest one. Tap it, and it downloads a file with
  everything in your log. Do this every so often (weekly, say) and save
  the file somewhere safe — email it to yourself, put it in your phone's
  own photo/file backup, whatever you'd trust with a photo.
- **Google Drive** — connects to your own Google account. Once set up,
  every note backs up automatically. This is the "set it and forget it"
  option, but it needs a one-time setup — ask whoever runs your DeckBoss
  project to help you connect it the first time.
- **Cloudflare R2 / Oracle Object Storage** — these are for someone
  technical setting up storage on your behalf. Don't worry about these
  unless someone's specifically walked you through it.

If in doubt: do the Export ZIP backup regularly. It always works, needs
no setup, and needs nothing but a tap.

## Other things worth knowing

- **Search your notes.** On the Log screen, there's a search box and
  filters for date range and tags (species, gear, etc. — DeckBoss tries
  to pick these out of what you said automatically).
- **Fixing a mistake.** Open a note, tap **Add tag** to add something you
  forgot, or **Retract** if the whole note was wrong. Retracting doesn't
  delete it — it marks it as withdrawn but keeps it in your history. This
  is intentional: nothing in DeckBoss ever quietly disappears.
- **Recording length.** Settings → Recording lets you set a max length
  (1, 5, or 10 minutes) in case you forget to tap stop.
- **Transcription options.** Settings → Transcription. The default (free,
  built into your browser) is fine for most people. There's an option to
  use a paid service (OpenAI Whisper) if you have your own account for
  it and want more accurate transcripts — most people don't need this.

## If something's wrong

Go to **Settings → Support**. There's an **Export everything** button —
tap it, and it downloads a file with your notes plus some technical
details about what the app has been doing. Send that file (email, text,
whatever's easiest) to whoever's helping you with DeckBoss, along with
what happened in your own words. That one file usually tells us
everything we need to figure out the problem — you don't need to explain
anything technical.

The same Settings → Support screen also shows a quick summary: how many
notes have saved successfully, how many failed, and whether your phone's
storage is set to "persistent" (protected from being cleared automatically
— if it says "not persistent," reinstalling to your home screen per
[Getting started](#1-install-it-to-your-home-screen) usually fixes it).
