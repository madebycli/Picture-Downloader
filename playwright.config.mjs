import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/ui',
    timeout: 45_000,
    expect: {
        timeout: 7_500
    },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: [
        ['line'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }]
    ],
    outputDir: 'test-results',
    use: {
        viewport: { width: 1440, height: 900 },
        actionTimeout: 7_500,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome']
            }
        },
        {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox']
            }
        }
    ]
});
