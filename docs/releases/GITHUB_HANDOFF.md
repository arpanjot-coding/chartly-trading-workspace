# Chartly GitHub handoff

Source repository: `arpanjot-coding/chartly-trading-workspace`. The separate `chartly-site` repository contains the static website and sample replay used for Vercel.

The [README](../../README.md) follows the presentation of [AVault](https://github.com/arpanjot-coding/AVault): a cover, actual app screenshots, a quick start, and links to project guides. The [Chartly cover](../assets/chartly-social-card.png) is 1280 × 640 and fits GitHub’s upload limit. After the repository exists, use [Settings → Social preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview) to upload it. The image in the README and the image in link previews are configured separately.

- [x] Capture the built chart, journal, and profiles with synthetic data in an isolated app.
- [x] Verify the sample journal opens the saved chart and the chart returns to the journal.
- [x] Verify the light-mode chart studies and annotation, replay step, and illustrative MT5 positions. The public homepage previews use only sample data.
- [x] Identify the upstream base and restore its license. The pre-rename backup matches [OpenAlgo commit `61243a0`](https://github.com/marketcalls/openalgo/commit/61243a0936b852ece0284c9e32c474b7194bdb8f) in the app entry point, project manifest, proxy config, and release notes. The restored [license](../../License.md) matches the upstream Git blob.
- [x] Prepare the Chartly source for publication. The local checkout arrived without Git history. The upstream source commit and license are recorded above.
- [x] Scan the source snapshot for local data and credential defaults. Runtime files, legacy evidence captures, notebook outputs, and unused vendor archives stay local. The included app screenshots use synthetic data. The identified credential defaults in example clients and manual tests were removed.
- [ ] Push the reviewed commit. Verify the README, image links, and CI on GitHub. Set the repository description and topics, enable private vulnerability reporting if available, and upload the social preview.
- [ ] Publish a tagged release only after the [app release gates](../plans/chartly-professional-platform/CHARTLY_QUALITY_AUDIT.md) appropriate to the release scope are verified.
