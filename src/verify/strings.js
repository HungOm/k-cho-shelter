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
 * keys added with the page's redesign
 * — brandCheck, privacyNote, whyOneAnswer, whyOneAnswerNote, showSeller,
 * aboutMore — were written the same way and have had the same amount of native
 * review, which is none. The English in each is the sentence that was meant; if
 * the two ever disagree, the English is the one to correct the Burmese against.
 */
export const S = {
  checking: { en: 'Checking this ticket…', my: 'အသိအမှတ်ကို စစ်ဆေးနေသည်…' },

  genuine: { en: 'This is a real ticket', my: 'ဤလက်မှတ်မှန်ကန်ပါသည်' },
  notGenuine: { en: 'This is not a valid ticket', my: 'ဤလက်မှတ် မမှန်ပါ' },
  cannotCheck: { en: 'Could not check this ticket', my: 'စစ်ဆေး၍ မရပါ' },

  sold: { en: 'Recorded as sold', my: 'ရောင်းပြီးအဖြစ် မှတ်တမ်းရှိသည်' },
  unsold: { en: 'Not recorded as sold yet', my: 'ရောင်းပြီးသည်ဟု မှတ်တမ်းမရှိသေးပါ' },
  void: { en: 'This ticket was cancelled', my: 'ဤလက်မှတ်ကို ပယ်ဖျက်ပြီးဖြစ်သည်' },

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
  receiptGenuine: { en: 'These are real tickets', my: 'ဤလက်မှတ်များ မှန်ကန်ပါသည်' },
  receiptCount: { en: '{n} tickets on this receipt', my: 'ဤပြေစာတွင် လက်မှတ် {n} စောင်' },

  /*
   * The unsold line is the one that matters most and is the easiest to get
   * wrong. It must not accuse the seller: a ticket sold ten minutes ago at a
   * desk with no signal is genuinely not recorded yet, and that is ordinary.
   */
  unsoldNote: {
    en: 'If you have paid for this ticket, the sale has not reached the raffle’s records yet. Ask the person who sold it to you.',
    my: 'ငွေပေးပြီးပါက အရောင်းမှတ်တမ်း မရောက်သေးပါ။ ရောင်းချသူ္ကို မေးပါ။',
  },
  notGenuineNote: {
    en: 'The code on this ticket does not match anything in the raffle. It may be a copy, or the number may have been typed wrongly.',
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
  brandCheck: { en: 'Ticket check', my: 'လက်မှတ် စစ်ဆေးရန်' },

  /*
   * THE PROMISE THE ARCHITECTURE ALREADY KEEPS, said out loud.
   *
   * The verify function may touch two columns of `tickets` and one of
   * `ticket_codes`, and tests/verify.test.mjs fails if it ever mentions a
   * buyer. A stranger cannot know that. Somebody who has just scanned a
   * stranger's ticket — or had theirs scanned by somebody else — is entitled to
   * be told that pointing a phone at a QR code does not reveal who bought it.
   */
  privacyNote: {
    en: 'The buyer’s name and phone number are never shown on this page.',
    my: 'ဝယ်ယူသူ၏ အမည်နှင့် ဖုန်းနံပါတ်ကို ဤစာမျက်နှာတွင် ဘယ်သောအခါမျှ မပြသပါ။',
  },

  /*
   * WHY ONE ANSWER FITS EVERY FAILURE.
   *
   * The endpoint answers identically for a number that was never issued, a
   * ticket never printed, and a code out by one character — deliberately, so it
   * cannot be used to map which numbers exist. Unexplained, that reads as a
   * page that does not know very much. Explained, it reads as a page that is
   * refusing to help somebody forging tickets, which is what it is.
   */
  whyOneAnswer: { en: 'Why it says nothing more', my: 'ဤထက်ပို၍ မဖော်ပြရခြင်း အကြောင်းရင်း' },
  whyOneAnswerNote: {
    en: 'A number that was never issued, a ticket that was never printed, and a code changed by one character all get this same answer. Any difference between them could be used to work out which ticket numbers exist.',
    my: 'မထုတ်ဝေဖူးသော နံပါတ်၊ မပုံနှိပ်ရသေးသော လက်မှတ်နှင့် စာလုံးတစ်လုံး ပြောင်းလဲထားသော ကုဒ်တို့အားလုံးသည် တူညီသော အဖြေကိုသာ ရရှိပါသည်။ ကွာခြားမှုရှိပါက မည်သည့်လက်မှတ်နံပါတ်များ ရှိသည်ကို ရှာဖွေရန် အသုံးပြုနိုင်ပါသည်။',
  },

  /* What to actually do about it, which the refusal on its own does not say. */
  showSeller: {
    en: 'Show this ticket to the person who sold it to you.',
    my: 'ဤလက်မှတ်ကို ရောင်းချသူထံ ပြသပါ။',
  },

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
  sampleNote: {
    en: 'It was printed to show what a ticket looks like. It is not entered in the raffle, it cannot win a prize, and it is not for sale. A real ticket has a number without the word Sample in it.',
    my: 'လက်မှတ်ပုံစံ ပြသရန်အတွက်သာ ရိုက်နှိပ်ထားခြင်း ဖြစ်ပါသည်။ ကံစမ်းမဲတွင် ပါဝင်ခြင်း မရှိပါ၊ ဆုမဲ ပေါက်နိုင်ခွင့် မရှိပါ၊ ရောင်းချရန်လည်း မဟုတ်ပါ။ စစ်မှန်သော လက်မှတ်တွင် Sample ဟူသော စာလုံး ပါဝင်မည် မဟုတ်ပါ။',
  },

  checkedAt: { en: 'Checked', my: 'စစ်ဆေးချိန်' },
  photocopy: {
    en: 'A real ticket can still be copied. The raffle is decided by its own records, not by a printed ticket.',
    my: 'မှန်ကန်သည့် လက်မှတ်ကိုလည်း မိတ္တူကူးနိုင်သည်။ ဆုရာကို မှတ်တမ်းဖြင့်သာ ဆုံးဖြတ်ပါသည်။',
  },
}
