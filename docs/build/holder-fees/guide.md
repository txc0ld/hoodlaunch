# Holder fee sharing in the launch preview

The free launch form includes **Holder fee sharing** for the token being launched. This is separate from HOODRICH holdings and Pro access. It concerns the creator’s portion of future trading fees, not every fee collected by PONS.

Holder sharing is currently unavailable in HOODLABS. Selecting it blocks launch preparation and confirmation. Turn it off to prepare a normal launch with creator fees. No distributor is created and no recipient is changed by this preview.

The official PONS flow uses up to two additional wallet approvals after a token launches: create its distributor, then change its creator fee recipient to that distributor. Each costs gas. A distributor creation alone is not fee routing. Routing gives up the creator’s standard ability to redirect those fees; the protocol owner retains a timelocked override. Never assume funds can be recovered by undoing a UI setting.

After a confirmed or recovered launch, **Check holder fee status** reads the chain. It distinguishes no registered distributor, a registered distributor with a different recipient, and a recipient matching the distributor. The latter two remain **unverified**; matching addresses do not prove holder payouts work. A status lookup does not request signing, wallet permissions, or payment.

Holder claims belong to the [official PONS profile](https://www.ponsfamily.com/profile). HOODLABS does not calculate claim amounts, create epochs, promise yields, or manage holder funds.
