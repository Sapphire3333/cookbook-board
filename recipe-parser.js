/* ============================================================
   The Cookbook Board — recipe parser
   ------------------------------------------------------------
   Turns a block of text copied off a recipe site into the fields
   this app uses. No AI and no network: it is pattern matching,
   and it says so — everything it works out is shown to you for
   correction before it becomes a meal.

   What it looks for, in order of reliability:
     • an explicit "Ingredients" / "Method" heading  (very reliable)
     • numbered or bulleted steps                    (reliable)
     • a line that looks like "200°C" or "400F"      (reliable)
     • "Prep 10 mins  Cook 25 mins"                  (reliable)
     • otherwise: lines that start with a quantity are
       ingredients, long prose sentences are steps
   ============================================================ */
(function () {

  const UNITS = "g|kg|ml|l|litre|litres|oz|lb|lbs|cup|cups|tsp|teaspoon|teaspoons|tbsp|tablespoon|tablespoons|clove|cloves|pinch|handful|slice|slices|tin|tins|can|cans|packet|packets|pack|bunch|sprig|sprigs|stick|sticks|piece|pieces|dash|knob|splash";
  const FRACTIONS = "¼|½|¾|⅓|⅔|⅛";

  const ING_HEAD = /^(ingredients?|you(?:'ll)? will need|you'll need|shopping list|for the\b.*)[:\s]*$/i;
  const STEP_HEAD = /^(method|instructions?|directions?|steps?|preparation|how to (?:make|cook) it|to cook)[:\s]*$/i;
  const NOISE = /^(share|save|print|jump to recipe|rate this|advertisement|photograph|photo|image|by |serves?\b\s*\d*$|servings?\b|makes\s+\d|yield|prep(?:aration)?\s*time|cook(?:ing)?\s*time|total\s*time|ready in|nutrition|calories|difficulty|equipment|tags?|cuisine|course|author|published|updated|\d+ comments?|reviews?)/i;

  /* A line that opens with a quantity, a fraction, or "a/an <unit>". */
  const startsWithQuantity = (l) =>
    new RegExp("^(?:\\d+[\\d/.,\\s-]*|" + FRACTIONS + ")\\s*(?:" + UNITS + ")?\\b", "i").test(l) ||
    new RegExp("^(?:a|an|one|two|three|four|half)\\s+(?:" + UNITS + ")\\b", "i").test(l);

  const hasUnit = (l) => new RegExp("\\b\\d+\\s*(?:" + UNITS + ")\\b", "i").test(l);

  /* Lines that open with a cooking instruction are steps however short they are.
     Without this, "Preheat the air fryer to 200C." is too short to survive the
     word-count rule and quietly disappears. */
  const VERBS = /^(?:pre)?(?:heat|bake|roast|fry|air[\s-]?fry|grill|boil|simmer|cook|stir|mix|whisk|beat|fold|add|pour|season|serve|drain|chop|slice|dice|crush|mince|melt|combine|blend|toss|rub|brush|coat|marinate|arrange|place|put|transfer|remove|leave|rest|chill|refrigerate|freeze|garnish|sprinkle|scatter|top|repeat|reduce|cover|uncover|flip|turn|spread|knead|prove|line|grease|preheat|set|bring|return|divide|shape|roll)\b/i;
  const isStepish = (l) => VERBS.test(l.replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, ""));

  /* ---------- individual field finders ---------- */

  function findTemp(text) {
    // °C wins outright.
    let m = text.match(/(\d{2,3})\s*(?:°|º|\s)?\s*C\b(?!\w)/);
    if (m && +m[1] >= 50 && +m[1] <= 300) return { c: +m[1], from: "C" };
    // Gas mark, which UK sites love.
    m = text.match(/gas(?:\s*mark)?\s*(\d(?:\s*½)?)/i);
    if (m) {
      const GAS = { "1": 140, "2": 150, "3": 170, "4": 180, "5": 190, "6": 200, "7": 220, "8": 230, "9": 240 };
      const c = GAS[m[1].trim().charAt(0)];
      if (c) return { c, from: "gas" };
    }
    // Fahrenheit, converted and rounded to the nearest 5.
    m = text.match(/(\d{3})\s*(?:°|º|\s)?\s*F\b(?!\w)/);
    if (m && +m[1] >= 150 && +m[1] <= 550) {
      return { c: Math.round(((+m[1] - 32) * 5 / 9) / 5) * 5, from: "F" };
    }
    return null;
  }

  function findMinutes(text) {
    const grab = (label) => {
      const re = new RegExp(label + "[^\\d]{0,12}(\\d+)\\s*(hours?|hrs?|h|minutes?|mins?|m)\\b", "i");
      const m = text.match(re);
      if (!m) return 0;
      const n = +m[1];
      return /^h/i.test(m[2]) ? n * 60 : n;
    };
    const prep = grab("prep(?:aration)?(?:\\s*time)?");
    const cook = grab("cook(?:ing)?(?:\\s*time)?");
    const total = grab("total(?:\\s*time)?") || grab("ready in");
    if (total) return total;
    if (prep || cook) return prep + cook;
    // Fall back to the largest plain duration mentioned anywhere.
    let best = 0;
    const re = /(\d+)\s*(hours?|hrs?|minutes?|mins?)\b/gi;
    let m;
    while ((m = re.exec(text))) {
      const n = /^h/i.test(m[2]) ? +m[1] * 60 : +m[1];
      if (n > best && n <= 600) best = n;
    }
    return best;
  }

  function findServings(text) {
    const m = text.match(/\b(?:serves|servings?|makes|feeds|yield)\b[^\d]{0,10}(\d+)/i);
    return m ? +m[1] : null;
  }

  function findDevice(text) {
    const t = text.toLowerCase();
    if (/air[\s-]?fry/.test(t)) return "Air fryer";
    if (/slow cooker|crock ?pot/.test(t)) return "Slow cooker";
    if (/\bgrill\b|barbecue|bbq/.test(t)) return "Grill";
    if (/microwave/.test(t)) return "Microwave";
    if (/\boven\b|\bbake\b|\broast\b|preheat/.test(t)) return "Oven";
    if (/\bfry\b|\bpan\b|skillet|saucepan|\bhob\b|\bsimmer\b|\bboil\b|\bsauté|saute/.test(t)) return "Stovetop";
    if (/no[\s-]?cook|no baking|refrigerate until set/.test(t)) return "No-cook";
    return "Stovetop";
  }

  function findMealType(text, name) {
    const t = (name + " " + text).toLowerCase();
    if (/dessert|cake|brownie|cookie|pudding|ice cream|cheesecake|tart|pie\b|crumble|mousse/.test(t)) return "Dessert";
    if (/breakfast|pancake|porridge|granola|omelette|scrambled|brunch|waffle/.test(t)) return "Breakfast";
    if (/snack|dip\b|nibbles|popcorn|energy ball/.test(t)) return "Snack";
    if (/lunch|sandwich|wrap\b|salad\b|soup\b/.test(t)) return "Lunch";
    return "Dinner";
  }

  function findName(lines) {
    for (const l of lines.slice(0, 6)) {
      if (l.length < 4 || l.length > 70) continue;
      if (ING_HEAD.test(l) || STEP_HEAD.test(l) || NOISE.test(l)) continue;
      if (startsWithQuantity(l)) continue;
      // An instruction, not a title. Length matters: "Roast Chicken" is a dish,
      // "Roast the chicken for an hour" is a step, and both start with a verb.
      if (isStepish(l) && l.split(/\s+/).length > 4) continue;
      if (/[.!?]$/.test(l) && l.split(/\s+/).length > 9) continue;   // a sentence, not a title
      return l.replace(/^#+\s*/, "").trim();
    }
    return "";
  }

  /* ---------- ingredient tidy-up ---------- */

  /* "2 cloves of garlic, crushed"  ->  "garlic"
     Used only for pantry matching; the ingredient itself is kept verbatim. */
  function ingredientKey(line) {
    let s = " " + line.toLowerCase() + " ";
    s = s.split(/,|\(|—| - /)[0];                                  // drop ", finely chopped"
    s = s.replace(new RegExp("\\b(?:" + FRACTIONS + ")", "g"), " ");
    s = s.replace(/\b\d+([./]\d+)?\b/g, " ");                            // numbers
    s = s.replace(new RegExp("\\b(?:" + UNITS + ")\\b", "gi"), " ");     // units
    s = s.replace(/\b(?:of|a|an|the|fresh|freshly|dried|ground|chopped|finely|roughly|large|small|medium|ripe|raw|cooked|frozen|tinned|canned|free[- ]range|organic|plain|whole|extra|virgin|to taste|optional|for (?:the )?(?:garnish|serving|frying|drizzling)|approx|about)\b/gi, " ");
    s = s.replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
    return s;
  }

  /* ---------- the main pass ---------- */

  function parseRecipe(raw) {
    const text = String(raw || "").replace(/ /g, " ");
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "").trim()).filter(Boolean);
    if (!lines.length) return null;

    const name = findName(lines);
    const temp = findTemp(text);
    const prepTime = findMinutes(text);
    const servings = findServings(text);

    /* Pass 1 — explicit headings. This is the happy path and by far the most
       accurate, so when we find headings we trust them completely. */
    let ingredients = [], steps = [], usedHeadings = false;
    let section = null;
    for (const l of lines) {
      if (ING_HEAD.test(l)) { section = "ing"; usedHeadings = true; continue; }
      if (STEP_HEAD.test(l)) { section = "step"; usedHeadings = true; continue; }
      if (!section || NOISE.test(l)) continue;
      if (section === "ing") {
        // A numbered line under Ingredients usually means the method started
        // without a heading of its own.
        if (/^\s*(?:step\s*)?\d+[.)]\s+/i.test(l) && l.split(/\s+/).length > 6) { section = "step"; steps.push(l); continue; }
        ingredients.push(l);
      } else {
        steps.push(l);
      }
    }

    /* Pass 2 — no headings, so judge each line on its own merits. */
    if (!usedHeadings || (!ingredients.length && !steps.length)) {
      ingredients = []; steps = [];
      for (const l of lines) {
        if (l === name || NOISE.test(l)) continue;
        const numbered = /^\s*(?:step\s*)?\d+[.)]\s+/i.test(l);
        const bulleted = /^[-•*·]\s+/.test(l);
        const words = l.split(/\s+/).length;
        if (numbered && words > 5) { steps.push(l); continue; }
        if ((startsWithQuantity(l) || hasUnit(l) || bulleted) && words <= 14 && !isStepish(l)) { ingredients.push(l); continue; }
        if (words > 6 || isStepish(l)) steps.push(l);
      }
    }

    const clean = (arr) => arr
      .map((l) => l.replace(/^[-•*·]\s*/, "").replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, "").trim())
      .filter((l) => l.length > 1);

    ingredients = clean(ingredients);
    steps = clean(steps);

    /* Pass 3 — the recipe arrived as one wall of prose. Split it into sentences
       so each instruction gets its own step instead of one giant paragraph. */
    let proseName = "";
    if (steps.length <= 1 && steps.join("").length > 160) {
      const blob = steps[0] || "";
      const sentences = blob.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [];
      const parts = sentences.map((s) => s.trim()).filter((s) => s.length > 1);
      // A short opening sentence with no verb is the dish's name, not a step.
      if (parts.length > 1 && parts[0].split(/\s+/).length <= 6 && !VERBS.test(parts[0])) {
        proseName = parts.shift().replace(/[.!?]+$/, "");
      }
      if (parts.length > 1) steps = parts;
      // Prose hides its ingredients inside the sentences: pull out the
      // "200g dark chocolate" style fragments so at least something is offered.
      if (!ingredients.length) {
        const re = new RegExp("(\\d+[\\d/.,]*\\s*(?:" + UNITS + ")?)\\s+(?:of\\s+)?([a-z][a-z\\s-]{2,30})", "gi");
        const TIMEY = /^(?:minute|minutes|min|mins|hour|hours|hr|hrs|second|seconds|degree|degrees)\b/i;
        const found = new Map();
        let m;
        while ((m = re.exec(blob))) {
          // Stop the noun at the first joining word — "chocolate with 175g butter"
          // must not swallow the rest of the sentence.
          const noun = m[2]
            .replace(/\s+\b(?:with|and|then|until|into|onto|over|under|in|on|to|at|the|a|an|for|from|plus|or|but)\b.*$/i, "")
            .trim();
          if (noun.length < 3 || TIMEY.test(noun)) continue;
          const qty = m[1].trim();
          if (TIMEY.test(noun) || /^\d+$/.test(qty) && noun.split(/\s+/).length > 3) continue;
          found.set(noun.toLowerCase(), (qty + " " + noun).replace(/\s+/g, " "));
        }
        ingredients = [...found.values()].slice(0, 20);
      }
    }

    // A "step" shorter than a clause is nearly always a stray caption.
    steps = steps.filter((s) => s.split(/\s+/).length >= 3 || isStepish(s));

    const instructions = steps.map((s, i) => (i + 1) + ". " + s).join("\n");

    return {
      name: name || proseName || "Pasted recipe",
      mealType: findMealType(text, name),
      device: findDevice(text),
      prepTime: prepTime || 30,
      temp: temp ? temp.c : null,
      tempFrom: temp ? temp.from : null,
      servings,
      ingredients,
      ingredientKeys: ingredients.map(ingredientKey).filter(Boolean),
      steps,
      instructions,
      usedHeadings,
      lineCount: lines.length,
    };
  }

  /* ---------- durations inside a step ---------- */

  /* "roast for 35-40 minutes"  ->  one hit, 35 min, covering that phrase.
     Ranges take the LOWER bound: you want the alarm when it might be ready,
     not once it's certainly overdone. Bare "m" and "s" are deliberately not
     units here — they match far too much ordinary text. */
  const DUR_RE = /(\d+(?:[.,]\d+)?)\s*(?:\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?)?\s*(hours?|hrs?|hr|h|minutes?|mins?|min|seconds?|secs?|sec)\b/gi;

  /* Never rounds a compound away: 90 seconds reads "1 min 30 sec", not "2 min". */
  function durationLabel(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h) return h + " h" + (m ? " " + m + " min" : "");
    if (m) return m + " min" + (s ? " " + s + " sec" : "");
    return s + " sec";
  }

  function findDurations(text) {
    const out = [];
    const s = String(text || "");
    DUR_RE.lastIndex = 0;
    let m;
    while ((m = DUR_RE.exec(s))) {
      const n = parseFloat(m[1].replace(",", "."));
      if (!isFinite(n) || n <= 0) continue;
      const unit = m[2].toLowerCase();
      let seconds;
      let label;
      if (/^h/.test(unit)) { seconds = Math.round(n * 3600); label = n + (n === 1 ? " hour" : " hours"); }
      else if (/^m/.test(unit)) { seconds = Math.round(n * 60); label = n + " min"; }
      else { seconds = Math.round(n); label = n + " sec"; }
      if (seconds < 5 || seconds > 24 * 3600) continue;   // not a cooking time
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0].trim(), seconds, label, unit });
    }

    /* "1 hour 20 minutes" arrives as two separate hits. Anyone reading that
       means one timer of eighty minutes, so fold a smaller unit into the larger
       one directly before it. */
    const merged = [];
    for (const hit of out) {
      const prev = merged[merged.length - 1];
      const gap = prev ? s.slice(prev.end, hit.start) : null;
      const finerThanPrev = prev &&
        ((/^h/.test(prev.unit) && /^[ms]/.test(hit.unit)) || (/^m/.test(prev.unit) && /^s/.test(hit.unit)));
      if (prev && finerThanPrev && /^[\s,]*(?:and\s+)?$/i.test(gap)) {
        prev.end = hit.end;
        prev.seconds += hit.seconds;
        prev.text = s.slice(prev.start, prev.end).trim();
        prev.label = durationLabel(prev.seconds);
        continue;
      }
      merged.push(hit);
    }
    return merged;
  }

  /* Splits a step into plain-text and duration pieces so the UI can render the
     durations as something you can tap. */
  function splitByDurations(text) {
    const s = String(text || "");
    const hits = findDurations(s);
    if (!hits.length) return [{ kind: "text", text: s }];
    const parts = [];
    let at = 0;
    for (const h of hits) {
      if (h.start > at) parts.push({ kind: "text", text: s.slice(at, h.start) });
      parts.push({ kind: "time", text: s.slice(h.start, h.end), seconds: h.seconds, label: h.label });
      at = h.end;
    }
    if (at < s.length) parts.push({ kind: "text", text: s.slice(at) });
    return parts;
  }

  window.RecipeParser = { parseRecipe, ingredientKey, findDurations, splitByDurations };
})();
