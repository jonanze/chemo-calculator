# Chemo Calculator

Works out the next clinic reviews, chemo dates and pre-chemo labs from the upcoming review date, chemo date and regimen. Applies Singapore public holidays. Static site with no backend; settings are kept in the browser.

- `js/engine.js`: scheduling rules (pure functions)
- `js/holidays.js`: SG public holidays from MOM. **Update yearly.**
- `js/defaults.js`: default settings and regimen entry
- `npm test`: engine tests (Node 20+)

When releasing, bump `VERSION` in `sw.js`.
