# Public ORACLE tour

The public entry point is `/tour.html`. It explains player and organizer workflows, the three themes, all twelve instruments, and preparation for offline use without asking visitors to create an account. Homepage, help, and application navigation link to it.

Screenshots contain fictional data only. They are browser captures of `/tour-examples.html`, whose static examples are rendered by the same UI components used in the application. They are not AI-generated images or production account screenshots. The example badge uses a reserved `.invalid` domain and cannot identify a real player.

## Updating examples

1. Edit the fictional fixtures in `scripts/tour/`. Keep all responses in memory; do not fetch live events or user data.
2. Run `npm ci`, then `npm run tour:build`. This regenerates the example page, its frame styles, and `public/tour-catalog.json` with renderer provenance.
3. Review and deploy the example page to staging. Open each catalog ID as `/tour-examples.html#<id>` in a browser. Capture the current viewport as a JPEG, keeping the example caption and application styles intact. Save the captures as `public/tour-images/<id>.jpg`.
4. Update each tour image’s width and height to its actual capture dimensions. Keep descriptive alternative text, lazy loading for below-the-fold pictures, and links to the full-size image. Check the narrow layout, anchors, and image loading before promotion.

The generated examples contain no app controller, executable scripts, forms, or active game links. Their controls are inert. Generation requires the development-only `jsdom` dependency; serving the committed public pages does not. The server serves screenshot names from an explicit allowlist. Public content does not query the database or grant event access.

The screenshot tour and example gallery are online public pages. Their larger image assets are deliberately excluded from the installed field kit’s offline cache. Gameplay’s existing offline preparation, account isolation, and explicit request sending are unchanged.

The tour is included in the production sitemap. The auxiliary example gallery uses `noindex,follow` to keep the descriptive tour as the discovery page; staging remains excluded from indexing. Publishing a page does not guarantee when search engines will index it.
