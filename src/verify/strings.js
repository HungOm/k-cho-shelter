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
export const S = {
  checking: { en: 'Checking this ticket…', my: 'အသိအမှတ်ကို စစ်ဆေးနေသည်…' },

  genuine: { en: 'This is a real ticket', my: 'ဤလက်မှတ်မှန်ကန်ပါသည်' },
  notGenuine: { en: 'This is not a valid ticket', my: 'ဤလက်မှတ် မမှန်ပါ' },
  cannotCheck: { en: 'Could not check this ticket', my: 'စစ်ဆေး၍ မရပါ' },

  sold: { en: 'Recorded as sold', my: 'ရောင်းပြီးအဖြစ် မှတ်တမ်းရှိသည်' },
  unsold: { en: 'Not recorded as sold yet', my: 'ရောင်းပြီးသည်ဟု မှတ်တမ်းမရှိသေးပါ' },
  void: { en: 'This ticket was cancelled', my: 'ဤလက်မှတ်ကို ပယ်ဖျက်ပြီးဖြစ်သည်' },

  ticketNo: { en: 'Ticket number', my: 'လက်မှတ်အမှတ်' },

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

  checkedAt: { en: 'Checked', my: 'စစ်ဆေးချိန်' },
  photocopy: {
    en: 'A real ticket can still be copied. The raffle is decided by its own records, not by a printed ticket.',
    my: 'မှန်ကန်သည့် လက်မှတ်ကိုလည်း မိတ္တူကူးနိုင်သည်။ ဆုရာကို မှတ်တမ်းဖြင့်သာ ဆုံးဖြတ်ပါသည်။',
  },
}
