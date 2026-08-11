/* ============================================================
   The Cookbook Board — reference data
   ------------------------------------------------------------
   Three built-in tables that never change and have no business
   cluttering app.js:

     COOK_TEMPS     temperatures and times per device, in °C
     DONENESS       internal "it's actually cooked" temperatures
     PANTRY_GROUPS  the ingredient checklist
     STARTER_MEALS  recipes shipped with the app, used by the
                    "What can I cook?" suggestions

   Times assume a preheated oven or air fryer and a piece of food
   roughly the size named. They are a starting point, not gospel —
   every row can be edited or overridden with your own.
   ============================================================ */

/* Each row: food, then [°C, "time"] per device. null = not suited to it. */
window.COOK_TEMPS = [
  {
    group: "Chicken & poultry",
    rows: [
      { food: "Chicken breast (boneless)", oven: [200, "20–25 min"], air: [190, "16–18 min"], pan: [null, "6–7 min a side, medium"] },
      { food: "Chicken thighs (bone in)", oven: [200, "35–40 min"], air: [190, "22–25 min"], pan: [null, "8 min a side, medium"] },
      { food: "Chicken wings", oven: [220, "35–40 min"], air: [200, "20–24 min"], pan: null },
      { food: "Whole chicken (1.5 kg)", oven: [190, "1 h 20 min"], air: [180, "50–60 min"], pan: null },
      { food: "Chicken nuggets (frozen)", oven: [200, "15–18 min"], air: [190, "9–11 min"], pan: null },
      { food: "Turkey breast steak", oven: [190, "20–25 min"], air: [180, "14–16 min"], pan: [null, "5 min a side, medium"] },
    ],
  },
  {
    group: "Beef, pork & lamb",
    rows: [
      { food: "Steak (2.5 cm, medium)", oven: [null, "sear then 6–8 min at 200"], air: [200, "10–12 min"], pan: [null, "3–4 min a side, high"] },
      { food: "Beef roast (per 500 g)", oven: [180, "25 min + 20 min rest"], air: [170, "22 min per 500 g"], pan: null },
      { food: "Pork chops (2 cm)", oven: [200, "20–25 min"], air: [190, "12–14 min"], pan: [null, "5 min a side, medium-high"] },
      { food: "Pork belly (crisp skin)", oven: [220, "30 min, then 160 for 1 h 30"], air: [200, "35–40 min"], pan: null },
      { food: "Lamb chops", oven: [200, "18–20 min"], air: [190, "10–12 min"], pan: [null, "4 min a side, high"] },
      { food: "Bacon", oven: [200, "12–15 min"], air: [180, "7–9 min"], pan: [null, "4–6 min, medium"] },
      { food: "Sausages", oven: [200, "25–30 min"], air: [180, "12–15 min"], pan: [null, "12–14 min, medium, turning"] },
      { food: "Meatballs", oven: [200, "18–22 min"], air: [180, "10–12 min"], pan: [null, "10–12 min, medium"] },
      { food: "Burgers (beef, 2 cm)", oven: [200, "18–20 min"], air: [190, "10–13 min"], pan: [null, "4 min a side, high"] },
    ],
  },
  {
    group: "Fish & seafood",
    rows: [
      { food: "Salmon fillet", oven: [200, "12–15 min"], air: [180, "8–10 min"], pan: [null, "4 min skin down, 2 min over"] },
      { food: "White fish fillet (cod, haddock)", oven: [200, "12–15 min"], air: [180, "8–10 min"], pan: [null, "3 min a side, medium"] },
      { food: "Breaded fish (frozen)", oven: [200, "18–20 min"], air: [190, "10–12 min"], pan: null },
      { food: "Prawns (raw, peeled)", oven: [200, "6–8 min"], air: [180, "5–6 min"], pan: [null, "2–3 min, high"] },
      { food: "Fish fingers", oven: [200, "15–18 min"], air: [190, "8–10 min"], pan: [null, "6–8 min, medium"] },
    ],
  },
  {
    group: "Potatoes & chips",
    rows: [
      { food: "Oven chips (frozen)", oven: [220, "20–25 min"], air: [200, "14–16 min"], pan: null },
      { food: "Home-cut chips (fresh)", oven: [220, "30–35 min"], air: [200, "18–22 min"], pan: null },
      { food: "Potato wedges", oven: [200, "30–35 min"], air: [190, "18–20 min"], pan: null },
      { food: "Roast potatoes", oven: [220, "45–55 min"], air: [200, "25–30 min"], pan: null },
      { food: "Baked potato (large)", oven: [200, "1 h 15 min"], air: [200, "40–45 min"], pan: null },
      { food: "Hash browns (frozen)", oven: [220, "18–20 min"], air: [200, "10–12 min"], pan: [null, "8 min, medium"] },
      { food: "Sweet potato wedges", oven: [200, "25–30 min"], air: [190, "15–18 min"], pan: null },
    ],
  },
  {
    group: "Vegetables",
    rows: [
      { food: "Mixed roast vegetables", oven: [200, "25–35 min"], air: [190, "15–20 min"], pan: [null, "10–12 min, medium-high"] },
      { food: "Broccoli / cauliflower florets", oven: [200, "20–25 min"], air: [190, "10–12 min"], pan: [null, "6–8 min, or 5 min steamed"] },
      { food: "Brussels sprouts (halved)", oven: [200, "22–25 min"], air: [190, "12–14 min"], pan: [null, "8–10 min, medium"] },
      { food: "Carrots (batons)", oven: [200, "25–30 min"], air: [190, "14–16 min"], pan: [null, "10 min, or 8 min boiled"] },
      { food: "Peppers & onions", oven: [200, "20–25 min"], air: [190, "10–12 min"], pan: [null, "8–10 min, medium-high"] },
      { food: "Mushrooms", oven: [200, "15–18 min"], air: [180, "8–10 min"], pan: [null, "6–8 min, high, dry first"] },
      { food: "Asparagus", oven: [220, "10–12 min"], air: [200, "7–8 min"], pan: [null, "4–5 min, high"] },
      { food: "Corn on the cob", oven: [200, "25–30 min"], air: [190, "12–14 min"], pan: [null, "8 min boiled"] },
    ],
  },
  {
    group: "Meat-free",
    rows: [
      { food: "Halloumi slices", oven: [200, "12–15 min"], air: [190, "8–10 min"], pan: [null, "2 min a side, medium-high, dry"] },
      { food: "Tofu cubes (pressed)", oven: [200, "25–30 min"], air: [190, "13–15 min"], pan: [null, "8–10 min, medium-high"] },
      { food: "Falafel", oven: [200, "20–25 min"], air: [190, "12–14 min"], pan: [null, "6–8 min, medium"] },
      { food: "Veggie burgers (frozen)", oven: [200, "20–22 min"], air: [190, "10–12 min"], pan: [null, "4 min a side, medium"] },
    ],
  },
  {
    group: "Bread, pizza & pastry",
    rows: [
      { food: "Pizza (fresh, on a tray)", oven: [230, "12–15 min"], air: [180, "8–10 min"], pan: null },
      { food: "Pizza (frozen)", oven: [220, "15–18 min"], air: [180, "9–12 min"], pan: null },
      { food: "Garlic bread", oven: [200, "10–12 min"], air: [180, "5–7 min"], pan: null },
      { food: "Bread loaf", oven: [220, "25–30 min"], air: null, pan: null },
      { food: "Bread rolls (part-baked)", oven: [200, "8–10 min"], air: [180, "5–6 min"], pan: null },
      { food: "Puff pastry (blind)", oven: [200, "18–22 min"], air: [180, "10–12 min"], pan: null },
      { food: "Sausage rolls", oven: [200, "22–25 min"], air: [180, "13–15 min"], pan: null },
    ],
  },
  {
    group: "Baking & sweet",
    rows: [
      { food: "Cookies", oven: [180, "10–12 min"], air: [160, "7–8 min"], pan: null },
      { food: "Brownies (20 cm tin)", oven: [180, "25–30 min"], air: [160, "18–20 min"], pan: null },
      { food: "Sponge cake (20 cm)", oven: [180, "25–30 min"], air: [160, "22–25 min"], pan: null },
      { food: "Muffins / cupcakes", oven: [190, "18–22 min"], air: [160, "12–14 min"], pan: null },
      { food: "Banana bread", oven: [170, "50–60 min"], air: [160, "35–40 min"], pan: null },
      { food: "Pancakes", oven: null, air: null, pan: [null, "2 min, then 1 min, medium"] },
      { food: "Apple crumble", oven: [180, "35–45 min"], air: [170, "20–25 min"], pan: null },
    ],
  },
  {
    group: "Eggs, rice & pasta",
    rows: [
      { food: "Boiled egg (soft / hard)", oven: null, air: [130, "10 / 13 min"], pan: [null, "6 min / 9 min from boiling"] },
      { food: "Fried egg", oven: null, air: null, pan: [null, "3–4 min, medium-low"] },
      { food: "Scrambled eggs", oven: null, air: null, pan: [null, "3–5 min, low, stirring"] },
      { food: "Omelette", oven: null, air: null, pan: [null, "4–5 min, medium-low"] },
      { food: "White rice", oven: null, air: null, pan: [null, "10–12 min simmer + 10 min lid on"] },
      { food: "Brown rice", oven: null, air: null, pan: [null, "25–30 min simmer"] },
      { food: "Dried pasta", oven: null, air: null, pan: [null, "8–12 min, rolling boil"] },
      { food: "Fresh pasta", oven: null, air: null, pan: [null, "2–4 min, rolling boil"] },
    ],
  },
];

/* Cooked-through internal temperatures. The only numbers here that really
   matter for safety are the poultry, pork and mince ones. */
window.DONENESS = [
  { food: "Chicken & turkey", temp: "75 °C", note: "all cuts, juices run clear" },
  { food: "Pork", temp: "71 °C", note: "slightly pink centre is fine at this temp" },
  { food: "Mince & burgers", temp: "71 °C", note: "all mince, whatever the meat" },
  { food: "Sausages", temp: "75 °C", note: "no pink at the centre" },
  { food: "Beef — rare", temp: "52 °C", note: "whole cuts only, never mince" },
  { food: "Beef — medium rare", temp: "57 °C", note: "" },
  { food: "Beef — medium", temp: "63 °C", note: "" },
  { food: "Beef — well done", temp: "71 °C", note: "" },
  { food: "Lamb — medium", temp: "63 °C", note: "" },
  { food: "Fish", temp: "63 °C", note: "flakes apart easily" },
  { food: "Reheated leftovers", temp: "75 °C", note: "steaming hot the whole way through" },
];

/* The pantry checklist. Names here are also what recipe ingredients are
   matched against, so keep them singular and plain. */
window.PANTRY_GROUPS = [
  {
    group: "Spices & dried herbs",
    items: ["salt", "black pepper", "paprika", "smoked paprika", "chilli flakes", "chilli powder",
      "cumin", "coriander seed", "turmeric", "curry powder", "garam masala", "cinnamon", "nutmeg",
      "oregano", "basil", "thyme", "rosemary", "bay leaf", "mixed herbs", "garlic powder",
      "onion powder", "ginger powder", "cayenne", "all-purpose seasoning"],
  },
  {
    group: "Vegetables",
    items: ["onion", "red onion", "garlic", "potato", "sweet potato", "carrot", "celery", "tomato",
      "cherry tomato", "bell pepper", "chilli", "courgette", "aubergine", "broccoli", "cauliflower",
      "mushroom", "spinach", "lettuce", "cucumber", "cabbage", "leek", "peas", "sweetcorn",
      "green beans", "spring onion", "ginger", "pumpkin", "beetroot"],
  },
  {
    group: "Fruit",
    items: ["lemon", "lime", "orange", "apple", "banana", "berries", "avocado", "pineapple", "raisins"],
  },
  {
    group: "Meat & fish",
    items: ["chicken breast", "chicken thigh", "chicken wings", "beef mince", "steak", "pork chop",
      "bacon", "sausages", "ham", "salmon", "white fish", "tuna", "prawns", "turkey"],
  },
  {
    group: "Dairy & eggs",
    items: ["egg", "milk", "butter", "cheese", "cheddar", "parmesan", "mozzarella", "feta", "halloumi",
      "cream", "sour cream", "yoghurt", "cream cheese"],
  },
  {
    group: "Grains, pasta & bread",
    items: ["rice", "pasta", "spaghetti", "noodles", "couscous", "quinoa", "bread", "tortilla",
      "flour", "breadcrumbs", "oats", "pizza base"],
  },
  {
    group: "Tins, jars & dry goods",
    items: ["chopped tomatoes", "tomato puree", "passata", "coconut milk", "chickpeas", "black beans",
      "kidney beans", "lentils", "baked beans", "stock cube", "peanut butter", "honey", "olives",
      "tinned tuna", "tinned sweetcorn"],
  },
  {
    group: "Sauces & oils",
    items: ["olive oil", "vegetable oil", "soy sauce", "vinegar", "balsamic vinegar", "ketchup",
      "mayonnaise", "mustard", "hot sauce", "worcestershire sauce", "sesame oil", "fish sauce",
      "curry paste", "pesto"],
  },
  {
    group: "Baking",
    items: ["sugar", "brown sugar", "baking powder", "bicarbonate of soda", "yeast", "vanilla",
      "cocoa powder", "chocolate", "icing sugar", "cornflour"],
  },
];

/* Page backgrounds. All deliberately pale — the app's text is dark, and a
   background dark enough to fight it would make the whole thing unreadable.
   `css` goes straight into the background shorthand. */
window.BACKGROUNDS = [
  { id: "paper", label: "Plain paper", css: "#F3F5EF" },
  { id: "cream", label: "Cream", css: "#FAF6EC" },
  { id: "linen", label: "Linen", css: "repeating-linear-gradient(45deg,#F6F4EC,#F6F4EC 6px,#F1EEE3 6px,#F1EEE3 12px)" },
  { id: "grid", label: "Notebook grid", css: "linear-gradient(#E4E9DC 1px,transparent 1px) 0 0/22px 22px,linear-gradient(90deg,#E4E9DC 1px,transparent 1px) 0 0/22px 22px,#F5F7F0" },
  { id: "dots", label: "Dotted", css: "radial-gradient(#DBE2D2 1.4px,transparent 1.4px) 0 0/20px 20px,#F5F7F0" },
  { id: "sage", label: "Sage wash", css: "linear-gradient(160deg,#EDF2E7,#E2EBDD)" },
  { id: "peach", label: "Peach wash", css: "linear-gradient(160deg,#FDF0E6,#F8E3D6)" },
  { id: "sky", label: "Sky wash", css: "linear-gradient(160deg,#EAF2F7,#DCE9F2)" },
  { id: "lilac", label: "Lilac wash", css: "linear-gradient(160deg,#F1ECF7,#E6DEF1)" },
  { id: "butter", label: "Butter", css: "linear-gradient(160deg,#FBF6DE,#F5EDC9)" },
  { id: "check", label: "Picnic check", css: "repeating-linear-gradient(0deg,#F7EDE9 0 14px,#FBF6F4 14px 28px),repeating-linear-gradient(90deg,#EFD9D2 0 14px,transparent 14px 28px)" },
  { id: "marble", label: "Marble", css: "radial-gradient(at 20% 30%,#FFFFFF,transparent 45%),radial-gradient(at 75% 65%,#FFFFFF,transparent 40%),linear-gradient(135deg,#EFEFEA,#E6E7E0)" },
];

/* Recipes shipped with the app. Ingredients are written in pantry terms so the
   matcher can do its job; "staples" are things almost everyone has and are
   weighted far less when deciding whether you can cook something. */
window.STARTER_MEALS = [
  {
    id: "starter-carbonara", name: "Spaghetti carbonara", mealType: "Dinner", device: "Stovetop",
    prepTime: 20, rating: 8.5,
    ingredients: ["spaghetti", "bacon", "egg", "parmesan", "black pepper", "garlic", "olive oil"],
    instructions: "1. Boil the spaghetti in well-salted water.\n2. Fry the bacon in a little oil until crisp, add crushed garlic for the last minute.\n3. Beat the eggs with grated parmesan and plenty of black pepper.\n4. Drain the pasta, keeping a mugful of the water.\n5. Off the heat, toss pasta into the bacon pan, then stir through the egg mix, loosening with pasta water until glossy. Never let it boil or it scrambles.",
  },
  {
    id: "starter-chilli", name: "Beef chilli", mealType: "Dinner", device: "Stovetop",
    prepTime: 45, rating: 8.7,
    ingredients: ["beef mince", "onion", "garlic", "bell pepper", "chopped tomatoes", "kidney beans",
      "cumin", "chilli powder", "smoked paprika", "stock cube", "tomato puree", "olive oil"],
    instructions: "1. Soften chopped onion and pepper in oil, 8 minutes.\n2. Add garlic and the spices, stir for a minute until fragrant.\n3. Brown the mince, breaking it up.\n4. Stir in tomato puree, chopped tomatoes, drained beans and a crumbled stock cube.\n5. Simmer 25–30 minutes until thick. Season well.",
  },
  {
    id: "starter-tikka", name: "Chicken tikka masala", mealType: "Dinner", device: "Stovetop",
    prepTime: 40, rating: 9.0,
    ingredients: ["chicken breast", "yoghurt", "garam masala", "cumin", "turmeric", "garlic", "ginger",
      "onion", "chopped tomatoes", "cream", "rice", "vegetable oil"],
    instructions: "1. Toss diced chicken in yoghurt with half the spices; leave 20 minutes if you can.\n2. Fry onion until golden, add garlic, ginger and remaining spices.\n3. Add the chicken and colour it all over.\n4. Pour in chopped tomatoes, simmer 15 minutes.\n5. Stir through cream, simmer 5 more. Serve with rice.",
  },
  {
    id: "starter-airfryer-chicken", name: "Air fryer chicken & wedges", mealType: "Dinner", device: "Air fryer",
    prepTime: 30, rating: 8.2,
    ingredients: ["chicken thigh", "potato", "olive oil", "smoked paprika", "garlic powder", "salt", "black pepper"],
    instructions: "1. Cut potatoes into wedges, toss with oil, paprika, garlic powder, salt and pepper.\n2. Air fry wedges at 190°C for 10 minutes.\n3. Rub the chicken thighs with the same seasoning.\n4. Add chicken to the basket, cook 18–20 minutes more, turning once, until the chicken hits 75°C.",
  },
  {
    id: "starter-tomato-soup", name: "Tomato soup", mealType: "Lunch", device: "Stovetop",
    prepTime: 30, rating: 7.8,
    ingredients: ["chopped tomatoes", "onion", "garlic", "stock cube", "olive oil", "basil", "cream"],
    instructions: "1. Soften onion and garlic in oil.\n2. Add chopped tomatoes, a stock cube and a tin of water.\n3. Simmer 20 minutes.\n4. Blend smooth, stir in a splash of cream and torn basil.",
  },
  {
    id: "starter-stirfry", name: "Vegetable stir fry", mealType: "Dinner", device: "Stovetop",
    prepTime: 20, rating: 7.9,
    ingredients: ["noodles", "bell pepper", "broccoli", "carrot", "spring onion", "garlic", "ginger",
      "soy sauce", "sesame oil", "vegetable oil"],
    instructions: "1. Cook the noodles, drain, rinse cold.\n2. Get a pan very hot with a little oil.\n3. Stir fry the hard vegetables 3 minutes, then garlic and ginger for 30 seconds.\n4. Add noodles, soy sauce and sesame oil, toss 2 minutes.\n5. Finish with sliced spring onion.",
  },
  {
    id: "starter-omelette", name: "Cheese omelette", mealType: "Breakfast", device: "Stovetop",
    prepTime: 10, rating: 7.5,
    ingredients: ["egg", "cheese", "butter", "salt", "black pepper"],
    instructions: "1. Beat 3 eggs with salt and pepper.\n2. Melt butter in a non-stick pan on medium-low.\n3. Pour in the eggs, drag the set edges inwards for 2 minutes.\n4. Scatter cheese over, fold, slide out while the middle is still just soft.",
  },
  {
    id: "starter-pancakes", name: "Pancakes", mealType: "Breakfast", device: "Stovetop",
    prepTime: 20, rating: 8.4,
    ingredients: ["flour", "egg", "milk", "sugar", "baking powder", "butter", "salt"],
    instructions: "1. Whisk flour, sugar, baking powder and a pinch of salt.\n2. Beat in egg and milk to a thick batter; rest 10 minutes.\n3. Cook spoonfuls in a buttered pan on medium, 2 minutes until bubbles set, 1 minute the other side.",
  },
  {
    id: "starter-roast-veg-pasta", name: "Roast vegetable pasta", mealType: "Dinner", device: "Oven",
    prepTime: 40, rating: 8.0,
    ingredients: ["pasta", "courgette", "bell pepper", "cherry tomato", "red onion", "garlic",
      "olive oil", "oregano", "parmesan"],
    instructions: "1. Heat the oven to 200°C.\n2. Toss chopped vegetables and whole garlic cloves in oil and oregano; roast 25–30 minutes.\n3. Boil the pasta.\n4. Squeeze the soft garlic out of its skins, mash into the vegetables, toss with the pasta and a splash of pasta water.\n5. Grate parmesan over.",
  },
  {
    id: "starter-fish-traybake", name: "Salmon traybake", mealType: "Dinner", device: "Oven",
    prepTime: 30, rating: 8.6,
    ingredients: ["salmon", "potato", "green beans", "lemon", "olive oil", "garlic", "black pepper", "salt"],
    instructions: "1. Heat the oven to 200°C.\n2. Halve baby potatoes, toss in oil and salt, roast 20 minutes.\n3. Add green beans and the salmon fillets, drizzle with oil, garlic and lemon.\n4. Roast 12–14 minutes more until the salmon flakes.",
  },
  {
    id: "starter-chickpea-curry", name: "Chickpea curry", mealType: "Dinner", device: "Stovetop",
    prepTime: 30, rating: 8.3,
    ingredients: ["chickpeas", "coconut milk", "onion", "garlic", "ginger", "curry powder", "turmeric",
      "chopped tomatoes", "spinach", "rice", "vegetable oil"],
    instructions: "1. Fry onion until soft, add garlic, ginger and the spices.\n2. Add chopped tomatoes and cook down 5 minutes.\n3. Stir in drained chickpeas and coconut milk; simmer 15 minutes.\n4. Wilt spinach through at the end. Serve with rice.",
  },
  {
    id: "starter-brownies", name: "Brownies", mealType: "Dessert", device: "Oven",
    prepTime: 45, rating: 9.2,
    ingredients: ["chocolate", "butter", "sugar", "egg", "flour", "cocoa powder", "vanilla", "salt"],
    instructions: "1. Heat the oven to 180°C, line a 20 cm tin.\n2. Melt chocolate and butter together, cool slightly.\n3. Whisk eggs, sugar and vanilla until pale and thick.\n4. Fold in the chocolate, then flour, cocoa and a pinch of salt.\n5. Bake 25–30 minutes — the middle should still wobble slightly.",
  },
  {
    id: "starter-jacket", name: "Loaded jacket potato", mealType: "Lunch", device: "Oven",
    prepTime: 80, rating: 7.6,
    ingredients: ["potato", "cheddar", "baked beans", "butter", "salt", "olive oil"],
    instructions: "1. Heat the oven to 200°C.\n2. Prick the potatoes, rub with oil and salt.\n3. Bake straight on the shelf 1 h 15 min until the skin crackles.\n4. Split, fork through butter, pile on hot beans and grated cheddar.",
  },
  {
    id: "starter-fried-rice", name: "Egg fried rice", mealType: "Dinner", device: "Stovetop",
    prepTime: 15, rating: 8.1,
    ingredients: ["rice", "egg", "peas", "spring onion", "garlic", "soy sauce", "sesame oil", "vegetable oil"],
    instructions: "1. Use cold cooked rice — fresh rice goes to mush.\n2. Scramble the eggs in a hot oiled pan, tip out.\n3. Fry garlic briefly, add rice and peas, press it flat and let it catch for a minute at a time.\n4. Return the egg, add soy and sesame oil, finish with spring onion.",
  },
];
