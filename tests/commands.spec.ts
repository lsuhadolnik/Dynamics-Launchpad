import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import commands from '../app/commands.json' assert { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const distPath = path.resolve(__dirname, '../dist');
const manifest = JSON.parse(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8'));
const loader = manifest.content_scripts[0].js[0];
const harness = path.resolve(__dirname, 'harness.html');
const cmdsBase64 = Buffer.from(fs.readFileSync(path.join(distPath, 'app/commands.json'), 'utf-8')).toString('base64');

const gridCommands = new Set(['openGrid', 'quickFindFields', 'blurView', 'resetViewBlur', 'sendToFXB']);

const special = new Set([
  'openRecordSpotlight',
  'openList',
  'newRecord',
  'runFetchXmlSpotlight',
  'entityInfoSpotlight',
  'myRoles',
  'entityMetadata',
  'environmentDetails',
  'impersonateUserSpotlight',
  'impersonationResetSpotlight',
  'refreshEntityMetadata',
  'reloadData',
  'populateMin',
  'refresh',
  'perfCenter',
]);

// Workflow:
// 1. Load the harness page in record or grid mode based on the command.
// 2. Trigger Spotlight and search for the command by title.
// 3. Execute the command and assert either a runtime message or a UI effect.
test.describe('Commands', () => {
  for (const cmd of commands as { id: string; title: string; category: string }[]) {
    test(cmd.id, async ({ page }) => {
      const targetPage = gridCommands.has(cmd.id) ? 'grid' : 'record';
      const url =
        'file://' +
        harness +
        `?dist=${encodeURIComponent(distPath)}&loader=${encodeURIComponent(loader)}&page=${targetPage}&cmds=${encodeURIComponent(cmdsBase64)}`;
      await page.goto(url);
      await page.waitForFunction(() => (window as any).pref !== undefined);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('openSpotlight')));
      await page.waitForSelector('#dl-spotlight-input');
      await page.fill('#dl-spotlight-input', cmd.title);
      await page.click(`li[data-id="${cmd.id}"]`);
      if (!special.has(cmd.id)) {
        const messages = await page.evaluate(() => (window as any).recordedMessages);
        const last = messages[messages.length - 1];
        expect(last).toMatchObject({ type: 'sp:' + cmd.id, category: cmd.category });
      } else {
        switch (cmd.id) {
          case 'openRecordSpotlight':
          case 'openList':
          case 'newRecord':
            await expect(page.locator('#dl-spotlight-input')).toHaveAttribute('placeholder', 'Search entity...');
            break;
          case 'runFetchXmlSpotlight':
            await expect(page.locator('#dl-spotlight-info')).toBeVisible();
            break;
          case 'impersonateUserSpotlight':
            const msgs = await page.evaluate(() => (window as any).recordedMessages);
            expect(msgs[msgs.length - 1]).toMatchObject({ type: 'sp:search', category: 'Impersonation' });
            break;
          case 'impersonationResetSpotlight':
            const msgs2 = await page.evaluate(() => (window as any).recordedMessages);
            expect(msgs2[msgs2.length - 1]).toMatchObject({ type: 'sp:reset', category: 'Impersonation' });
            break;
          case 'refreshEntityMetadata':
            await page.waitForFunction(() =>
              (window as any).fetchLog.some((u: string) => u.includes('EntityDefinitions'))
            );
            break;
          case 'perfCenter':
            await page.waitForFunction(() => location.href.includes('perf=true'));
            break;
          default:
            // ensure no error
            await expect(page).toHaveTitle(/SWIFTPAD|Harness/);
        }
      }
    });
  }
});
