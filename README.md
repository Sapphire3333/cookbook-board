# 🍳 The Cookbook Board

A personal cooking journal where every meal gets a **board** — photos you can drag
around, notepads you can scribble on, arrows and highlights drawn straight over the
top — plus the boring-but-useful bits: prep time, rating, which device you cooked it
on, and a search that actually finds things.

No account required, no server, no build step. Open it and it works. If you want the
same cookbook on your phone *and* your computer, add a free Supabase project and it
syncs too.

---

## Why you might like it

- **Your data is yours.** Everything is stored in your browser (IndexedDB) — not on
  someone else's servers. Sync, if you turn it on, goes to *your own* free Supabase
  project, protected by row-level security so only your login can read it.
- **Built for lots of photos.** Photos are stored as compressed JPEG *blobs*, not as
  text — about a third smaller than the usual approach, and they never sit in memory
  as giant strings. Hundreds of photos is normal, not a problem.
- **Works offline, always.** Reading and editing never touch the network. Sync is a
  layer on top that catches up when you're online.
- **No lock-in.** One button exports the whole cookbook — meals, photos, notes,
  drawings — as a single JSON file that imports back in anywhere.
- **Made for fingers too.** Dragging, resizing and drawing all work properly on a
  phone, and the page doesn't scroll out from under you mid-stroke.

## What it does

**Every meal**
- Name, meal type, device, prep time, rating out of 10, favourite star
- **Other preparations** — the same meal in the air fryer *and* the oven, each with
  its own prep time and rating (leave either blank if you haven't tried it), and a
  *make main* button to promote one to the headline version
- A free-text instructions box

**The meal page**
- **View / Arrange / Draw** modes
- Photos by **upload, paste or drag-and-drop**, auto-downscaled to 1200px and
  re-encoded so a 5 MB phone photo lands as ~60 KB
- **Photos, notepads and tables go anywhere on the page** — over the rating
  fields, beside the instructions, wherever. The dotted area is only a hint about
  where there's free room, not a boundary
- Drag anything, resize from the corner, fade a photo with the opacity slider,
  send it to the back or bring it to the front
- **Notepads** that things stick to: drop a photo, a table or a drawing on a pad
  and it travels with the pad when you move it
- **Tables** you can drop in and type into — three columns by default, or filled
  in for you from the temperature charts
- Pick any photo as the **list image** shown on the meal's card
- Grow the page whenever you run out of room
- Nothing can be stranded off the edge: drops and resizes stay inside the page,
  so a layout made on a laptop stays reachable on a phone

**Paste a recipe from the internet**
- Copy a recipe off any site, paste the text in, and it's sorted into name, meal
  type, device, prep time, temperature, ingredients and numbered steps
- Handles the common shapes: proper *Ingredients* / *Method* headings, bare
  numbered lists, and recipes written as one solid paragraph
- Reads °C, °F (converted) and gas marks; adds up "Prep 15 mins + Cook 45 mins"
- **Always shows you what it worked out before saving anything**, with every
  field editable — it's pattern matching, not comprehension, so it tells you when
  it had to guess
- Either creates a new meal or fills in the one you have open

**What can I cook?**
- A **pantry** of ~150 common ingredients and spices as tick boxes, plus anything
  you want to add yourself
- Suggestions ranked by how much of each recipe you already have, drawn from
  **14 built-in recipes and your own saved meals**
- *Only what I can cook now* filters to complete matches
- Salt, pepper, oil, flour, sugar, onion and garlic are assumed — you're not
  nagged about staples
- Add any built-in recipe to your own meals in one click

**Temps & times**
- Charts in **°C** for **oven, air fryer and pan** across ~60 common foods —
  chicken, chips, fish, vegetables, baking, eggs, rice and pasta
- A separate **cooked-through internal temperature** chart
- Searchable, and you can add your own rows
- **Insert any row, any group, or your own table straight into a meal**, where it
  becomes an editable table on that meal's page

**Draw tools**
- Pen, line, arrow, box, circle and highlighter
- A colour wheel with a lightness slider, 18 preset swatches and an exact-colour
  picker; adjustable size; undo and clear

**Finding things again**
- **Overview → search by category**: combine meal type + device + rating band +
  prep-time band + favourites, and see the matching cards
- **Meals tab**: sort by newest, rating, prep time or name, or group by meal type,
  device or favourites-first, with quick filter chips on top

**Decoration**
- Six frame themes — sakura, fresh leaves, autumn, citrus, berries, herbs — drawn
  around the whole app, remembered between visits and synced across devices

**Safety nets**
- Autosaves about 1.5 seconds after you stop changing things, plus a manual Save
- **Numbered backups**: snapshots kept inside the browser, each with a **4-digit
  code** — type the code to restore that version. One is taken automatically the
  first time you save each day, and another right before any restore, so
  restoring is itself undoable. The newest 20 are kept
- **Download backup** / **Restore from backup file** as a single JSON
- *Restore last save* to throw away unsaved changes

---

## Getting started

### Option 1 — host it on GitHub Pages (free, gives you a URL)

1. Put these files in a GitHub repository (drag them into a new repo, or push a copy).
2. On your repo: **Settings → Pages → Build and deployment → Source**, choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`, **Save**.
3. After a minute your app is live at `https://<your-username>.github.io/<repo>/`.

Without sync configured it runs in local-only mode — each browser keeps its own
cookbook. To share one cookbook across devices, do Option 2 as well.

> Opening `index.html` straight off your disk (`file://`) will **not** work — browsers
> block IndexedDB there. Use the GitHub Pages URL, or any local web server.

### Option 2 — turn on sync (≈10 minutes, once)

This gives you a private login and the same cookbook on every device.

1. Go to [supabase.com](https://supabase.com), sign in, **New project**. Any name,
   any strong database password (the app never needs it). Wait for setup to finish.
2. In the sidebar open **SQL Editor → New query**. Copy **all** of `schema.sql`
   from this repo, paste, **Run**. You should see "Success". This creates the
   `meals` and `meta` tables, the `cookbook` storage bucket, and the security rules
   that lock every row and photo to your login.
3. Open **Project Settings → API** and copy two values:
   - **Project URL** — like `https://abcd1234.supabase.co`
   - the **anon / public** key (on newer projects it's labelled *Publishable key* —
     either works)
4. Edit `config.js` and paste them in place of the `YOUR_…` placeholders. Commit and
   push; Pages redeploys itself.
5. Open your live URL, go to **Overview & search → Cloud sync**, **Create account**
   (email + password), and you're in. On your phone, open the same URL and sign in
   with the same account — same cookbook.

> **Tip:** Supabase asks new accounts to confirm their email by default. For a
> personal app you can turn that off under **Authentication → Sign In / Providers
> → Email → Confirm email**, and account creation logs you straight in.

> **Note:** the URL and anon key in `config.js` are public *by design* — it's safe
> to commit them. Your data is protected by row-level security, not by hiding keys.

### Put it on your phone's home screen

Open your URL in the phone's browser and choose **Add to Home Screen** (Share menu
on iOS, ⋮ menu on Android). It installs like an app, opens full-screen with its own
icon, and works offline.

---

## Using it on a phone

- **View mode** — the board scrolls with the page like anything else.
- **Arrange mode** — dragging a photo, a notepad's title bar or a corner handle moves
  or resizes it and never scrolls the page; dragging empty board space still scrolls,
  so you're not trapped.
- **Draw mode** — the whole board takes your finger, so a stroke is a stroke.
- Handles, close buttons and swatches all grow on touch screens.
- A second finger (pinch-zooming the page) is ignored mid-drag rather than hijacking it.

## Backups — please make them

Your cookbook lives in your browser. Browsers are generally careful with it (the app
asks for persistent storage), but the only backup *you* control is the one you export:

- **Overview → Download backup** writes a single `.json` with every meal, photo,
  notepad and drawing. Photos are inlined, so the file is self-contained.
- **Restore from backup file** loads it back — then press **Save** to keep it.

The backup format is **identical to the original artifact version** of this app
(`{ app, exported, meals }` with photos as data URLs), so old backup files restore
here without any conversion.

## How sync works (so you can trust it)

- **Local first.** The copy in your browser is the source of truth. Nothing waits on
  the network.
- **Sync on demand and on sign-in.** *Sync now* pushes everything newer here and
  pulls everything newer there.
- **Conflicts** are resolved per meal by edit time — the newest edit wins.
- **Photos** go to your private storage bucket as JPEGs, one file per photo, and are
  only downloaded once per device. Meal rows stay small however many photos you add.
- **Deletes travel.** Deleting a meal records a tombstone, so it disappears from your
  other devices too instead of coming back on the next sync.

## FAQ

**Is it really free?** Yes. GitHub Pages hosting is free, and Supabase's free tier
(~500 MB database + 1 GB file storage) holds a very large cookbook of compressed
photos.

**Anyone can open my URL — can they see my meals?** No. Without configuring sync
there's nothing online at all. With sync on, every row and file in Supabase is scoped
to your user id; without your login the data is unreachable.

**What if I never set up Supabase?** The app runs in local-only mode forever — that's
a fully supported way to use it, not a degraded one.

**Where did my photos go on another browser?** Nowhere — browser storage isn't shared
between browsers or between normal and private windows. That's what backups and sync
are for.

## The files

| File | What it is |
|------|------------|
| `index.html` | Page shell and all the styling. |
| `app.js` | The whole app — storage, sync and UI. |
| `data.js` | The built-in charts: temperatures, doneness, pantry list, recipes. |
| `recipe-parser.js` | Turns pasted recipe text into fields. No network, no AI. |
| `config.js` | Your Supabase URL + anon key. Placeholders = local-only mode. |
| `schema.sql` | Paste-once Supabase setup (tables, bucket, security rules). |
| `sw.js` | Service worker so the app itself opens offline. |
| `manifest.json`, `icon.svg` | Home-screen install bits. |

Want different temperatures, more pantry items or your own starter recipes? They
all live in plain lists at the top of `data.js` — edit that one file.

*No build step and no npm. React, htm and `@supabase/supabase-js` are loaded from a
CDN and cached by the service worker; nothing is compiled.*

## Where things are stored

IndexedDB database **`cookbook`**, three stores:

| Store | Contents |
|-------|----------|
| `meals` | One record per meal — everything except the photo bytes. |
| `images` | One JPEG blob per photo, keyed `<mealId>__<itemId>`. |
| `backups` | Numbered snapshots, keyed by their 4-digit code. |
| `meta` | `settings` (frame theme), `index` (meal order), `pantry`, `customTemps`, `deletions` (tombstones). |

Photos are deliberately kept out of the meal records: a meal stays a few kilobytes of
JSON no matter how many photos are pinned to its page, and the browser stores the
images themselves on disk rather than in memory.

Snapshots don't copy photos either — they record which photos they need, and the
clean-up pass that deletes unreferenced images treats a snapshot's list as a
reason to keep one. So a backup of a cookbook with 300 photos costs a few
kilobytes, and a photo you deleted last week is still there if you restore a
snapshot from before you deleted it.
