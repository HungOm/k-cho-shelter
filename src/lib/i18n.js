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
  'Sign in with Google': 'Google ဖြင့် ဝင်ရန်',
  // Shown when the project has not been told to trust this app's Google client
  // id. The person reading it cannot fix that, so both lines say so plainly.
  'Sign-in is not set up on this raffle yet.':
    'ဤမဲစနစ်တွင် အကောင့်ဝင်ခြင်း မပြင်ဆင်ရသေးပါ။',
  'Nothing is wrong with your phone or your account — tell the organiser.':
    'သင့်ဖုန်း သို့မဟုတ် သင့်အကောင့်တွင် ပြဿနာ မရှိပါ — စီစဉ်သူကို အကြောင်းကြားပါ။',
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
  // Return dates. Templates so the number lands where Burmese puts it.
  'Your book is past its return date': 'သင့်စာအုပ် ပြန်အပ်ရမည့်ရက် ကျော်လွန်နေပြီ',
  '{n} of your books are past their return date': 'သင့်စာအုပ် {n} အုပ် ပြန်အပ်ရမည့်ရက် ကျော်လွန်နေပြီ',
  'A book is past its return date': 'စာအုပ်တစ်အုပ် ပြန်အပ်ရမည့်ရက် ကျော်လွန်နေပြီ',
  '{n} books are past their return date': 'စာအုပ် {n} အုပ် ပြန်အပ်ရမည့်ရက် ကျော်လွန်နေပြီ',
  'Your book is due back soon': 'သင့်စာအုပ် မကြာမီ ပြန်အပ်ရန်ရှိသည်',
  '{n} of your books are due back soon': 'သင့်စာအုပ် {n} အုပ် မကြာမီ ပြန်အပ်ရန်ရှိသည်',
  'A book is due back soon': 'စာအုပ်တစ်အုပ် မကြာမီ ပြန်အပ်ရန်ရှိသည်',
  '{n} books are due back soon': 'စာအုပ် {n} အုပ် မကြာမီ ပြန်အပ်ရန်ရှိသည်',
  'Another {n} due by {when}.': 'နောက်ထပ် {n} အုပ် {when} တွင် ပြန်အပ်ရန်။',
  'Bring them back, or write down which tickets sold.': 'ပြန်အပ်ပါ၊ သို့မဟုတ် ရောင်းပြီးသော လက်မှတ်များကို မှတ်သားပါ။',
  'Chase the sellers holding them.': 'ကိုင်ဆောင်ထားသော ရောင်းသူများကို ဆက်သွယ်ပါ။',
  'Due by {when}.': '{when} တွင် ပြန်အပ်ရန်။',
  'Due by {when}. Bring them back, or write down which tickets sold.': '{when} တွင် ပြန်အပ်ရန်။ ရောင်းပြီးသော လက်မှတ်များကို မှတ်သားပါ။',
  'See the books': 'စာအုပ်များ ကြည့်ရန်',
  // The Home "needs looking at" rows. Every role reads these, sellers included.
  'A book has not come back': 'စာအုပ်တစ်အုပ် ပြန်မရောက်သေးပါ',
  '{n} books have not come back': 'စာအုပ် {n} အုပ် ပြန်မရောက်သေးပါ',
  'Past the date they were due back': 'ပြန်အပ်ရမည့်ရက် ကျော်လွန်နေပြီ',
  'You have not reported yet': 'သင် အစီရင်မခံရသေးပါ',
  'Time to report': 'အစီရင်ခံရန် အချိန်ရောက်ပြီ',
  'Everybody reports by {when} — what has sold, what is left': 'အားလုံး {when} တွင် အစီရင်ခံရန် — ဘာရောင်းပြီး ဘာကျန်သည်',
  'Say what has sold and what is left, even if the books stay with you': 'စာအုပ်များ သင့်ထံတွင် ရှိနေသော်လည်း ဘာရောင်းပြီး ဘာကျန်သည် ပြောပါ',
  'A seller has not reported': 'ရောင်းသူတစ်ဦး အစီရင်မခံရသေးပါ',
  '{n} sellers have not reported': 'ရောင်းသူ {n} ဦး အစီရင်မခံရသေးပါ',
  'Past the check-in date, books still with them': 'သတ်မှတ်ရက် ကျော်လွန်ပြီ၊ စာအုပ်များ သူတို့ထံတွင် ရှိနေသေးသည်',
  'A ticket has no phone number': 'လက်မှတ်တစ်စောင်တွင် ဖုန်းနံပါတ် မရှိပါ',
  '{n} tickets have no phone number': 'လက်မှတ် {n} စောင်တွင် ဖုန်းနံပါတ် မရှိပါ',
  'You could not tell these people if they win': 'ဤသူများ ဆုရလျှင် အကြောင်းကြား၍ မရနိုင်ပါ',
  '{amount} not handed in yet': '{amount} မပေးသွင်းရသေးပါ',
  'Sold, but the money has not come back': 'ရောင်းပြီးသော်လည်း ငွေ ပြန်မရောက်သေးပါ',
  'A book is still out': 'စာအုပ်တစ်အုပ် ပြင်ပတွင် ရှိနေသေးသည်',
  '{n} books are still out': 'စာအုပ် {n} အုပ် ပြင်ပတွင် ရှိနေသေးသည်',
  'With sellers, or waiting to be counted': 'ရောင်းသူများထံတွင် သို့မဟုတ် ရေတွက်ရန် စောင့်ဆိုင်းနေသည်',
  'Ask the System Admin': 'စီစဉ်သူထံ တောင်းခံရန်',
  'Ask the owner': 'စီစဉ်သူထံ တောင်းခံရန်',
  // Kept: older strings may still be in a cached build on a phone.
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
  // A settled book is not merely 'finished' — the money in it has been
  // counted and reconciled. The gloss says the thing that actually
  // happened, which is what a gloss is for; the English stays short
  // because it is a label on a grid square.
  'Finished': 'ငွေစာရင်းရှင်းပြီး',
  'Lost': 'ပျောက်ဆုံး',
  // The two marks the grid draws ON TOP of the custody colour. They answer a
  // different question from the five above — not where the book is, but how
  // much of it has gone — so the Burmese says "sold", not "finished": a book
  // can be sold out and still have its money uncounted, which is precisely the
  // state these marks exist to make visible.
  'Every ticket sold': 'လက်မှတ်အားလုံး ရောင်းပြီး',
  'Some sold': 'တစ်ချို့ ရောင်းပြီး',
  // Restock, said as what it does rather than as a word. A label long
  // enough to explain itself stops being a label.
  'Put unsold tickets back': 'မရောင်းရသေးသော လက်မှတ်များ ပြန်ထည့်ရန်',
  'Late': 'နောက်ကျနေသည်',

  // --- who people are ---
  'Organiser': 'စီစဉ်သူ',
  'Everything': 'အားလုံး',
  'System Admin': 'အဓိက စီမံခန့်ခွဲသူ',
  'Owner': 'အဓိက စီမံခန့်ခွဲသူ',
  'Super admin': 'အဓိက စီမံခန့်ခွဲသူ',
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
  INSUFFICIENT_ROLE: 'ဤအရာကို သင့်အကောင့်အတွက် ဖွင့်မထားပါ',
  // Not a permission level but an ownership one: the sale belongs to whoever
  // wrote it down, so the words say whose it is rather than what rank you are.
  NOT_YOURS: 'ဤအရောင်းကို အခြားသူက မှတ်သားထားသည် — သင်ပြင်ခွင့် မရှိပါ',
  SUPER_ADMIN_ONLY: 'အဓိက စီမံခန့်ခွဲသူသာ လုပ်နိုင်သည်',
  ALREADY_SOLD: 'ဤလက်မှတ်ကို ရောင်းပြီးဖြစ်သည်',
  ALREADY_SETTLED: 'ဤစာအုပ်ကို ပြီးဆုံးပြီးဖြစ်သည်',
  NOT_AVAILABLE: 'မရနိုင်ပါ',
  NOT_RESERVED: 'သိမ်းထားခြင်း မရှိပါ',
  TICKET_VOID: 'ဤလက်မှတ်ကို ပယ်ဖျက်ထားသည်',
  NOT_YOUR_BOOK: 'ဤစာအုပ်မှာ သင့်ထံတွင် မရှိပါ',
  BOOK_NOT_ASSIGNED: 'ဤစာအုပ်ကို မထုတ်ပေးရသေးပါ',
  BOOK_CLOSED: 'ဤစာအုပ်ကို ပိတ်ထားပြီးဖြစ်သည်',
  BOOK_WITH_SELLER: 'ဤစာအုပ်သည် ရောင်းသူထံတွင် ရှိနေသည် — အရင် ပြန်အပ်ကြောင်း မှတ်ပါ',
  BOOKS_NOT_AVAILABLE: 'ဤစာအုပ်များ မရနိုင်ပါ',
  TRANSFER_BLOCKED: 'လွှဲပြောင်း၍ မရပါ',
  MONEY_STILL_OWED: 'ငွေ ကျန်ရှိနေသေးသည် — အရင် ရှင်းပါ',
  // Uploading a logo. Short on purpose: the English underneath carries the
  // detail, and these are read by an organiser at a desk, not in the field.
  SVG_REFUSED: 'SVG ဖိုင် လက်မခံပါ — PNG အဖြစ် သိမ်းပါ',
  BAD_IMAGE: 'ဤဖိုင်သည် ဓာတ်ပုံ မဟုတ်ပါ',
  WRONG_IMAGE_TYPE: 'ဖိုင်အမျိုးအစား မကိုက်ညီပါ',
  IMAGE_TOO_BIG: 'ဓာတ်ပုံ အရွယ်အစား ကြီးလွန်းသည်',
  BAD_COLOUR: 'အရောင်ကုဒ် မမှန်ပါ — #0B7285 ပုံစံ',
  // Dates and deadlines. Short on purpose: the English underneath carries the
  // detail, and a gloss that runs to three lines stops being a gloss.
  BAD_DATE: 'ရက်စွဲကို ဖတ်၍ မရပါ',
  IN_THE_PAST: 'ကုန်လွန်ပြီးသော ရက်စွဲ ဖြစ်သည်',
  TOO_FAR: 'အလွန်ဝေးသော ရက်စွဲ ဖြစ်သည်',
  CANNOT_MOVE_BACK: 'နောက်ပြန် ရွှေ့၍ မရပါ — ရှေ့သို့သာ',
  AFTER_DRAW: 'မဲဖောက်သည့်ရက် နောက်ပိုင်း ဖြစ်နေသည်',
  DUE_AFTER_FINAL: 'နောက်ဆုံးရက် ကျော်လွန်နေသည်',
  FINAL_PASSED: 'နောက်ဆုံးရက် ကုန်လွန်ပြီ ဖြစ်သည်',
  NO_FINAL_DEADLINE: 'နောက်ဆုံးရက် သတ်မှတ်ရသေးပါ',
  NO_CHECK_IN_DATE: 'အစီရင်ခံရမည့်ရက် သတ်မှတ်ရသေးပါ',
  VERSION_CONFLICT: 'အခြားသူတစ်ဦး ပြောင်းလဲထားပါသည်',
  BATCH_REJECTED: 'အမှားပါသဖြင့် တစ်ခုမှ မသိမ်းခဲ့ပါ',
  DUPLICATE_IN_BATCH: 'နှစ်ကြိမ် ထပ်နေသည်',
  RANGE_TOO_LARGE: 'အရေအတွက် များလွန်းပါသည်',
  RATE_LIMIT: 'ခဏစောင့်ပြီး ထပ်ကြိုးစားပါ',
  LOCK_TIMEOUT: 'အခြားသူ သိမ်းနေဆဲဖြစ်သည်',
  NOT_CONFIGURED: 'စနစ် မပြင်ဆင်ရသေးပါ',
  TIMEOUT: 'ဆာဗာမှ အဖြေပြန်ရန် အချိန်ကြာလွန်းသည်။ ခဏနေ ထပ်ကြိုးစားပါ',
  WRITE_UNCONFIRMED: 'သိမ်းဆည်းမှု အချိန်ကြာနေသည်။ မည်သည့်အရာ သိမ်းပြီးကြောင်း စစ်ဆေးနေသည် — ထပ်မံ မထည့်ပါနှင့်',
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
  TOO_MANY: 'တစ်ကြိမ်တည်း လုပ်ရန် အရေအတွက် များလွန်းသည်',
  TICKET_NOT_RELEASED: 'ဤလက်မှတ်ကို မရောင်းရသေးပါ',
  NOT_GENERATED: 'ထိုမျှလောက် လက်မှတ် မပြုလုပ်ရသေးပါ',
  TICKETS_IN_USE: 'အထက်ပါ လက်မှတ်အချို့ကို ရောင်းပြီးဖြစ်သည်',
  BOOKS_IN_USE: 'အထက်ပါ စာအုပ်အချို့ကို ထုတ်ပေးထားပြီးဖြစ်သည်',
  ABOVE_CEILING: 'စီစဉ်ထားသော အရေအတွက်ထက် ကျော်လွန်နေသည်',
  NUMBERING_CHANGED: 'လက်မှတ်နံပါတ် စနစ် ပြောင်းလဲထားသည် — မူလအတိုင်း ပြန်ထားပါ',
  NETWORK: 'အင်တာနက် ဆက်သွယ်မှု မရပါ',
  SERVER_ERROR: 'စနစ်တွင် အမှားဖြစ်နေသည်',

  /*
   * REFUSALS THAT ONLY THE SUPABASE BACKEND MAKES, and which had no Burmese at
   * all until the coverage test stopped measuring itself against the wrong
   * backend. i18n.test.mjs read the error codes out of `apps_script/*.gs`, so
   * the set a volunteer was guaranteed to be able to read was the set the
   * SPREADSHEET could produce. Every one of these was already reachable on the
   * live backend, and every one of them arrived in English.
   *
   * Short, like the rest: myError() puts the gloss above the server's own
   * sentence rather than replacing it, so the detail is still there underneath.
   */

  // Signing in. Which state it is matters — somebody waiting to be let in and
  // somebody who has been stopped need to do different things next.
  ACCOUNT_PENDING: 'ဤအကောင့်ကို ခွင့်ပြုရန် စောင့်ဆိုင်းနေသည်',
  ACCOUNT_SUSPENDED: 'ဤအကောင့်ကို ယာယီ ရပ်ဆိုင်းထားသည်',
  ACCOUNT_BANNED: 'ဤအကောင့်ကို ပိတ်သိမ်းလိုက်ပြီ',

  // Books moving between people.
  NOT_HELD: 'ဤစာအုပ်များ ထိုသူ့ထံတွင် မရှိပါ',
  NOTHING_TO_CONFIRM: 'အတည်ပြုစရာ စာအုပ် မရှိပါ',
  BOOKS_CHANGED_MEANWHILE: 'ဤစာအုပ်များကို အခြားသူက ခုနက ထုတ်ပေးလိုက်ပြီ',
  BOOK_HAS_SALES: 'ဤစာအုပ်တွင် အရောင်း မှတ်တမ်း ရှိနေသည် — အရင် ပြန်အပ်ပြီး ရှင်းပါ',

  // Dates: when selling stops, and the reporting rounds between now and the end.
  SALES_CLOSED: 'လက်မှတ် ရောင်းချချိန် ပြီးဆုံးသွားပါပြီ',
  AFTER_THE_DRAW: 'မဲဖောက်ပြီးနောက် ရောင်းချချိန် သတ်မှတ်၍ မရပါ',
  PAST_THE_WALL: 'နောက်ဆုံးရက် ကျော်လွန်၍ မရပါ',
  NO_SUCH_ROUND: 'ဤအကြိမ် မရှိပါ',
  OUT_OF_ORDER: 'အကြိမ်များ၏ ရက်စွဲ အစီအစဉ် မှားနေသည်',
  ROUND_CLOSED: 'ဤအကြိမ်ကို ပိတ်ပြီးဖြစ်သည်',
  ROUND_IS_LIVE: 'ဤအကြိမ်သည် လက်ရှိ အသုံးပြုနေဆဲ ဖြစ်သည်',

  // Writing money off for more than is owed.
  TOO_MUCH: 'ပမာဏ များလွန်းသည် — ကျန်ရှိငွေထက် ပိုနေသည်'
}

/**
 * The Burmese for a piece of interface text, or nothing if it is untranslated.
 *
 * `vars` fills {n}-style placeholders, so a sentence with a count in it can be
 * ONE translatable key instead of a fragment with a number stranded beside it.
 * Without this, "3 of your books are late" could only be translated as "of your
 * books are late" with the 3 outside — which reads as broken Burmese and puts
 * the number in the wrong place for a language that does not order it that way.
 *
 * The same substitution runs on the English, so the key and what a reader sees
 * cannot drift: there is one template and both languages fill it.
 */
export function fill(text, vars) {
  const t = String(text ?? '')
  if (!vars) return t
  return t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export function my(text, vars) {
  return fill(MY[String(text || '').trim()] || '', vars)
}

export function myError(code) {
  return MY_ERRORS[code] || ''
}
