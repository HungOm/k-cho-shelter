#!/usr/bin/env bash
# Every test. Needs node; nothing to install.
set -e
cd "$(dirname "$0")"
fail=0
for t in search.test.mjs emits.test.mjs bookrange.test.mjs yourstock.test.mjs checkin.test.mjs roundsnapshot.test.mjs backup.test.mjs issuepartial.test.mjs docs.test.mjs acknowledge.test.mjs changelog.test.mjs returncheck.test.mjs writeoff.test.mjs chasetoday.test.mjs whohadit.test.mjs checkinreport.test.mjs money.test.mjs ledger.test.mjs refusals.test.mjs i18n.test.mjs whereis.test.mjs canonical-client.test.mjs supabaseauth.test.mjs timeout.test.mjs storeload.test.mjs emptypayloads.test.mjs roles.test.mjs rolewords.test.mjs settlecopy.test.mjs days.test.mjs modalwiring.test.mjs refused.test.mjs settleguards.test.mjs settlecount.test.mjs userstatus.test.mjs noundef.test.mjs tokens.test.mjs branches.test.mjs wording.test.mjs polling.test.mjs approvallinks.test.mjs refusalsays.test.mjs findkeys.test.mjs sellercontact.test.mjs returndue.test.mjs supabaseload.test.mjs directreads.test.mjs wireshape.test.mjs clientcoverage.test.mjs payloadshape.test.mjs permissionui.test.mjs moneyowed.test.mjs clientdates.test.mjs dates.test.mjs edgehandlers.test.mjs router.test.mjs payloads.test.mjs everyaction.test.mjs whoholds.test.mjs helperscope.test.mjs readshape.test.mjs orgidentity.test.mjs branding.test.mjs logofile.test.mjs screencalls.test.mjs buyerreach.test.mjs contactpoints.test.mjs screenrender.test.mjs deskstock.test.mjs newseller.test.mjs receiptempty.test.mjs receiptshape.test.mjs history.test.mjs soldlock.test.mjs everytestruns.test.mjs reactive.test.mjs sourceanchors.test.mjs nudgeclient.test.mjs integrity.test.mjs bookdetail.test.mjs nudge.test.mjs ambiguousseller.test.mjs footerfit.test.mjs helpermoney.test.mjs booksold.test.mjs backontheshelf.test.mjs statement.test.mjs deltapaging.test.mjs pricefloor.test.mjs whowrote.test.mjs prizes.test.mjs freshinstall.test.mjs gate.test.mjs ticketrange.test.mjs softdelete.test.mjs bookrequest.test.mjs custodyledger.test.mjs moneyjournal.test.mjs resetcovers.test.mjs receipt.test.mjs reportback.test.mjs reportbalance.test.mjs deltabooks.test.mjs templates.test.mjs ticketart.test.mjs ranks.test.mjs harnessreach.test.mjs seedagree.test.mjs strictactions.test.mjs ticketscreen.test.mjs ticketcode.test.mjs generate.test.mjs verify.test.mjs verifypage.test.mjs qr.test.mjs printing.test.mjs session.test.mjs selfhost.test.mjs artworkpalette.test.mjs bookcanonical.test.mjs ticketsample.test.mjs printsheet.test.mjs resetplan.test.mjs seedplan.test.mjs sheettab.test.mjs icons.test.mjs blankticket.test.mjs cardlayout.test.mjs ticketspans.test.mjs arrange.test.mjs migrationsql.test.mjs; do
  [ -f "$t" ] || continue
  echo "── ${t%%.*}"
  # THE `if` AROUND THIS ASSIGNMENT IS LOAD-BEARING, not a style. `set -e` is on
  # above, so a bare `out=$(node "$t")` aborts the WHOLE gate at the first
  # failing suite — which exits non-zero having run a fraction of the suites and
  # looks exactly like a gate that worked. A condition context is what suspends
  # errexit. (kcho-shelter-8d, flagging it so it survives the next tidy-up.)
  if out=$(node "$t" 2>&1); then status=0; else status=$?; fi
  printf '%s\n' "$out" | tail -1
  # ONLY THE SUMMARY ON A GOOD RUN, and everything on a bad one. The previous
  # version piped through `tail -1` and then ran each suite a SECOND time to
  # read its status — so every suite ran twice, and the FAIL lines were thrown
  # away by the pipe. Grepping a gate log for FAIL therefore found nothing even
  # when suites had failed, which is how a red run got reported as green.
  if [ "$status" -ne 0 ]; then
    fail=1
    if printf '%s\n' "$out" | grep -q '^  FAIL'; then
      printf '%s\n' "$out" | grep '^  FAIL'
    else
      # A suite that threw before printing anything leaves no failures to show,
      # and an absence is indistinguishable from success. Say so out loud.
      echo "  CRASHED — exit $status with no failures printed"
      printf '%s\n' "$out" | tail -12 | sed 's/^/  | /'
    fi
  fi
done
exit $fail
