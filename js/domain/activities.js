/* The kinds of work. Their order sets the colours (--a0…) and the report column order.
   Adding one means updating this list, PRINT_COLORS and the --aN tokens in style.css (and checking the Excel/PDF widths). */

export const ACTIVITIES = [
  {id: "flip", name: "Flipping", short: "Flip"},
  {id: "mr",   name: "Detailing (MR)", short: "MR"},
  {id: "cal",  name: "Calibration", short: "Cal"},
  {id: "fa",   name: "Final Assembly", short: "FA"},
  {id: "edit", name: "Editing", short: "Edit"},
  // Rare: only books that need it get this clock (a chip under the name), added from the book's ⋯ menu
  {id: "embed", name: "Embedding", short: "Embed", rare: true}
];
export const MAIN = ACTIVITIES.filter(a => !a.rare);   // the five clocks every book has
// Activity colours for paper and Excel (the light-mode ones, whatever the screen is using)
export const PRINT_COLORS = ["#3B6EA8", "#7657A8", "#2D8A6C", "#A87A1E", "#AE4A67", "#4F7F8C", "#8C5A3C"];
export const actName = id => (ACTIVITIES.find(a => a.id === id) || {}).name || id;
