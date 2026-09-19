# The review pass

Read this at the end of design work, after `./tests/run.sh` passes and after you
have actually looked at the rendered page.

Review as a skeptical senior product designer seeing it for the first time —
not as the person who just built it. The failure mode this guards against is
grading your own work while still holding the reasoning that produced it.

## The two that decide whether you are finished

1. Does this look like a generic AI dashboard?
2. Could this interface belong to 500 other products?

If either is yes, the work is not done. Find the weakest screen and redesign it
before going further — usually it is the one composed from generic containers
rather than from the object it is about (see §4 of the skill).

## Structure and hierarchy

3. Is the hierarchy obvious within two seconds of landing on the page?
4. Can a user scan for the thing they came for without reading?
5. Did every object become a card when some of them wanted a table, a ledger,
   a timeline or a status strip?
6. Does each section's structure match what its information actually is, or did
   the page settle into one repeating rhythm?
7. Is there anything on screen that communicates nothing — a decorative block,
   an illustration, explanatory copy nobody will read?

## Product fit

8. Does the visual language belong to *this* product — tickets, books, custody,
   money — or could the same screens ship for a CRM?
9. Do tickets read as tickets and books as controlled inventory?
10. Is custody legible at a glance where it matters? (Who holds this book?)

## Numbers and trust

11. Do money columns align on the digit, with tabular figures?
12. Would a person reconciling cash trust these numbers, or do they read like
    body text that happens to be numeric?
13. Is the most important number on each screen the most prominent one?
14. Do serial numbers have consistent, deliberate formatting?

## The repo's enforced rules

15. Is every unusable control shown **disabled with its reason**, rather than
    hidden or enabled-then-refused? (`permissionui`)
16. Do the words for people match the server's words — "seller", not "agent"?
    (`rolewords`)
17. Does every new `<Bi text>` have a Burmese line? (`i18n`)
18. Does anything new hard-code a colour, radius or shadow instead of using a
    token?

## Devices and people

19. Is the phone layout designed, or is it a desktop layout stacked? Sellers
    are the phone users, standing up, often one-handed.
20. Are touch targets still `--tap` sized for anything used in the field?
21. Does it hold together in dark mode? (`style.css` redefines every token —
    a hard-coded value shows up here first.)
22. Does it survive a long Burmese string, a long name, and a zero state?

## Character

23. Would it still look intentional with every gradient, shadow and animation
    stripped out?
24. Is there one memorable characteristic somebody could describe afterwards?
25. Could you explain to a designer *why* each major decision exists — and is
    that explanation about the product rather than about taste?
