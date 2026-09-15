#!/usr/bin/env bash
# Every test. Needs node; nothing to install.
set -e
cd "$(dirname "$0")"
fail=0
for t in numbering.test.cjs settlement.test.cjs superadmin.test.cjs permissions.test.cjs approvals.test.cjs sellbook.test.cjs cache.test.cjs search.test.mjs emits.test.mjs bookrange.test.mjs loadorder.test.cjs numberinglock.test.cjs canonical.test.cjs expand.test.cjs ceiling.test.cjs active.test.cjs deadlines.test.cjs checkin.test.mjs holders.test.cjs refusals.test.mjs i18n.test.mjs whereis.test.mjs canonical-client.test.mjs gateparity.test.mjs backendswitch.test.mjs supabaseauth.test.mjs timeout.test.mjs storeload.test.mjs emptypayloads.test.mjs roles.test.mjs rolewords.test.mjs settlecopy.test.mjs days.test.mjs modalwiring.test.mjs refused.test.mjs settleguards.test.mjs userstatus.test.mjs noundef.test.mjs wording.test.mjs polling.test.mjs approvallinks.test.mjs sellercontact.test.mjs returndue.test.mjs supabaseload.test.mjs directreads.test.mjs booklife.test.cjs agentscope.test.cjs migrate.test.cjs portparity.test.mjs clientcoverage.test.mjs payloadshape.test.mjs permissionui.test.mjs moneyowed.test.mjs clientdates.test.mjs dates.test.mjs edgehandlers.test.mjs router.test.mjs payloads.test.mjs everyaction.test.mjs gsnoundef.test.mjs whoholds.test.mjs helperscope.test.mjs readshape.test.mjs; do
  [ -f "$t" ] || continue
  echo "── ${t%%.*}"
  node "$t" | tail -1
  node "$t" > /dev/null || fail=1
done
exit $fail
