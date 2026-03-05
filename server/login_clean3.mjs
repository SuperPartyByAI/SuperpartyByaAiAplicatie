import puppeteer from 'puppeteer';
(async () => {
    console.log("-> Pornim instanta CURATA...");
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--window-size=1280,800', '--disable-blink-features=AutomationControlled']
    });    
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false, }); });
    try {
        await page.goto('https://login.twilio.com/u/login');
        await page.waitForTimeout(600000);
    } catch (e) {
        console.error(e.message);
    } finally {
        await browser.close();
    }
})();
