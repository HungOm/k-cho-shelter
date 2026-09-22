/*
 * What the verify page says, in both languages.
 *
 * Kept as a flat object rather than going through src/lib/i18n.js on purpose.
 * That file is loaded by the app, carries four hundred entries, and imports its
 * way into the store; this page is opened by a stranger on mobile data in a
 * hall and has to be a few kilobytes. Every line it needs is here.
 *
 * Both languages are shown at once, not chosen between. The person holding the
 * ticket may read either, the page has no way to ask, and a wrong guess shows
 * somebody a verdict about their money in a language they do not read.
 */
/*
 * BURMESE AWAITING A NATIVE READER.
 *
 * `whatThisIs` HAS now been reviewed — the user supplied both halves on
 * 2026-09-20 and they are in verbatim. Do not reword either without them. The
 * keys added with the page's redesign — brandCheck, showSeller, aboutMore —
 * were written the same way and have had the same amount of native review,
 * which is none. The English in each is the sentence that was meant; if the two
 * ever disagree, the English is the one to correct the Burmese against.
 *
 * AND NOTHING HERE IS SHORTENED BY REWORDING. Where a line has been cut down
 * it is by deleting a WHOLE SENTENCE that already stood in both halves. A
 * clause trimmed by somebody who does not read Burmese is a new sentence
 * wearing an old one's clothes, and nobody would know to send it for review.
 *
 * `sold`, `unsold` and `void` were shortened on 2026-09-22 and did not break
 * that rule, because they were not reworded at all: all three are single
 * clauses with no sentence to delete, so instead of trimming them they were
 * REPLACED WITH THE APP'S OWN PAIRS, copied verbatim from STATUS_WORDS and
 * i18n.js. No Burmese was composed. A native reader checking them should check
 * i18n.js, where the same two words have always been what the raffle calls
 * these states — and a change there is a change here, which verifypage pins.
 */
export const S = {
  checking: { en: 'Checking this ticket…', my: 'အသိအမှတ်ကို စစ်ဆေးနေသည်…' },

  /*
   * THE VERDICT IS A VERDICT, NOT A CLAIM ABOUT THE PAPER.
   *
   * These read "This is a real ticket" and "This is not a valid ticket", and
   * card 4i draws "Verified ticket" and "Not verified". The difference is not
   * tone. "Real" is a statement about the object in somebody's hand, which
   * this page cannot make — a genuine ticket can be photocopied, and no page
   * can tell from a number whether the paper in front of somebody is the one
   * it was printed on. What the page can actually attest is that it checked
   * the number against the raffle's records and they matched.
   * "Verified" says that and claims nothing more; "real" over-claims on the
   * one page whose whole value is that it does not.
   *
   * The negative matters more. "This is not a valid ticket" tells somebody
   * holding paper that their paper is fake, when the same page is returned for
   * a number never issued, a book never printed and a code altered by one
   * character, which the endpoint answers identically on purpose so that it
   * cannot be used to map the raffle. "Not verified" is what happened; the
   * page no longer explains why, and the note above brandCheck says so.
   *
   * THE BURMESE IS COMPOSED, not written by a reader of it, like the rest of
   * this file: အတည်ပြု is "confirm/verify". It wants checking by somebody who
   * reads Burmese, and the English above is the sentence that was meant.
   */
  genuine: { en: 'Verified ticket', my: 'အတည်ပြုပြီး လက်မှတ်' },
  notGenuine: { en: 'Not verified', my: 'အတည်မပြုနိုင်ပါ' },
  cannotCheck: { en: 'Could not check this ticket', my: 'စစ်ဆေး၍ မရပါ' },

  /*
   * THREE STATES, THREE WORDS — AND THEY ARE THE APP'S OWN WORDS, NOT NEW ONES.
   *
   * These read "Recorded as sold", "Not recorded as sold yet" and "This ticket
   * was cancelled". On one ticket that is a sentence; on a receipt it is the
   * same sentence in two languages on every row, so a buyer holding forty-one
   * tickets read eighty-two lines of prose carrying three facts. The mark
   * beside each one already says which state it is at a glance, and `unsoldNote`
   * already carries the only explanation a reader can act on.
   *
   * WHAT THEY WERE REPLACED WITH IS NOT A TRIM. The rule at the top of this
   * file forbids shortening a Burmese line by cutting a clause out of it, and
   * these three are single clauses with nothing to delete. So nothing was
   * reworded: each pair is COPIED VERBATIM from the app's own vocabulary, where
   * it is what every screen has always called these states —
   * STATUS_WORDS in src/lib/format.js for the English, src/lib/i18n.js for the
   * Burmese.
   *
   * Which makes the page agree with the app instead of having a second opinion.
   * A buyer reading "ရောင်းပြီး" here and an organiser reading "ရောင်းပြီး" on
   * their screen are now looking at the same word about the same ticket, and
   * that matters most on the telephone call where one of them reads it to the
   * other.
   *
   * THEY ARE COPIES, because this page may not import the app's i18n — it is
   * four hundred entries that reach the store, and tests/verifypage fails the
   * build if this page ever imports its way into src/lib. Copies drift, so
   * verifypage asserts these three pairs still match i18n.js character for
   * character, reading both as TEXT rather than importing either.
   */
  sold: { en: 'Sold', my: 'ရောင်းပြီး' },
  unsold: { en: 'Not sold yet', my: 'မရောင်းရသေးပါ' },
  void: { en: 'Cancelled', my: 'ပယ်ဖျက်ပြီး' },

  ticketNo: { en: 'Ticket number', my: 'လက်မှတ်အမှတ်' },

  /* The label on the state row. The mockup's facts are all label-and-value. */
  statusLabel: { en: 'Status', my: 'အခြေအနေ' },

  /*
   * A RECEIPT — one code standing for the tickets one buyer took, so a buyer
   * who bought ten checks them in one scan instead of ten.
   *
   * The heading is plural and the rest is reused: every line below it is a
   * ticket number and one of `sold`, `unsold` or `void`, which are the same
   * three sentences a single ticket gets. Nothing new had to be said about a
   * ticket because nothing about a ticket changed.
   *
   * THE BURMESE HERE IS COMPOSED, not translated by a reader of it: ဤလက်မှတ်များ
   * မှန်ကန်ပါသည် is the singular line above with the plural marker, and
   * လက်မှတ် {n} စောင် uses the classifier for sheets. Both want checking by
   * somebody who reads Burmese before this is shown to buyers — the same
   * treatment the rest of this file has already had.
   */
  receiptGenuine: { en: 'Verified tickets', my: 'အတည်ပြုပြီး လက်မှတ်များ' },
  receiptCount: { en: '{n} tickets on this receipt', my: 'ဤပြေစာတွင် လက်မှတ် {n} စောင်' },

  /*
   * THE SUPPORTER BAND, AND WHY IT IS ON THIS ROUTE ONLY.
   *
   * A raffle that is funded by a few people buying a great many tickets should
   * be able to say thank you to them by name of band, and the thank-you is
   * worth nothing if it cannot be checked. This is where it is checked: the
   * band was worked out on the server when the receipt was minted, from the
   * tickets the buyer actually holds, and this page reads it back.
   *
   * NOT on the printed QR. That code is on the paper, so anybody who picks up a
   * dropped ticket has it, and "held by a Diamond supporter" would tell a
   * stranger something about the person who lost it. A receipt is minted per
   * purchase, printed on nothing, and delivered only inside the digital ticket
   * the buyer is sent — the split the endpoint's own comments set out.
   *
   * WARM, AND STILL A STATEMENT OF FACT. The count is beside the name because a
   * compliment with the number under it is a receipt; without the number it is
   * flattery, and this page's whole job is to be believed.
   */
  rankFaithful: { en: 'Faithful supporter', my: 'သစ္စာရှိ ထောက်ပံ့သူ' },
  rankSilver: { en: 'Silver supporter', my: 'ငွေ ထောက်ပံ့သူ' },
  rankGold: { en: 'Gold supporter', my: 'ရွှေ ထောက်ပံ့သူ' },
  rankDiamond: { en: 'Diamond supporter', my: 'စိန် ထောက်ပံ့သူ' },
  rankThanks: {
    en: '{n} tickets in this raffle — thank you.',
    my: 'ဤကံစမ်းမဲတွင် လက်မှတ် {n} စောင် — ကျေးဇူးတင်ပါသည်။',
  },

  /*
   * The unsold line is the one that matters most and is the easiest to get
   * wrong. It must not accuse the seller: a ticket sold ten minutes ago at a
   * desk with no signal is genuinely not recorded yet, and that is ordinary.
   */
  unsoldNote: {
    en: 'If you have paid for this ticket, the sale has not reached the raffle’s records yet. Ask the person who sold it to you.',
    my: 'ငွေပေးပြီးပါက အရောင်းမှတ်တမ်း မရောက်သေးပါ။ ရောင်းချသူ္ကို မေးပါ။',
  },
  /*
   * THE ENGLISH CARRIED A THIRD CLAUSE THE BURMESE NEVER DID — "or the number
   * may have been typed wrongly" — so the two halves had been saying different
   * amounts to different readers since the line was written. Dropping it makes
   * them one sentence again, and the link that was actually scanned is printed
   * directly above this, which answers "did I mistype it" better than a
   * sentence raising the possibility.
   */
  notGenuineNote: {
    en: 'The code on this ticket does not match anything in the raffle. It may be a copy.',
    my: 'ဤလက်မှတ်ပါကုဒ်သည် မှတ်တမ်းနှင့် မကိုက်ညီပါ။ မိတ္တူ ဖြစ်နိုင်ပါသည်။',
  },
  cannotCheckNote: {
    en: 'The check could not be completed. Try again in a moment.',
    my: 'ယခု စစ်ဆေး၍မရပါ။ ခဏ နေပြီး ထပ်ကြိုးစားပါ။',
  },
  malformedNote: {
    en: 'This link is incomplete. Scan the code on the ticket again.',
    my: 'ဤလိပ်ခ် မပြည့်စုံပါ။ လက်မှတ်ပေါ်မှ ကုဒ်ကို ပြန်ဆကြန်ပါ။',
  },

  /*
   * WHAT THIS RAFFLE IS, said to somebody who has no way to know.
   *
   * A stranger scans a piece of paper and lands on a page that says a number
   * is genuine. With nothing else on it, that reads like a commercial
   * ticketing service — which is the wrong impression of tickets volunteers
   * are selling by hand for a community cause, and the wrong impression to
   * leave with whoever is standing there holding one.
   *
   * It says what the raffle is FOR. It does not say the raffle is permitted,
   * approved or registered: this page cannot know that, and a line implying it
   * would be a claim the software has no way to stand behind.
   */
  /*
   * REVIEWED BY THE USER ON 2026-09-20, and both halves replaced with their
   * wording. This is the one string on the page that had been waiting for a
   * native reader, and it now has one — so the caveat above no longer applies
   * to it. The English changed too: "families" became "members", which is the
   * wider and truer claim about who the money reaches.
   *
   * It is also the DEFAULT rather than the text. An organiser can replace both
   * halves from Setup; see ORG_ABOUT_MY / ORG_ABOUT_EN. This is what a raffle
   * that has not set one says.
   */
  whatThisIs: {
    en: 'A small community charity raffle. Volunteers sell these tickets by hand to raise money for the most vulnerable members of the community. It is not a commercial ticket sale.',
    my: 'ဤကံစမ်းမဲသည် ရပ်ရွာလူမှုကူညီရေးအတွက် ရည်ရွယ်ကျင်းပသည့် အသေးစား ကံစမ်းမဲအစီအစဉ် ဖြစ်ပါသည်။ ကံစမ်းမဲလက်မှတ်များကို စေတနာ့ဝန်ထမ်းများက ကိုယ်တိုင် ရောင်းချပေးပြီး၊ ရရှိသည့်ငွေများကို ရပ်ရွာအတွင်း အကူအညီအလိုအပ်ဆုံးသူများအား ထောက်ပံ့ကူညီရန် အသုံးပြုပါသည်။ ဤကံစမ်းမဲလက်မှတ်များသည် စီးပွားဖြစ် ရောင်းချခြင်းအတွက် မဟုတ်ပါ။',
  },

  /*
   * WHO IS ANSWERING. The page used to open on a bare verdict card with no
   * heading of any kind, so the first thing a stranger saw was a coloured tick
   * and a sentence about a number. This names what they have reached.
   *
   * It does NOT name a charity. The raffle now supports more than one
   * organisation's artwork, and a page hard-coded to one of them would be wrong
   * on the others' tickets. `whatThisIs` below says what kind of thing this is
   * without claiming to be a particular body, which is the same reasoning.
   */
  /*
   * THE SECOND LINE OF THE HEADER — a description of the SERVICE, never a claim
   * to be a particular charity.
   *
   * The distinction is the one brandCheck below already rests on: several
   * raffles run off one deployment, so a page that named a body would be lying
   * on everybody else's tickets. "Official verification service" says what this
   * page IS without saying whose. The organisation's own name sits beside it
   * only when config carries one, and nothing at all when it does not.
   *
   * UNREVIEWED, like every Burmese string on this page. The English is the
   * sentence that was meant; correct the Burmese against it.
   */
  officialService: { en: 'Official verification service', my: 'တရားဝင် စစ်ဆေးရေး ဝန်ဆောင်မှု' },

  /*
   * What was actually scanned, shown back on the failure page.
   *
   * This is what somebody reads down a telephone to the office, so it must be
   * the raw thing — a tidied version would let a wrong number look right, which
   * is the reasoning params() already carries for not canonicalising before the
   * lookup. The same rule applies to showing it.
   */
  linkScanned: { en: 'Link scanned', my: 'စကင်ဖတ်ထားသော လင့်ခ်' },

  brandCheck: { en: 'Ticket check', my: 'လက်မှတ် စစ်ဆေးရန်' },

  /*
   * THREE ENTRIES CAME OUT OF HERE ON 2026-09-21 — `privacyNote`,
   * `whyOneAnswer` with its note, and `photocopy` — on the instruction that
   * this page be a professional interface rather than a set of long
   * explanations. Each was true, each was well argued in the comment that went
   * with it, and each was the page explaining ITSELF to somebody who had asked
   * it one question about a piece of paper in their hand.
   *
   * NOTHING THEY SAID STOPPED BEING TRUE. The buyer's name is still never
   * shown — verify/index.ts may touch two columns of `tickets` and one of
   * `ticket_codes`, and tests/verify.test.mjs fails if it ever mentions a
   * buyer. Every failure still answers identically so the page cannot be used
   * to map which numbers exist. A genuine ticket can still be photocopied and
   * the draw is still settled by the records. What went is the narration.
   *
   * Written down because the argument for each was good enough that somebody
   * will make it again, and the answer is that being right is not the same as
   * being worth the reader's attention at the moment they are deciding whether
   * to hand over ten ringgit.
   */

  /* What to actually do about it, which the refusal on its own does not say. */
  /*
   * STRONGER THAN IT WAS, because the old sentence left out the instruction
   * that matters. "Show this ticket to the person who sold it to you" is what
   * to DO; it does not say what not to do, and the moment this page is being
   * read is usually the moment before money changes hands. The verify mockup
   * leads with the refusal for that reason.
   *
   * The office is not named. Which organisation this is belongs to the raffle
   * and arrives with ?about; a sentence with a charity's name baked into it is
   * a sentence that is wrong for every other raffle that runs this.
   */
  showSeller: {
    en: 'Do not pay for this ticket. Show this screen to the person selling it, and contact the office.',
    my: 'ဤလက်မှတ်အတွက် ငွေမပေးပါနှင့်။ ဤစာမျက်နှာကို ရောင်းချနေသူအား ပြသပြီး ရုံးသို့ ဆက်သွယ်ပါ။',
  },

  /*
   * THE THREE BUTTON LABELS, and all three are UNREVIEWED Burmese — written
   * the same way as the keys named in the caveat at the top of this file, and
   * with the same amount of native review, which is none. Kept together and
   * apart from `whatThisIs`, which the user supplied verbatim on 2026-09-20
   * and which is the one reviewed pair in here.
   *
   * Every one of them only ever renders when the raffle has somewhere for it
   * to point, so a wrong word here is never a dead button — see actions() and
   * orgFoot() in main.js.
   */
  callOffice: { en: 'Call the office', my: 'ရုံးသို့ ဖုန်းဆက်ရန်' },
  reportIt: { en: 'Report it', my: 'တိုင်ကြားရန်' },
  contactUs: { en: 'Contact us', my: 'ဆက်သွယ်ရန်' },

  aboutMore: { en: 'More about this raffle', my: 'အသေးစိတ် ဖတ်ရှုရန်' },

  /*
   * A THIRD VERDICT, and it is neither of the other two.
   *
   * A sample is not genuine and is not a forgery — it is a demonstration, and
   * saying either of the other things about it would be wrong in a way that
   * matters. Shown in red it accuses whoever is holding it; shown in green it
   * turns a page anybody can print into something that vouches for itself.
   */
  sampleHead: { en: 'This is a sample ticket', my: 'ဤသည်မှာ နမူနာလက်မှတ် ဖြစ်ပါသည်' },
  /*
   * THE CLOSING SENTENCE WENT — "A real ticket has a number without the word
   * Sample in it." The card it appears on is watermarked SAMPLE four times over
   * and its number reads SAMPLE-0001, so the sentence was describing what the
   * reader was already looking at. Deleted WHOLE in both halves rather than
   * reworded, for the reason at the top of this file.
   */
  sampleNote: {
    en: 'It was printed to show what a ticket looks like. It is not entered in the raffle, it cannot win a prize, and it is not for sale.',
    my: 'လက်မှတ်ပုံစံ ပြသရန်အတွက်သာ ရိုက်နှိပ်ထားခြင်း ဖြစ်ပါသည်။ ကံစမ်းမဲတွင် ပါဝင်ခြင်း မရှိပါ၊ ဆုမဲ ပေါက်နိုင်ခွင့် မရှိပါ၊ ရောင်းချရန်လည်း မဟုတ်ပါ။',
  },

  checkedAt: { en: 'Checked', my: 'စစ်ဆေးချိန်' },
}
