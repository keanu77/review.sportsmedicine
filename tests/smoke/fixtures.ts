import { test as base } from '@playwright/test';
export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';
// Core behavior uses bundled system fonts; external font service outages are not app failures.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await use(page);
  },
});
