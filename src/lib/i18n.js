/**
 * Burmese sublabels.
 *
 * English stays primary and Burmese sits under it, small and faint — the point
 * is to help somebody who is unsure, not to replace the label.
 *
 * ⚠ THESE TRANSLATIONS HAVE NOT BEEN CHECKED BY A NATIVE SPEAKER.
 *
 * They are machine-authored Unicode Burmese. Get them read before the raffle
 * runs. The words on destructive buttons matter most — if "Count a book in",
 * "Cancel a ticket" or "Mark books lost" read wrongly, somebody will press the
 * wrong one and the mistake will be in the money.
 *
 * Two encoding notes:
 *  - Written in Unicode. A phone still running Zawgyi will show these as
 *    nonsense. There is nothing to do in code; it is worth knowing.
 *  - Burmese needs an explicit font or many Android phones render empty boxes
 *    or wrongly stacked glyphs. See the font stack in style.css.
 *
 * Only interface text is translated. Ticket numbers, buyer names, phone
 * numbers, money and dates are data and are never glossed.
 */

export const MY = {
  // --- getting in ---
  'Connect': 'ချိတ်ဆက်ရန်',
  'Link to the spreadsheet': 'စာရင်းဇယားလင့်ခ်',
  'Sign in with Google': 'Google ဖြင့် ဝင်ရန်',
  'Leave': 'ထွက်ရန်',
  'Try again': 'ထပ်ကြိုးစားရန်',

  // --- moving around ---
  'Home': 'ပင်မ',
  'Find': 'ရှာဖွေရန်',
  'Sell': 'ရောင်းရန်',
  'Books': 'စာအုပ်များ',
  'Sellers': 'ရောင်းသူများ',
  'Money': 'ငွေကြေး',
  'Draw': 'မဲဖောက်ခြင်း',
  'Setup': 'စနစ်ပြင်ဆင်ခြင်း',
  'Access': 'ခွင့်ပြုချက်',
  'More': 'နောက်ထပ်',

  // --- doing things ---
  'Save': 'သိမ်းရန်',
  'Cancel': 'မလုပ်တော့ပါ',
  'Close': 'ပိတ်ရန်',
  'Open': 'ဖွင့်ရန်',
  'Next': 'ရှေ့သို့',
  'Back': 'နောက်သို့',
  'Print': 'ပုံနှိပ်ရန်',
  'Add someone': 'လူတစ်ဦးထည့်ရန်',
  'Check again': 'ထပ်စစ်ရန်',
  'Show them': 'ပြရန်',
  'See list': 'စာရင်းကြည့်ရန်',

  // --- the main jobs ---
  'Write down a sale': 'ရောင်းချမှု မှတ်သားရန်',
  'Write down sales': 'ရောင်းချမှုများ မှတ်သားရန်',
  'Find a ticket': 'လက်မှတ် ရှာရန်',
  'Give out books': 'စာအုပ်များ ထုတ်ပေးရန်',
  'Add a seller': 'ရောင်းသူ ထည့်ရန်',
  'Add your first seller': 'ပထမဆုံး ရောင်းသူ ထည့်ရန်',
  'Count a book in': 'စာအုပ် ပြန်စစ်ရန်',
  'Finish this book': 'ဤစာအုပ် ပြီးဆုံးရန်',
  'Pass books to someone else': 'စာအုပ်များ လွှဲပြောင်းရန်',
  'Mark books brought back': 'ပြန်ရောက်ကြောင်း မှတ်ရန်',
  'Report books lost': 'ပျောက်ဆုံးကြောင်း တင်ပြရန်',
  'Hold it': 'ခဏ သိမ်းထားရန်',
  'Let it go': 'ပြန်လွှတ်ရန',
  'It is sold': 'ရောင်းပြီးပါပြီ',
  'Save the fix': 'ပြင်ဆင်ချက် သိမ်းရန်',
  'Save all': 'အားလုံး သိမ်းရန်',
  'Remind': 'သတိပေးရန်',

  // --- questions the app asks ---
  'Who bought it?': 'ဘယ်သူ ဝယ်သွားပါသလဲ။',
  'What is their phone number?': 'သူတို့၏ ဖုန်းနံပါတ်က ဘာလဲ။',
  'Their name': 'နာမည်',
  'Phone number': 'ဖုန်းနံပါတ်',
  'Their phone number': 'သူတို့၏ ဖုန်းနံပါတ်',
  'Ticket number': 'လက်မှတ်နံပါတ်',
  'Church or area': 'ဘုရားကျောင်း သို့မဟုတ် ဒေသ',
  'Their Google email': 'သူတို့၏ Google အီးမေးလ်',
  'Who is taking them?': 'ဘယ်သူ ယူသွားမှာလဲ။',
  'First book': 'ပထမ စာအုပ်',
  'Last book': 'နောက်ဆုံး စာအုပ်',
  'Bring back by': 'ပြန်ယူလာရမည့် ရက်',
  'Which tickets came back?': 'ဘယ်လက်မှတ်တွေ ပြန်ရောက်လာလဲ။',
  'How much money did they hand in?': 'ငွေ ဘယ်လောက် အပ်သွားလဲ။',
  'How many did they sell?': 'ဘယ်နှစ်စောင် ရောင်းခဲ့လဲ။',
  'What are you fixing?': 'ဘာကို ပြင်နေတာလဲ။',
  'What can they do?': 'သူတို့ ဘာလုပ်နိုင်လဲ။',
  'What do you want to do?': 'ဘာလုပ်ချင်ပါသလဲ။',

  // --- what things are called ---
  'Needs looking at': 'ကြည့်ရှုရန် လိုအပ်သည်',
  'All the books': 'စာအုပ်အားလုံး',
  'Every book': 'စာအုပ်တိုင်း',
  'One ticket': 'လက်မှတ် တစ်စောင်',
  'A pile of stubs': 'လက်မှတ်ပိုင်းများ',
  'Who can sign in': 'ဝင်ရောက်ခွင့် ရှိသူများ',
  'Who can do what': 'ဘယ်သူ ဘာလုပ်နိုင်သလဲ',
  'Winners': 'ဆုရရှိသူများ',
  'Approvals': 'ခွင့်ပြုချက် တောင်းခံမှုများ',
  'Waiting for approval': 'ခွင့်ပြုချက် စောင့်ဆိုင်းဆဲ',
  'Sell a whole book': 'စာအုပ်တစ်အုပ်လုံး ရောင်းရန်',
  'Four things, once.': 'လေးခု၊ တစ်ကြိမ်သာ။',
  'Make the tickets': 'လက်မှတ်များ ပြုလုပ်ရန်',
  'Add your sellers': 'ရောင်းသူများ ထည့်ရန်',
  'Hand books to a seller': 'ရောင်းသူထံ စာအုပ်ပေးရန်',
  'As they happen, or all at once later': 'ဖြစ်တိုင်း သို့မဟုတ် နောက်မှ တစ်ပြိုင်နက်',
  'The people who will carry books. No account needed.':
    'စာအုပ်သယ်ဆောင်မည့်သူများ။ အကောင့် မလိုပါ။',
  'Getting your raffle': 'အချက်အလက်များ ရယူနေသည်',
  'One moment…': 'ခဏစောင့်ပါ…',
  'Administrator': 'စီမံခန့်ခွဲသူ',
  'Ask the organiser': 'စီစဉ်သူထံ တောင်းခံရန်',
  'Approve and do it': 'ခွင့်ပြုပြီး လုပ်ဆောင်ရန်',
  'Turn down': 'ငြင်းပယ်ရန်',
  'Withdraw': 'ပြန်ရုပ်သိမ်းရန်',
  'The draw': 'မဲဖောက်ခြင်း',
  'Getting started': 'စတင်ခြင်း',
  "Let's get started": 'စတင်ကြပါစို့',
  'What each seller owes': 'ရောင်းသူတစ်ဦးချင်း ပေးရန်ရှိငွေ',
  'Books not brought back': 'ပြန်မရောက်သေးသော စာအုပ်များ',

  // --- states ---
  'Not sold yet': 'မရောင်းရသေးပါ',
  'Being held': 'သိမ်းထားသည်',
  'Sold': 'ရောင်းပြီး',
  'Given': 'လှူဒါန်းပြီး',
  'Cancelled': 'ပယ်ဖျက်ပြီး',
  'In the office': 'ရုံးတွင် ရှိသည်',
  'With a seller': 'ရောင်းသူထံ ရောက်နေသည်',
  'Brought back': 'ပြန်ရောက်ပြီး',
  'Finished': 'ပြီးဆုံးပြီး',
  'Lost': 'ပျောက်ဆုံး',
  'Late': 'နောက်ကျနေသည်',

  // --- who people are ---
  'Organiser': 'စီစဉ်သူ',
  'Helper': 'ကူညီသူ',
  'Seller': 'ရောင်းသူ',
  'Can only look': 'ကြည့်ရုံသာ',

  // --- money words ---
  'Should have': 'ရရှိရမည့် ငွေ',
  'Handed in': 'အပ်ပြီး ငွေ',
  'Still owed': 'ပေးရန် ကျန်ငွေ',
  'Tickets sold': 'ရောင်းပြီး လက်မှတ်',
  'In the draw': 'မဲတွင် ပါဝင်သည်',
  'Not sold': 'မရောင်းရသေး',
  'No phone number': 'ဖုန်းနံပါတ် မရှိ'
}

/** Error codes from the server, so a failure is not only in English. */
export const MY_ERRORS = {
  MISSING_FIELD: 'လိုအပ်သော အချက်အလက် မပြည့်စုံပါ',
  BAD_REQUEST: 'တောင်းဆိုချက် မမှန်ကန်ပါ',
  BAD_PHONE: 'ဖုန်းနံပါတ် မမှန်ကန်ပါ',
  BOOK_NOT_FOUND: 'ဤစာအုပ်ကို ရှာမတွေ့ပါ',
  TICKET_NOT_FOUND: 'ဤလက်မှတ်ကို ရှာမတွေ့ပါ',
  AGENT_NOT_FOUND: 'ဤရောင်းသူကို ရှာမတွေ့ပါ',
  USER_NOT_FOUND: 'ဤအသုံးပြုသူကို ရှာမတွေ့ပါ',
  AUTH_REQUIRED: 'အကောင့်ဝင်ရန် လိုအပ်သည်',
  AUTH_EXPIRED: 'အကောင့်ဝင်ချိန် ကုန်ဆုံးသွားပါပြီ',
  AUTH_UNAVAILABLE: 'Google သို့ ဆက်သွယ်၍ မရပါ',
  NOT_AUTHORIZED: 'ခွင့်ပြုချက် မရှိပါ',
  ACCOUNT_DISABLED: 'ဤအကောင့်ကို ပိတ်ထားသည်',
  INSUFFICIENT_ROLE: 'သင့်အဆင့်ဖြင့် ဤအရာကို မလုပ်နိုင်ပါ',
  SUPER_ADMIN_ONLY: 'အဓိက စီမံခန့်ခွဲသူသာ လုပ်နိုင်သည်',
  ALREADY_SOLD: 'ဤလက်မှတ်ကို ရောင်းပြီးဖြစ်သည်',
  ALREADY_SETTLED: 'ဤစာအုပ်ကို ပြီးဆုံးပြီးဖြစ်သည်',
  NOT_AVAILABLE: 'မရနိုင်ပါ',
  NOT_RESERVED: 'သိမ်းထားခြင်း မရှိပါ',
  TICKET_VOID: 'ဤလက်မှတ်ကို ပယ်ဖျက်ထားသည်',
  NOT_YOUR_BOOK: 'ဤစာအုပ်မှာ သင့်ထံတွင် မရှိပါ',
  BOOK_NOT_ASSIGNED: 'ဤစာအုပ်ကို မထုတ်ပေးရသေးပါ',
  BOOK_CLOSED: 'ဤစာအုပ်ကို ပိတ်ထားပြီးဖြစ်သည်',
  BOOKS_NOT_AVAILABLE: 'ဤစာအုပ်များ မရနိုင်ပါ',
  TRANSFER_BLOCKED: 'လွှဲပြောင်း၍ မရပါ',
  VERSION_CONFLICT: 'အခြားသူတစ်ဦး ပြောင်းလဲထားပါသည်',
  BATCH_REJECTED: 'အမှားပါသဖြင့် တစ်ခုမှ မသိမ်းခဲ့ပါ',
  DUPLICATE_IN_BATCH: 'နှစ်ကြိမ် ထပ်နေသည်',
  RANGE_TOO_LARGE: 'အရေအတွက် များလွန်းပါသည်',
  RATE_LIMIT: 'ခဏစောင့်ပြီး ထပ်ကြိုးစားပါ',
  LOCK_TIMEOUT: 'အခြားသူ သိမ်းနေဆဲဖြစ်သည်',
  SHEET_MISSING: 'စာရင်းဇယား မပြင်ဆင်ရသေးပါ',
  NOT_CONFIGURED: 'စနစ် မပြင်ဆင်ရသေးပါ',
  APPROVAL_EXPIRED: 'ခွင့်ပြုချက် တောင်းခံမှု သက်တမ်းကုန်သွားပါပြီ',
  APPROVAL_REQUIRED: 'အခြားတစ်ဦး၏ ခွင့်ပြုချက် လိုအပ်သည်',
  REQUESTER_NOT_ALLOWED: 'တောင်းခံသူတွင် ခွင့်ပြုချက် မရှိပါ',
  REQUESTER_UNAVAILABLE: 'တောင်းခံသူကို ရှာမတွေ့ပါ',
  CANNOT_SHRINK: 'လက်မှတ်အရေအတွက်ကို ပြန်လျှော့၍ မရပါ',
  BELOW_GENERATED: 'ပြုလုပ်ထားသည့် အရေအတွက်ထက် နည်းနေသည်',
  CONFIRM_REQUIRED: 'အတည်ပြုရန် ဂဏန်းကို ရိုက်ထည့်ပါ',
  NOTHING_TO_DO: 'ပြောင်းလဲစရာ မရှိပါ',
  NO_CHANGE: 'ပြောင်းလဲမှု မရှိပါ',
  NOT_ELIGIBLE: 'မဲဖောက်ရန် အရည်အချင်း မပြည့်မီပါ',
  NOT_FOUND: 'ရှာမတွေ့ပါ',
  NOT_IN_BOOK: 'ဤလက်မှတ်သည် ထိုစာအုပ်ထဲတွင် မပါဝင်ပါ',
  NUMBERING_TOO_SMALL: 'လက်မှတ်နံပါတ် ဂဏန်းနေရာ မလုံလောက်ပါ',
  PARTIAL_BOOK: 'စာအုပ်တစ်အုပ်လုံး မဟုတ်ပါ',
  SHEET_DRIFT: 'စာရင်းဇယားနှင့် ဆက်တင်များ ကိုက်ညီမှု မရှိပါ',
  TOO_MANY: 'တစ်ကြိမ်တည်း လုပ်ရန် အရေအတွက် များလွန်းသည်',
  TICKET_NOT_RELEASED: 'ဤလက်မှတ်ကို မရောင်းရသေးပါ',
  NOT_GENERATED: 'ထိုမျှလောက် လက်မှတ် မပြုလုပ်ရသေးပါ',
  TICKETS_IN_USE: 'အထက်ပါ လက်မှတ်အချို့ကို ရောင်းပြီးဖြစ်သည်',
  BOOKS_IN_USE: 'အထက်ပါ စာအုပ်အချို့ကို ထုတ်ပေးထားပြီးဖြစ်သည်',
  ABOVE_CEILING: 'စီစဉ်ထားသော အရေအတွက်ထက် ကျော်လွန်နေသည်',
  NUMBERING_CHANGED: 'လက်မှတ်နံပါတ် စနစ် ပြောင်းလဲထားသည် — မူလအတိုင်း ပြန်ထားပါ',
  NETWORK: 'အင်တာနက် ဆက်သွယ်မှု မရပါ',
  SERVER_ERROR: 'စနစ်တွင် အမှားဖြစ်နေသည်'
}

/** The Burmese for a piece of interface text, or nothing if it is untranslated. */
export function my(text) {
  return MY[String(text || '').trim()] || ''
}

export function myError(code) {
  return MY_ERRORS[code] || ''
}
